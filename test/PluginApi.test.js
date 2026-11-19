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

  test('Plugin API - adapter wraps render, output and cleanup', async () => {
    const calls = [];

    class AdapterApp extends Component(HTMLElement) {
      render() {
        calls.push('render');
        return html`<span class="x">ok</span>`;
      }
    }

    const unregister = registerRenderAdapter({
      beforeUpdate() { calls.push('before'); },
      render(_component, renderFn) {
        calls.push('adapter-render');
        return renderFn();
      },
      afterUpdate(_component, output) { calls.push(typeof output); },
      cleanup() { calls.push('cleanup'); },
    });

    try {
      const {component, cleanup} = await createTestComponent(AdapterApp);

      assert(calls[0] === 'before', 'beforeUpdate ran first');
      assert(calls.includes('adapter-render'), 'adapter rendered');
      assert(calls.includes('string'), 'afterUpdate saw the string output');

      component.remove();
      assert(calls.includes('cleanup'), 'cleanup ran on disconnect');

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
