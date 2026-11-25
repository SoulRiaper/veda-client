/**
 * Public API surface for render plugins.
 *
 * The `veda-jsx` plugin uses this entry instead of deep-importing core
 * internals, so render plugins can live in their own package without reaching
 * into `veda-client/src/*`.
 */

export {registerRenderAdapter, getRenderAdapter} from './components/render-adapter.js';
export {setAttributeOrProperty} from './components/dom-bind.js';
export {reconcileOrder, longestIncreasingSubsequence} from './components/reconcile.js';
export {default as ExpressionParser} from './components/ExpressionParser.js';
export {effect} from './Effect.js';
export {
  createScope,
  getCurrentScope,
  currentComponent,
  runInScope,
  scopedEffect,
  addCleanup,
  disposeScope,
  listen,
} from './view-scope.js';
