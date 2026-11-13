/**
 * TemplateResult is a string-compatible value returned by `html`.
 * At runtime it extends String, so existing code that treats it as a string
 * keeps working, while the renderer uses `strings`/`values` to compile and
 * patch a cached template.
 */
export class TemplateResult extends String {
  readonly strings: readonly string[] | TemplateStringsArray;
  readonly values: readonly any[];
  readonly type: 'html' | 'raw';
  readonly isTemplateResult: true;
}

export function isTemplateResult(value: any): value is TemplateResult;
export function html(strings: TemplateStringsArray, ...values: any[]): TemplateResult;
export function raw(strings: TemplateStringsArray, ...values: any[]): string;
export function safe(value: any): string | string[];
