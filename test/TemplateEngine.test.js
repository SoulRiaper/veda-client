import './setup-dom.js';
import Component, {html} from '../src/components/Component.js';
import {Loop} from '../src/components/LoopComponent.js';
import {If} from '../src/components/IfComponent.js';
import {flushEffects} from '../src/Effect.js';
import {createTestComponent, createTestContainer} from './helpers.js';
import {clearTemplateCache, compileTemplate, getTemplateCacheStats} from '../src/template/Template.js';
import {TemplateResult} from '../src/template/TemplateResult.js';
import {PathBindingStrategy} from '../src/template/BindingStrategy.js';

export default ({test, assert}) => {

  test('TemplateEngine - html returns a string-compatible TemplateResult', () => {
    const result = html`<div class="a ${'b'}">${'<x>'}</div>`;

    assert(result instanceof TemplateResult, 'html() should return TemplateResult');
    assert(result instanceof String, 'TemplateResult should stay string-compatible');
    assert(result.includes('&lt;x&gt;'), 'Legacy string form should be escaped');
    assert(result.includes('class="a b"'), 'Legacy string form should include interpolated attributes');
    assert(result.strings.length === 3, 'TemplateResult should retain strings');
    assert(result.values.length === 2, 'TemplateResult should retain values');
  });

  test('TemplateEngine - template is compiled once per call site', async () => {
    clearTemplateCache();

    class Item extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.label = 'item';
      }
      render() {
        return html`<span class="item">{this.state.label}</span>`;
      }
    }

    const tag = `test-engine-item-${Date.now()}`;
    Item.tag = tag;
    customElements.define(tag, Item);

    const {container, cleanup} = createTestContainer();
    const first = document.createElement(tag);
    container.appendChild(first);
    await first.rendered;

    const second = document.createElement(tag);
    container.appendChild(second);
    await second.rendered;

    const stats = getTemplateCacheStats();
    assert(stats.compiles === 1, `Expected one compile, got ${stats.compiles}`);
    assert(stats.instances === 2, `Expected two instances, got ${stats.instances}`);

    cleanup();
  });

  test('TemplateEngine - update() patches instead of replacing the DOM', async () => {
    class Counter extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.n = 0;
        this.state.suffix = 'a';
      }
      render() {
        return html`<div class="row ${this.state.suffix}"><span>{this.state.n}</span><b>${this.state.n}</b></div>`;
      }
    }

    const {component, cleanup} = await createTestComponent(Counter);
    const div = component.querySelector('div');
    const span = component.querySelector('span');
    const bold = component.querySelector('b');

    component.state.n = 5;
    await flushEffects();
    assert(span.textContent === '5', 'Reactive {} text should update');
    assert(component.querySelector('div') === div, 'Reactive update must not replace the div');

    await component.update();
    assert(component.querySelector('div') === div, 'update() should reuse the div');
    assert(component.querySelector('span') === span, 'update() should reuse the span');
    assert(bold.textContent === '5', '${} text should be patched');

    component.state.suffix = 'b';
    await component.update();
    assert(div.getAttribute('class') === 'row b', '${} attribute should be patched');
    assert(component.querySelector('b') === bold, '${} text node should be reused');

    cleanup();
  });

  test('TemplateEngine - dynamic tag and attribute names are compiled', async () => {
    class Dynamic extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.value = 'one';
      }
      render() {
        return html`<div><${'section'} ${'data-x'}="{this.state.value}">text</${'section'}></div>`;
      }
    }

    const {component, cleanup} = await createTestComponent(Dynamic);
    const section = component.querySelector('section');
    assert(section !== null, 'Dynamic tag name should create a section');
    assert(section.getAttribute('data-x') === 'one', 'Dynamic attribute name should be set');

    component.state.value = 'two';
    await flushEffects();
    assert(section.getAttribute('data-x') === 'two', 'Dynamic attribute should be reactive');

    cleanup();
  });

  test('TemplateEngine - child component is reused across parent update()', async () => {
    let childTag = '';
    class Child extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.own = 0;
      }
      bump() {
        this.state.own++;
      }
      render() {
        return html`<button onclick="{this.bump}">{this.state.own}</button>`;
      }
    }
    childTag = `test-engine-child-${Date.now()}`;
    Child.tag = childTag;
    customElements.define(childTag, Child);

    class Parent extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.label = 'a';
      }
      render() {
        return html`<p>{this.state.label}</p><${childTag}></${childTag}>`;
      }
    }

    const {component, cleanup} = await createTestComponent(Parent);
    const child = component.querySelector(childTag);
    await child.rendered;

    child.bump();
    await flushEffects();
    const button = child.querySelector('button');
    assert(button.textContent === '1', 'Child state should update');

    component.state.label = 'b';
    await flushEffects();
    await component.update();

    assert(component.querySelector(childTag) === child, 'Child component should be reused');
    assert(child.querySelector('button') === button, 'Child DOM should be reused');
    assert(button.textContent === '1', 'Child state should survive the parent update');

    cleanup();
  });

  test('TemplateEngine - nested TemplateResult renders as DOM and updates', async () => {
    class Nested extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.name = 'first';
      }
      render() {
        const inner = html`<em>{this.state.name}</em>`;
        return html`<div>${inner}</div>`;
      }
    }

    const {component, cleanup} = await createTestComponent(Nested);
    const em = component.querySelector('em');
    assert(em !== null, 'Nested TemplateResult should render as DOM');
    assert(em.textContent === 'first', 'Nested TemplateResult should render its value');

    component.state.name = 'second';
    await flushEffects();
    assert(component.querySelector('em')?.textContent === 'second', 'Nested TemplateResult should update');

    cleanup();
  });

  test('TemplateEngine - refs stay stable across update()', async () => {
    class RefComponent extends Component(HTMLElement) {
      render() {
        return html`<input ref="query" type="text">`;
      }
    }

    const {component, cleanup} = await createTestComponent(RefComponent);
    const first = component.refs.query;
    assert(first === component.querySelector('input'), 'Initial ref should be the input');

    await component.update();
    assert(component.refs.query === first, 'Ref should point to the same node after update()');
    assert(first.isConnected, 'Ref node should stay attached');

    cleanup();
  });

  test('TemplateEngine - component with changed template still replaces the DOM', async () => {
    class Switch extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.alt = false;
      }
      render() {
        return this.state.alt
          ? html`<section class="alt">alt</section>`
          : html`<div class="main">main</div>`;
      }
    }

    const {component, cleanup} = await createTestComponent(Switch);
    const main = component.querySelector('.main');
    assert(main !== null, 'Initial template should render');

    component.state.alt = true;
    await component.update();

    assert(component.querySelector('.main') === null, 'Old template should be removed');
    assert(component.querySelector('.alt') !== null, 'New template should be rendered');
    assert(main.isConnected === false, 'Old node should be detached');

    cleanup();
  });
  test('TemplateEngine - ${} inside child content updates without replacing the child', async () => {
    class ValueChild extends Component(HTMLElement) {
      static tag = `test-engine-value-child-${Date.now()}`;
    }
    customElements.define(ValueChild.tag, ValueChild);

    class ValueParent extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.title = 'one';
      }
      render() {
        return html`
          <${ValueChild}>
            <span class="value-text">${this.state.title}</span>
            <b class="value-attr" data-title="${this.state.title}">x</b>
          </${ValueChild}>
        `;
      }
    }

    const {component, cleanup} = await createTestComponent(ValueParent);
    const child = component.querySelector(ValueChild.tag);
    await child.rendered;

    const text = child.querySelector('.value-text');
    const attr = child.querySelector('.value-attr');
    assert(text.textContent === 'one', 'Child content ${} text should render');
    assert(attr.getAttribute('data-title') === 'one', 'Child content ${} attribute should render');

    component.state.title = 'two';
    await component.update();

    assert(component.querySelector(ValueChild.tag) === child, 'Child component should be reused');
    assert(child.querySelector('.value-text') === text, 'Child text node should be reused');
    assert(text.textContent === 'two', 'Child content ${} text should update');
    assert(attr.getAttribute('data-title') === 'two', 'Child content ${} attribute should update');

    cleanup();
  });

  test('TemplateEngine - ${} inside nested child content propagates to grandchildren', async () => {
    class NestedValueGrandchild extends Component(HTMLElement) {
      static tag = `test-engine-nested-grand-${Date.now()}`;
    }
    customElements.define(NestedValueGrandchild.tag, NestedValueGrandchild);

    class NestedValueChild extends Component(HTMLElement) {
      static tag = `test-engine-nested-child-${Date.now()}`;
    }
    customElements.define(NestedValueChild.tag, NestedValueChild);

    class NestedValueParent extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.title = 'first';
      }
      render() {
        return html`
          <${NestedValueChild}>
            <${NestedValueGrandchild}>
              <i class="nested-value">${this.state.title}</i>
            </${NestedValueGrandchild}>
          </${NestedValueChild}>
        `;
      }
    }

    const {component, cleanup} = await createTestComponent(NestedValueParent);
    const child = component.querySelector(NestedValueChild.tag);
    const grand = child.querySelector(NestedValueGrandchild.tag);
    await grand.rendered;

    assert(grand.querySelector('.nested-value').textContent === 'first', 'Nested ${} should render');

    component.state.title = 'second';
    await component.update();

    assert(grand.querySelector('.nested-value').textContent === 'second', 'Nested ${} should update');

    cleanup();
  });

  test('TemplateEngine - ${} inside If/Loop content updates from parent values', async () => {
    class SlotValueParent extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.title = 'alpha';
        this.state.items = [{id: 1}];
      }
      render() {
        return html`
          <${If} condition="{this.state.items.length}">
            <span class="if-value">${this.state.title}</span>
          </${If}>
          <${Loop} items="{this.state.items}" key="id" as="item">
            <span class="loop-value">${this.state.title}-{item.id}</span>
          </${Loop}>
        `;
      }
    }

    const {component, cleanup} = await createTestComponent(SlotValueParent);
    assert(component.querySelector('.if-value').textContent === 'alpha', 'If child ${} should render');
    assert(component.querySelector('.loop-value').textContent === 'alpha-1', 'Loop child ${} should render');

    component.state.title = 'beta';
    await component.update();

    assert(component.querySelector('.if-value').textContent === 'beta', 'If child ${} should update');
    assert(component.querySelector('.loop-value').textContent === 'beta-1', 'Loop child ${} should update');

    cleanup();
  });

  test('TemplateEngine - a component can use a custom BindingStrategy', async () => {
    let resolves = 0;
    class CountingStrategy extends PathBindingStrategy {
      resolve(root, descriptor) {
        resolves++;
        return super.resolve(root, descriptor);
      }
    }

    class StrategyComponent extends Component(HTMLElement) {
      static bindingStrategy = new CountingStrategy();
      constructor() {
        super();
        this.state.label = 'ok';
      }
      noop() {}
      render() {
        return html`<div><span>{this.state.label}</span><button onclick="{noop}">x</button></div>`;
      }
    }

    const {component, cleanup} = await createTestComponent(StrategyComponent);
    assert(resolves > 0, 'Custom binding strategy should be used');
    assert(component.querySelector('span').textContent === 'ok', 'Custom strategy should still bind parts');

    cleanup();
  });

  test('TemplateEngine - structured values keep later sibling parts on their own nodes', async () => {
    class StructuredSiblings extends Component(HTMLElement) {
      render() {
        const first = html`<b class="first">1</b>`;
        const second = html`<i class="second">2</i>`;
        return html`<div class="structured">${first}<span class="middle">mid</span>${second}</div>`;
      }
    }

    const {component, cleanup} = await createTestComponent(StructuredSiblings);
    const div = component.querySelector('.structured');
    const tags = [...div.children].map(child => child.tagName);

    assert.deepEqual(tags, ['B', 'SPAN', 'I'], 'Structured ${} parts must not shift later sibling paths');
    assert(div.querySelector('.middle').textContent === 'mid', 'Static sibling should keep its content');

    cleanup();
  });

  test('TemplateEngine - nested TemplateResult keeps its own ${} values', async () => {
    class NestedLazy extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.name = 'first';
      }
      render() {
        return html`<div class="nested-lazy">${html`<em>${this.state.name}</em>`}</div>`;
      }
    }

    const {component, cleanup} = await createTestComponent(NestedLazy);
    assert(component.querySelector('em').textContent === 'first', 'Nested ${} should render its value');

    component.state.name = 'second';
    await component.update();
    await flushEffects();

    assert(component.querySelector('em').textContent === 'second', 'Nested ${} should follow update() values');

    cleanup();
  });

  test('TemplateEngine - unquoted attribute values stay dynamic and escaped', async () => {
    class UnquotedAttribute extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.value = 'safe';
      }
      render() {
        return html`<div class="unquoted" data-value=${this.state.value}></div>`;
      }
    }

    const {component, cleanup} = await createTestComponent(UnquotedAttribute);
    const div = component.querySelector('.unquoted');
    assert(div.getAttribute('data-value') === 'safe', 'Unquoted ${} should be attached as an attribute');

    const payload = 'a><img class="pwn" src=x>';
    component.state.value = payload;
    await component.update();
    await flushEffects();

    assert(div.getAttribute('data-value') === payload, 'Attribute value should be preserved verbatim');
    assert(component.querySelector('.pwn') === null, 'Attribute value must not inject markup');

    cleanup();
  });

  test('TemplateEngine - a literal < in text does not fold the following ${}', async () => {
    class LessThanText extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.value = 'one';
      }
      render() {
        return html`<p class="less-than">1 < 2 ${this.state.value}</p>`;
      }
    }

    const {component, cleanup} = await createTestComponent(LessThanText);
    const p = component.querySelector('.less-than');
    assert(p.textContent === '1 < 2 one', 'Text with < should render');

    const payload = '<img class="pwn" src=x>';
    component.state.value = payload;
    await component.update();
    await flushEffects();

    assert(p.textContent === `1 < 2 ${payload}`, 'Value after < should stay dynamic text');
    assert(component.querySelector('.pwn') === null, 'Text value must not inject markup');

    cleanup();
  });

  test('TemplateEngine - ${} inside a comment is escaped, not injected as markup', () => {
    const compiled = compileTemplate(html`<!-- ${'--> <img class="pwn">'} -->`);
    const source = compiled.template.innerHTML;

    assert(!source.includes('<img'), 'Comment value must not create an element');
    assert(source.includes('&lt;img'), 'Comment value should be escaped');
  });

  test('TemplateEngine - ${} inside script/style raw text is escaped', () => {
    const compiled = compileTemplate(html`<script>const t = ${'</script><img class="pwn">'};</script>`);
    const source = compiled.template.innerHTML;

    assert(!source.includes('<img'), 'Raw text value must not create an element');
    assert(source.includes('&lt;img'), 'Raw text value should be escaped');
  });

  test('TemplateEngine - clearTemplateCache clears call-site templates too', () => {
    clearTemplateCache();
    const make = () => html`<div class="cache-clear">${1}</div>`;

    const first = compileTemplate(make());
    clearTemplateCache();
    const second = compileTemplate(make());

    assert(first !== second, 'clearTemplateCache should drop the per-call-site cache');
  });

  test('TemplateEngine - changed folded values use a new compiled template', async () => {
    class DynamicTagSwitch extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.tag = 'section';
      }
      render() {
        return html`<${this.state.tag} class="dynamic-tag">text</${this.state.tag}>`;
      }
    }

    const {component, cleanup} = await createTestComponent(DynamicTagSwitch);
    assert(component.querySelector('section.dynamic-tag') !== null, 'Dynamic tag should render');

    component.state.tag = 'article';
    await component.update();

    assert(component.querySelector('section.dynamic-tag') === null, 'Old folded template should be removed');
    assert(component.querySelector('article.dynamic-tag') !== null, 'New folded value should compile a new template');

    cleanup();
  });

};
