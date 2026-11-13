import {isTemplateResult, isUnsafeHTML, nothing, noChange, safe} from './TemplateResult.js';
import {ELEMENT_MARKER, TEXT_MARKER_PREFIX, TEXT_MARKER_SUFFIX} from './markers.js';
import TemplateInstance from './TemplateInstance.js';
import {getTemplateStats, recordTemplateStat, resetTemplateStats, TEMPLATE_ENGINE} from './stats.js';

export const TOKEN_PREFIX = '\uE000';
export const TOKEN_SUFFIX = '\uE001';

const TOKEN_AT_START = new RegExp(`^${TOKEN_PREFIX}(\\d+)${TOKEN_SUFFIX}`);
const TOKEN_GLOBAL = new RegExp(`${TOKEN_PREFIX}(\\d+)${TOKEN_SUFFIX}`, 'g');
const ATTR_ESCAPE_REGEX = /[&<>"]/g;
const ATTR_ESCAPE_MAP = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'};

// A marker attribute groups every Part that belongs to one element. It is
// generated at compile time and removed when the instance resolves the Part.

const RAW_TEXT_TAGS = new Set(['script', 'style']);
const RCDATA_TAGS = new Set(['textarea', 'title']);
const FRAMEWORK_ATTRS = new Set([
  'condition', 'items', 'as', 'key', 'item-key',
  'height', 'item-height', 'overscan',
]);

const MAX_STRING_CACHE = 1000;
const MAX_SHAPE_CACHE = 20;

const stringCache = new Map();
let resultCache = new WeakMap();
// Per call-site source + token classification. Fold modes depend only on the
// template source (and type), not on the interpolated values, so the full HTML
// scan can be skipped on cache hits.
let sourceCache = new WeakMap();

function token(index) {
  return `${TOKEN_PREFIX}${index}${TOKEN_SUFFIX}`;
}

function isTokenAt(source, index) {
  return source.charCodeAt(index) === 0xE000;
}

function readTokenAt(source, index) {
  const match = TOKEN_AT_START.exec(source.slice(index));
  if (!match) return null;
  return {
    index: Number(match[1]),
    text: match[0],
    end: index + match[0].length,
  };
}

export function stringifyValue(value, type = 'html') {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(item => stringifyValue(item, type)).join(' ');
  if (isTemplateResult(value)) return value.toString();
  if (isUnsafeHTML(value)) return String(value.value ?? '');
  if (type === 'raw') return String(value);
  if (typeof value === 'string' || value instanceof String) return safe(String(value));
  return String(value);
}

function stringifyTagValue(value, type) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(item => stringifyTagValue(item, type)).join(' ');
  if (isTemplateResult(value)) return value.toString();
  return String(value);
}

function escapeAttribute(value) {
  return String(value).replace(ATTR_ESCAPE_REGEX, char => ATTR_ESCAPE_MAP[char]);
}

const TAG_NAME_RE = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const TAG_NAME_FRAGMENT_RE = /^[A-Za-z0-9._:-]+$/;
const ATTR_NAME_RE = /^[A-Za-z_:][A-Za-z0-9._:-]*$/;
const HANDLER_NAME_RE = /^on[a-z]+$/i;
const SNIPPET_ATTR_RE = /\b(on[a-z]+|srcdoc)\s*=\s*/gi;

// A DOM element exposes its event handler content attributes as IDL properties
// (`onclick`, `onerror`, ...). Checking the property avoids treating ordinary
// attributes that merely start with "on" (once, ontology) as handlers.
function isEventHandlerAttribute(element, name) {
  return name.startsWith('on') && name.length > 2 && name in element;
}

// `${}` in a tag name, attribute name or attribute snippet is folded into the
// template markup. Unlike text and attribute *values*, that markup is parsed as
// HTML, so a value must never be able to add elements, attributes or handlers.
// A `${}` value in a tag name or attribute name is a name, not markup: validate
// it, and reject handler names outright. `${attrs}` snippets stay supported for
// static-looking attribute lists, but event handlers and srcdoc are refused.
function assertSafeTagName(text) {
  if (!TAG_NAME_RE.test(text)) {
    throw new Error(
      `Invalid dynamic tag name '${text}': expected an element name, not markup`
    );
  }
}

