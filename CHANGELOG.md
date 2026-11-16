# Changelog

All notable changes to Veda Client Framework will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Prepared as 4.0.0. Not merged to `master` yet._

### Breaking
- `html` now returns a `TemplateResult` object; it no longer extends `String`.
  Mount it with `render(result, container)` or return it from
  `Component.render()`. `String(result)` remains only as a deprecated
  diagnostic serializer.
- **A `${}` value never becomes markup.** It is a text/attribute/spread value.
  Dynamic tag names and attribute names are no longer interpolated: they
  require an authored name, a Component class that declares its own
  `static tag`, or `unsafeStatic(value)`. A plain string in a name position
  throws; a class without its own `static tag` is an error instead of
  inheriting `veda-component`.
- `${attrs}` now takes an **object** (or `Map`) and is applied through the DOM
  API (`name`, `?boolean`, `.property`, `@event`). Attribute snippets written
  as strings are no longer parsed; a string throws with a migration message.
- `${}` inside HTML comments is a compile error (it used to be escaped into
  the comment).
- Data (a spread object) may not set `on*` content attributes, `srcdoc`,
  `innerHTML`/`outerHTML`, framework attributes (`items`, `condition`, `key`,
  `as`, `item-key`, `height`, `item-height`, `overscan`), `bind`, `ref`,
  `about`, `property`, `rel`, `is`, `slot` or the reserved `data-veda-*`
  namespace.
- `javascript:`/`vbscript:` values are refused for `href`, `src`, `action`,
  `formaction`, `poster` and similar URL attributes, including values written
  with `{expression}`.
- `:srcdoc`, `:on*`, `:innerHTML` and `:outerHTML` are compile errors; HTML
  sinks go through `unsafeHTML()` and handlers through `{expression}`.
- `PathBindingStrategy`/`BindingStrategy` were removed. Parts are now
  marker-based (text markers for ChildParts, a randomized element attribute
  for element Parts) and do not use DOM paths. Custom `bindingStrategy` hooks
  no longer run.
- `Component._process()` and its legacy helpers were removed together with
  `_getRenderEffectsCount()`, `_extractRenderEffects()`,
  `_cleanupAllEventListeners()`, `_extractEventListeners()` and
  `_stopEventListeners()`. Rendering always goes through compiled templates
  and Parts. `post()` is called without the mounted fragment.
- `${}` inside `<script>`/`<style>`, a nested `<template>`, framework
  configuration attributes (`key`, `as`, heights) and `ref` is a compile
  error. Those positions are static or unsupported; there is no `{expression}`
  alternative for `<script>`/`<style>`/`<template>` — build those nodes
  imperatively.
- `items` and `condition` are reactive attributes and use `{expression}`;
  `bind` and `on*` handlers take `{expression}`. A static `on*` attribute is
  now a compile error, and `srcdoc` is not supported in templates.
- `is` values are validated as custom-element tag names. A class with
  `static tag` or a valid tag string is accepted; arbitrary strings throw
  instead of injecting attributes.

### Added
- Marker-based `ChildPart`/`AttributePart`/`PropertyPart`/`EventPart`/
  `RefPart`/`BindPart`/`AttributesPart` renderer with in-place patching.
- `AttributesPart` (`${attrs}` spread): an object of attributes applied
  through the DOM API, with stale-key removal.
- `unsafeStatic()` for trusted static source in name positions, branded with a
  symbol so JSON/data can never forge it (same design as lit-html's
  `static.js`).
- `render(result, container)` standalone entry point.
- `nothing`, `noChange` and `unsafeHTML()` sentinels/directive.
- Randomized marker names per page load and a reserved `data-veda-*`
  namespace; marker collisions fail loudly instead of rebinding Parts.
- Trusted Types policy (`veda-template`) for the compiled `innerHTML`.
- `src/template/security.js`: attribute-name policy, forbidden framework
  attributes, URL-scheme guard.
- Template compilation cache keyed by call-site / template source, including
  `html('...')`.
- `ExpressionParser.compile()` cache for compiled safe/complex expressions.
- `Loop`, `If`, `Slot`, `Place`, `Property`, `Relation` and `Value` use
  compiled templates and Part instances instead of re-parsing their content.
- Nested `TemplateResult` instances are reused across `update()`.
- `TEMPLATE_ENGINE.md` updated for the marker engine and the static/spread
  contract.

### Changed
- `update()` reuses DOM nodes, child components, refs and focus when the
  template is unchanged (previously the whole subtree was replaced).
