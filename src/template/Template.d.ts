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

export class CompiledTemplate {
  readonly template: HTMLTemplateElement;
  readonly source: string;
  readonly type: 'html' | 'raw';
  readonly meta: Record<string, unknown>;
  readonly textParts: readonly unknown[];
  readonly elementParts: readonly unknown[];
  readonly components: readonly unknown[];
  instantiate(context: object, host: object, options?: {
    result?: unknown;
    values?: readonly unknown[];
    strategy?: unknown;
    nested?: boolean;
  }): unknown;
}

export const TEMPLATE_ENGINE: string;
export function getTemplateCacheStats(): TemplateCacheStats;
export function resetTemplateStats(): void;
export function clearTemplateCache(): void;
