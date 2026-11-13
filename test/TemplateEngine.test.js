import './setup-dom.js';
import Component, {html} from '../src/components/Component.js';
import {Loop} from '../src/components/LoopComponent.js';
import {If} from '../src/components/IfComponent.js';
import {flushEffects} from '../src/Effect.js';
import {createTestComponent, createTestContainer} from './helpers.js';
import {clearTemplateCache, compileTemplate, getTemplateCacheStats, render} from '../src/template/Template.js';
import {TemplateResult, nothing, noChange, unsafeHTML} from '../src/template/TemplateResult.js';

export default ({test, assert}) => {

  test('TemplateEngine - html returns a TemplateResult object', () => {
    const result = html`<div class="a ${'b'}">${'<x>'}</div>`;

    assert(result instanceof TemplateResult, 'html() should return TemplateResult');
    assert(!(result instanceof String), 'TemplateResult must not be a String object');
    assert(String(result).includes('&lt;x&gt;'), 'Diagnostic string form should be escaped');
    assert(String(result).includes('class="a b"'), 'Diagnostic string form should include values');
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

  test('TemplateEngine - ${} inside script/style raw text is rejected', () => {
    assert.throws(
      () => compileTemplate(html`<script>const t = ${'x'};</script>`),
      /Expressions inside <script> are not supported/,
    );
    assert.throws(
      () => compileTemplate(html`<style>.a { color: ${'red'}; }</style>`),
      /Expressions inside <style> are not supported/,
    );
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

  test('TemplateEngine - is="${Comp}" resolves the component tag', async () => {
    class IsTarget extends Component(HTMLElement) {
      static tag = 'test-engine-is-target';
      render() {
        return '<span class="is-inner">ok</span>';
      }
    }
    if (!customElements.get(IsTarget.tag)) customElements.define(IsTarget.tag, IsTarget);

    class UsesIs extends Component(HTMLElement) {
      render() {
        return html`<div class="is-host"><p has="x" is="${IsTarget}"></p></div>`;
      }
    }

    // Regression: an unresolved `${}` in `is` used to reach the custom elements
    // registry as a template token and abort the render.
    const {component, cleanup} = await createTestComponent(UsesIs);
    const el = component.querySelector('.is-host p');

    assert(el !== null, 'Element with is="${Comp}" should render');
    assert(el.getAttribute('is') === IsTarget.tag, 'is should carry the resolved tag name');
    assert(el.getAttribute('has') === 'x', 'Other static attributes should survive');

    cleanup();
  });

  test('TemplateEngine - declaration attribute does not swallow a sibling dynamic attribute', async () => {
    class IsSibling extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.cls = 'first';
      }
      render() {
        return html`<div class="is-sibling" data-cls="${this.state.cls}"></div>`;
      }
    }

    const {component, cleanup} = await createTestComponent(IsSibling);
    const div = component.querySelector('.is-sibling');
    assert(div.getAttribute('data-cls') === 'first', 'Attribute after a declaration one should be dynamic');

    component.state.cls = 'second';
    await component.update();
    await flushEffects();

    assert(div.getAttribute('data-cls') === 'second', 'Dynamic attribute should keep patching');

    cleanup();
  });

  test('TemplateEngine - whitespace around = keeps the value dynamic', async () => {
    class SpacedAttr extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.value = 'safe';
      }
      render() {
        return html`<div class="spaced" data-value = ${this.state.value}></div>`;
      }
    }

    const {component, cleanup} = await createTestComponent(SpacedAttr);
    const div = component.querySelector('.spaced');
    assert(div.getAttribute('data-value') === 'safe', 'Spaced unquoted ${} should attach as an attribute');

    const payload = '<img class="pwn-spaced" src=x>';
    component.state.value = payload;
    await component.update();
    await flushEffects();

    assert(div.getAttribute('data-value') === payload, 'Value should be preserved verbatim');
    assert(component.querySelector('.pwn-spaced') === null, 'Spaced value must not inject markup');

    cleanup();
  });

  test('TemplateEngine - spaced unquoted attribute is escaped on first render', () => {
    const compiled = compileTemplate(html`<b data-x = ${'"><img class="pwn-static">'}></b>`);
    const template = document.createElement('template');
    template.innerHTML = compiled.source;

    assert(template.content.querySelector('.pwn-static') === null, 'First render must not splice markup');
  });

  test('TemplateEngine - parent update keeps the child own ${} values', async () => {
    class OwnValueChild extends Component(HTMLElement) {
      static tag = `test-engine-own-value-${Date.now()}`;
      constructor() {
        super();
        this.state.label = 'child-own';
      }
      render() {
        return html`<span class="own-value">${this.state.label}</span>`;
      }
    }
    customElements.define(OwnValueChild.tag, OwnValueChild);

    class OwnValueParent extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.parent = 'parent-value';
      }
      render() {
        return html`<div>${this.state.parent}</div><${OwnValueChild}></${OwnValueChild}>`;
      }
    }

    const {component, cleanup} = await createTestComponent(OwnValueParent);
    const child = component.querySelector(OwnValueChild.tag);
    await child.rendered;

    assert(child.querySelector('.own-value').textContent === 'child-own', 'Initial child value');
    await component.update();
    await flushEffects();
    assert(child.querySelector('.own-value').textContent === 'child-own',
      'A parent update must not overwrite the child own ${} values');

    cleanup();
  });

  test('TemplateEngine - dynamic event handlers are re-resolved on dispatch', async () => {
    const calls = [];
    class EventSwitch extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.handler = () => calls.push('first');
      }
      render() {
        return html`<button onclick="{this.state.handler}">go</button>`;
      }
    }

    const {component, cleanup} = await createTestComponent(EventSwitch);
    const button = component.querySelector('button');
    button.click();

    component.state.handler = () => calls.push('second');
    await component.update();
    button.click();

    assert.deepEqual(calls, ['first', 'second'], 'The current handler should be used');
    cleanup();
  });

  test('TemplateEngine - invalid is values are rejected instead of injected', () => {
    assert.throws(
      () => compileTemplate(html`<div is='${"x' onmouseover='alert(1)"}'></div>`),
      /Invalid is=/,
    );
    assert.throws(
      () => compileTemplate(html`<div is=${"foo onmouseover=alert(1)"}></div>`),
      /Invalid is=/,
    );
  });

  test('TemplateEngine - framework attributes reject ${} values', () => {
    assert.throws(
      () => compileTemplate(html`<veda-loop items="${[1, 2]}"></veda-loop>`),
      /does not support \$\{\} values/,
    );
    assert.throws(
      () => compileTemplate(html`<veda-if condition="${true}"></veda-if>`),
      /does not support \$\{\} values/,
    );
    assert.throws(
      () => compileTemplate(html`<veda-virtual height="${10}"></veda-virtual>`),
      /does not support \$\{\} values/,
    );
    assert.throws(
      () => compileTemplate(html`<veda-loop as="${'row'}"></veda-loop>`),
      /does not support \$\{\} values/,
    );
  });

  test('TemplateEngine - key/as/height stay ordinary attributes on user components', () => {
    // Only Loop/If/Virtual read these names as framework config. On a user
    // component they are normal attributes and must accept ${} values.
    assert.doesNotThrow(
      () => compileTemplate(html`<my-card key="${'k'}" as="${'a'}" height="${10}"></my-card>`),
      'User component attributes must not be treated as framework config',
    );
    const compiled = compileTemplate(html`<ul class="list" items="{this.state.items}"></ul>`);
    assert(compiled.source.includes('items="{this.state.items}"'), 'Semantic Loop keeps items');
  });

  test('TemplateEngine - dynamic tag names cannot inject markup', () => {
    assert.throws(
      () => compileTemplate(html`<${'123'}></${'123'}>`),
      /Invalid dynamic tag name/,
    );
    assert.throws(
      () => compileTemplate(html`<${'img src=x onerror=alert(1)'}></div>`),
      /Invalid dynamic (tag name|attribute snippet)/,
    );
    assert.throws(
      () => compileTemplate(html`<div></${'div><img src=x onerror=alert(1)>'}>`),
      /Invalid dynamic/,
    );
    assert.throws(
      () => compileTemplate(html`<${'div onclick=alert(1)'}></div>`),
      /Invalid dynamic/,
    );
    // A Component class still folds to its static tag.
    class SafeTag extends Component(HTMLElement) {
      static tag = 'test-engine-safe-tag';
    }
    const compiled = compileTemplate(html`<${SafeTag}></${SafeTag}>`);
    assert(compiled.source.includes('<test-engine-safe-tag></test-engine-safe-tag>'),
      'Component classes must keep folding to their tag');
  });

  test('TemplateEngine - dynamic attribute names and snippets cannot inject handlers', () => {
    assert.throws(
      () => compileTemplate(html`<div ${'onclick'}="alert(1)"></div>`),
      /Invalid dynamic attribute name/,
    );
    assert.throws(
      () => compileTemplate(html`<div on${'click'}="alert(1)"></div>`),
      /Invalid dynamic attribute name/,
    );
    assert.throws(
      () => compileTemplate(html`<div ${'onmouseover=window.x=1'}></div>`),
      /on\* handlers must use \{expression\}/,
    );
    assert.throws(
      () => compileTemplate(html`<div ${'x><img src=x onerror=alert(1)'}></div>`),
      /markup is not allowed/,
    );
    assert.throws(
      () => compileTemplate(html`<div ${'srcdoc="<img src=x onerror=alert(1)>"'}></div>`),
      /markup is not allowed|srcdoc/,
    );

    // Ordinary attribute names and static-looking snippets keep working.
    const named = compileTemplate(html`<div data-${'id'}="1"></div>`);
    assert(named.source.includes('data-id="1"'), 'Dynamic attribute name fragment should fold');
    const snippet = compileTemplate(html`<div data-x=foo ${'data-y="1" disabled'}></div>`);
    assert(snippet.source.includes('data-y="1"'), 'Attribute snippet should fold as markup');
  });

  test('TemplateEngine - an HTML comment inside an attribute stays data', async () => {
    class CommentAttribute extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.value = 'one';
      }
      render() {
        return html`<div class="comment-attr" title="<!-- ${this.state.value} -->">x</div>`;
      }
    }

    const {component, cleanup} = await createTestComponent(CommentAttribute);
    const div = component.querySelector('.comment-attr');
    assert(div.getAttribute('title') === '<!-- one -->', 'Initial attribute value');

    component.state.value = 'two';
    await component.update();
    await flushEffects();

    assert(component.querySelector('.comment-attr') === div, 'The element should be patched, not remounted');
    assert(div.getAttribute('title') === '<!-- two -->', 'The dynamic attribute should update');
    cleanup();
  });

  test('TemplateEngine - an attribute snippet after an unquoted literal is markup', () => {
    const compiled = compileTemplate(html`<div data-x=foo ${'data-y="1"'}></div>`);
    assert(!compiled.source.includes('\uE000'), 'No template token should leak into the source');
    const source = compiled.source;
    assert(source.includes('data-y="1"'), 'The snippet should be folded as attributes');
  });

  test('TemplateEngine - html("...") reuses the string cache and the mounted DOM', async () => {
    clearTemplateCache();
    class PlainString extends Component(HTMLElement) {
      render() {
        return html('<div class="plain-string">plain</div>');
      }
    }

    const {component, cleanup} = await createTestComponent(PlainString);
    const div = component.querySelector('.plain-string');
    await component.update();
    await component.update();

    const stats = getTemplateCacheStats();
    assert(stats.compiles === 1, `Expected one compile, got ${stats.compiles}`);
    assert(component.querySelector('.plain-string') === div, 'The string template should be patched in place');
    cleanup();
  });

  test('TemplateEngine - nested TemplateResult is patched instead of remounted', async () => {
    class NestedFocus extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.value = 'one';
      }
      render() {
        return html`<div class="nested-focus">${html`<input class="nested-input" value="${this.state.value}">`}</div>`;
      }
    }

    const {component, cleanup} = await createTestComponent(NestedFocus);
    const input = component.querySelector('.nested-input');
    input.focus();
    component.state.value = 'two';
    await component.update();
    await flushEffects();

    assert(component.querySelector('.nested-input') === input, 'Nested input should be reused');
    assert(document.activeElement === input, 'Focus should survive the nested patch');
    assert(component.querySelector('.nested-input').value === 'two', 'Nested value should update');
    cleanup();
  });

  test('TemplateEngine - structured DocumentFragment is replaced cleanly', async () => {
    class FragmentValue extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.value = 1;
      }
      render() {
        const fragment = document.createDocumentFragment();
        const span = document.createElement('span');
        span.className = 'fragment-value';
        span.textContent = String(this.state.value);
        fragment.append(span);
        return html`<div>${fragment}</div>`;
      }
    }

    const {component, cleanup} = await createTestComponent(FragmentValue);
    component.state.value = 2;
    await component.update();

    assert(component.querySelectorAll('.fragment-value').length === 1, 'Only one fragment child should remain');
    assert(component.querySelector('.fragment-value').textContent === '2', 'The new fragment should render');
    cleanup();
  });

  test('TemplateEngine - nothing, noChange and unsafeHTML have Lit semantics', async () => {
    class Sentinels extends Component(HTMLElement) {
      constructor() {
        super();
        this.state.value = 'a';
        this.state.mode = 'value';
      }
      render() {
        const value = this.state.mode === 'nothing'
          ? nothing
          : this.state.mode === 'unsafe'
            ? unsafeHTML('<b class="trusted">ok</b>')
            : this.state.value;
        return html`<div class="sentinel">${value}</div>`;
      }
    }

    const {component, cleanup} = await createTestComponent(Sentinels);
    const div = component.querySelector('.sentinel');
    assert(div.textContent === 'a', 'Initial value');

    component.state.value = noChange;
    await component.update();
    assert(div.textContent === 'a', 'noChange should keep the previous text');

    component.state.mode = 'nothing';
    await component.update();
    assert(div.textContent === '', 'nothing should clear the child');
    assert(component.querySelector('.sentinel') === div, 'The container should be reused');

    component.state.mode = 'unsafe';
    await component.update();
    assert(component.querySelector('.trusted')?.textContent === 'ok', 'unsafeHTML should render trusted markup');
    cleanup();
  });

  test('TemplateEngine - standalone render() patches the same container', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const view = (value) => html`<div class="standalone">${value}</div>`;
    const first = render(view('a'), container);
    const div = container.querySelector('.standalone');
    const second = render(view('b'), container);

    assert(container.querySelector('.standalone') === div, 'Standalone render should patch in place');
    assert(div.textContent === 'b', 'Standalone render should update values');
    assert(first === second, 'The root instance should be reused');
    container.remove();
  });

  test('TemplateEngine - expressions inside nested <template> are rejected', () => {
    assert.throws(
      () => compileTemplate(html`<template><span>${'x'}</span></template>`),
      /nested <template> are not supported/,
    );
  });


  test('TemplateEngine - refs inside nested TemplateResult survive update', async () => {
    class NestedRefs extends Component(HTMLElement) {
      render() {
        return html`<div class="nested-refs">${html`<input ref="deep" class="deep">`}</div>`;
      }
    }

    const {component, cleanup} = await createTestComponent(NestedRefs);
    const input = component.querySelector('.deep');
    assert(component.refs.deep === input, 'Initial nested ref');
    await component.update();
    assert(component.refs.deep === input, 'Nested ref should be restored after update');
    cleanup();
  });

  test('TemplateEngine - static script and style braces are not expressions', () => {
    const compiled = compileTemplate(html`<style>.a { color: red; }</style><script>if (x) { y(); }</script>`);
    assert(compiled.source.includes('color: red'), 'Static CSS should be preserved');
    assert(compiled.source.includes('if (x)'), 'Static JS should be preserved');
  });


  test('TemplateEngine - folded values cannot create handlers or srcdoc', () => {
    const splits = (text) => {
      const pairs = [];
      for (let i = 0; i <= text.length; i++) pairs.push([text.slice(0, i), text.slice(i)]);
      return pairs;
    };

    // A folded value may supply a whole snippet or a name fragment. No split
    // combination may smuggle an inline handler into the compiled markup.
    for (const [a, b] of splits('onclick')) {
      assert.throws(
        () => compileTemplate(html`<div ${a}${b}="alert(1)"></div>`),
        /handler|snippet|Invalid dynamic/,
        `onclick split as ${JSON.stringify([a, b])} must not compile`,
      );
    }
    for (const [a, b] of splits('onerror')) {
      assert.throws(
        () => compileTemplate(html`<img ${a}${b}="alert(1)">`),
        /handler|snippet|Invalid dynamic/,
        `onerror split as ${JSON.stringify([a, b])} must not compile`,
      );
    }

    // Whitespace between the folded name and an authored value is not a snippet.
    assert.throws(
      () => compileTemplate(html`<div ${'onclick '}="alert(1)"></div>`),
      /handler|snippet|Invalid dynamic/,
    );

    // srcdoc is parsed as HTML, so it has no safe Part representation.
    for (const [a, b] of splits('srcdoc')) {
      assert.throws(
        () => compileTemplate(html`<iframe ${a}${b}="&lt;img src=x onerror=alert(1)&gt;"></iframe>`),
        /srcdoc|snippet|Invalid dynamic/,
        `srcdoc split as ${JSON.stringify([a, b])} must not compile`,
      );
    }
    assert.throws(
      () => compileTemplate(html`<iframe srcdoc="{this.state.html}"></iframe>`),
      /srcdoc/,
    );
    assert.throws(
      () => compileTemplate(html`<iframe srcdoc="<b>x</b>"></iframe>`),
      /srcdoc/,
    );

    // A folded snippet is spliced into markup and re-parsed; an embedded
    // expression would turn data into evaluated Veda code.
    assert.throws(
      () => compileTemplate(html`<div ${'title="{alert(1)}"'}></div>`),
      /expressions must be authored/,
    );

    // Static inline handlers are not executed by the framework; only the
    // authored expression form is accepted.
    assert.throws(
      () => compileTemplate(html`<button onclick="alert(1)">x</button>`),
      /must use \{expression\}/,
    );

    // Attributes that merely start with "on" are not event handlers.
    assert.doesNotThrow(
      () => compileTemplate(html`<my-widget once="1" ontology="x"></my-widget>`),
      'once/ontology are ordinary attributes',
    );

    // The documented dynamic-name form stays valid.
    const compiled = compileTemplate(html`<button on${'click'}="{this.save}">x</button>`);
    assert(compiled.source.includes('onclick="{this.save}"'), 'on${name} with an authored expression stays valid');
  });


};
