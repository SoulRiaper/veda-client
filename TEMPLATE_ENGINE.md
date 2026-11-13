# Template Engine (реализация варианта B)

Статус: движок внедрён. `Component`, `Loop`, `If`, `Slot`, `Place`,
`Property`, `Relation` и `Value` работают через `TemplateResult` +
скомпилированные шаблоны + Part-ы. `Virtual` пока остаётся на собственном
ручном пути `#prepareChildTemplates` (он не используется в проекте и
отложен); `Component._process` им уже не вызывается.

## Что появилось

| Файл | Назначение |
|---|---|
| `src/template/TemplateResult.js` | `html`/`raw`/`safe`, `TemplateResult extends String` |
| `src/template/Template.js` | компилятор, кеш, `CompiledTemplate` |
| `src/template/TemplateInstance.js` | инстанс шаблона и Part-ы |
| `src/template/BindingStrategy.js` | сменная стратегия поиска узлов (path/reference) |
| `src/template/factories.js` | поздняя регистрация фабрик встроенных компонентов |
| `src/template/TemplateResult.d.ts` | типы `TemplateResult` |

## Публичный контракт

```js
import { html, raw, safe, TemplateResult } from 'veda-client';

const result = html`<div class="row {this.state.cls}">{this.state.title}</div>`;
```

- `html` возвращает `TemplateResult`.
- `TemplateResult extends String`, поэтому работают:
  - `String(result)`, `result.toString()`, `result.includes(...)`;
  - `element.innerHTML = result`;
  - конкатенация и передача в API, ожидающие строку.
- `result.strings` и `result.values` доступны рендереру и инструментам.
- `raw` по-прежнему возвращает обычную строку (исторический контракт).
- `safe` не изменился.

## Пайплайн рендера

```
render()
  → TemplateResult { strings, values }
  → compileTemplate()
      → кеш по identity strings + shape key
      → сканирование HTML: {expr} и ${value}
      → <template> со статическим скелетом
      → PartDescriptor[] (text / attribute / property / event / ref / bind)
  → CompiledTemplate.instantiate(context, host, options)
      → clone скелета
      → bindingStrategy.resolve(...) для каждого дескриптора
      → создание дочерних компонентов
      → создание Part-ов
  → mount(container)  (только при первом рендере/смене шаблона)
```

При повторном `update()` с тем же шаблоном:

```
instance.setResult(newResult)
  → части обновляют только изменившиеся значения
  → DOM-узлы, дочерние компоненты, refs и слушатели сохраняются
```

Если `render()` вернул другой шаблон, старый инстанс уничтожается и
монтируется новый. Поведение соответствует старому `replaceChildren`, но
только при фактической смене шаблона.

## Поддерживаемый синтаксис

### `{expr}` — реактивное выражение Veda

```html
<div class="{this.state.cls}">{this.state.title}</div>
<button onclick="{save}">Save</button>
<input bind="{this.state.query}">
<child-component :model="{this.state.model}"></child-component>
<div ref="box"></div>
```

Каждое выражение компилируется один раз (кеш `ExpressionParser.compile`) и
подключается к Part-у через `effect`. Part пишет в DOM только при изменении
значения.

### `${value}` — ленивое значение шаблона

```js
html`<div class="row ${this.state.cls}">${this.state.title}</div>`
```

Правила позиционирования:

| Позиция | Поведение |
|---|---|
| Имя тега `<${Comp}>`, `</${Comp}>` | статически сворачивается |
| Имя атрибута `<div ${name}="...">` | статически сворачивается |
| Сниппет атрибутов `${attrs}` | статически сворачивается как markup |
| `is="${Comp}"` | статически сворачивается и экранируется |
| Значение атрибута `class="a ${x}"` | `AttributePart` |
| Текст `...${x}...` | `ChildPart` |
| `TemplateResult`/`Node`/массив | `ChildPart` с вложенным рендером |

Значения `${}` не являются реактивными сами по себе: они обновляются при
`update()`. Реактивность — за `{expr}`.

## Кеш

- `WeakMap<TemplateStringsArray, Map<shape, CompiledTemplate>>` — один
  call-site компилируется один раз.