- Parent `${}` values are propagated to a child only when the child renders
  the parent-authored `CompiledTemplate`; a child's own `${}` values are no
  longer overwritten.
- `EventPart` resolves the handler at dispatch time, so replacing
  `this.state.handler` works without remount.
- `Place` patches moved nodes in place instead of remounting on every
  `update()`.
- `Slot` reuses its template instance when the projection and context are
  unchanged.
- `Value`/`Property`/`Relation` only replace changed value ranges and reuse
  unchanged nodes/template instances.
- `raw` passed as a `${}` value is inserted as text (DOM-escaped), not markup;
  return `raw` from `render()` or use `unsafeHTML()` for trusted markup.
- `html('...')` with interpolation values throws instead of being silently
  compiled as a plain string; pass values through the `html` tag.
- `items`/`condition` upgrade a semantic Loop/If only on a native element; on
  a user component they stay ordinary reactive attributes.
- `TEMPLATE_ENGINE` diagnostics version is `templateresult-parts-v3`.

### Fixed
- Data can no longer reach the compiled template source: entity-encoded braces
  in a snippet (`&#123;…&#125;`) are not decoded into an `{expression}`.
- `items`/`condition` supplied by data can no longer turn an element into a
  Loop/If and execute the value as JavaScript.
- A data-driven attribute can no longer forge the compiler marker
  (`data-veda-*`) and rebind a Part/ref to another element.
- Spread values can no longer inject `href="javascript:"`, `srcdoc`,
  `on*` content attributes or framework attributes.
- Dynamic tag names can no longer create `script`/`style`/`iframe` elements or
  inject markup; spread values can no longer be parsed as markup at all.
- `:srcdoc`/`:on*` no longer bypass the static `srcdoc`/`on*` policy.
- Static `on*` handlers inside a nested `<template>` are now rejected like
  everywhere else.
- `${}` cell values no longer shift sibling Parts; earlier ChildParts resolve
  from their own markers.
- Parent `update()` no longer overwrites a child component's own `${}`
  values.
- `EventPart` no longer keeps a stale dynamic handler after `update()`.
- `<!--` inside an attribute value is treated as data, not as an HTML
  comment, so the value stays a Part and `update()` patches instead of
  remounting.
- Static JS/CSS braces in `<script>`/`<style>` are no longer mistaken for
  `{expr}`.
- `is="${Comp}"` resolves a Component class to `static tag` and validates the
  result; single-quoted/unquoted values cannot inject attributes.
- Unquoted attribute values stay dynamic Parts; `${}` in raw text is rejected
  instead of being half-escaped.
- `DocumentFragment` values are removed cleanly on the next update.
- `clearTemplateCache()` clears per-call-site templates too; caches are LRU.
- DOM nodes are no longer wrapped by reactive proxies; this fixes
  `Node.contains()` brand-check errors when `refs` live on reactive state.
- `Place` re-registers author `refs` after a parent `update()`; refs inside a
  nested `TemplateResult` are restored too.
- `Property` lang changes invalidate the value cache.
- Template-cache shapes are JSON-keyed and include static-trusted names, so
  different static values cannot reuse each other's template.

## [3.0.0] - 2025-11

### Added
- Fine-grained reactivity system with automatic dependency tracking
- Batched async effect execution via microtask queue
- Component reactivity with reactive expressions in templates
- Loop component with key-based reconciliation
- If component for conditional rendering
- Property and Relation components for RDF data binding
- watch() API for side effects on reactive state changes
- computed() for derived values
- Infinite loop detection (max 100 triggers)
- Full TypeScript type definitions
- Comprehensive documentation (API, Reactivity, Security, Troubleshooting)

### Changed
- **BREAKING:** Effects now run asynchronously (use flushEffects() in tests)
- **BREAKING:** Loop/If components use new syntax with component references
- **BREAKING:** Expression parser is stricter (only property access, no operators)
- Component `this.state` is now automatically reactive (no need for manual reactive() call)
- Component lifecycle methods are now async-friendly

### Deprecated
- None

### Removed
- Manual model subscription in components (replaced by automatic reactivity)

### Fixed
- Race conditions in concurrent effect flushes
- Circular reference handling in reactive proxies
- Prototype pollution prevention

### Security
- Unified `{expr}` syntax with auto-detection: simple property access is CSP-compatible (no eval), complex expressions (operators, ternaries, function calls) use safe evaluation with result sanitization
- safe() function removes `{expr}` to prevent template injection
- Double protection against XSS: result sanitization + processed node marking

## [1.x] - Previous versions

Legacy version without reactive system. See git history for details.

