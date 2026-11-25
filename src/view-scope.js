/**
 * Ambient view scopes.
 *
 * A scope owns the effects, cleanups and DOM listeners created while a view is
 * rendered. `Component` creates one per render and disposes it on the next
 * update or on disconnect; renderer plugins create child scopes for lists,
 * branches and slots.
 *
 * This module lives in the core because `currentScope` must be a single
 * process-wide stack. Compiled renderers and the core's string pipeline both
 * register their work here, so a scope tree can mix them safely.
 */

import {effect} from './Effect.js';

let currentScope = null;

/**
 * Create a scope. If another scope is active it becomes the parent, so
 * disposeScope(parent) recursively disposes the whole subtree.
 *
 * @param {object|null} component
 * @returns {{component: object|null, cleanups: Function[], listeners: Array, children: Set, parent: object|null, disposed: boolean}}
 */
export function createScope(component = null) {
  const scope = {
    component,
    cleanups: [],
    listeners: [],
    children: new Set(),
    parent: null,
    disposed: false,
  };

  const parent = currentScope;
  if (parent && !parent.disposed) {
    scope.parent = parent;
    parent.children.add(scope);
  }

  return scope;
}

export function getCurrentScope() {
  return currentScope;
}

export function currentComponent() {
  return currentScope?.component ?? null;
}

/**
 * Run fn with scope active.
 *
 * The scope is restored before fn returns. It is deliberately NOT kept
 * active across an `await`: `currentScope` is a single global, so two
 * concurrent async renders would steal each other's bindings. Compiled
 * renderers must build their view synchronously; load async data in
 * `pre()`/`added()` or in reactive state instead.
 */
export function runInScope(scope, fn) {
  const previous = currentScope;
  currentScope = scope;
  try {
    return fn();
  } finally {
    currentScope = previous;
  }
}

/**
 * effect() bound to the owning scope. Inside an effect callback the scope is
 * active again, so nested scopedEffect()/createScope() calls keep the tree.
 */
export function scopedEffect(fn, options = {}) {
  const scope = currentScope;
  if (!scope) return effect(fn, options);

  const stop = effect(() => runInScope(scope, fn), {
    ...options,
    component: options.component ?? scope.component ?? undefined,
  });
  scope.cleanups.push(stop);
  return stop;
}

/**
 * Register a cleanup in the current scope. Falls back to a no-op outside a
 * render scope.
 */
export function addCleanup(fn) {
  const scope = currentScope;
  if (!scope) return () => {};
  if (scope.disposed) {
    try {
      fn();
    } catch (error) {
      console.error('Error in view cleanup:', error);
    }
    return () => {};
  }
  scope.cleanups.push(fn);
  return fn;
}

/**
 * Dispose a scope tree: children first, then effects, then DOM listeners.
 * Callers that remove DOM nodes should do so before calling this, so child
 * custom elements run disconnectedCallback while their tree still exists.
 */
export function disposeScope(scope) {
  if (!scope || scope.disposed) return;
  scope.disposed = true;

  const parent = scope.parent;
  if (parent) parent.children.delete(scope);

  for (const child of [...scope.children]) disposeScope(child);
  scope.children.clear();

  const cleanups = scope.cleanups.splice(0);
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (error) {
      console.error('Error disposing view effect:', error);
    }
  }

  const listeners = scope.listeners.splice(0);
  for (const {node, event, handler} of listeners) {
    node.removeEventListener(event, handler);
  }
}

/**
 * Add an event listener that is removed when the scope is disposed.
 */
export function listen(node, event, handler) {
  node.addEventListener(event, handler);
  const scope = currentScope;
  if (scope) scope.listeners.push({node, event, handler});
  return handler;
}
