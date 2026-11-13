/**
 * TemplateResult: a Lit-like template value.
 *
 * `html` returns a TemplateResult instead of a plain string. For backward
 * compatibility the object extends String, so existing code that does
 * `innerHTML = html`...``, `String(result)`, `result.includes(...)` or string
 * concatenation keeps working. The renderer detects TemplateResult and uses
 * `strings` / `values` to compile and patch a cached template. `raw` keeps its
 * historical contract and returns a plain string.
 *
 * `{expr}` inside the static parts remains the Veda reactive expression
 * syntax. `${value}` interpolations become lazy template values.
 */

const HTML_ESCAPE_MAP = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  "'": '&#39;', '/': '&#x2F;', '\\': '&#x5C;', '`': '&#x60;',
};
const HTML_ESCAPE_REGEX = /[&<>"'/\\`]/g;
const SAFE_EXPR_REGEX = /\{[^}]*\}/g;

export function safe(value) {
  if (Array.isArray(value)) return value.map(safe);
  if (typeof value !== 'string' && !(value instanceof String)) return value;
  return String(value)
    .replace(HTML_ESCAPE_REGEX, char => HTML_ESCAPE_MAP[char])
    .replace(SAFE_EXPR_REGEX, '');
}

function legacyValue(value, type) {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value.map(item => legacyValue(item, type)).join(' ');
  }
  if (value instanceof TemplateResult) {
    // Nested templates are already escaped/serialized by their own tag.
    return value.toString();
  }
  if (type === 'raw') {
    return String(value);
  }
  if (typeof value === 'string' || value instanceof String) {
    return safe(String(value));
  }
  return String(value);
}

export class TemplateResult extends String {
  /**
   * @param {TemplateStringsArray|string[]} strings
   * @param {any[]} values
   * @param {'html'|'raw'} [type]
   */
  constructor(strings, values, type = 'html') {
    const legacy = legacyStrings(strings, values, type);
    super(legacy);
    this.strings = strings;
    this.values = values;
    this.type = type;
  }

  get isTemplateResult() { return true; }
}

export function isTemplateResult(value) {
  return value instanceof TemplateResult;
}

function legacyStrings(strings, values, type) {
  if (typeof strings === 'string') return strings;
  let result = '';
  const count = Math.max(strings.length, values.length + 1);
  for (let i = 0; i < count; i++) {
    result += strings[i] ?? '';
    if (i < values.length) result += legacyValue(values[i], type);
  }
  return result.trimEnd();
}

export function html(strings, ...values) {
  if (typeof strings === 'string' && values.length === 0) {
    return new TemplateResult([strings], [], 'html');
  }
  return new TemplateResult(strings, values, 'html');
}

export function raw(strings, ...values) {
  // `raw` keeps the historical contract: it returns a plain string. Only
  // `html` participates in the TemplateResult pipeline.
  if (typeof strings === 'string' && values.length === 0) return strings;
  return legacyStrings(strings, values, 'raw');
}
