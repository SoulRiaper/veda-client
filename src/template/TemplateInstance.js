import {effect} from '../Effect.js';
import {toRaw} from '../Reactive.js';
import ExpressionParser from '../components/ExpressionParser.js';
import {isTemplateResult} from './TemplateResult.js';
import {compileTemplate} from './Template.js';
import {factories} from './factories.js';
import {defaultBindingStrategy} from './BindingStrategy.js';
import {recordComponentTag, recordInstanceHost, recordTemplateStat} from './stats.js';

const METHOD_NAME_RE = /^(?:this\.)?([A-Za-z_$][\w$]*)$/;
const MAX_TREE_DEPTH = 20;

function findMethod(start, name) {
  let obj = start;
  let instanceOwner = null;

  for (let depth = 0; obj && depth < MAX_TREE_DEPTH; depth++) {
    const raw = toRaw(obj) || obj;

    if (raw instanceof Element && raw.state) instanceOwner = raw;

    if (typeof raw[name] === 'function') {
      if (Object.prototype.hasOwnProperty.call(raw, name)) {
        return {fn: raw[name], owner: instanceOwner || raw};
      }
      // Inherited function: keep walking so the owner is the actual component
      // instance, not the prototype object that stores the method.
    }

    const next = Object.getPrototypeOf(raw);
    if (!next || next === Object.prototype) break;
    obj = next;
  }
  return null;
}

function findComponentOwner(start) {
  let obj = start;
  for (let depth = 0; obj && depth < MAX_TREE_DEPTH; depth++) {
    const raw = toRaw(obj) || obj;
    if (raw instanceof Element && raw.state) return raw;
    const next = Object.getPrototypeOf(raw);
    if (!next || next === Object.prototype) break;
    obj = next;
  }
  return null;
}

function resolveOwnedFromExpr(expr, evalContext) {
  const methodMatch = expr.match(METHOD_NAME_RE);
  if (methodMatch) return findMethod(evalContext, methodMatch[1]);

  const result = ExpressionParser.evaluate(expr, evalContext, true);
  if (!result || typeof result.value !== 'function') return null;

  const key = expr.split(/[?.]/).filter(Boolean).pop();
  const ctx = result.context;
  const rawOwner = toRaw(ctx) || ctx;

  if (rawOwner instanceof Element) {
    return {fn: rawOwner[key] || result.value, owner: rawOwner};
  }

  const component = findComponentOwner(ctx);
  if (component) {
    return {fn: component[key] || result.value, owner: component};
  }

  // Plain reactive item/context object: keep the proxy as the receiver so
  // mutations inside the handler still go through reactivity.
  return {fn: ctx?.[key] || result.value, owner: ctx};
}

function bindOwned(owned) {
  if (!owned || typeof owned.fn !== 'function') return owned?.fn;
  return owned.fn.bind(owned.owner);
}

function assignExprPath(context, expr, value) {
  let path = expr.trim();
  if (path === 'this') return;
  if (path.startsWith('this.')) path = path.slice(5);
  path = path.replace(/\?\./g, '.');
  const parts = path.split('.').filter(Boolean);
  let obj = context;
  for (let i = 0; i < parts.length - 1; i++) {
    obj = obj?.[parts[i]];
    if (obj == null) return;
  }
  const last = parts[parts.length - 1];
  if (obj && last) obj[last] = value;
}

function segmentValueText(value, type = 'text') {
  if (value == null) return '';
  if (isTemplateResult(value)) {
    return type === 'attribute' ? String(value) : '';
  }
  if (typeof Node !== 'undefined' && value instanceof Node) return '';
  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (isTemplateResult(item) || (typeof Node !== 'undefined' && item instanceof Node)) return '';
        return item == null ? '' : String(item);
      })
      .join(' ');
  }
  return String(value);
}

function evalSegments(segments, context, values, type) {
  let text = '';
  let hasNull = false;

  for (const segment of segments) {
    if (segment.type === 'static') {
      text += segment.value;
      continue;
    }

    let value;
    if (segment.type === 'expr') {
      value = ExpressionParser.evaluateAuto(segment.code, context);
      if (value == null) hasNull = true;
      text += value == null ? '' : String(value);
      continue;
    }

    value = segment.type === 'constant'
      ? segment.value
      : values?.[segment.index];

    if (value == null) hasNull = true;
    text += segmentValueText(value, type);
  }

  return {text, hasNull};
}

