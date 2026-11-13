/**
 * Binding strategies isolate "where is the node for this PartDescriptor"
 * from the Part implementations.
 *
 * The default strategy resolves the precomputed child-index path once per
 * template instance. It adds no marker nodes to the DOM.
 *
 * A future comment-marker / hydration strategy can implement the same
 * `resolve(root, descriptor)` contract without changing Part code.
 */
export class PathBindingStrategy {
  /**
   * @param {DocumentFragment} root
   * @param {{path: number[]}} descriptor
   * @returns {Node|null}
   */
  resolve(root, descriptor) {
    let node = root;
    for (const index of descriptor.path) {
      if (!node) return null;
      node = node.childNodes[index];
    }
    return node || null;
  }
}

export const defaultBindingStrategy = new PathBindingStrategy();
