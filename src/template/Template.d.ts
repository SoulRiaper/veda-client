import type {TemplateResult} from './TemplateResult.js';

export interface TemplateCacheStats {
  compiles: number;
  cacheHits: number;
  instances: number;
  mounts: number;
  patches: number;
  componentCreates: number;
  domWrites: number;
  instancesByHost: Record<string, number>;
  componentsByTag: Record<string, number>;
  engine: string;
  stringCacheSize: number;
}

export interface PartDescriptor {
  type: string;
  [key: string]: unknown;
}

export interface ElementGroup {
  id: number;
  component: Record<string, unknown> | null;
  parts: PartDescriptor[];
}

export interface ChildPartDescriptor {
  id: number;
  segment: Record<string, unknown>;
  anchor: 'text' | 'node';
}

export class CompiledTemplate {
  readonly template: HTMLTemplateElement;
  readonly source: string;
  readonly type: 'html' | 'raw';
  readonly meta: Record<string, unknown>;
  readonly elements: readonly ElementGroup[];
  readonly childParts: readonly ChildPartDescriptor[];
  instantiate(context: object, host: object, options?: {
    result?: unknown;
    values?: readonly unknown[];
    nested?: boolean;
  }): unknown;
}

export const TEMPLATE_ENGINE: string;
export function compileTemplate(input: TemplateResult | CompiledTemplate | string | null | undefined): CompiledTemplate;
/**
 * Compile a raw source that still contains internal `${}` tokens with the
 * values of the owning call-site. Used by Slot projection.
 * @internal
 */
export function compileTemplateWithValues(
  source: string,
  values?: readonly unknown[],
): CompiledTemplate;
/**
 * Resolve `${}` tokens in a plain string (for example a `slot` attribute)
 * without serializing markup. Used by Slot projection.
 * @internal
 */
export function resolveSourceTokens(text: string, values?: readonly unknown[]): string;
export function render(
  result: TemplateResult | CompiledTemplate | string | null | undefined,
  container: Element | DocumentFragment | ShadowRoot,
): unknown;
export function getTemplateCacheStats(): TemplateCacheStats;
export function resetTemplateStats(): void;
export function clearTemplateCache(): void;
