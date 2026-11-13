# Template Engine

Статус: **beta / breaking change**, готовится к релизу 4.0.0; в `master`
ещё не влит. Движок переведён на marker-based Parts по образцу lit-html:
Part-ы находят свои узлы по маркерам, а не по путям в DOM. `Component`,
`Loop`, `If`, `Slot`, `Place`, `Property`, `Relation` и `Value` используют
новый путь. `Virtual` остаётся на собственном `#prepareChildTemplates`.
Legacy-обходчик `Component._process` удалён в 4.0; рендер всегда идёт через
скомпилированные шаблоны и Part-ы.

## Файлы

| Файл | Назначение |
|---|---|
| `src/template/TemplateResult.js` | `html`/`raw`/`safe`, `TemplateResult`, `nothing`/`noChange`/`unsafeHTML` |
| `src/template/Template.js` | компилятор, маркеры, кеш, `CompiledTemplate`, `render()` |
| `src/template/TemplateInstance.js` | инстанс шаблона и Part-ы |
| `src/template/markers.js` | общие константы маркеров для компилятора и рендерера |
| `src/template/factories.js` | поздняя регистрация фабрик встроенных компонентов |
| `src/template/stats.js` | диагностические счётчики |

`BindingStrategy`/`PathBindingStrategy` удалены: стратегия фиксирована
marker-based. Это breaking change.

## Публичный контракт

```js
import { html, render, unsafeHTML, nothing, noChange } from 'veda-client';

const result = html`<div class="row ${this.state.cls}">${this.state.title}</div>`;
render(result, document.querySelector('#app'));
```

- `html` возвращает `TemplateResult`, **не** `String`.
- `String(result)`/`result.toString()` остаются только как deprecated
  диагностический сериализатор. Для рендера используйте `render()` или
  `Component.render()`.
- `render(result, container)` — Lit-style точка входа: первый рендер
  монтирует шаблон, повторный с тем же call-site патчит DOM.
- `nothing` очищает позицию, `noChange` оставляет предыдущее значение.
- `unsafeHTML(value)` вставляет доверенный markup. Обычные строки всегда
  являются текстом.
- `raw` по-прежнему возвращает строку. `${raw`...`}` в `html` — это текст;
  если нужен markup из значения, используйте `unsafeHTML`.

## Маркеры и Part-ы

При компиляции в шаблон вставляются служебные узлы:

- **ChildPart** — пустой текстовый узел-маркер в позиции `${}`/`{expr}`.
  Значения вставляются перед маркером; чужие Part-ы и соседние узлы не
  сдвигаются.
- **Element marker** — атрибут `data-veda-element` на элементе, у которого
  есть Component/Attribute/Property/Event/Ref/Bind Part. При инстанцировании
  маркер удаляется, Part-ы получают реальный элемент.

Part-ы:

| Part | Что делает |
|---|---|
| `ChildPart` | текст, `TemplateResult`, `Node`, массив, `nothing`/`noChange`, `unsafeHTML` |
| `AttributePart` | атрибут или свойство; boolean-атрибуты через `toggleAttribute` |
| `PropertyPart` | `:prop` на native/custom element |
| `EventPart` | один listener на элемент; handler резолвится в момент события |
| `RefPart` | `ref` с восстановлением после `update()` |
| `BindPart` | `bind` с проверкой простого пути |

## Поддерживаемый синтаксис

### `{expr}` — реактивное выражение Veda

```html
<div class="{this.state.cls}">{this.state.title}</div>
<button onclick="{save}">Save</button>
<input bind="{this.state.query}">
<child-component :model="{this.state.model}"></child-component>
<div ref="box"></div>
```

Каждое выражение компилируется один раз и подключается к Part-у через
`effect`. Part пишет в DOM только при изменении значения.

### `${value}` — ленивое значение шаблона

```js
html`<div class="row ${this.state.cls}">${this.state.title}</div>`
```

