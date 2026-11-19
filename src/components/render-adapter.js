/**
 * Render adapter hook.
 *
 * Core stays free of JSX. An optional adapter (for example the
 * `veda-jsx` package) can own the render lifecycle:
 *
 *   beforeUpdate(component)              -> prepare per-render state
 *   render(component, renderFn)          -> run render() in an ambient scope
 *   afterUpdate(component, output)       -> output is a string or DOM nodes
 *   onConnect(component) -> boolean      -> true: skip connectedCallback work
 *   onDisconnect(component) -> boolean   -> true: this is a move, keep the tree
 *   cleanup(component)                   -> component is really disconnected
 *   onError(component)                   -> render/update threw
 *
 * Only the last registered adapter is active. Without one, component behavior
 * is exactly the original string-template pipeline.
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