- `Map<string, CompiledTemplate>` (LRU, 1000) — для шаблонов, пришедших
  строками (`this.template`, legacy-компоненты).
- `shape` учитывает только статически свёрнутые значения (имена тегов,
  `is`, raw-сниппеты). Динамические `${}` не создают новый шаблон.
- `${}` внутри контента дочернего компонента пробрасываются в него как
  `values`; родительский шаблон не перекомпилируется при их изменении.
- `ExpressionParser` кеширует скомпилированные safe/complex выражения
  (2000 записей).

## Что изменилось в lifecycle

- `update()` больше не пересоздаёт DOM, если шаблон тот же.
- Дочерние компоненты переживают `update()` родителя.
- `refs` стабильны между `update()`; при смене шаблона старые refs
  очищаются.
- `rendered` по-прежнему ждёт дочерние компоненты, созданные при первом
  рендере, в `If`-контенте и элементах `Loop`.
- При disconnect DOM больше не удаляется принудительно — как и раньше,
  узел остаётся в отсоединённом поддереве, но эффекты и слушатели
  останавливаются.
- `Place` перемещает узлы один раз и дальше патчит их на месте: focus,
  state и анимации overlay сохраняются при `update()`.
- `Slot` переиспользует свой `TemplateInstance`, если проекция и контекст
  не изменились; fallback `${}` обновляется через values.
- `Value`/`Property`/`Relation` переиспользуют узлы/инстансы неизменившихся
  значений; при изменении значения заменяется только его диапазон.
- DOM-узлы не оборачиваются reactive-proxy: native-методы (`Node.contains`,
  `appendChild` и т.п.) требуют настоящий `Node`, а не Proxy. Это важно для
  `refs`, которые могут лежать на reactive `state`.

## Ограничения текущего этапа

1. `raw` возвращает строку, а не `TemplateResult`.
2. `Virtual` пока использует собственный `#prepareChildTemplates`; сам `Component._process` оставлен только для обратной совместимости и внешних компонентов.
3. Проектируемый контент `Slot` берётся из `host.template` (legacy-строка),
   поэтому `${}` внутри **спроецированного** контента остаётся запечённым;
   fallback и обычные дочерние шаблоны values пробрасывают.
4. Нет comment-маркеров, SSR/hydration и morph-стратегии. Стратегия по
   умолчанию — `PathBindingStrategy` (прямые пути/ссылки, без лишних узлов).
   `BindingStrategy` уже выделен как точка замены.
5. `ChildPart` с вложенным `TemplateResult` пересоздаёт вложенный инстанс
   при каждом коммите, если значение структурное. Для текущих шаблонов это
   редкий путь.


## Диагностика в браузере

Движок публикует несколько диагностических глобальных переменных:

```js
window.__VEDA_TEMPLATE_ENGINE__      // 'templateresult-parts-v2'
window.__VEDA_TEMPLATE_STATS__()     // снимок счётчиков
window.__VEDA_TEMPLATE_RESET_STATS__()
```

Счётчики:

- `compiles` / `cacheHits` — сколько шаблонов скомпилировано и сколько раз
  сработал кеш;
- `instances` / `mounts` — сколько инстансов создано и смонтировано;
- `patches` — сколько раз инстанс обновлялся через `setResult`/`setValues`;
- `componentCreates` — сколько дочерних компонентов создано;
- `domWrites` — сколько фактических записей в DOM сделали Part-ы.

Для A/B-сравнения удобно дополнительно считать мутации DOM через
`MutationObserver` и проверять, что при изменении модели/валидации не
происходит массового `childList` (старый движок пересоздавал поддеревья).

## Проверка

- `npm run test:unit` — 715 тестов.
- `npm run test:benchmark` — бенчмарки проходят.
- `test/TemplateEngine.test.js` — новые тесты на кеш, patch, дочерние
  компоненты, refs, nested TemplateResult и смену шаблона.

Ориентировочный результат на синтетическом компоненте (JSDOM, 400
элементов, 100 выражений, 100 обработчиков):

| Операция | До | После |
|---|---|---|
| `update()` | 17.5 ms | ~0.38 ms |
| Компиляций шаблона | 0 кеша | 1 на call-site |
| Инстансов | новый DOM каждый раз | 1 при том же шаблоне |
