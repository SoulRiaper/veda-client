/**
 * DOM markers shared by the template compiler and the renderer.
 *
 * The compiler inserts these markers into the static template; the renderer
 * resolves them back to Parts without relying on DOM paths. They live in one
 * module so Template.js and TemplateInstance.js cannot drift apart.
 */
export const ELEMENT_MARKER = 'data-veda-element';
export const TEXT_MARKER_PREFIX = '\uE000veda$';
export const TEXT_MARKER_SUFFIX = '\uE001';
export const TEXT_MARKER_RE = /^\uE000veda\$(\d+)\uE001$/;
