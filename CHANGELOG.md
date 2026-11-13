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
- `PathBindingStrategy`/`BindingStrategy` were removed. Parts are now
  marker-based (text markers for ChildParts, `data-veda-element` for element
  Parts) and do not use DOM paths. Custom `bindingStrategy` hooks no longer
  run.
- `Component._process()` and its legacy helpers were removed together with
  `_getRenderEffectsCount()`, `_extractRenderEffects()`,
  `_cleanupAllEventListeners()`, `_extractEventListeners()` and
  `_stopEventListeners()`. Rendering always goes through compiled templates
  and Parts.
- `${}` inside `<script>`/`<style>`, a nested `<template>`, framework
  configuration attributes (`key`, `as`, heights) and `ref` is a compile
  error. Those positions are static or unsupported; there is no `{expression}`
  alternative for `<script>`/`<style>`/`<template>` — build those nodes
  imperatively.
- `items` and `condition` are reactive attributes and use `{expression}`;
  `bind` and `on*` handlers take `{expression}`. A static `on*` attribute is
  now a compile error, and `srcdoc` is not supported in templates. Use
  `unsafeHTML()` or set them imperatively.
- Dynamic tag names, attribute names and `${attrs}` snippets are validated.
  `${attrs}` snippets are static markup: they may not contain `<`, `>`, `{}`,
  `on*` or `srcdoc`. `on${name}="{expression}"` is still allowed;
  `on${name}="code()"` throws.
- `is` values are validated as custom-element tag names. A class with
  `static tag` or a valid tag string is accepted; arbitrary strings throw
  instead of injecting attributes.

### Added
- Marker-based `ChildPart`/`AttributePart`/`PropertyPart`/`EventPart`/
  `RefPart`/`BindPart` renderer with in-place patching.
- `render(result, container)` standalone entry point.
- `nothing`, `noChange` and `unsafeHTML()` sentinels/directive.
- Template compilation cache keyed by call-site / template source, including
  `html('...')`.
- `ExpressionParser.compile()` cache for compiled safe/complex expressions.
- `Loop`, `If`, `Slot`, `Place`, `Property`, `Relation` and `Value` use
  compiled templates and Part instances instead of re-parsing their content.
- Nested `TemplateResult` instances are reused across `update()`.
- `TEMPLATE_ENGINE.md` updated for the marker engine.

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
- `TEMPLATE_ENGINE` diagnostics version is `templateresult-parts-v3`.

### Fixed
- Parent `update()` no longer overwrites a child component's own `${}`
  values.
- `EventPart` no longer keeps a stale dynamic handler after `update()`.
- `${}` values can no longer smuggle `on*` handlers or `srcdoc` through
  splitted names, trailing whitespace or a snippet followed by `=`.
- `${}` snippets can no longer inject `{expression}` code into the compiled
  template.
- `<!--` inside an attribute value is treated as data, not as an HTML
  comment, so the value stays a Part and `update()` patches instead of
  remounting.
- `${attrs}` after an unquoted literal attribute value is folded as markup
  again; the scanner no longer leaks a token into the attribute name.
- Static JS/CSS braces in `<script>`/`<style>` are no longer mistaken for
  `{expr}`.
- `is="${Comp}"` resolves a Component class to `static tag` and validates the
  result; single-quoted/unquoted values cannot inject attributes.
- Unquoted attribute values stay dynamic Parts; comments are escaped;
  `${}` in raw text is rejected instead of being half-escaped.
- `DocumentFragment` values are removed cleanly on the next update.
- `clearTemplateCache()` clears per-call-site templates too; caches are LRU.
- DOM nodes are no longer wrapped by reactive proxies; this fixes
  `Node.contains()` brand-check errors when `refs` live on reactive state.
- `Place` re-registers author `refs` after a parent `update()`; refs inside a
  nested `TemplateResult` are restored too.
- `Property` lang changes invalidate the value cache.
- `key`/`as`/`height` are framework config only on Loop/If/Virtual; a user
  component keeps them as ordinary dynamic attributes.
- Folded template-cache shapes are JSON-keyed, so a value containing `:`/`;`
  cannot collide with another shape and reuse its template.
- `post()` is called without the already-consumed mounted fragment.

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

