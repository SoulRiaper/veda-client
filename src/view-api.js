/**
 * Public view API for compiled renderers.
 *
 * The AOT JSX compiler emits calls from this module instead of using a
 * runtime JSX factory. Bindings are ordinary DOM operations wrapped in
 * micro-effects; every binding registers its cleanup in the ambient scope,
 * which the owning Component creates and disposes.
 *
 * The API is renderer-agnostic: it can be used directly from a hand-written
 * `render()` without importing `veda-jsx`.
 */

import {effect} from './Effect.js';
import {toRaw} from './Reactive.js';
import {setAttributeOrProperty} from './components/dom-bind.js';
import {reconcileOrder} from './components/reconcile.js';

// ============================================================================
// SCOPES
// ============================================================================

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
 * Run fn with scope active. A promise result keeps the scope active until it
 * settles, so an async render() can create bindings after an await.
 */
export function runInScope(scope, fn) {
  const previous = currentScope;
  currentScope = scope;

  let result;
  try {
    result = fn();
  } catch (error) {
    currentScope = previous;
    throw error;
  }

  if (result && typeof result.then === 'function') {
    return Promise.resolve(result).finally(() => {
      currentScope = previous;
    });
  }

  currentScope = previous;
  return result;
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

// ============================================================================
// VALUES AND DOM NODES
// ============================================================================

function readValue(value) {
  return typeof value === 'function' ? value() : value;
}

/**
 * Resolve a binding getter, also unwrapping a getter returned by a getter.
 * This keeps `{expr('model.rdfs:label.0', this)}` working: `expr()` returns
 * a getter, and the compiler wraps the call in its own getter.
 */
function readBinding(value) {
  let result = readValue(value);
  if (typeof result === 'function') result = result();
  return result;
}

/**
 * Normalize an arbitrary render value to DOM nodes. Strings and numbers
 * become text nodes; arrays and fragments are flattened.
 */
export function toNodes(value, out = []) {
  if (value == null || value === false || value === true) return out;

  if (Array.isArray(value)) {
    for (const item of value) toNodes(item, out);
    return out;
  }

  if (value instanceof Node) {
    // Reactive state proxies DOM nodes too; DOM APIs need the raw target.
    const node = toRaw(value);
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      for (const child of [...node.childNodes]) out.push(child);
    } else {
      out.push(node);
    }
    return out;
  }

  out.push(document.createTextNode(String(value)));
  return out;
}

/**
 * Insert a render value before an anchor node. Returns the inserted nodes.
 */
export function insertNode(anchor, value, removeAnchor = false) {
  const nodes = toNodes(value);
  const parent = anchor.parentNode;
  if (nodes.length) {
    if (parent) {
      const fragment = document.createDocumentFragment();
      for (const node of nodes) fragment.appendChild(node);
      parent.insertBefore(fragment, anchor);
    }
  }
  // Compiler-owned anchors for static component nodes have done their job;
  // removing them keeps a row view to a single stable root.
  if (removeAnchor) anchor.remove();
  return nodes;
}

function removeNodes(nodes) {
  for (const node of nodes) node.remove();
}

// ============================================================================
// TEMPLATES AND MARKERS
// ============================================================================

const templateCache = new Map();

/**
 * Create (or reuse) a `<template>` for a static HTML string. The compiler
 * hoists these calls to module scope so a row template is parsed once.
 */
export function template(html) {
  let tpl = templateCache.get(html);
  if (!tpl) {
    tpl = document.createElement('template');
    tpl.innerHTML = html;
    templateCache.set(html, tpl);
  }
  return tpl;
}

/**
 * Collect dynamic binding sites from a cloned template:
 *
 *   elements:  data-v="N"  (attribute is removed after collection)
 *   comments:  <!--v:N-->
 *
 * @returns {Record<number, Node>}
 */
export function collectMarkers(root) {
  const markers = {};
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT
  );

  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.COMMENT_NODE) {
      const match = /^v:(\d+)$/.exec(node.nodeValue || '');
      if (match) markers[Number(match[1])] = node;
    } else {
      const id = node.getAttribute('data-v');
      if (id != null) {
        markers[Number(id)] = node;
        node.removeAttribute('data-v');
      }
    }
    node = walker.nextNode();
  }

  return markers;
}

