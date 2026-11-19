# Changelog

All notable changes to Veda Client Framework will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Generic render-adapter hook (`registerRenderAdapter`) and DOM output mounting
- `veda-client/plugin-api` extension entry for standalone render plugins
- Public `veda-client/view-api` entry for compiled renderers: scoped
  `bindText`/`bindChild`/`bindAttr`/`bindProp`/`bindEvent`/`bindRef`,
  keyed `bindList`, `bindShow`, node-based `bindSlot`/`bindPlace`, template
  and marker helpers, and `component()` mounting with lazy props
- `View` contract: `render()` may return `{nodes, dispose}`; the core mounts
  the nodes, calls `dispose` before the next update and on disconnect
- `Component.renderScope`, `Component.addCleanup()`, `Component.mountView()`
  and `Component.container` public surface
- Core move guard keeps a mounted DOM view and its effects alive when a
  component is moved rather than removed

### Changed
- Extracted `setAttributeOrProperty` (`dom-bind.js`) and LIS reconciliation (`reconcile.js`) into shared modules; `Component` and `Loop` behavior is unchanged
- JSX authoring moved to the separate `veda-jsx` package; core `veda-client` remains template-only
- The core creates a per-render view scope when no render adapter is
  registered, so `veda-client/view-api` bindings work without `veda-jsx`

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

