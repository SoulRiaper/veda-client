export interface BindingStrategy {
  resolve(root: DocumentFragment, descriptor: { path: number[] }): Node | null;
}

export class PathBindingStrategy implements BindingStrategy {
  resolve(root: DocumentFragment, descriptor: { path: number[] }): Node | null;
}

export const defaultBindingStrategy: PathBindingStrategy;
