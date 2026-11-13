/**
 * TemplateResult: a Lit-like template value.
 *
 * `html` returns a TemplateResult object. It is intentionally not a String
 * subclass any more: rendering goes through the template engine, not through
 * `innerHTML`. `toString()` is kept for diagnostics and migration, but the
 * supported way to render a result is `render()` or a Component.
 *
 * `{expr}` inside the static parts remains the Veda reactive expression
 * syntax. `${value}` interpolations become template values.
 */

const HTML_ESCAPE_MAP = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  "'": '&#39;', '/': '&#x2F;', '\\': '&#x5C;', '`': '&#x60;',
};
const HTML_ESCAPE_REGEX = /[&<>"'/\\`]/g;
const SAFE_EXPR_REGEX = /\{[^}]*\}/g;

/**
 * Sentinel: render nothing at this position.
 */
export const nothing = Symbol.for('veda.nothing');
/**
 * Sentinel: keep the previous value of this Part.
 */
export const noChange = Symbol.for('veda.noChange');

const UNSAFE_HTML = Symbol.for('veda.unsafeHTML');

/**
 * Trusted markup. Use only with trusted content; values are inserted as DOM.
 * @param {unknown} value
 */
export function unsafeHTML(value) {
  return {[UNSAFE_HTML]: true, value};
}

export function isUnsafeHTML(value) {
  return Boolean(value && value[UNSAFE_HTML] === true);
}

export function safe(value) {
  if (Array.isArray(value)) return value.map(safe);
  if (typeof value !== 'string' && !(value instanceof String)) return value;
  return String(value)
    .replace(HTML_ESCAPE_REGEX, char => HTML_ESCAPE_MAP[char])
    .replace(SAFE_EXPR_REGEX, '');
}

function legacyValue(value, type) {
  if (value == null || value === nothing || value === noChange) return '';
  if (Array.isArray(value)) {
    return value.map(item => legacyValue(item, type)).join(' ');
  }
  if (value instanceof TemplateResult) {
    // Nested templates are already escaped/serialized by their own tag.
    return value.toString();
  }
  if (isUnsafeHTML(value)) return String(value.value ?? '');
  if (type === 'raw') {
    return String(value);
  }
  if (typeof value === 'string' || value instanceof String) {
    return safe(String(value));
  }
  return String(value);
}

export class TemplateResult {
  /**
   * @param {TemplateStringsArray|readonly string[]|string} strings
   * @param {any[]} values
   * @param {'html'|'raw'} [type]
   */
  constructor(strings, values, type = 'html') {
    this.strings = strings;
    this.values = values;
    this.type = type;
  }

  get isTemplateResult() { return true; }

  /**
   * Diagnostic/migration serialization. Do not use this to render: it loses
   * reactivity and bypasses the template engine.
   */
  toString() {
    return legacyStrings(this.strings, this.values, this.type);
  }
}

export function isTemplateResult(value) {
  return value instanceof TemplateResult;
}

function legacyStrings(strings, values, type) {
  if (typeof strings === 'string') {
    let result = strings;
    for (let i = 0; i < values.length; i++) result += legacyValue(values[i], type);
    return result.trimEnd();
  }
  let result = '';
  const count = Math.max(strings.length, values.length + 1);
  for (let i = 0; i < count; i++) {
    result += strings[i] ?? '';
    if (i < values.length) result += legacyValue(values[i], type);
  }
  return result.trimEnd();
}

export function html(strings, ...values) {
  return new TemplateResult(strings, values, 'html');
}

export function raw(strings, ...values) {
  // `raw` keeps its historical string contract. It is not a TemplateResult.
  if (typeof strings === 'string' && values.length === 0) return strings;
  return legacyStrings(strings, values, 'raw');
}
