import './setup-dom.js';
import Component from '../src/components/Component.js';
import {flushEffects} from '../src/Effect.js';
import {reactive} from '../src/Reactive.js';
import {createScope, disposeScope, runInScope, scopedEffect} from '../src/view-scope.js';
import {createTestComponent} from './helpers.js';

export default ({test, assert}) => {
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
          scopedEffect(() => {
            span.textContent = `v${ticks.value}`;
          });
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
};
