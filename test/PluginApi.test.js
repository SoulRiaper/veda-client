import './setup-dom.js';
import Component, {html} from '../src/components/Component.js';
import {registerRenderAdapter, getRenderAdapter, ExpressionParser, reconcileOrder, setAttributeOrProperty} from '../src/plugin-api.js';
import {createTestComponent} from './helpers.js';

export default ({test, assert}) => {
  test('Plugin API - adapter registration can be removed', () => {
    const before = getRenderAdapter();
    const adapter = {};
    const unregister = registerRenderAdapter(adapter);

    assert(getRenderAdapter() === adapter, 'adapter installed');
    unregister();
    assert(getRenderAdapter() === before, 'previous adapter restored');
  });

  test('Plugin API - adapter wraps render inside the core scope', async () => {
    const calls = [];

    class AdapterApp extends Component(HTMLElement) {
      render() {
        calls.push('render');
        this.addCleanup(() => calls.push('cleanup'));
        return html`<span class="x">ok</span>`;
      }
    }

    const unregister = registerRenderAdapter({
      render(component, renderFn) {
        assert(component.renderScope, 'render runs inside the core scope');
        calls.push('adapter-render');
        return renderFn();
      },
    });

    try {
      const {component, cleanup} = await createTestComponent(AdapterApp);

      assert.equal(calls[0], 'adapter-render', 'adapter wrapped render');
      assert(calls.includes('render'), 'author render ran');

      component.remove();
      assert(calls.includes('cleanup'), 'core disposed the render scope');

      cleanup();
    } finally {
      unregister();
    }
  });

  test('Plugin API - core mounts Node output without an adapter', async () => {
    class NodeApp extends Component(HTMLElement) {
      render() {
        const node = document.createElement('div');
        node.className = 'node';
        node.textContent = 'node';
        return node;
      }
    }

    const {component, cleanup} = await createTestComponent(NodeApp);
    assert(component.querySelector('.node')?.textContent === 'node', 'Node output mounted');

    cleanup();
  });

  test('Plugin API - helper exports are available', () => {
    assert(typeof setAttributeOrProperty === 'function', 'setAttributeOrProperty');
    assert(typeof ExpressionParser.evaluateAuto === 'function', 'ExpressionParser');
    assert(typeof reconcileOrder === 'function', 'reconcileOrder');
  });
};