/**
 * Clone a template, collect markers and run the generated setup function in
 * the current scope. Returns the view nodes, ready to mount.
 *
 * @param {HTMLTemplateElement|string} source
 * @param {(root: DocumentFragment, markers: Record<number, Node>) => void} [setup]
 * @returns {Node[]}
 */
export function useTemplate(source, setup) {
  const tpl = typeof source === 'string' ? template(source) : source;
  const root = tpl.content.cloneNode(true);
  const markers = collectMarkers(root);
  if (setup) setup(root, markers);
  return Array.from(root.childNodes);
}

// ============================================================================
// BINDINGS
// ============================================================================

/**
 * Text binding: `{expr}` in JSX. A text node is created from the whole
 * current value; nullish values render as an empty string.
 */
export function bindText(anchor, getter) {
  let text = null;

  const run = () => {
    const value = readBinding(getter);
    const next = value == null || value === false || value === true ? '' : String(value);
    if (text) {
      if (text.data !== next) text.data = next;
      return;
    }
    text = document.createTextNode(next);
    if (anchor.nodeType === Node.ELEMENT_NODE) anchor.appendChild(text);
    else anchor.parentNode?.insertBefore(text, anchor);
  };

  return scopedEffect(run);
}

/**
 * Child binding for expressions that may render nodes, arrays or text.
 * Primitives update a single text node in place; node values replace the
 * previous subtree when the identity changes.
 */
export function bindChild(anchor, getter) {
  let mode = null;
  let text = null;
  let nodes = [];

  const clear = () => {
    if (text) {
      text.remove();
      text = null;
    }
    if (nodes.length) {
      removeNodes(nodes);
      nodes = [];
    }
    mode = null;
  };

  const run = () => {
    const value = readBinding(getter);
    const isNodes = value instanceof Node || Array.isArray(value);

    if (!isNodes) {
      const next = value == null || value === false || value === true ? '' : String(value);
      if (mode === 'text' && text) {
        if (text.data !== next) text.data = next;
        return;
      }
      clear();
      text = document.createTextNode(next);
      anchor.parentNode?.insertBefore(text, anchor);
      mode = 'text';
      return;
    }

    const nextNodes = toNodes(value);
    if (
      mode === 'nodes'
      && nextNodes.length === nodes.length
      && nextNodes.every((node, index) => node === nodes[index])
    ) {
      return;
    }
    clear();
    insertNode(anchor, nextNodes);
    nodes = nextNodes;
    mode = 'nodes';
  };

  return scopedEffect(run);
}

const CALLBACK_PROP_RE = /^on(?:[-A-Z])/;

