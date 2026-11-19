import Model from '../Model.js';

export function html(strings: TemplateStringsArray, ...values: any[]): string;
export function raw(strings: TemplateStringsArray, ...values: any[]): string;
export function safe(value: any): string | string[];

export interface View {
  nodes: Node[];
  dispose?(): void;
}

export interface ViewScope {
  component: any;
  cleanups: Array<() => void>;
  disposed: boolean;
  [key: string]: any;
}

export interface ComponentState<M extends Model = Model> {
  model?: M;
  [key: string]: any;
}

export interface ComponentInstance<M extends Model = Model> {
  state: ComponentState<M>; // Reactive state object with typed model
  model?: M; // Direct model access (alternative to state.model)
  template?: string;
  rendered: Promise<void>;
  refs: Record<string, Element | undefined>;
  context: Record<string, any>;

  connectedCallback(): Promise<void>;
  disconnectedCallback(): Promise<void>;
  renderedCallback(): void;

  added(): void | Promise<void>;
  pre(): void | Promise<void>;
  render(): string | Node | Node[] | View | Promise<string | Node | Node[] | View> | undefined;
  post(fragment?: DocumentFragment | HTMLElement): void | Promise<void>;
  removed(): void | Promise<void>;

  update(): Promise<void>;
  populate(): Promise<void>;

  // View contract (compiler output and renderer plugins)
  readonly renderScope: ViewScope | null;
  readonly container: HTMLElement | ShadowRoot;
  addCleanup(fn: () => void): () => void;
  mountView(view: View | Node | Node[] | string): Node[];

  // Reactive methods
  effect(fn: () => void): () => void;
  watch<T>(getter: () => T, callback: (newValue: T, oldValue: T | undefined) => void, options?: { immediate?: boolean }): () => void;

  // Internal helper method
  _findParentComponent(): HTMLElement | null;
  _cleanupAllEventListeners(): void;
  _getRenderEffectsCount(): number;
  _extractRenderEffects(startIndex: number): Array<() => void>;
  _getEventListenersCount(): number;
  _extractEventListeners(startIndex: number): Array<{node: EventTarget; eventName: string; handler: EventListener}>;
  _stopEventListeners(listeners?: Array<{node: EventTarget; eventName: string; handler: EventListener}>): void;
  _trackChildRendered(promise: Promise<void>): void;
}

export interface ComponentConstructor<T extends typeof HTMLElement = typeof HTMLElement> {
  new (): InstanceType<T> & ComponentInstance;
  tag: string;
  toString(): string;
}

export default function Component(
  ElementClass?: any,
  ModelClass?: any
): ComponentConstructor;

// Re-export reactive utilities
export function reactive<T extends object>(target: T): T;
export function effect(fn: () => void, options?: { lazy?: boolean; scheduler?: (effect: () => void) => void; computed?: boolean }): () => void;