function assertSafeTagNameFragment(text) {
  if (!TAG_NAME_FRAGMENT_RE.test(text)) {
    throw new Error(
      `Invalid dynamic tag name fragment '${text}': expected name characters only`
    );
  }
}

function assertSafeAttributeName(text) {
  if (!ATTR_NAME_RE.test(text)) {
    throw new Error(
      `Invalid dynamic attribute name '${text}': names must be static, use {expression} for values`
    );
  }
}

function readAttributeValue(rest) {
  const source = rest.replace(/^\s*=\s*/, '');
  const quote = source[0];
  if (quote === '"' || quote === "'") {
    const end = source.indexOf(quote, 1);
    return end === -1 ? source.slice(1) : source.slice(1, end);
  }
  return (source.match(/^[^\s>]*/) || [''])[0];
}

// A handler name may be folded from `${}` only when the attribute value is an
// authored `{expression}`. `on${'click'}="{this.handle}"` stays valid;
// `on${'click'}="alert(1)"` and `on${'click'}="${code}"` are rejected.
function assertSafeHandlerName(text, source, end) {
  if (!HANDLER_NAME_RE.test(text)) return;
  const rest = source.slice(end);
  if (!/^\s*=/.test(rest)) return;
  const value = readAttributeValue(rest).trim();
  if (/^\{[^}]*\}$/.test(value)) return;
  throw new Error(
    `Invalid dynamic attribute name '${text}': on* handlers must use a {expression} value`
  );
}

