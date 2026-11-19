export interface ViewScope {
  component: any;
  cleanups: Array<() => void>;
  listeners: Array<{node: EventTarget; event: string; handler: EventListener}>;
  children: Set<ViewScope>;
  parent: ViewScope | null;
  disposed: boolean;
}

export interface View {
  nodes: Node[];
  dispose?(): void;
}

export interface SlotGroup {
  name?: string;
  view: () => unknown;
}

export interface ComponentSpec {
  attrs?: Record<string, string | number | boolean> | null;
  lazy?: Record<string, () => unknown> | null;
  values?: Record<string, unknown> | null;
  slots?: SlotGroup[] | null;
  ref?: string | ((node: Node | null) => void) | {current: Node | null} | undefined;
}

export declare function createScope(component?: any): ViewScope;
export declare function getCurrentScope(): ViewScope | null;
export declare function currentComponent(): any;
export declare function runInScope<T>(scope: ViewScope | null, fn: () => T): T;
export declare function scopedEffect(fn: () => void, options?: Record<string, any>): () => void;
export declare function addCleanup(fn: () => void): () => void;
export declare function disposeScope(scope: ViewScope | null): void;
export declare function listen(node: EventTarget, event: string, handler: EventListener): EventListener;

export declare function toNodes(value: unknown, out?: Node[]): Node[];
export declare function insertNode(anchor: Node, value: unknown, removeAnchor?: boolean): Node[];

export declare function template(html: string): HTMLTemplateElement;
export declare function collectMarkers(root: Node): Record<number, Node>;
export declare function useTemplate(
  source: HTMLTemplateElement | string,
  setup?: (root: DocumentFragment, markers: Record<number, Node>) => void
): Node[];

export declare function bindText(anchor: Node, getter: () => unknown): () => void;
export declare function bindChild(anchor: Node, getter: () => unknown): () => void;
export declare function bindAttr(node: Element, name: string, getter: () => unknown): () => void;
export declare function bindProp(
  node: any,
  name: string,
  value: unknown,
  options?: {callback?: boolean}
): () => void;
export declare function bindEvent(node: EventTarget, event: string, handler: unknown): EventListener;
export declare function bindRef(node: any, value: unknown): void;
export declare function setAttributes(node: Element, attrs: Record<string, unknown> | null | undefined): Element;

export interface BindListOptions<T = any> {
  items: (() => Iterable<T> | null | undefined) | Iterable<T> | null | undefined;
  key?: ((item: T, index: number) => unknown) | null;
  render: (item: T, index: number) => unknown;
}
export declare function bindList<T = any>(anchor: Node, options: BindListOptions<T>): ViewScope;

export interface BindShowOptions {
  when: (() => unknown) | unknown;
  render: () => unknown;
  fallback?: (() => unknown) | null;
}
export declare function bindShow(anchor: Node, options: BindShowOptions): ViewScope;
export declare function bindSlot(anchor: Node, name?: string, fallback?: (() => unknown) | null): ViewScope;
export declare function setSlotViews(component: any, views: Record<string, () => unknown>): any;
export declare function bindPlace(
  anchor: Node,
  options?: {to?: string | Node | (() => Node | null) | null; render: () => unknown}
): ViewScope;

export declare function defineLazy<T extends object>(target: T, name: string, getter: () => unknown): T;
export declare function component(Ctor: any, spec?: ComponentSpec): Element | Node[];
