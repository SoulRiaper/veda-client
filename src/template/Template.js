import {isTemplateResult, safe} from './TemplateResult.js';
import TemplateInstance from './TemplateInstance.js';
import {getTemplateStats, recordTemplateStat, resetTemplateStats, TEMPLATE_ENGINE} from './stats.js';

export const TOKEN_PREFIX = '\uE000';
export const TOKEN_SUFFIX = '\uE001';

const TOKEN_AT_START = new RegExp(`^${TOKEN_PREFIX}(\\d+)${TOKEN_SUFFIX}`);
const TOKEN_GLOBAL = new RegExp(`${TOKEN_PREFIX}(\\d+)${TOKEN_SUFFIX}`, 'g');
const ATTR_ESCAPE_REGEX = /[&<>"]/g;
const ATTR_ESCAPE_MAP = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'};

const MAX_STRING_CACHE = 1000;
const MAX_SHAPE_CACHE = 20;

const stringCache = new Map();
const resultCache = new WeakMap();

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
 * raw text/script/style) and which remain dynamic parts.
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
  let quote = null;
  let attrName = '';
  let readingAttrName = false;
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
        out += stringifyTagValue(value, type);
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
          const value = tokenMap.get(tokenInfo.index);
          out += stringifyTagValue(value, type);
          modes.set(tokenInfo.index, 'folded');
          i = tokenInfo.end;
          continue;
        }
        out += source[i++];
        continue;
      }
    }

    if (source.startsWith('<!--', i)) {
      inComment = true;
      out += '<!--';
      i += 4;
      continue;
    }

    if (quote) {
      if (source[i] === quote) {
        quote = null;
        out += source[i++];
        continue;
      }
      const tokenInfo = isTokenAt(source, i) ? readTokenAt(source, i) : null;
      if (tokenInfo) {
        const value = tokenMap.get(tokenInfo.index);
        if (forceFold || attrName.toLowerCase() === 'is') {
          out += forceFold
            ? stringifyTagValue(value, type)
            : escapeAttribute(stringifyTagValue(value, type));
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

    if (inTag) {
      const char = source[i];
      if (char === '>') {
        inTag = false;
        attrName = '';
        readingAttrName = false;
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
        out += char;
        i++;
        continue;
      }
      if (char === '/' && source[i + 1] === '>') {
        inTag = false;
        attrName = '';
        readingAttrName = false;
        pendingRawTextTag = null;
        out += '/>';
        i += 2;
        continue;
      }
      if (/\s/.test(char)) {
        readingAttrName = false;
        attrName = '';
        out += char;
        i++;
        continue;
      }
      const tokenInfo = isTokenAt(source, i) ? readTokenAt(source, i) : null;
      if (tokenInfo) {
        const value = tokenMap.get(tokenInfo.index);
        // Tag name, attribute name, or an unquoted attribute value. Values
        // such as ` type="text"` are intentionally inserted as markup.
        out += stringifyTagValue(value, type);
        modes.set(tokenInfo.index, 'folded');
        i = tokenInfo.end;
        continue;
      }
      if (char === '=') {
        readingAttrName = false;
        out += char;
        i++;
        continue;
      }
      if (readingAttrName) {
        attrName += char;
        out += char;
        i++;
        continue;
      }
      out += char;
      i++;
      continue;
    }

    if (source[i] === '<') {
      const rest = source.slice(i);
      const rawMatch = rest.match(/^<(script|style)(?=[\s>])/i);
      inTag = true;
      readingAttrName = true;
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

function tokenValuesInSource(source) {
  const indices = new Set();
  TOKEN_GLOBAL.lastIndex = 0;
  let match;
  while ((match = TOKEN_GLOBAL.exec(source)) !== null) {
    indices.add(Number(match[1]));
  }
  return indices;
}

function resolveTokensToLegacy(source, tokenMap, type) {
  TOKEN_GLOBAL.lastIndex = 0;
  return source.replace(TOKEN_GLOBAL, (_, rawIndex) => {
    return stringifyValue(tokenMap.get(Number(rawIndex)), type);
  });
}

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

    if (text[i] === '{') {
      const close = text.indexOf('}', i + 1);
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

/**
 * Compiled template: static DOM skeleton + part descriptors.
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
    this.textParts = [];
    this.elementParts = [];
    this.components = [];
    this.bakedIndices = new Set();
  }

  instantiate(context, host, options) {
    recordTemplateStat('instances');
    return new TemplateInstance(this, context, host, options);
  }
}

function compileSource(source, tokenMap, options = {}) {
  const type = options.type || 'html';
  const forceFold = options.forceFold === true;
  const bakeValues = options.bakeValues === true;

  const folded = options.foldedSource != null
    ? {foldedSource: options.foldedSource, modes: options.modes || new Map()}
    : foldStaticTokens(source, tokenMap, {type, forceFold});
  const {foldedSource, modes} = folded;
  const template = document.createElement('template');
  template.innerHTML = foldedSource;

  const compiled = new CompiledTemplate(template, {
    source: foldedSource,
    type,
    bakeValues,
  });

  const root = template.content;

  const walk = (parent, parentPath, skipText) => {
    let index = 0;
    const children = Array.from(parent.childNodes);
    for (const node of children) {
      const path = parentPath.concat(index);
      index++;

      if (node.nodeType === Node.TEXT_NODE) {
        if (skipText) continue;
        const segments = parseSegments(node.nodeValue, tokenMap, {bakeValues});
        if (!hasDynamicSegments(segments)) continue;
        node.nodeValue = '';
        compiled.textParts.push({path, segments});
        continue;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) continue;

      const el = node;
      const tag = el.tagName.toLowerCase();
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
        if (childCompiled) {
          for (const tokenIndex of tokenValuesInSource(childSource)) {
            compiled.bakedIndices.add(tokenIndex);
          }
        }
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

        const skipAttrProcessing = new Set([
          'condition', 'items', 'as', 'key', 'item-key',
          'height', 'item-height', 'overscan',
        ]);

        const staticAttrs = [];
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name;
          const value = attr.value;
          const isFrameworkAttr = skipAttrProcessing.has(name);
          const hasExpr = value.includes('{') || value.includes(TOKEN_PREFIX);

          if (isFrameworkAttr || name === 'is') {
            staticAttrs.push([name, value]);
            continue;
          }

          if (name === 'ref') {
            el.removeAttribute(name);
            compiled.elementParts.push({type: 'ref', path, name: value.trim()});
            continue;
          }

          if (name === 'bind') {
            const expr = value.match(/^\{([^}]+)\}$/)?.[1]?.trim();
            el.removeAttribute(name);
            if (expr) compiled.elementParts.push({type: 'bind', path, expr});
            continue;
          }

          if (name.startsWith(':')) {
            const propName = name.slice(1).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
            const segments = parseSegments(value, tokenMap, {bakeValues});
            el.removeAttribute(name);
            if (hasDynamicSegments(segments)) {
              compiled.elementParts.push({
                type: 'property',
                path,
                name: propName,
                segments,
                expression: segmentsHaveExpressions(segments),
              });
            }
            continue;
          }

          if (name.startsWith('on') && name.length > 2 && value.includes('{')) {
            const eventName = name.slice(2).toLowerCase();
            const expr = value.replace(/[{}]/g, '').trim();
            el.removeAttribute(name);
            compiled.elementParts.push({type: 'event', path, eventName, expr});
            continue;
          }

          if (!hasExpr) {
            staticAttrs.push([name, value]);
            continue;
          }

          const segments = parseSegments(value, tokenMap, {bakeValues});
          if (!hasDynamicSegments(segments)) {
            staticAttrs.push([name, resolveTokensToLegacy(value, tokenMap, type)]);
            continue;
          }

          compiled.elementParts.push({
            type: 'attribute',
            path,
            name,
            segments,
            mode: 'component',
            expression: segmentsHaveExpressions(segments),
          });
        }

        compiled.components.push({
          path,
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
        });

        // Do not walk into the child content; it is compiled separately.
        continue;
      }

      // Plain native element: compile attribute parts.
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name;
        const value = attr.value;
        const hasExpr = value.includes('{') || value.includes(TOKEN_PREFIX);

        if (name === 'ref') {
          el.removeAttribute(name);
          compiled.elementParts.push({type: 'ref', path, name: value.trim()});
          continue;
        }

        if (name === 'bind') {
          const expr = value.match(/^\{([^}]+)\}$/)?.[1]?.trim();
          el.removeAttribute(name);
          if (expr) compiled.elementParts.push({type: 'bind', path, expr});
          continue;
        }

        if (name.startsWith(':')) {
          const propName = name.slice(1).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
          const segments = parseSegments(value, tokenMap, {bakeValues});
          el.removeAttribute(name);
          if (hasDynamicSegments(segments)) {
            compiled.elementParts.push({
              type: 'property',
              path,
              name: propName,
              segments,
              expression: segmentsHaveExpressions(segments),
            });
          }
          continue;
        }

        if (name.startsWith('on') && name.length > 2 && value.includes('{')) {
          const eventName = name.slice(2).toLowerCase();
          const expr = value.replace(/[{}]/g, '').trim();
          el.removeAttribute(name);
          compiled.elementParts.push({type: 'event', path, eventName, expr});
          continue;
        }

        if (!hasExpr) continue;

        const segments = parseSegments(value, tokenMap, {bakeValues});
        if (!hasDynamicSegments(segments)) continue;
        el.removeAttribute(name);
        compiled.elementParts.push({
          type: 'attribute',
          path,
          name,
          segments,
          mode: 'native',
          expression: segmentsHaveExpressions(segments),
        });
      }

      const skipChildText = tag === 'style' || tag === 'script';
      walk(el, path, skipChildText);
    }
  };

  walk(root, [], false);

  // Keep only tokens that actually survived as parts; the rest were folded.
  for (const index of tokenMap.keys()) {
    if (modes.get(index) !== 'dynamic') compiled.bakedIndices.add(index);
  }

  return compiled;
}

function shapeKey(values, type, modes) {
  let key = `${type}|`;
  for (let i = 0; i < values.length; i++) {
    const mode = modes.get(i);
    if (mode === 'folded') {
      key += `${i}:${stringifyTagValue(values[i], type)};`;
    } else {
      key += `${i}:*;`;
    }
  }
  return key;
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
    const {source, tokenMap} = buildTokenizedSource(strings, input.values);
    const {foldedSource, modes} = foldStaticTokens(source, tokenMap, {
      type: input.type,
      forceFold: input.type === 'raw',
    });
    const shape = shapeKey(input.values, input.type, modes);

    let perStrings = resultCache.get(strings);
    if (!perStrings) {
      perStrings = new Map();
      resultCache.set(strings, perStrings);
    }
    const cached = perStrings.get(shape);
    if (cached) {
      recordTemplateStat('cacheHits');
      return cached;
    }

    recordTemplateStat('compiles');
    const compiled = compileSource(source, tokenMap, {
      type: input.type,
      forceFold: input.type === 'raw',
      foldedSource,
      modes,
    });
    perStrings.set(shape, compiled);
    trimCache(perStrings, MAX_SHAPE_CACHE);
    return compiled;
  }

  const stringSource = typeof input === 'string' ? input : '';
  if (typeof input !== 'string' && input != null) {
    // Unknown value (Node, number, etc.) — treat it as text.
    return compileTemplate(String(input));
  }

  const cached = stringCache.get(stringSource);
  if (cached) {
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
  resetTemplateStats();
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
