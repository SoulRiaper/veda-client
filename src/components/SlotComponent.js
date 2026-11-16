import Component from './Component.js';
import {toRaw} from '../Reactive.js';
import {compileTemplate, compileTemplateWithValues, resolveSourceTokens} from '../template/Template.js';

const MAX_TREE_DEPTH = 20;

/**
 * Projects named content from the host component's original template.
 *
 * Host:
 *   <veda-popup>
 *     <button slot="trigger">Open</button>
 *     <div slot="content">Hello</div>
 *   </veda-popup>
 *
 * Popup render():
 *   <veda-slot name="trigger"></veda-slot>
 *   <veda-slot name="content"></veda-slot>
 *
 * Forward an outer slot into an inner one by projecting the outlet itself:
 *   <ui-card><veda-slot name="page-aside" slot="aside"></veda-slot></ui-card>
 */
export default function SlotComponent(Class = HTMLElement) {
  return class SlotComponentClass extends Component(Class) {
    static tag = 'veda-slot';

    #host = null;
    #registeredHost = null;
    #isDisconnected = false;
    #instance = null;
    #instanceKey = null;
    #instanceContext = null;

    async connectedCallback() {
      this.#isDisconnected = false;
      this.#host = this.#host || this.#resolveHost();
      this.#instance = null;
      this.#instanceKey = null;
      this.#instanceContext = null;
      this.replaceChildren();
      this._deferRendered();
      await super.connectedCallback();
      this._resolveDeferred();
    }

    disconnectedCallback() {
      if (this.#isDisconnected) return;
      this.#isDisconnected = true;
      this.#stopListeningHost();
      this.#instance?.destroy();
      this.#instance = null;
      this.#instanceKey = null;
      this.#instanceContext = null;
      this.replaceChildren();
      // Keep #host. Place may move this node to another parent and reconnect;
      // the layout host is no longer an ancestor after the move.
      super.disconnectedCallback?.();
    }

    _processEvalContext() {
      return null;
    }

    _getEventListenersCount() {
      return super._getEventListenersCount() + (this.#instance?.getEventListenersCount?.() || 0);
    }

    _onTemplateValuesChanged() {
      if (this.isConnected) this.#mount();
    }

    // The layout host is a component, not an instance of this Slot: when its
    // parent updates the host values, the Slot still has to patch the projected
    // content. The host keeps its slots in a Set and calls this method.
    _onHostValuesChanged() {
      if (this.isConnected) this.#mount();
    }

    render() {}

    post() {
      this.#mount();
    }

    #mount() {
      if (this.#isDisconnected) return;

      const host = this.#host;
      if (!host) {
        this.#stopListeningHost();
        this.replaceChildren();
        return;
      }
      this.#listenToHost(host);

      const name = this.getAttribute('name') || 'default';
      const projection = this.#buildProjection(host, name);
      const evalContext = projection.hasProjected
        ? host._vedaEvalContext || host
        : host;
      // Projected content belongs to the parent template, so its `${}` values
      // are the host values. The Slot fallback belongs to this layout.
      const values = projection.hasProjected
        ? (host._templateValues || [])
        : (this._templateValues || []);
      const key = `${projection.hasProjected ? 'p' : 'f'}|${name}|${projection.key}`;

      if (
        this.#instance &&
        this.#instanceKey === key &&
        this.#instanceContext === evalContext
      ) {
        this._vedaRefsTarget = this.#refsOwner(evalContext, host);
        try {
          this.#instance.setValues(values);
          this.#instance.refreshRefs();
        } finally {
          this._vedaRefsTarget = null;
        }
        return;
      }

      this.#instance?.destroy();
      this.#instance = null;
      this.replaceChildren();

      this._vedaRefsTarget = this.#refsOwner(evalContext, host);
      try {
        let compiled = projection.compiled;
        if (!compiled) {
          compiled = projection.hasProjected
            ? compileTemplateWithValues(projection.markup, values)
            : compileTemplate(projection.markup);
        }
        const instance = compiled.instantiate(
          evalContext,
          this,
          {values},
        );
        if (projection.hasProjected) this.#pinProjectedSlots(instance.fragment, evalContext);
        this.append(instance.fragment);
        this.#instance = instance;
        this.#instanceKey = key;
        this.#instanceContext = evalContext;
      } finally {
        this._vedaRefsTarget = null;
      }
    }

    // The layout host is a component. It keeps a Set of the slots that project
    // its author content and notifies them when its `${}` values change.
    #listenToHost(host) {
      if (this.#registeredHost === host) return;
      this.#stopListeningHost();
      if (!host) return;
      if (!host._vedaSlotListeners) host._vedaSlotListeners = new Set();
      host._vedaSlotListeners.add(this);
      this.#registeredHost = host;
    }

    #stopListeningHost() {
      const host = this.#registeredHost;
      if (!host) return;
      host._vedaSlotListeners?.delete(this);
      this.#registeredHost = null;
    }

    #buildProjection(host, name) {
      // Prefer the raw author source, which still carries `${}` tokens: it is
      // compiled with the host values below, so values stay values. A host
      // without a compiled source (authored directly in the DOM, or created by
      // the legacy Virtual path) falls back to its baked template string.
      const source = host._templateSource ?? host.template;
      const values = host._templateValues || [];
      const tpl = document.createElement('template');
      tpl.innerHTML = source || '';

      const fragment = document.createDocumentFragment();
      let hasProjectedContent = false;

      for (const child of [...tpl.content.childNodes]) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (name !== 'default' || !child.nodeValue.trim()) continue;
          fragment.appendChild(child.cloneNode(true));
          hasProjectedContent = true;
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        // A `${}` in the slot attribute is a value, not markup: resolve it for
        // matching only, then drop the attribute from the projected clone.
        const slotName = resolveSourceTokens(child.getAttribute('slot') || 'default', values);
        if (slotName !== name) continue;
        child.removeAttribute('slot');
        fragment.appendChild(child.cloneNode(true));
        hasProjectedContent = true;
      }

      if (!hasProjectedContent && this.template) {
        return {
          compiled: this._compiledTemplate || null,
          markup: this.template,
          key: this._compiledTemplate ? 'compiled' : this.template,
          hasProjected: false,
        };
      }

      const wrapper = document.createElement('template');
      wrapper.content.appendChild(fragment);
      const markup = wrapper.innerHTML;
      return {compiled: null, markup, key: markup, hasProjected: hasProjectedContent};
    }

    // A forwarded outlet is cloned into the inner component, so its DOM parent
    // is the wrong host. Pin the component that authored the projected template.
    #pinProjectedSlots(fragment, evalContext) {
      const author = this.#authorFromContext(evalContext);
      if (!author) return;
      for (const slot of fragment.querySelectorAll('veda-slot')) {
        slot._vedaSlotHost = author;
      }
    }

    #authorFromContext(context) {
      let obj = context;
      for (let i = 0; obj && i < MAX_TREE_DEPTH; i++) {
        const raw = toRaw(obj) || obj;
        // State objects prototype-chain to their component, so instanceof matches
        // the proxy too. Only the component owns `template`.
        if (
          raw instanceof Element
          && Object.prototype.hasOwnProperty.call(raw, 'template')
          && typeof raw.template === 'string'
        ) return raw;
        obj = Object.getPrototypeOf(raw);
        if (obj === Object.prototype) break;
      }
      return null;
    }

    #resolveHost() {
      if (this._vedaSlotHost) return this._vedaSlotHost;

      const fromTree = this._findParentComponent();
      if (fromTree) return fromTree;

      let obj = this._vedaEvalContext || this._vedaParentContext;
      for (let i = 0; obj && i < MAX_TREE_DEPTH; i++) {
        if (typeof obj.template === 'string') return obj;
        obj = Object.getPrototypeOf(obj);
      }
      return null;
    }

    #refsOwner(evalContext, fallback) {
      let obj = evalContext;
      for (let i = 0; obj && i < MAX_TREE_DEPTH; i++) {
        if (obj.refs && typeof obj.refs === 'object' && !Array.isArray(obj.refs)) {
          return toRaw(obj) || obj;
        }
        obj = Object.getPrototypeOf(obj);
      }
      return fallback;
    }
  };
}

const Slot = (() => {
  if (typeof customElements !== 'undefined') {
    const SlotComponentClass = SlotComponent(HTMLElement);
    customElements.define(SlotComponentClass.tag, SlotComponentClass);
    return SlotComponentClass;
  }
  return SlotComponent;
})();

export {Slot};