function hasExpressions(segments) {
  return segments.some(segment => segment.type === 'expr');
}

function hasStructuredValues(segments, values) {
  for (const segment of segments) {
    if (segment.type !== 'value' && segment.type !== 'constant') continue;
    const value = segment.type === 'constant' ? segment.value : values?.[segment.index];
    if (isTemplateResult(value)) return true;
    if (typeof Node !== 'undefined' && value instanceof Node) return true;
    if (Array.isArray(value)) {
      if (value.some(item => isTemplateResult(item) || (typeof Node !== 'undefined' && item instanceof Node))) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

class ChildPart {
  #stop = null;
  #nodes = [];
  #nested = [];

  constructor(anchor, segments, context, host, instance, values) {
    this.anchor = anchor;
    this.segments = segments;
    this.context = context;
    this.host = host;
    this.instance = instance;
    this.values = values || [];

    if (hasExpressions(segments)) {
      this.#stop = effect(() => this.commit(), {component: host, internal: true});
    } else {
      this.commit();
    }
  }

  setResult(result) {
    this.values = result?.values || [];
    // `${}` values are not reactive by themselves; `update()` patches them.
    this.commit();
  }

  commit() {
    if (hasStructuredValues(this.segments, this.values)) {
      this.#renderStructured();
      return;
    }

    this.#clearNodes();
    const {text} = evalSegments(this.segments, this.context, this.values, 'text');
    if (this.anchor.nodeValue !== text) {
      recordTemplateStat('domWrites');
      this.anchor.nodeValue = text;
    }
  }

  #clearNodes() {
    for (const node of this.#nodes) node.remove?.();
    this.#nodes = [];
    for (const nested of this.#nested) nested.destroy();
    this.#nested = [];
  }

  #renderStructured() {
    this.#clearNodes();
    this.anchor.nodeValue = '';

    const nodes = [];
    const nested = [];
    let textBuffer = '';

    const flushText = () => {
      if (!textBuffer) return;
      nodes.push(document.createTextNode(textBuffer));
      textBuffer = '';
    };

    const appendValue = (value) => {
      if (value == null) return;

      if (isTemplateResult(value)) {
        flushText();
        const compiled = compileTemplate(value);
        const nestedInstance = compiled.instantiate(this.context, this.host, {
          nested: true,
          strategy: this.instance.strategy,
          // Nested templates keep their own ${} values. Without `result` the
          // nested Parts would start with an empty values array.
          result: value,
        });
        nodes.push(...nestedInstance.rootNodes);
        nested.push(nestedInstance);
        this.#adoptChildren(nestedInstance.childrenRendered);
        return;
      }

      if (typeof Node !== 'undefined' && value instanceof Node) {
        flushText();
        nodes.push(value);
        return;
      }

      if (Array.isArray(value)) {
        let first = true;
        for (const item of value) {
          if (first) first = false;
          else if (!isTemplateResult(item) && !(typeof Node !== 'undefined' && item instanceof Node)) {
            textBuffer += ' ';
          } else {
            flushText();
          }
          appendValue(item);
        }
        return;
      }

      textBuffer += String(value);
    };

    for (const segment of this.segments) {
      if (segment.type === 'static') {
        textBuffer += segment.value;
        continue;
      }
      if (segment.type === 'expr') {
        const value = ExpressionParser.evaluateAuto(segment.code, this.context);
        textBuffer += value == null ? '' : String(value);
        continue;
      }
      const value = segment.type === 'constant'
        ? segment.value
        : this.values?.[segment.index];
      appendValue(value);
    }

    flushText();

    const parent = this.anchor.parentNode;
    if (!parent) return;
    if (nodes.length) recordTemplateStat('domWrites', nodes.length);
    for (const node of nodes) parent.insertBefore(node, this.anchor);

    this.#nodes = nodes;
    this.#nested = nested;
  }

  #adoptChildren(children) {
    if (!children?.length) return;
    for (const child of children) {
      if (!this.instance.childrenRendered.includes(child)) {
        this.instance.childrenRendered.push(child);
      }
    }
  }

  listenerCount() {
    let count = 0;
    for (const nested of this.#nested) {
      count += nested.getEventListenersCount?.() || 0;
    }
    return count;
  }

  destroy() {
    this.#stop?.();
    this.#stop = null;
    this.#clearNodes();
  }
}

class AttributePart {
  #stop = null;

  constructor(element, descriptor, context, host, values) {
    this.element = element;
    this.name = descriptor.name;
    this.mode = descriptor.mode || 'native';
    this.segments = descriptor.segments;
    this.context = context;
    this.host = host;
    this.values = values || [];

    if (descriptor.expression) {
      this.#stop = effect(() => this.commit(), {component: host, internal: true});
    } else {
      this.commit();
    }
  }

  setResult(result) {
    this.values = result?.values || [];
    this.commit();
  }

  commit() {
    const {text, hasNull} = evalSegments(this.segments, this.context, this.values, 'attribute');

    if (this.mode === 'component') {
      if (this.element.getAttribute(this.name) !== text) {
        recordTemplateStat('domWrites');
        this.element.setAttribute(this.name, text);
      }
      return;
    }

    this.#setAttributeOrProperty(text, hasNull);
  }

  #setAttributeOrProperty(value, hasNull) {
    const node = this.element;
    const attrName = this.name;
    const shouldUseProperty = attrName in node &&
      !attrName.startsWith('data-') &&
      attrName !== 'style' &&
      attrName !== 'class';

    if (shouldUseProperty) {
      if (typeof node[attrName] === 'boolean') {
        const boolValue = !hasNull && value !== 'false' &&
          (value === 'true' || value === '' || value === attrName);
        if (node[attrName] !== boolValue) {
          recordTemplateStat('domWrites');
          node[attrName] = boolValue;
          node.toggleAttribute(attrName, boolValue);
        }
      } else if (node[attrName] !== value) {
        recordTemplateStat('domWrites');
        node[attrName] = value;
      }
      return;
    }

    if (node.getAttribute(attrName) !== value) {
      recordTemplateStat('domWrites');
      node.setAttribute(attrName, value);
    }
  }

  destroy() {
    this.#stop?.();
    this.#stop = null;
  }
}

class PropertyPart {
  #stop = null;

  constructor(element, descriptor, context, host, values) {
    this.element = element;
    this.target = element.state || element;
    this.name = descriptor.name;
    this.segments = descriptor.segments;
    this.context = context;
    this.host = host;
    this.values = values || [];

    if (descriptor.expression) {
      this.#stop = effect(() => this.commit(), {component: host, internal: true});
    } else {
      this.commit();
    }
  }

  setResult(result) {
    this.values = result?.values || [];
    this.commit();
  }

  commit() {
    const pure = this.segments.length === 1 && this.segments[0].type === 'expr';

    // Compare through the raw target: reading a reactive property here would
    // add a dependency and could make the part fight the component's own state.
    const rawTarget = toRaw(this.target) || this.target;

    if (pure) {
      const code = this.segments[0].code;
      const value = this.#evaluatePropertyValue(code);
      if (rawTarget[this.name] !== value) {
        recordTemplateStat('domWrites');
        this.target[this.name] = value;
      }
      return;
    }

    const {text} = evalSegments(this.segments, this.context, this.values, 'property');
    if (rawTarget[this.name] !== text) {
      recordTemplateStat('domWrites');
      this.target[this.name] = text;
    }
  }

  #evaluatePropertyValue(code) {
    try {
      const owned = resolveOwnedFromExpr(code, this.context);
      if (owned) return bindOwned(owned);
    } catch {
      // Not a function path — fall through to the normal evaluator.
    }
    return ExpressionParser.evaluateAuto(code, this.context);
  }

  destroy() {
    this.#stop?.();
    this.#stop = null;
  }
}

