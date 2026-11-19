import './setup-dom.js';
import Component from '../src/components/Component.js';
import {flushEffects} from '../src/Effect.js';
import {reactive} from '../src/Reactive.js';
import {createTestComponent} from './helpers.js';
import {
  bindAttr,
  bindChild,
  bindEvent,
  bindList,
  bindShow,
  bindSlot,
  bindText,
  component,
  createScope,
  disposeScope,
  insertNode,
  runInScope,
  setSlotViews,
  template,
  useTemplate,
} from '../src/view-api.js';

function scope(fn) {
  const s = createScope(null);
  runInScope(s, fn);
  return s;
}

export default ({test, assert}) => {
  test('view-api - text, attribute and event bindings react inside a scope', async () => {
    const owner = reactive({value: 0, label: 'one', clicks: 0});
    const el = document.createElement('button');
    document.body.appendChild(el);

    const s = scope(() => {
      bindText(el, () => owner.label);
      bindAttr(el, 'data-value', () => owner.value);
      bindAttr(el, 'disabled', () => owner.value <= 0);
      bindEvent(el, 'click', () => { owner.clicks++; });
    });

    assert.equal(el.textContent, 'one');
    assert.equal(el.getAttribute('data-value'), '0');
    assert.equal(el.disabled, true);

    owner.label = 'two';
    owner.value = 2;
    await flushEffects();
    assert.equal(el.textContent, 'two');
    assert.equal(el.getAttribute('data-value'), '2');
    assert.equal(el.disabled, false);

    el.click();
    assert.equal(owner.clicks, 1);

    disposeScope(s);
    owner.label = 'three';
    owner.value = 3;
    await flushEffects();
    assert.equal(el.textContent, 'two', 'disposed scope no longer updates');

    owner.label = 'one';
    owner.value = 0;
    el.remove();
  });

  test('view-api - bindAttr applies style objects and removes dropped properties', async () => {
    const el = document.createElement('div');
    const style = reactive({color: 'red', marginTop: '4px'});

    const s = scope(() => bindAttr(el, 'style', () => style));
    assert.equal(el.style.color, 'red');
    assert.equal(el.style.marginTop, '4px');

    style.color = 'blue';
    style.marginTop = null;
    await flushEffects();
    assert.equal(el.style.color, 'blue');
    assert.equal(el.style.marginTop, '');

    disposeScope(s);
  });

  test('view-api - bindChild renders text and replaces node values', async () => {
    const anchor = document.createComment('v:0');
    const host = document.createElement('div');
    host.appendChild(anchor);
    const state = reactive({value: 'hello', node: null});

    const s = scope(() => bindChild(anchor, () => state.node ?? state.value));
    assert.equal(host.textContent, 'hello');

    const span = document.createElement('span');
    span.textContent = 'node';
    state.node = span;
    await flushEffects();
    assert.equal(host.textContent, 'node');
    assert.equal(host.firstChild, span);

    state.node = null;
    state.value = 'done';
    await flushEffects();
    assert.equal(host.textContent, 'done');

    disposeScope(s);
  });

  test('view-api - useTemplate collects markers and binds them', async () => {
    const tpl = template('<section><h1><!--v:0--></h1><p data-v="1"></p></section>');
    const state = reactive({title: 'Hello', tone: 'ok'});
    let nodes;
    scope(() => {
      nodes = useTemplate(tpl, (_root, m) => {
        bindText(m[0], () => state.title);
        bindAttr(m[1], 'class', () => state.tone);
      });
    });

    const root = nodes[0];
    const outside = document.createElement('div');
    outside.appendChild(root);
    assert.equal(root.querySelector('h1').textContent, 'Hello');
    assert.equal(root.querySelector('p').getAttribute('class'), 'ok');
    assert.equal(root.querySelector('[data-v]'), null, 'marker attribute is removed');

    state.title = 'Changed';
    state.tone = 'warn';
    await flushEffects();
    assert.equal(root.querySelector('h1').textContent, 'Changed');
    assert.equal(root.querySelector('p').getAttribute('class'), 'warn');
  });

  test('view-api - bindList keeps keyed nodes and disposes removed rows', async () => {
    const anchor = document.createComment('v:for');
    const host = document.createElement('div');
    host.appendChild(anchor);

    const rows = [
      {id: 1, title: 'one'},
      {id: 2, title: 'two'},
      {id: 3, title: 'three'},
    ];
    const state = reactive({rows, markers: 0});

    const s = scope(() => {
      bindList(anchor, {
        items: () => state.rows,
        key: row => row.id,
        render: row => {
          state.markers++;
          const el = document.createElement('li');
          bindText(el, () => row.title);
          el.__rowId = row.id;
          return el;
        },
      });
    });

    assert.equal(host.querySelectorAll('li').length, 3);
    assert.equal(host.querySelectorAll('li')[0].__rowId, 1);
    const first = host.querySelectorAll('li')[0];
    assert.equal(state.markers, 3);

    // Reverse: the same DOM nodes are moved, not recreated.
    state.rows = [rows[2], rows[1], rows[0]];
    await flushEffects();
    assert.equal(state.markers, 3, 'no rows recreated on reorder');
    assert.equal(host.querySelectorAll('li')[0].__rowId, 3, 'last row moved to the front');
    assert.equal(host.querySelectorAll('li')[2], first, 'first row moved to the end');

    // Replace the middle row: same key keeps the old node and its text.
    state.rows = [{id: 3, title: 'three'}, {id: 2, title: 'TWO'}, {id: 1, title: 'one'}];
    await flushEffects();
    assert.equal(host.querySelectorAll('li')[1].textContent, 'two', 'existing rows keep their original item (For parity)');

    // Remove one row.
    state.rows = [{id: 3, title: 'three'}, {id: 1, title: 'one'}];
    await flushEffects();
    assert.equal(host.querySelectorAll('li').length, 2);

    disposeScope(s);
    assert.equal(host.querySelectorAll('li').length, 2, 'nodes stay after scope disposal');
  });

  test('view-api - bindShow toggles a branch and disposes its effects', async () => {
    const anchor = document.createComment('v:show');
    const host = document.createElement('div');
    host.appendChild(anchor);

    const state = reactive({open: false, ticks: 0});
    const s = scope(() => {
      bindShow(anchor, {
        when: () => state.open,
        render: () => {
          const el = document.createElement('div');
          el.className = 'panel';
          bindText(el, () => `ticks ${state.ticks}`);
          return el;
        },
      });
    });

    assert.equal(host.querySelector('.panel'), null);

    state.open = true;
    await flushEffects();
    assert.equal(host.querySelector('.panel').textContent, 'ticks 0');

    state.ticks = 1;
    await flushEffects();
    assert.equal(host.querySelector('.panel').textContent, 'ticks 1');

    state.open = false;
    await flushEffects();
    assert.equal(host.querySelector('.panel'), null);

    state.ticks = 2;
    await flushEffects();
    assert.equal(host.querySelector('.panel'), null);

    state.open = true;
    await flushEffects();
    assert.equal(host.querySelector('.panel').textContent, 'ticks 2', 'branch recreated with current state');

    disposeScope(s);
  });

  test('view-api - component() supports class and function components', async () => {
    class Child extends Component(HTMLElement) {
      static tag = `test-view-child-${Math.random().toString(36).slice(2, 8)}`;
      render() {
        return {nodes: [document.createComment('child')]};
      }
    }
    customElements.define(Child.tag, Child);

    const state = reactive({model: 'a'});
    const s = scope(() => {
      const el = component(Child, {
        attrs: {title: 'Hello'},
        lazy: {model: () => state.model},
        values: {onSelect: () => 'selected'},
      });
      assert(el instanceof Child);
      assert.equal(el.getAttribute('title'), 'Hello');
      assert.equal(el.state.model, 'a');
      assert.equal(el.state.onSelect(), 'selected');
      state.model = 'b';
    });
    await flushEffects();
    // The binding was registered in the isolated scope, so it is disposed with it.
    disposeScope(s);

    const View = props => {
      const span = document.createElement('span');
      span.textContent = `${props.title}:${props.model}:${props.children?.[0]?.textContent ?? ''}`;
      return span;
    };
    let nodes;
    scope(() => {
      nodes = component(View, {
        attrs: {title: 'fn'},
        lazy: {model: () => 'lazy'},
        slots: [{name: 'default', view: () => {
          const el = document.createElement('i');
          el.textContent = 'kids';
          return el;
        }}],
      });
    });
    assert.equal(nodes[0].textContent, 'fn:lazy:kids');
  });

  test('view-api - node-based slots render registered views without veda-slot', async () => {
    class Layout extends Component(HTMLElement) {
      static tag = `test-view-slot-${Math.random().toString(36).slice(2, 8)}`;
      render() {
        return useTemplate(
          template('<div class="slot-host"><!--v:0--></div>'),
          (_root, m) => bindSlot(m[0], 'content')
        );
      }
    }
    customElements.define(Layout.tag, Layout);

    class App extends Component(HTMLElement) {
      static tag = `test-view-slot-app-${Math.random().toString(36).slice(2, 8)}`;
      render() {
        const el = component(Layout, {
          slots: [{name: 'content', view: () => {
            const p = document.createElement('p');
            p.className = 'slotted';
            p.textContent = 'Hello';
            return p;
          }}],
        });
        return el;
      }
    }

    const {component: app, cleanup} = await createTestComponent(App);
    const layout = app.querySelector(Layout.tag);
    await layout.rendered;
    await flushEffects();

    assert.equal(app.querySelector('veda-slot'), null, 'no veda-slot element in the DOM');
    assert.equal(app.querySelector('.slotted').textContent, 'Hello');

    cleanup();
  });

  test('Component view contract - View dispose runs before update and on disconnect', async () => {
    const calls = [];
    let renders = 0;

    class ContractApp extends Component(HTMLElement) {
      static tag = `test-view-contract-${Math.random().toString(36).slice(2, 8)}`;
      render() {
        renders++;
        const span = document.createElement('span');
        span.textContent = `render ${renders}`;
        return {
          nodes: [span],
          dispose() { calls.push(`dispose ${renders}`); },
        };
      }
    }

    const {component, cleanup} = await createTestComponent(ContractApp);
    assert.equal(component.textContent, 'render 1');

    await component.update();
    assert(calls.includes('dispose 1'), 'previous view disposed before an update');
    assert.equal(component.textContent, 'render 2');

    component.addCleanup(() => calls.push('cleanup'));
    component.remove();
    assert(calls.includes('dispose 2'), 'view disposed on disconnect');
    assert(calls.includes('cleanup'), 'addCleanup callback disposed on disconnect');

    cleanup();
  });

  test('Component view contract - renderScope, addCleanup and shadow container', async () => {
    const log = [];

    class ShadowApp extends Component(HTMLElement) {
      static tag = `test-view-shadow-${Math.random().toString(36).slice(2, 8)}`;
      render() {
        assert(this.renderScope, 'render scope exists while rendering');
        assert.equal(this.container, this.shadowRoot);
        this.addCleanup(() => log.push('disposed'));
        const span = document.createElement('span');
        span.textContent = 'shadow';
        return [span];
      }
    }

    const {component, cleanup} = await createTestComponent(ShadowApp, {
      setup: element => element.setAttribute('shadow', ''),
    });
    assert.equal(component.shadowRoot.querySelector('span').textContent, 'shadow');
    assert.equal(component.querySelector('span'), null, 'content stays in the shadow root');

    component.remove();
    assert.deepEqual(log, ['disposed']);
    cleanup();
  });

  test('Component view contract - move keeps the mounted DOM and effects', async () => {
    let renders = 0;
    const ticks = reactive({value: 0});

    class MoveApp extends Component(HTMLElement) {
      static tag = `test-view-move-${Math.random().toString(36).slice(2, 8)}`;
      render() {
        renders++;
        const s = createScope(this);
        return runInScope(s, () => {
          const span = document.createElement('span');
          bindText(span, () => `v${ticks.value}`);
          return {nodes: [span], dispose: () => disposeScope(s)};
        });
      }
    }

    const {component, container, cleanup} = await createTestComponent(MoveApp);
    const first = component.querySelector('span');
    assert.equal(first.textContent, 'v0');

    const other = document.createElement('div');
    document.body.appendChild(other);
    other.appendChild(component);
    await flushEffects();

    assert.equal(renders, 1, 'move does not re-render');
    assert.equal(component.querySelector('span'), first, 'same mounted node after the move');

    ticks.value = 1;
    await flushEffects();
    assert.equal(first.textContent, 'v1', 'effects survive the move');

    component.remove();
    other.remove();
    cleanup();
  });

  test('view-api - insertNode inserts arrays and slot views can be registered', () => {
    const host = document.createElement('div');
    const anchor = document.createComment('v:0');
    host.appendChild(anchor);
    const s = scope(() => insertNode(anchor, ['a', 'b']));
    assert.equal(host.textContent, 'ab');
    disposeScope(s);

    setSlotViews(host, {default: () => document.createElement('b')});
    assert.equal(typeof host.slotViews.default, 'function');
  });
};