function propName(name) {
  return String(name).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function isStyleObject(value) {
  return value != null
    && typeof value === 'object'
    && !(value instanceof Node)
    && !Array.isArray(value)
    && !(value instanceof String);
}

function applyStyle(node, style, previous = null) {
  if (!style || typeof style !== 'object') return;
  if (previous) {
    for (const property of Object.keys(previous)) {
      if (property in style) continue;
      if (property.startsWith('--')) node.style.removeProperty(property);
      else node.style[property] = '';
    }
  }
  for (const [property, value] of Object.entries(style)) {
    if (value == null) {
      if (property.startsWith('--')) node.style.removeProperty(property);
      else node.style[property] = '';
      continue;
    }
    if (property.startsWith('--')) node.style.setProperty(property, value);
    else node.style[property] = value;
  }
}

/**
 * Attribute binding. Uses the same attribute/property rules as the string
 * pipeline (`value`, `checked`, boolean attributes) and supports style
 * objects.
 */
export function bindAttr(node, name, getter) {
  const attrName = name === 'className' ? 'class' : name === 'htmlFor' ? 'for' : name;
  const property = !attrName.startsWith('data-') && attrName in node && attrName !== 'style' && attrName !== 'class';
  let previousStyle = null;

  const run = () => {
    const value = readValue(getter);

    if (attrName === 'style' && isStyleObject(value)) {
      applyStyle(node, value, previousStyle);
      previousStyle = value;
      return;
    }

    if (value == null) {
      if (property) {
        try {
          if (typeof node[attrName] === 'boolean') node[attrName] = false;
          else if (typeof node[attrName] === 'string') node[attrName] = '';
        } catch {
          // Read-only DOM property: fall through to the attribute.
        }
      }
      node.removeAttribute?.(attrName);
      return;
    }

    setAttributeOrProperty(node, attrName, value);
  };

  return scopedEffect(run);
}

/**
 * Component property binding.
 *
 * A function value is a lazy getter unless the name follows the callback
 * convention (`onSomething` / `on-something`). Pass `{callback: true}` to
 * store a function as a value regardless of its name.
 */
export function bindProp(node, name, value, options = {}) {
  const target = node.state ?? node;
  const key = propName(name);
  const callback = options.callback ?? (typeof value === 'function' && CALLBACK_PROP_RE.test(name));

  if (callback) {
    target[key] = value;
    return () => {};
  }

  if (typeof value === 'function') {
    return scopedEffect(() => {
      target[key] = value();
    });
  }

  target[key] = value;
  return () => {};
}

/**
 * Event binding. The handler may be a function or a getter returning one.
 */
export function bindEvent(node, event, handler) {
  const listener = (eventObject) => {
    // Handlers are stored as functions; a non-function getter is resolved
    // once at dispatch time.
    const fn = typeof handler === 'function' ? handler : readBinding(handler);
    if (typeof fn === 'function') fn.call(node, eventObject);
  };
  return listen(node, event, listener);
}

/**
 * Ref binding: `ref="name"`, `ref={fn}`, or `ref={{current}}`.
 */
export function bindRef(node, value) {
  if (typeof value === 'string') {
    const component = currentComponent();
    if (component) {
      component.refs ??= {};
      component.refs[value] = node;
    }
    return;
  }

  if (typeof value === 'function') {
    value(node);
    addCleanup(() => value(null));
    return;
  }

  if (value && typeof value === 'object' && 'current' in value) {
    value.current = node;
    addCleanup(() => {
      if (value.current === node) value.current = null;
    });
  }
}

/**
 * Set several static attributes at once.
 */
export function setAttributes(node, attrs) {
  if (!attrs) return node;
  for (const [name, value] of Object.entries(attrs)) {
    if (value == null || value === false) node.removeAttribute(name);
    else if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
  return node;
}

// ============================================================================
// CONTROL FLOW
// ============================================================================

function defaultKey(item, index) {
  if (item != null && typeof item === 'object') {
    if (item.id != null) return `id:${item.id}`;
    if (item.key != null) return `key:${item.key}`;
  }
  return `index:${index}`;
}

function itemNode(value) {
  const nodes = toNodes(value);
  if (nodes.length === 0) return document.createComment('v:empty');
  if (nodes.length === 1) return nodes[0];

  // Multiple roots need one stable node for the LIS reconciler.
  const wrapper = document.createElement('span');
  wrapper.setAttribute('data-v-item', '');
  wrapper.style.display = 'contents';
  for (const node of nodes) wrapper.appendChild(node);
  return wrapper;
}

/**
 * Keyed list binding.
 *
 * @param {Comment} anchor
 * @param {{
 *   items: (() => Iterable<any>|null|undefined) | Iterable<any>|null|undefined,
 *   key?: ((item: any, index: number) => unknown) | null,
 *   render: (item: any, index: number) => any,
 * }} options
 */
export function bindList(anchor, options) {
  const {items: getItems = () => [], key = null, render} = options ?? {};
  if (typeof render !== 'function') {
    throw new TypeError('bindList: render must be a function');
  }

  const scope = createScope(currentComponent());
  let map = new Map();

  runInScope(scope, () => {
    scopedEffect(() => {
      let items = readValue(getItems);
      // Tolerate the legacy getter form (`each={() => rows}`).
      if (typeof items === 'function') items = items();
      if (items == null) items = [];
      else if (!Array.isArray(items)) items = Array.from(items);

      const newKeys = [];
      const used = new Set();
      items.forEach((item, index) => {
        const base = key ? String(key(item, index)) : defaultKey(item, index);
        let candidate = base;
        let duplicate = 2;
        while (used.has(candidate)) candidate = `${base}#${duplicate++}`;
        if (candidate !== base) {
          console.warn(
            `bindList: duplicate key "${base}" at index ${index}. `,
            'Keys must be unique; the duplicate was suffixed.'
          );
        }
        used.add(candidate);
        newKeys.push(candidate);
      });

      const newSet = new Set(newKeys);

      // DOM first (child disconnectedCallback), then item effects.
      for (const [itemKey, data] of map) {
        if (!newSet.has(itemKey)) {
          data.element.remove();
          disposeScope(data.scope);
          map.delete(itemKey);
        }
      }

      const oldKeys = [...map.keys()];

      items.forEach((item, index) => {
        const itemKey = newKeys[index];
        if (map.has(itemKey)) return;

        const itemScope = createScope(currentComponent());
        const element = runInScope(itemScope, () => itemNode(render(item, index)));
        map.set(itemKey, {element, scope: itemScope});
      });

      const parent = anchor.parentNode;
      if (!parent) return;

      reconcileOrder(parent, newKeys, oldKeys, map, anchor);

      const ordered = new Map();
      for (const itemKey of newKeys) {
        const data = map.get(itemKey);
        if (data) ordered.set(itemKey, data);
      }
      map = ordered;
    });
  });

  return scope;
}

/**
 * Conditional branch binding. The visible branch creates a child scope that
 * is disposed when the branch is hidden.
 */
export function bindShow(anchor, options) {
  const {when, render, fallback = null} = options ?? {};
  if (typeof render !== 'function') {
    throw new TypeError('bindShow: render must be a function');
  }

  const scope = createScope(currentComponent());
  const state = {branch: null, nodes: [], fallbackBranch: null, fallbackNodes: []};

  const clear = (which) => {
    const nodes = which === 'branch' ? state.nodes : state.fallbackNodes;
    const branch = which === 'branch' ? state.branch : state.fallbackBranch;
    for (const node of nodes) node.remove();
    if (branch) disposeScope(branch);
    if (which === 'branch') {
      state.branch = null;
      state.nodes = [];
    } else {
      state.fallbackBranch = null;
      state.fallbackNodes = [];
    }
  };

  runInScope(scope, () => {
    scopedEffect(() => {
      let condition = typeof when === 'function' ? when() : when;
      // Tolerate the legacy getter form (`when={() => open}`).
      if (typeof condition === 'function') condition = condition();
      const visible = !!condition;

      if (visible) {
        if (state.fallbackBranch) clear('fallback');
        if (!state.branch) {
          state.branch = createScope(currentComponent());
          state.nodes = runInScope(state.branch, () => toNodes(render()));
          insertNode(anchor, state.nodes);
        }
        return;
      }

      if (state.branch) clear('branch');
      if (typeof fallback === 'function' && !state.fallbackBranch) {
        state.fallbackBranch = createScope(currentComponent());
        state.fallbackNodes = runInScope(state.fallbackBranch, () => toNodes(fallback()));
        insertNode(anchor, state.fallbackNodes);
      }
    });
  });

  return scope;
}

/**
 * Node-based slot outlet. Named views are registered by the parent component
 * (`component(..., {slots})` or `setSlotViews`) and rendered directly, with
 * no `<veda-slot>` element in the DOM.
 */
export function bindSlot(anchor, name = 'default', fallback = null) {
  const host = currentComponent();
  const factory = host?.slotViews?.[name];
  const scope = createScope(host);
  let nodes = [];

  runInScope(scope, () => {
    const source = typeof factory === 'function'
      ? factory
      : typeof fallback === 'function'
        ? fallback
        : null;
    if (!source) return;
    nodes = toNodes(source());
    insertNode(anchor, nodes);
  });

  return scope;
}

/**
 * Register named node factories on a component. A factory builds slot
 * content in the consumer's scope.
 */
export function setSlotViews(component, views) {
  if (!component) return component;
  component.slotViews = views ?? {};
  return component;
}

function groupSlotViews(groups) {
  const views = {};
  for (const {name = 'default', view} of groups) {
    if (typeof view !== 'function') continue;
    const previous = views[name];
    if (!previous) {
      views[name] = view;
      continue;
    }
    views[name] = () => [...toNodes(previous()), ...toNodes(view())];
  }
  return views;
}

/**
 * Portal binding: render children into another container while keeping a
 * comment placeholder in the original position.
 */
export function bindPlace(anchor, options = {}) {
  const {to = null, render} = options;
  if (typeof render !== 'function') {
    throw new TypeError('bindPlace: render must be a function');
  }

  const scope = createScope(currentComponent());
  let nodes = [];

  runInScope(scope, () => {
    nodes = toNodes(render());
    const target = resolvePlaceTarget(to);
    if (!target) return;
    for (const node of nodes) target.appendChild(node);

    addCleanup(() => {
      for (const node of nodes) node.remove();
    });
  });

  return scope;
}

function resolvePlaceTarget(to) {
  if (to == null) return document.body;
  if (typeof to === 'function') return to() ?? document.body;
  if (to instanceof Node) return to;
  if (typeof to === 'string') {
    if (to === 'body') return document.body;
    if (to === 'head') return document.head;
    return document.querySelector(to);
  }
  return document.body;
}

// ============================================================================
// COMPONENTS
// ============================================================================

function isCustomElementClass(value) {
  return typeof value === 'function'
    && typeof HTMLElement !== 'undefined'
    && value.prototype instanceof HTMLElement;
}

function ensureDefined(Ctor) {
  const tag = Ctor?.tag;
  if (!tag || typeof customElements === 'undefined') return;
  const registered = customElements.get(tag);
  if (registered === Ctor) return;
  if (registered) {
    console.warn(
      `veda view: custom element "${tag}" is already registered with a different class.`,
      'The existing registration wins.'
    );
    return;
  }
  customElements.define(tag, Ctor);
}

/**
 * Make a lazily-evaluated property. Reading `target[name]` calls `getter`,
 * so a function component that reads `props.title` inside a binding stays
 * reactive. Destructuring props snapshots the value.
 */
export function defineLazy(target, name, getter) {
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    get() {
      return getter();
    },
  });
  return target;
}