class EventPart {
  constructor(element, descriptor, context) {
    this.element = element;
    this.eventName = descriptor.eventName;
    this.handler = null;

    const expr = descriptor.expr;
    const methodMatch = expr.match(METHOD_NAME_RE);

    if (methodMatch) {
      const methodName = methodMatch[1];
      // Method-name handlers are resolved lazily, matching the legacy engine:
      // the warning (if any) is emitted on click, not during rendering.
      this.handler = (event) => {
        const owned = findMethod(context, methodName);
        if (!owned) {
          console.warn(`Method '${methodName}' not found`);
          return;
        }
        owned.fn.call(owned.owner, event, this.element);
      };
      this.element.addEventListener(this.eventName, this.handler);
      return;
    }

    let owned = null;
    try {
      owned = resolveOwnedFromExpr(expr, context);
    } catch (error) {
      console.warn(`Invalid event handler '${expr}':`, error.message);
    }
    if (owned) {
      this.handler = (event) => owned.fn.call(owned.owner, event, this.element);
      this.element.addEventListener(this.eventName, this.handler);
    } else {
      console.warn(`Handler '${expr}' did not resolve to a function`);
    }
  }

  destroy() {
    if (this.handler) {
      this.element.removeEventListener(this.eventName, this.handler);
      this.handler = null;
    }
  }

