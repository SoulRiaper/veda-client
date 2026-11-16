# Template Engine

Статус: **beta / breaking change**, готовится к релизу 4.0.0; в `master`
ещё не влит. Движок построен по модели lit-html: шаблон статичен, значения
пишутся в DOM через Part-ы, а не парсятся как markup. `Component`, `Loop`,
`If`, `Slot`, `Place`, `Property`, `Relation` и `Value` используют новый
путь. `Virtual` остаётся на собственном `#prepareChildTemplates`.
Legacy-обходчик `Component._process` удалён в 4.0; рендер всегда идёт через
скомпилированные шаблоны и Part-ы.

## Главное правило

**Значение никогда не становится markup.** Всё, что приходит из `${}`, — это
данные: они попадают в текстовый узел, атрибут или свойство через DOM API.
Единственное исключение — **static-trusted** значения, которые автор шаблона
явно пометил как часть исходника (`unsafeStatic()`) или которые являются
кодом (Component class с `static tag`). Это то же правило, что в lit-html:
там статику сплайсит только `static.js`, а обычный `html` — никогда.

Static-trusted значение нельзя подделать данными: бренд — это `Symbol`,
поэтому ни `JSON.parse`, ни объект из сети не могут выглядеть как
`unsafeStatic()` (Lit защищает `unsafeStatic` ровно так же).

## Файлы

| Файл | Назначение |
|---|---|
| `src/template/TemplateResult.js` | `html`/`raw`/`safe`, `TemplateResult`, `unsafeStatic`, `nothing`/`noChange`/`unsafeHTML` |
| `src/template/Template.js` | компилятор, маркеры, кеш, `CompiledTemplate`, `render()` |
| `src/template/TemplateInstance.js` | инстанс шаблона и Part-ы |
| `src/template/security.js` | политика: имена, запрещённые атрибуты, URL-схемы |
| `src/template/markers.js` | случайные имена маркеров для компилятора и рендерера |
| `src/template/factories.js` | поздняя регистрация фабрик встроенных компонентов |
| `src/template/stats.js` | диагностические счётчики |

`BindingStrategy`/`PathBindingStrategy` удалены: стратегия фиксирована
marker-based. Это breaking change.

## Публичный контракт