function attachEvents(nodes, events) {
  for (const [name, handler] of events) {
    for (const node of nodes) {
      if (node && typeof node.addEventListener === 'function') {
        bindEvent(node, name, handler);
      }
    }
  }
}

function slotChildren(groups) {
  const nodes = [];
  for (const {view} of groups) {
    if (typeof view === 'function') toNodes(view(), nodes);
  }
  return nodes;
}

/**
 * Create a component for compiled output.
 *
 * Class component (`Ctor.prototype instanceof HTMLElement`):
 *   - static attrs -> attributes
 *   - lazy props   -> reactive `state` properties
 *   - values       -> `state` properties (callbacks are not called)
 *   - children     -> named slot views
 *
 * Function component (view-only):
 *   - attrs/values -> props
 *   - lazy props   -> lazy getters on props
 *   - children     -> `props.children` nodes, in declaration order
 *
 * @returns {Element|Node[]}
 */
export function component(Ctor, spec = {}) {
  const {
    attrs = null,
    attrsLazy = null,
    lazy = null,
    values = null,
    slots = null,
    events = null,
    ref = undefined,
  } = spec;

  if (typeof Ctor !== 'function') {
    throw new TypeError('component: expected a component class or function');
  }

  if (!isCustomElementClass(Ctor)) {
    const props = {};
    if (attrs) Object.assign(props, attrs);
    if (values) Object.assign(props, values);
    if (attrsLazy) {
      for (const [name, getter] of Object.entries(attrsLazy)) {
        defineLazy(props, propName(name), getter);
      }
    }
    if (lazy) {
      for (const [name, getter] of Object.entries(lazy)) {
        defineLazy(props, propName(name), getter);
      }
    }
    if (slots) props.children = slotChildren(slots);

    const view = Ctor(props);
    const nodes = toNodes(view);
    if (events) attachEvents(nodes, events);
    if (ref != null) {
      const node = nodes.length === 1 ? nodes[0] : nodes;
      bindRef(node, ref);
    }
    return nodes;
  }

  ensureDefined(Ctor);

  let el;
  try {
    el = new Ctor();
  } catch (error) {
    throw new Error(
      `veda view: cannot construct <${Ctor.tag ?? Ctor.name}>. `
      + 'Define class components with customElements.define() before mounting them.',
      {cause: error}
    );
  }

  if (attrs) setAttributes(el, attrs);
  if (slots && slots.length) setSlotViews(el, groupSlotViews(slots));
  if (events) attachEvents([el], events);

  if (attrsLazy) {
    for (const [name, getter] of Object.entries(attrsLazy)) {
      bindAttr(el, name, getter);
    }
  }

  if (values) {
    const target = el.state ?? el;
    for (const [name, value] of Object.entries(values)) {
      target[propName(name)] = value;
    }
  }

  if (lazy) {
    for (const [name, getter] of Object.entries(lazy)) {
      bindProp(el, name, getter);
    }
  }

  if (ref != null) bindRef(el, ref);
  return el;
}
