/**
 * Optional render-adapter hook.
 *
 * Core owns the render scope, DOM/string output mounting, cleanup and the move
 * guard. An adapter may only wrap the author's `render()` call, for example to
 * provide an alternative renderer that returns DOM nodes:
 *
 *   registerRenderAdapter({
 *     render(component, renderFn) {
 *       return compileAndRender(component, renderFn);
 *     },
 *   });
 *
 * The adapter runs inside the core-created view scope, so bindings created by
 * `veda-client/plugin-api` are disposed with the component. Only the last
 * registered adapter is active.
 */

let currentAdapter = null;

export function registerRenderAdapter(adapter) {
  const previous = currentAdapter;
  currentAdapter = adapter;

  return () => {
    if (currentAdapter === adapter) currentAdapter = previous;
  };
}

export function getRenderAdapter() {
  return currentAdapter;
}