```js
import {
  html, render, unsafeStatic, unsafeHTML, nothing, noChange,
} from 'veda-client';

const row = (item) => html`<div class="row ${item.cls}">${item.title}</div>`;
render(row({cls: 'a', title: 'Ada'}), document.querySelector('#app'));

// Имя тега/атрибута, если оно действительно статическое:
const tag = unsafeStatic('my-row');
html`<${tag} ${unsafeStatic('data-kind')}="row"></${tag}>`;
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
- `unsafeStatic(value)` — доверенная статика: имя тега, имя атрибута, `is`.
  Значение попадает в исходник шаблона до парсинга, поэтому **никогда** не
  передавайте туда ввод пользователя.
- `raw` по-прежнему возвращает строку. `${raw`...`}` в `html` — это текст;
  если нужен markup из значения, используйте `unsafeHTML`.

## Маркеры и Part-ы

Имена маркеров случайны на загрузку страницы (`data-veda-el-<token>`,
`data-veda-spread-<token>-<slot>`, текстовые маркеры `\uE000veda$<token>$<id>`),
как `lit$<random>$` в lit-html. Данные не могут ни угадать маркер, ни
подделать его: значения не попадают в markup, а namespace `data-veda-*`
запрещён для spread-значений.

- **ChildPart** — пустой текстовый узел-маркер в позиции `${}`/`{expr}`.
  Значения вставляются перед маркером; чужие Part-ы и соседние узлы не
  сдвигаются.
- **Element marker** — случайный атрибут на элементе, у которого есть
  Component/Attribute/Property/Event/Ref/Bind/Spread Part. При
  инстанцировании маркер удаляется, Part-ы получают реальный элемент.
  Коллизия маркеров — ошибка (шаблон повреждён), а не молчаливая перепривязка.

Part-ы:

| Part | Что делает |
|---|---|
| `ChildPart` | текст, `TemplateResult`, `Node`, массив, `nothing`/`noChange`, `unsafeHTML` |
| `AttributePart` | атрибут или свойство; boolean-атрибуты через `toggleAttribute` |
| `PropertyPart` | `:prop` на native/custom element |
| `EventPart` | один listener на элемент; handler резолвится в момент события |
| `RefPart` | `ref` с восстановлением после `update()` |
| `BindPart` | `bind` с проверкой простого пути |
| `AttributesPart` | `${attrs}`: объект атрибутов, применяемый через DOM API |

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
| Имя тега `<${Comp}>` | Component class с собственным `static tag` или `unsafeStatic('name')`; строка из данных и класс без своего тега — **ошибка** |
| Имя атрибута `${name}="..."` | `unsafeStatic` — имя; иначе `${attrs}`-слот, объект применяется через DOM |
| `is="${Comp}"` | Component class или `unsafeStatic('tag')`; иное — **ошибка** |
| Значение атрибута `class="a ${x}"` | `AttributePart` |
| Значение атрибута без кавычек `class=${x}`, `class = ${x}` | `AttributePart` |
| Текст `...${x}...` | `ChildPart` |
| `TemplateResult`/`Node`/массив | `ChildPart` с вложенным рендером |
| `${}` в `<script>`/`<style>` | **ошибка компиляции**; `{expression}` там тоже не работает |
| `${}` в HTML-комментарии | **ошибка компиляции**: значения не попадают в markup |
| `${}` в `key`/`as`/height на Loop/If/Virtual | **ошибка**: это статическая конфигурация |
| `${}` в `ref`/`bind`/`on*`/`is` | **ошибка**: используйте `{expression}` / `unsafeStatic` |
| `${}` во вложенном `<template>` | **ошибка**; `{expression}` там тоже не работает |
| Статический `on*`-атрибут или `srcdoc` в шаблоне | **ошибка компиляции**: `{expression}` / `unsafeHTML()` |
| `:srcdoc`, `:on*`, `:innerHTML`, `:outerHTML` | **ошибка компиляции**: HTML-синки только через `unsafeHTML()` |

`${attrs}` принимает **объект** (или `Map`), а не строку:

```js
html`<button ${this.state.buttonAttrs}>go</button>`
// {class: 'primary', '?disabled': true, '@click': this.onClick,
//  'aria-label': 'Go', '.value': 'x'}
```

- `name` — атрибут через `setAttribute`;
- `?name` — boolean-атрибут (`true`/`false`);
- `@name` — listener, значение обязано быть функцией;
- `.name` — свойство самого элемента (не `state` компонента).

Ключи, которых не стало в объекте, удаляются со следующего обновления.
Из данных запрещены: `on*` (только `@`), `srcdoc`, `innerHTML`/`outerHTML`,
framework-атрибуты (`items`, `condition`, `key`, `as`, `item-key`,
`height`, `item-height`, `overscan`), `bind`, `ref`, `about`, `property`,
`rel`, `is`, `slot` и namespace `data-veda-*`. `javascript:`/`vbscript:`
URL-значения отвергаются (в том числе записанные через `{expr}`).

## Кеш

- `WeakMap<TemplateStringsArray, Map<shape, CompiledTemplate>>` — один
  call-site компилируется один раз.
- `shape` учитывает только static-trusted значения (имена тегов, атрибутов,
  `is`). Динамические `${}` и spread-объекты новый шаблон не создают.
- `shape` также учитывает, стал ли attr-name-слот именем или spread-слотом,
  поэтому такие call-site переклассифицируются на каждый вызов.
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

## Trusted Types

Компилятор присваивает исходник в `template.innerHTML` через политику
`veda-template` (`createHTML`), как lit-html делает со своей политикой
`lit-html`. Это позволяет работать под
`Content-Security-Policy: require-trusted-types-for 'script'`.

## Ограничения

1. `Virtual` вне marker-engine.
2. `Slot`-проекция использует legacy-строку `host.template`; `${}` и spread
   внутри спроецированного контента остаются запечёнными/потерянными.
3. Нет comment-маркеров, SSR/hydration и morph-стратегии.
4. Нет директив `classMap`/`styleMap`/`repeat`/`cache`; есть только
   `nothing`/`noChange`/`unsafeHTML`/`unsafeStatic`.
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

- `npm run test:unit` — 751 тестов.
- `npm run test:benchmark` — 22 бенчмарка.
- `test/TemplateEngine.test.js` — кеш, markers, patch, дочерние компоненты,
  refs, nested TemplateResult, `nothing`/`noChange`/`unsafeHTML`,
  `unsafeStatic`, spread, `render()`, `is`/script/style/framework-attr/URL
  ошибки.
- `test/Security.test.js` — данные не становятся markup или capability:
  entity-скобки, `items`/`condition` из данных, подмена маркера, `on*`,
  `srcdoc`, `javascript:`.