function assertSafeAttributeSnippet(text) {
  if (/[<>]/.test(text)) {
    throw new Error(`Invalid dynamic attribute snippet '${text}': markup is not allowed`);
  }
  // A folded snippet is spliced into the template markup and re-parsed, so an
  // embedded {expression} would be evaluated as Veda code supplied by data.
  // Expressions must be authored in the template itself.
  if (/[{}]/.test(text)) {
    throw new Error(
      `Invalid dynamic attribute snippet '${text}': expressions must be authored in the template`
    );
  }
  for (const match of text.matchAll(SNIPPET_ATTR_RE)) {
    if (match[1].toLowerCase() === 'srcdoc') {
      throw new Error("Invalid dynamic attribute snippet: 'srcdoc' is not supported");
    }
    const rest = text.slice(match.index + match[0].length);
    if (!/^["']?\s*\{/.test(rest)) {
      throw new Error(
        `Invalid dynamic attribute snippet '${text}': on* handlers must use {expression}`
      );
    }
  }
}

function foldTagMarkup(value, state, type) {
  const text = stringifyTagValue(value, type);
  // An empty value contributes nothing: `${maybeAttrs}` with '' is a no-op.
  if (text === '') return text;
  if (state.tagStart) {
    // A token before the first whitespace is part of the tag name, but the
    // existing `<${Tag}${attrs}>` pattern also folds a leading attribute
    // snippet there. A value with whitespace/`=` is a snippet, not a name.
    if (/[\s=<>"']/.test(text)) {
      assertSafeAttributeSnippet(text);
      return text;
    }
    if (state.attrName === '' || state.attrName === '/') assertSafeTagName(text);
    else assertSafeTagNameFragment(text);
    return text;
  }
  const name = `${state.attrName}${text}`;
  if (state.attrName) {
    assertSafeAttributeName(name);
    assertSafeHandlerName(name, state.source, state.end);
    return text;
  }
  if (ATTR_NAME_RE.test(text)) {
    assertSafeAttributeName(text);
    assertSafeHandlerName(text, state.source, state.end);
    return text;
  }
  assertSafeAttributeSnippet(text);
  return text;
}

// `is` selects the element class, so it cannot be a Part. A Component class is
// accepted because it carries `static tag`; a string is accepted only when it
// is a valid custom-element name. This prevents attribute injection through a
// single-quoted or unquoted `is`.
function declarationValue(value) {
  let text;
  if (typeof value === 'function' && typeof value.tag === 'string') {
    text = value.tag;
  } else {
    text = value == null ? '' : String(value);
  }
  if (!/^[a-z][a-z0-9._-]*-[a-z0-9._-]*$/i.test(text)) {
    throw new Error(
      `Invalid is="${text}": expected a custom element tag name or a Component class with static tag`
    );
  }
  return text;
}

/**
 * Replace `${}` interpolations with internal tokens.
 */
function buildTokenizedSource(strings, values) {
  const sourceParts = [];
  const tokenMap = new Map();
  const length = Math.max(strings.length, values.length + 1);
  for (let i = 0; i < length; i++) {
    sourceParts.push(strings[i] ?? '');
    if (i < values.length) {
      sourceParts.push(token(i));
      tokenMap.set(i, values[i]);
    }
  }
  return {source: sourceParts.join(''), tokenMap};
}

/**
 * Decide which tokens are static markup (tag names, attribute names, `is`,
 * raw text comments) and which remain dynamic parts.
 *
 * This is intentionally a small HTML-aware scanner, not a full parser. It only
 * needs to know whether a token is inside a tag (and if so, inside which
 * attribute value). Everything else is a text/attribute part.
 */
function foldStaticTokens(source, tokenMap, options = {}) {
  const type = options.type || 'html';
  const forceFold = options.forceFold === true;
  const modes = new Map();
  let out = '';
  let i = 0;
  let inTag = false;
  let tagStart = false;
  let quote = null;
  let attrName = '';
  let inAttrName = false;
  let expectingValue = false;
  let readingValue = false;
  let inComment = false;
  let rawTextTag = null;
  let pendingRawTextTag = null;

  while (i < source.length) {
    if (inComment) {
      if (source.startsWith('-->', i)) {
        inComment = false;
        out += '-->';
        i += 3;
        continue;
      }
      const tokenInfo = isTokenAt(source, i) ? readTokenAt(source, i) : null;
      if (tokenInfo) {
        const value = tokenMap.get(tokenInfo.index);
        out += escapeAttribute(stringifyTagValue(value, type));
        modes.set(tokenInfo.index, 'folded');
        i = tokenInfo.end;
        continue;
      }
      out += source[i++];
      continue;
    }

    if (rawTextTag) {
      if (source[i] === '<' && source.slice(i).toLowerCase().startsWith(`</${rawTextTag}`)) {
        rawTextTag = null;
        // fall through to normal tag handling below
      } else {
        const tokenInfo = isTokenAt(source, i) ? readTokenAt(source, i) : null;
        if (tokenInfo) {
          // Expressions in script/style cannot be represented as DOM Parts.
          // They are rejected later by compileSource() instead of being
          // half-escaped into executable code.
          out += tokenInfo.text;
          modes.set(tokenInfo.index, 'dynamic');
          i = tokenInfo.end;
          continue;
        }
        out += source[i++];
        continue;
      }
    }

    // The quote check must come before comment detection: `<!--` inside an
    // attribute value is data, not an HTML comment.
    if (quote) {
      if (source[i] === quote) {
        quote = null;
        out += source[i++];
        continue;
      }
      const tokenInfo = isTokenAt(source, i) ? readTokenAt(source, i) : null;
      if (tokenInfo) {
        const name = attrName.toLowerCase();
        if (forceFold) {
          out += stringifyTagValue(tokenMap.get(tokenInfo.index), type);
          modes.set(tokenInfo.index, 'folded');
        } else if (name === 'is') {
          out += escapeAttribute(declarationValue(tokenMap.get(tokenInfo.index)));
          modes.set(tokenInfo.index, 'folded');
        } else {
          out += tokenInfo.text;
          modes.set(tokenInfo.index, 'dynamic');
        }
        i = tokenInfo.end;
        continue;
      }
      out += source[i++];
      continue;
    }

    if (source.startsWith('<!--', i)) {
      inComment = true;
      out += '<!--';
      i += 4;
      continue;
    }

    if (inTag) {
      const char = source[i];
      if (char === '>') {
        inTag = false;
        tagStart = false;
        attrName = '';
        inAttrName = false;
        expectingValue = false;
        readingValue = false;
        if (pendingRawTextTag) {
          rawTextTag = pendingRawTextTag;
          pendingRawTextTag = null;
        }
        out += char;
        i++;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        expectingValue = false;
        readingValue = false;
        out += char;
        i++;
        continue;
      }
      if (char === '/' && source[i + 1] === '>') {
        inTag = false;
        tagStart = false;
        attrName = '';
        inAttrName = false;
        expectingValue = false;
        readingValue = false;
        pendingRawTextTag = null;
        out += '/>';
        i += 2;
        continue;
      }
      if (/\s/.test(char)) {
        // Whitespace ends an unquoted value. Spaces immediately after `=` are
        // allowed (`attr = value`), so only clear expectingValue once a value
        // has actually started. Keep the name while a value is still expected,
        // so `is = ${...}` is still recognised as the declaration attribute.
        tagStart = false;
        if (readingValue) {
          readingValue = false;
          expectingValue = false;
        }
        inAttrName = false;
        if (!expectingValue) attrName = '';
        out += char;
        i++;
        continue;
      }
      const tokenInfo = isTokenAt(source, i) ? readTokenAt(source, i) : null;
      if (tokenInfo) {
        const isValue = expectingValue;
        expectingValue = false;
        if (isValue && attrName.toLowerCase() === 'is') {
          out += escapeAttribute(declarationValue(tokenMap.get(tokenInfo.index)));
          modes.set(tokenInfo.index, 'folded');
        } else if (isValue) {
          // Unquoted attribute value: keep the token so AttributePart escapes
          // it through the DOM instead of splicing markup.
          out += tokenInfo.text;
          modes.set(tokenInfo.index, 'dynamic');
        } else if (readingValue) {
          // A token spliced into an unquoted literal value, e.g. foo${bar}.
          out += tokenInfo.text;
          modes.set(tokenInfo.index, 'dynamic');
        } else {
          const foldedText = foldTagMarkup(
            tokenMap.get(tokenInfo.index),
            {tagStart, attrName, source, end: tokenInfo.end},
            type,
          );
          // A tag-start snippet ends the tag-name phase; following tokens are
          // attribute names/snippets, not more of the tag name.
          if (tagStart && /[\s=<>"']/.test(foldedText)) tagStart = false;
          out += foldedText;
          modes.set(tokenInfo.index, 'folded');
        }
        readingValue = false;
        i = tokenInfo.end;
        continue;
      }
      if (char === '=') {
        inAttrName = false;
        expectingValue = true;
        readingValue = false;
        out += char;
        i++;
        continue;
      }
      if (expectingValue) {
        // First character of an unquoted value.
        readingValue = true;
        expectingValue = false;
        out += char;
        i++;
        continue;
      }
      if (readingValue) {
        out += char;
        i++;
        continue;
      }
      if (!inAttrName) {
        inAttrName = true;
        attrName = '';
      }
      attrName += char;
      out += char;
      i++;
      continue;
    }

    if (source[i] === '<') {
      const next = source[i + 1];
      // A lone `<` in text (e.g. "1 < 2") is not a tag start. Without this
      // check the scanner would treat following `${}` as static markup.
      const startsTag = next &&
        (/[A-Za-z]/.test(next) || next === '/' || next === '!' || next === '?' || isTokenAt(source, i + 1));
      if (!startsTag) {
        out += source[i++];
        continue;
      }
      const rest = source.slice(i);
      const rawMatch = rest.match(/^<(script|style)(?=[\s>])/i);
      inTag = true;
      tagStart = true;
      inAttrName = false;
      expectingValue = false;
      readingValue = false;
      attrName = '';
      if (rawMatch) pendingRawTextTag = rawMatch[1].toLowerCase();
      out += '<';
      i++;
      continue;
    }

    const tokenInfo = isTokenAt(source, i) ? readTokenAt(source, i) : null;
    if (tokenInfo) {
      out += tokenInfo.text;
      modes.set(tokenInfo.index, 'dynamic');
      i = tokenInfo.end;
      continue;
    }

    out += source[i++];
  }

  return {foldedSource: out, modes};
}

function resolveTokensToLegacy(source, tokenMap, type) {
  TOKEN_GLOBAL.lastIndex = 0;
  return source.replace(TOKEN_GLOBAL, (_, rawIndex) => {
    return stringifyValue(tokenMap.get(Number(rawIndex)), type);
  });
}

const EXPR_OPEN = '{';
const EXPR_CLOSE = '}';

function parseSegments(text, tokenMap, options = {}) {
  const segments = [];
  let staticText = '';
  let i = 0;

  const pushStatic = () => {
    if (staticText) {
      segments.push({type: 'static', value: staticText});
      staticText = '';
    }
  };

  while (i < text.length) {
    if (isTokenAt(text, i)) {
      const tokenInfo = readTokenAt(text, i);
      if (tokenInfo) {
        pushStatic();
        const value = tokenMap.get(tokenInfo.index);
        if (options.bakeValues) {
          segments.push({type: 'constant', value});
        } else {
          segments.push({type: 'value', index: tokenInfo.index});
        }
        i = tokenInfo.end;
        continue;
      }
    }

    if (text[i] === EXPR_OPEN) {
      const close = text.indexOf(EXPR_CLOSE, i + 1);
      if (close !== -1) {
        pushStatic();
        segments.push({type: 'expr', code: text.slice(i + 1, close).trim()});
        i = close + 1;
        continue;
      }
    }

    staticText += text[i++];
  }

  pushStatic();
  return segments;
}

function hasDynamicSegments(segments) {
  return segments.some(segment => segment.type !== 'static');
}

function segmentsHaveExpressions(segments) {
  return segments.some(segment => segment.type === 'expr');
}

function hasDynamicContent(element) {
  // Nested <template> content is inert and is not walked by the marker engine.
  // A ${} token would leak into clones, so reject it; plain JS/CSS braces are
  // ordinary static text and stay untouched.
  return element.innerHTML.includes(TOKEN_PREFIX);
}

/**
 * Compiled template: static DOM skeleton + marker-based Part descriptors.
 */
export class CompiledTemplate {
  /**
   * @param {HTMLTemplateElement} template
   * @param {object} meta
   */
  constructor(template, meta = {}) {
    this.template = template;
    this.meta = meta;
    this.source = meta.source || template.innerHTML;
    this.type = meta.type || 'html';
    // Element groups: one entry per element that owns a Component replacement
    // and/or Attribute/Property/Event/Ref/Bind parts.
    this.elements = [];
    // Child markers: one entry per dynamic text position.
    this.childParts = [];
  }

  instantiate(context, host, options) {
    recordTemplateStat('instances');
    return new TemplateInstance(this, context, host, options);
  }
}

function replaceTextNode(node, segments, compiled, nextId, rcdata) {
  const replacement = [];
  for (const segment of segments) {
    if (segment.type === 'static') {
      if (segment.value) replacement.push(document.createTextNode(segment.value));
      continue;
    }
    const id = nextId();
    // A text-node marker is stable through cloning, is not serialized as a
    // visible comment, and can be found again without paths. RCDATA elements
    // use the marker node itself; regular children insert values before it.
    replacement.push(document.createTextNode(`${TEXT_MARKER_PREFIX}${id}${TEXT_MARKER_SUFFIX}`));
    compiled.childParts.push({id, segment, anchor: rcdata ? 'text' : 'node'});
  }
  node.replaceWith(...replacement);
}

function processAttributes(element, partList, tokenMap, type, isComponent, staticAttrs, isFrameworkComponent) {
  for (const attr of Array.from(element.attributes)) {
    const name = attr.name;
    const value = attr.value;
    const hasToken = value.includes(TOKEN_PREFIX);
    const hasExpr = value.includes(EXPR_OPEN);

    if (isComponent && isFrameworkComponent && FRAMEWORK_ATTRS.has(name)) {
      if (hasToken) {
        throw new Error(
          `The "${name}" attribute does not support \${} values; use {expression} instead`
        );
      }
      staticAttrs.push([name, value]);
      continue;
    }

    if (name === 'is') {
      if (hasToken) {
        throw new Error('The "is" attribute must be a static value or a Component class');
      }
      staticAttrs?.push([name, declarationValue(value)]);
      continue;
    }

    if (name === 'ref') {
      if (hasToken) throw new Error('The "ref" attribute does not support ${} values');
      element.removeAttribute(name);
      partList.push({type: 'ref', name: value.trim()});
      continue;
    }

    if (name === 'bind') {
      if (hasToken) throw new Error('The "bind" attribute does not support ${} values');
      const expr = value.match(/^\{([^}]+)\}$/)?.[1]?.trim();
      element.removeAttribute(name);
      if (expr) partList.push({type: 'bind', expr});
      continue;
    }

    if (name.startsWith(':')) {
      const propName = name.slice(1).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      const segments = parseSegments(value, tokenMap);
      element.removeAttribute(name);
      if (hasDynamicSegments(segments)) {
        partList.push({
          type: 'property',
          name: propName,
          segments,
          expression: segmentsHaveExpressions(segments),
        });
      }
      continue;
    }

    if (name === 'srcdoc') {
      // srcdoc is parsed as HTML by the browser, so even a dynamic value would
      // be a markup insertion point. It has no safe Part representation.
      throw new Error(
        'The "srcdoc" attribute is not supported in templates; use unsafeHTML() or set it imperatively'
      );
    }

    if (isEventHandlerAttribute(element, name)) {
      if (hasToken) {
        throw new Error(`The "${name}" handler must use {expression}, not \${} values`);
      }
      if (!hasExpr) {
        // Static inline JavaScript is unsafe under CSP and, more importantly,
        // can be smuggled in through a folded ${} attribute name/value. Only
        // the authored {expression} form is accepted.
        throw new Error(`The "${name}" handler must use {expression}, not a static value`);
      }
      const eventName = name.slice(2).toLowerCase();
      const expr = value.replace(/[{}]/g, '').trim();
      element.removeAttribute(name);
      partList.push({type: 'event', eventName, expr});
      continue;
    }

    if (!hasToken && !hasExpr) {
      staticAttrs?.push([name, value]);
      continue;
    }

    const segments = parseSegments(value, tokenMap);
    if (!hasDynamicSegments(segments)) {
      staticAttrs?.push([name, resolveTokensToLegacy(value, tokenMap, type)]);
      continue;
    }

    element.removeAttribute(name);
    partList.push({
      type: 'attribute',
      name,
      segments,
      mode: isComponent ? 'component' : 'native',
      expression: segmentsHaveExpressions(segments),
    });
  }
}

function compileSource(source, tokenMap, options = {}) {
  const type = options.type || 'html';
  const forceFold = options.forceFold === true;

  const folded = options.foldedSource != null
    ? {foldedSource: options.foldedSource, modes: options.modes || new Map()}
    : foldStaticTokens(source, tokenMap, {type, forceFold});
  const {foldedSource} = folded;
  const template = document.createElement('template');
  template.innerHTML = foldedSource;

  const compiled = new CompiledTemplate(template, {
    source: foldedSource,
    type,
  });

  let idCounter = 0;
  const nextId = () => ++idCounter;

  const walk = (parent, parentTag, skipText) => {
    const children = Array.from(parent.childNodes);
    for (const node of children) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (RAW_TEXT_TAGS.has(parentTag)) {
          // JS/CSS braces are not Veda expressions. Only an actual ${} token
          // is rejected here; static script/style text stays untouched.
          if (node.nodeValue.includes(TOKEN_PREFIX)) {
            throw new Error(`Expressions inside <${parentTag}> are not supported`);
          }
          continue;
        }
        if (skipText) continue;
        const segments = parseSegments(node.nodeValue, tokenMap);
        if (!hasDynamicSegments(segments)) continue;
        replaceTextNode(node, segments, compiled, nextId, RCDATA_TAGS.has(parentTag));
        continue;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) continue;

      const el = node;
      const tag = el.tagName.toLowerCase();

      if (tag === 'template') {
        if (hasDynamicContent(el)) {
          throw new Error('Expressions inside a nested <template> are not supported');
        }
        continue;
      }

      const hasDash = tag.includes('-');
      const hasIs = el.hasAttribute('is');
      const hasProp = el.hasAttribute('property');
      const hasRel = el.hasAttribute('rel');
      const hasAbout = el.hasAttribute('about');
      const hasItems = el.hasAttribute('items');
      const hasCondition = !hasItems && el.hasAttribute('condition');
      const isComponent = hasDash || hasIs || hasProp || hasRel || hasAbout || hasItems || hasCondition;

      if (isComponent) {
        const childSource = el.innerHTML;
        const childCompiled = childSource.trim()
          ? compileSource(childSource, tokenMap, {type})
          : null;
        const childLegacy = resolveTokensToLegacy(childSource, tokenMap, type);

        // Child content is rendered by the child component. Keep the parent
        // template free of it, so parent parts never see child internals.
        el.innerHTML = '';

        const kind = hasDash
          ? 'custom'
          : hasIs
            ? 'is'
            : hasProp
              ? 'property'
              : hasRel
                ? 'rel'
                : hasItems
                  ? 'items'
                  : hasCondition
                    ? 'condition'
                    : 'about';

        const group = {id: nextId(), component: null, parts: []};
        const staticAttrs = [];
        // Attribute names like `key`/`as`/`height` are framework config only on
        // Loop/If/Virtual; on a user component they are ordinary attributes.
        const isFrameworkComponent = hasItems || hasCondition ||
          tag === 'veda-loop' || tag === 'veda-if' || tag === 'veda-virtual';
        processAttributes(el, group.parts, tokenMap, type, true, staticAttrs, isFrameworkComponent);

        group.component = {
          kind,
          tag,
          is: el.getAttribute('is') || null,
          elementClass: el.constructor,
          staticAttrs,
          childCompiled,
          childLegacy,
          hasDash,
          hasIs,
          hasProp,
          hasRel,
          hasAbout,
          hasItems,
          hasCondition,
        };

        el.setAttribute(ELEMENT_MARKER, String(group.id));
        compiled.elements.push(group);
        continue;
      }

      const group = {id: nextId(), component: null, parts: []};
      processAttributes(el, group.parts, tokenMap, type, false, null);
      if (group.parts.length) {
        el.setAttribute(ELEMENT_MARKER, String(group.id));
        compiled.elements.push(group);
      }

      walk(el, tag, RAW_TEXT_TAGS.has(tag));
    }
  };

  walk(template.content, '', false);

  return compiled;
}

function shapeKey(values, type, modes) {
  const key = [type];
  for (let i = 0; i < values.length; i++) {
    const mode = modes.get(i);
    key.push([i, mode, mode === 'folded' ? stringifyTagValue(values[i], type) : null]);
  }
  // JSON keeps folded values unambiguous: a value containing `;` or `:` must
  // not be able to collide with a different shape and reuse its template.
  return JSON.stringify(key);
}

function trimCache(cache, max) {
  while (cache.size > max) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
}

/**
 * Compile a TemplateResult, a CompiledTemplate, or a plain HTML string.
 * @param {TemplateResult|CompiledTemplate|string|undefined|null} input
 * @param {object} [options]
 * @returns {CompiledTemplate}
 */
export function compileTemplate(input) {
  if (input instanceof CompiledTemplate) return input;

  if (isTemplateResult(input)) {
    const strings = input.strings;
    const type = input.type;
    const forceFold = type === 'raw';

    // html('...') is a plain string: use the string cache instead of
    // compiling a fresh template for every call.
    if (typeof strings === 'string') {
      if (input.values.length) {
        throw new Error('html() with a plain string does not support ${} values');
      }
      return compileTemplate(strings);
    }

    const canCache = strings && (typeof strings === 'object' || typeof strings === 'function');
    let stringsEntry = canCache ? sourceCache.get(strings) : null;
    if (stringsEntry && stringsEntry.type !== type) stringsEntry = null;

    let source = stringsEntry?.source;
    let modes = stringsEntry?.modes;
    let foldedSource = null;
    let tokenMap = null;

    if (!stringsEntry) {
      const built = buildTokenizedSource(strings, input.values);
      source = built.source;
      tokenMap = built.tokenMap;
      const folded = foldStaticTokens(source, tokenMap, {type, forceFold});
      modes = folded.modes;
      foldedSource = folded.foldedSource;
      if (canCache) sourceCache.set(strings, {type, source, modes});
    }

    const shape = shapeKey(input.values, type, modes);

    let perStrings = null;
    if (canCache) {
      perStrings = resultCache.get(strings);
      if (!perStrings) {
        perStrings = new Map();
        resultCache.set(strings, perStrings);
      }
    }
    const cached = perStrings?.get(shape);
    if (cached) {
      perStrings.delete(shape);
      perStrings.set(shape, cached);
      recordTemplateStat('cacheHits');
      return cached;
    }

    recordTemplateStat('compiles');
    if (!foldedSource) {
      tokenMap = new Map(input.values.map((value, index) => [index, value]));
      foldedSource = foldStaticTokens(source, tokenMap, {type, forceFold}).foldedSource;
    }
    const compiled = compileSource(source, tokenMap, {
      type,
      forceFold,
      foldedSource,
      modes,
    });
    if (perStrings) {
      perStrings.set(shape, compiled);
      trimCache(perStrings, MAX_SHAPE_CACHE);
    }
    return compiled;
  }

  const stringSource = typeof input === 'string' ? input : '';
  if (typeof input !== 'string' && input != null) {
    return compileTemplate(String(input));
  }

  const cached = stringCache.get(stringSource);
  if (cached) {
    stringCache.delete(stringSource);
    stringCache.set(stringSource, cached);
    recordTemplateStat('cacheHits');
    return cached;
  }

  recordTemplateStat('compiles');
  const compiled = compileSource(stringSource, new Map(), {type: 'html'});
  stringCache.set(stringSource, compiled);
  trimCache(stringCache, MAX_STRING_CACHE);
  return compiled;
}

export function clearTemplateCache() {
  stringCache.clear();
  resultCache = new WeakMap();
  sourceCache = new WeakMap();
  resetTemplateStats();
}


const ROOT_PART = Symbol.for('veda.rootPart');

/**
 * Render a TemplateResult into a container, reusing the mounted instance when
 * the compiled template is unchanged. This is the Lit-style standalone entry
 * point; Components use the same TemplateInstance internally.
 *
 * @param {TemplateResult|CompiledTemplate|string|null|undefined} result
 * @param {Element|DocumentFragment|ShadowRoot} container
 * @returns {TemplateInstance|null}
 */
export function render(result, container) {
  if (result === noChange) return container[ROOT_PART] || null;
  if (result === nothing || result == null) {
    container[ROOT_PART]?.destroy();
    container.replaceChildren();
    container[ROOT_PART] = null;
    return null;
  }

  const compiled = compileTemplate(result);
  let root = container[ROOT_PART];
  if (root && root.compiled === compiled) {
    root.setResult(typeof result === 'string' ? {values: []} : result);
    return root;
  }

  root?.destroy();
  root = compiled.instantiate(container, container, {result});
  root.mount(container);
  container[ROOT_PART] = root;
  return root;
}

export function getTemplateCacheStats() {
  return {...getTemplateStats(), stringCacheSize: stringCache.size};
}

export {resetTemplateStats, TEMPLATE_ENGINE};

if (typeof window !== 'undefined') {
  window.__VEDA_TEMPLATE_ENGINE__ = TEMPLATE_ENGINE;
  window.__VEDA_TEMPLATE_STATS__ = getTemplateCacheStats;
  window.__VEDA_TEMPLATE_RESET_STATS__ = resetTemplateStats;
}
