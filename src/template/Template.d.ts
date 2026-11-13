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

export const TEMPLATE_ENGINE: string;
export function getTemplateCacheStats(): TemplateCacheStats;
export function resetTemplateStats(): void;
export function clearTemplateCache(): void;
