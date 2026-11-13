/**
 * Runtime counters for the template engine. Intended for diagnostics and
 * A/B comparisons, not as a stable public API.
 */
export const TEMPLATE_ENGINE = 'templateresult-parts-v3';

export const templateStats = {
  compiles: 0,
  cacheHits: 0,
  instances: 0,
  mounts: 0,
  patches: 0,
  componentCreates: 0,
  domWrites: 0,
  instancesByHost: Object.create(null),
  componentsByTag: Object.create(null),
};

function bump(map, key) {
  const name = String(key || 'unknown');
  map[name] = (map[name] || 0) + 1;
}

export function recordInstanceHost(host) {
  let tag = '';
  try {
    tag = host?.tagName?.toLowerCase() || '';
  } catch {
    // Fake/test instances may inherit Element.prototype without being Elements.
  }
  bump(templateStats.instancesByHost, tag || host?.constructor?.tag || 'unknown');
}

export function recordComponentTag(tag) {
  bump(templateStats.componentsByTag, tag);
}

export function recordTemplateStat(key, amount = 1) {
  templateStats[key] = (templateStats[key] || 0) + amount;
}

export function resetTemplateStats() {
  for (const key of Object.keys(templateStats)) {
    if (typeof templateStats[key] === 'object' && templateStats[key] !== null) {
      for (const mapKey of Object.keys(templateStats[key])) delete templateStats[key][mapKey];
    } else {
      templateStats[key] = 0;
    }
  }
}

export function getTemplateStats() {
  return {
    ...templateStats,
    instancesByHost: {...templateStats.instancesByHost},
    componentsByTag: {...templateStats.componentsByTag},
    engine: TEMPLATE_ENGINE,
  };
}
