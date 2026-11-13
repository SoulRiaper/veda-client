# Changelog

All notable changes to Veda Client Framework will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Lit-like `TemplateResult` returned by `html` (string-compatible via `String`).
- Template compilation cache keyed by call-site / template source.
- Part-based rendering for text, attributes, properties, events, `ref` and `bind`.
- In-place `update()` patching when the rendered template is unchanged.
- `ExpressionParser.compile()` cache for compiled safe/complex expressions.
- `Loop`, `If`, `Slot`, `Place`, `Property`, `Relation` and `Value` now use compiled templates and Part instances instead of re-parsing and re-walking their content.
- `${}` values are passed through to child component templates and nested components (including values of a nested `TemplateResult`). `${}` inside Slot-projected content is still baked into the host template; see `TEMPLATE_ENGINE.md`.
- `BindingStrategy` seam with `PathBindingStrategy` for swapping node-location strategies.
- New documentation: `TEMPLATE_ENGINE.md`.

### Changed
- `update()` reuses DOM nodes and child components when the template is unchanged (previously the whole subtree was replaced).
- `refs` stay stable across `update()` while the template is unchanged.
- Event handler resolution for `${}`/`{}` values keeps reactive item proxies as the receiver.
- `Place` patches moved nodes in place instead of remounting on every `update()`.
- `Slot` reuses its template instance when the projection and context are unchanged.
- `Value`/`Property`/`Relation` only replace changed value ranges and reuse unchanged nodes/template instances.
- `raw` passed as a `${}` value is now inserted as text (DOM-escaped), not as markup; return `raw` from `render()` for trusted markup.

### Fixed
- Loop item handlers bound to plain item objects no longer bypass reactivity.
- DOM nodes are no longer wrapped by reactive proxies; this fixes `Node.contains()` brand-check errors when `refs` live on reactive state (Slot/Place remounts).
- Slot/Place ref cleanup now unwraps reactive owners and nodes before calling native DOM methods.
- Property lang changes invalidate the value cache so all values re-render with the new language.
- Parts are resolved before any `ChildPart` commits, so a structured `${}` value cannot shift sibling part paths.
- `Place` re-registers author `refs` after a parent `update()`.
- Unquoted attribute values stay dynamic Parts; `${}` in comments, `<script>` and `<style>` is escaped instead of being inserted verbatim.
- `clearTemplateCache()` now clears per-call-site templates too; template caches are LRU.

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

