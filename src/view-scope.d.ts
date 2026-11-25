export interface ViewScope {
  component: any;
  cleanups: Array<() => void>;
  listeners: Array<{node: EventTarget; event: string; handler: EventListener}>;
  children: Set<ViewScope>;
  parent: ViewScope | null;
  disposed: boolean;
  [key: string]: any;
}

export declare function createScope(component?: any): ViewScope;
export declare function getCurrentScope(): ViewScope | null;
export declare function currentComponent(): any;
export declare function runInScope<T>(scope: ViewScope | null, fn: () => T): T;
export declare function scopedEffect(fn: () => void, options?: Record<string, any>): () => void;
export declare function addCleanup(fn: () => void): () => void;
export declare function disposeScope(scope: ViewScope | null): void;
export declare function listen(node: EventTarget, event: string, handler: EventListener): EventListener;