  listenerCount() {
    return this.handler ? 1 : 0;
  }
}

class RefPart {
  #targets = new Set();

  constructor(element, name, host) {
    this.element = element;
    this.name = name;
    this.host = host;
    this.register();
  }

  get target() {
    return this.host._vedaRefsTarget || this.host;
  }

  register() {
    if (!this.name) return;
    const target = this.target;
    this.#targets.add(target);
    if (!target.refs) target.refs = {};
    target.refs[this.name] = this.element;
  }

  refresh() {
    this.register();
  }

  destroy() {
    for (const target of this.#targets) {
      if (target?.refs?.[this.name] === this.element) {
        delete target.refs[this.name];
      }
    }
    this.#targets.clear();
  }
}

class BindPart {
  #stop = null;

  constructor(element, descriptor, context, host) {
    this.element = element;
    this.expr = descriptor.expr;
    this.context = context;
    this.host = host;

    const isCheckbox = element.type === 'checkbox';
    const isRadio = element.type === 'radio';

    this.applyValue = (value) => {
      if (isRadio) {
        element.checked = String(value ?? '') === String(element.value);
      } else if (isCheckbox) {
        element.checked = !!value;
      } else if (element.value !== String(value ?? '')) {
        element.value = value ?? '';
      }
    };

    this.#stop = effect(() => {
      this.applyValue(ExpressionParser.evaluate(this.expr, context));
    }, {component: host, internal: true});

    this.handler = (event) => {
      if (isRadio) {
        if (event.target.checked) assignExprPath(context, this.expr, event.target.value);
        return;
      }
      const value = isCheckbox ? event.target.checked : event.target.value;
      assignExprPath(context, this.expr, value);
    };

    this.eventName = isCheckbox || isRadio || element.tagName === 'SELECT' ? 'change' : 'input';
    element.addEventListener(this.eventName, this.handler);
  }

  destroy() {
    this.#stop?.();
    this.#stop = null;
    this.element.removeEventListener(this.eventName, this.handler);
  }

  listenerCount() {
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Declarative component creation
// ---------------------------------------------------------------------------

function defineBuiltin(tag, is, factory, elementClass) {
  if (customElements.get(is)) return;
  if (!factory) throw new Error(`No component factory registered for '${is}'`);
  customElements.define(is, factory(elementClass), {extends: tag});
}

function createComponentElement(descriptor, context, host, instance) {
  const {kind, tag, elementClass} = descriptor;
  let isName = null;
  let factory = null;

  switch (kind) {
    case 'custom':
      if (!customElements.get(tag)) {
        throw new Error(`Custom elements registry has no entry for tag '${tag}'`);
      }
      break;
    case 'is':
      isName = descriptor.is;
      if (!isName || !customElements.get(isName)) {
        throw new Error(`Custom elements registry has no entry for '${isName}'`);
      }
      break;
    case 'about':
      isName = `${tag}-inline-component`;
      factory = factories.Component;
      break;
    case 'property':
      isName = `${tag}-property-component`;
      factory = factories.Property;
      break;
    case 'rel':
      isName = `${tag}-rel-component`;
      factory = factories.Relation;
      break;
    case 'items':
      isName = `${tag}-loop-component`;
      factory = factories.Loop;
      break;
    case 'condition':
      isName = `${tag}-if-component`;
      factory = factories.If;
      break;
    default:
      throw new Error(`Unknown component kind '${kind}'`);
  }

  let component;
  if (kind === 'custom') {
    component = document.createElement(tag);
  } else {
    if (factory) defineBuiltin(tag, isName, factory, elementClass);
    component = document.createElement(tag, {is: isName});
    component.setAttribute('is', isName);
  }

  for (const [name, value] of descriptor.staticAttrs || []) {
    if (name === 'is' && kind !== 'custom') continue;
    component.setAttribute(name, value);
  }

  recordTemplateStat('componentCreates');
  recordComponentTag(tag);
  component.template = descriptor.childLegacy || '';
  component._compiledTemplate = descriptor.childCompiled || null;
  component._vedaEvalContext = context;
  component._templateValues = instance.values;
  instance.components.push({component, descriptor});

  if ((kind === 'property' || kind === 'rel') && !component.hasAttribute('about')) {
    const model = context?.model || host?.state?.model;
    if (model) component.state.model = model;
  }

  if (component.rendered) instance.childrenRendered.push(component.rendered);
  return component;
}

// ---------------------------------------------------------------------------
// TemplateInstance
// ---------------------------------------------------------------------------

export default class TemplateInstance {
  constructor(compiled, context, host, options = {}) {
    this.compiled = compiled;
    this.context = context;
    this.host = host;
    recordInstanceHost(host);
    this.options = options;
    this.strategy = options.strategy || defaultBindingStrategy;
    this.result = options.result || null;
    this.values = options.values || this.result?.values || [];

    this.fragment = compiled.template.content.cloneNode(true);
    this.parts = [];
    this.components = [];
    this.childrenRendered = [];
    this.rootNodes = [];

    // Replace declarative component elements first. Paths remain valid because
    // replacement happens in place.
    for (const descriptor of compiled.components) {
      const old = this.strategy.resolve(this.fragment, descriptor);
      if (!old || !old.parentNode) continue;
      const component = createComponentElement(descriptor, context, host, this);
      old.parentNode.replaceChild(component, old);
    }

    // Resolve every node before creating any Part. ChildPart commits can
    // insert/remove sibling nodes (${...} with a TemplateResult/Node/array),
    // which would shift the child-index paths of Parts that are created later.
    const elementBindings = [];
    for (const descriptor of compiled.elementParts) {
      const element = this.strategy.resolve(this.fragment, descriptor);
      if (element) elementBindings.push([element, descriptor]);
    }

    const textBindings = [];
    for (const descriptor of compiled.textParts) {
      const node = this.strategy.resolve(this.fragment, descriptor);
      if (node) textBindings.push([node, descriptor]);
    }

    for (const [element, descriptor] of elementBindings) {
      this.parts.push(createElementPart(element, descriptor, context, host, this.values));
    }

    for (const [node, descriptor] of textBindings) {
      this.parts.push(new ChildPart(node, descriptor.segments, context, host, this, this.values));
    }

    this.rootNodes = Array.from(this.fragment.childNodes);
  }

  mount(container) {
    recordTemplateStat('mounts');
    container.replaceChildren(this.fragment);
    this.fragment = null;
  }

  setResult(result) {
    recordTemplateStat('patches');
    this.result = result;
    this.values = result?.values || [];
    this.#applyValues();
  }

  setValues(values) {
    recordTemplateStat('patches');
    this.values = values || [];
    this.#applyValues();
  }

  #applyValues() {
    const source = {values: this.values};
    for (const part of this.parts) part.setResult?.(source);
    for (const {component} of this.components) {
      component._setTemplateValues?.(this.values);
    }
  }

  refreshRefs() {
    for (const part of this.parts) part.refresh?.();
  }

  getEventListenersCount() {
    let count = 0;
    for (const part of this.parts) {
      if (typeof part.listenerCount === 'function') count += part.listenerCount();
    }
    return count;
  }

  destroy() {
    for (const part of this.parts) part.destroy?.();
    this.parts = [];
    this.components = [];
    // Keep the rendered DOM attached to a detached component, matching the
    // legacy lifecycle. A replacement instance clears it via replaceChildren().
    this.rootNodes = [];
    this.fragment = null;
  }
}

function createElementPart(element, descriptor, context, host, values) {
  switch (descriptor.type) {
    case 'attribute':
      return new AttributePart(element, descriptor, context, host, values);
    case 'property':
      return new PropertyPart(element, descriptor, context, host, values);
    case 'event':
      return new EventPart(element, descriptor, context);
    case 'ref':
      return new RefPart(element, descriptor.name, host);
    case 'bind':
      return new BindPart(element, descriptor, context, host);
    default:
      return null;
  }
}