| Позиция | Поведение |
|---|---|
| Имя тега `<${Comp}>` | статически сворачивается и валидируется: только имя элемента |
| Имя атрибута `<div ${name}="...">` | сворачивается и валидируется; `on*` — только с `{expression}` |
| Сниппет атрибутов `${attrs}` | статический markup; запрещены `<`/`>`, `{}`, inline `on*` и `srcdoc` |
| `is="${Comp}"` | класс с `static tag` или валидный custom-element tag; иное — ошибка |
| Значение атрибута `class="a ${x}"` | `AttributePart` |
| Значение атрибута без кавычек `class=${x}`, `class = ${x}` | `AttributePart` |
| Текст `...${x}...` | `ChildPart` |
| `TemplateResult`/`Node`/массив | `ChildPart` с вложенным рендером |
| `${}` в `<script>`/`<style>` | **ошибка компиляции**; `{expression}` там тоже не работает |
| `${}` в `key`/`as`/height на Loop/If/Virtual | **ошибка**: это статическая конфигурация |
| `${}` в `ref` | **ошибка**: это статическое имя |
| `${}` в `bind`/`on*` | **ошибка**: используйте `{expression}` |
| `${}` во вложенном `<template>` | **ошибка**; `{expression}` там тоже не работает |
| Статический `on*`-атрибут или `srcdoc` в шаблоне | **ошибка компиляции**: `{expression}` / `unsafeHTML()` |

Динамические имена тегов/атрибутов и сниппеты валидируются: `${}` не может
добавить элемент, `on*`-handler или `srcdoc`, в том числе через склейку имени
из нескольких `${}` или пробел перед `=`. `on${name}="{expression}"`
разрешён, `on${name}="code()"` — нет. Сниппет — статический markup: `<`/`>`,
`{}`, inline `on*` и `srcdoc` бросают ошибку компиляции, а статические
`on*`/`srcdoc` в шаблоне запрещены (для доверенного markup есть
`unsafeHTML()`).

## Кеш

- `WeakMap<TemplateStringsArray, Map<shape, CompiledTemplate>>` — один
  call-site компилируется один раз.
- `shape` учитывает только статически свёрнутые значения (имена тегов,
  атрибутов, `is`, attr-сниппеты). Динамические `${}` новый шаблон не
  создают.
- `Map<string, CompiledTemplate>` (LRU, 1000) — для шаблонов-строк,
  включая `html('...')`.
- `ExpressionParser` кеширует скомпилированные безопасные/сложные выражения
  (2000 записей).

## Lifecycle и значения

- `update()` с тем же `CompiledTemplate` патчит Part-ы и сохраняет DOM,
  дочерние компоненты, `refs`, фокус.
- Родитель передаёт свои `${}` values дочерним компонентам **только** если
  дочерний компонент рендерит parent-authored `CompiledTemplate`. Если
  ребёнок рендерит собственный `html`, его values не перезаписываются.
- Вложенный `TemplateResult` переиспользует `TemplateInstance`, если
  `CompiledTemplate` не изменился: фокус и состояние формы сохраняются.
- `EventPart` резолвит handler при каждом событии, поэтому замена
  `this.state.handler` подхватывается без remount.
- При disconnect DOM отсоединённого поддерева не вычищается: останавливаются
  эффекты/слушатели, но `textContent` не меняется.
- При смене шаблона старый `TemplateInstance` уничтожается, новый
  монтируется через `replaceChildren`.

## Ограничения

1. `Virtual` вне marker-engine.
2. `Slot`-проекция использует legacy-строку `host.template`; `${}` внутри
   спроецированного контента остаётся запечённым.
3. Нет comment-маркеров, SSR/hydration и morph-стратегии.
4. Нет директив `classMap`/`styleMap`/`repeat`/`cache`; есть только
   `nothing`/`noChange`/`unsafeHTML`.
5. `TemplateResult.toString()` — только диагностика; не используйте
   `innerHTML = html` как способ рендера.

## Диагностика

```js
window.__VEDA_TEMPLATE_STATS__()
// {compiles, cacheHits, instances, mounts, patches, componentCreates, domWrites, ...}
window.__VEDA_TEMPLATE_RESET_STATS__()
window.__VEDA_TEMPLATE_ENGINE__ // 'templateresult-parts-v3'
```

## Проверка

- `npm run test:unit` — 745 тестов.
- `npm run test:benchmark` — 22 бенчмарка.
- `test/TemplateEngine.test.js` — кеш, markers, patch, дочерние компоненты,
  refs, nested TemplateResult, `nothing`/`noChange`/`unsafeHTML`, `render()`,
  `is`/script/style/framework-attr ошибки.
