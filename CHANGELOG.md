# Changelog

All notable changes to Veda Client Framework will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Optional `registerRenderAdapter` render hook; core owns DOM output mounting,
  the per-render view scope, cleanup and move handling
- `veda-client/plugin-api` extension entry for standalone render plugins,
  including the shared view-scope primitives (`createScope`, `runInScope`,
  `disposeScope`, `scopedEffect`, `addCleanup`, `listen`)
- `View` contract: `render()` may return `{nodes, dispose}`; the core mounts
  the nodes, calls `dispose` before the next update and on disconnect
- `Component.renderScope`, `Component.addCleanup()` and `Component.container`
  public surface
- Core move guard keeps a mounted DOM view and its effects alive when a
  component is moved rather than removed

### Changed
- View scopes are synchronous: `runInScope()` restores the active scope before
  returning. Compiled renderers must build their view synchronously; load
  async data in `pre()`/`added()` or reactive state. This prevents two
  concurrent async renders from stealing each other's bindings.
- Extracted `setAttributeOrProperty` (`dom-bind.js`) and LIS reconciliation (`reconcile.js`) into shared modules; `Component` and `Loop` behavior is unchanged
- JSX authoring moved to the separate `veda-jsx` package; core `veda-client` remains template-only
- Compiled-renderer bindings live in `veda-jsx/view-api`; the core owns only
  the adapter hook and the shared scope tree. The core still creates a
  per-render scope when no render adapter is registered, so compiled output
  works without importing the JSX runtime.
- There is no core `veda-client/view-api` entry; use `veda-jsx/view-api` for
  compiled bindings.

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
- `bindAttr`/`bindProp` now unwrap getter-returning getters, so `expr()` works in attributes and component props
- `bindEvent` calls handlers with the owning component as `this` (the DOM node is the second argument and `event.currentTarget`), matching the string pipeline
- `bindList` rebuilds a row when an immutable item replaces the same key, and refreshes index-dependent rows after reorder
- `bindRef` removes named refs when the render scope is disposed
- Race conditions in concurrent effect flushes
- Circular reference handling in reactive proxies
- Prototype pollution prevention

### Security
- Unified `{expr}` syntax with auto-detection: simple property access is CSP-compatible (no eval), complex expressions (operators, ternaries, function calls) use safe evaluation with result sanitization
- safe() function removes `{expr}` to prevent template injection
- Double protection against XSS: result sanitization + processed node marking

## [1.x] - Previous versions

Legacy version without reactive system. See git history for details.

