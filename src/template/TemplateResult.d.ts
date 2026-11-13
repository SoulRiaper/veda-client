/**
 * TemplateResult is a Lit-style template value returned by `html`. It is not
 * a String subclass; use `render()` or a Component to mount it.
 */
export class TemplateResult {
  constructor(
    strings: TemplateStringsArray | readonly string[] | string,
    values: readonly any[],
    type?: 'html' | 'raw',
  );
  readonly strings: readonly string[] | TemplateStringsArray | string;
  readonly values: readonly any[];
  readonly type: 'html' | 'raw';
  readonly isTemplateResult: true;
  toString(): string;
}

export declare const nothing: unique symbol;
export declare const noChange: unique symbol;

export interface UnsafeHTML {
  readonly value: unknown;
}

export function unsafeHTML(value: unknown): UnsafeHTML;
export function isUnsafeHTML(value: unknown): value is UnsafeHTML;
export function isTemplateResult(value: any): value is TemplateResult;
export function html(strings: TemplateStringsArray | string, ...values: any[]): TemplateResult;
export function raw(strings: TemplateStringsArray | string, ...values: any[]): string;
export function safe(value: any): string | string[];
