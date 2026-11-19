/**
 * Shared DOM binding helper.
 *
 * Kept as a standalone module so both the string-template pipeline and the
 * JSX runtime use exactly the same property/attribute semantics.
 */

/**
 * Bind a value to a DOM property or attribute.
 *
 * @param {Element} node - Target element.
 * @param {string} attrName - Attribute/property name.
 * @param {*} value - Value to bind.
 * @param {boolean} hasNull - True when the source template produced a null
 *   interpolation (affects boolean attributes).
 * @param {Attr|null} attr - When supplied, update this Attr node instead of
 *   calling setAttribute (used by the string pipeline for performance).
 */
export function setAttributeOrProperty(node, attrName, value, hasNull = false, attr = null) {
  // Check if this attribute should be set as DOM property.
  // Properties like value, checked, disabled exist on DOM elements.
  // Exclude style/class - they have object types and need attribute handling.
  const shouldUseProperty = attrName in node &&
                            !attrName.startsWith('data-') &&
                            attrName !== 'style' &&
                            attrName !== 'class';

  if (shouldUseProperty) {
    // Boolean properties need special handling
    if (typeof node[attrName] === 'boolean') {
      const boolValue = !hasNull && value !== 'false' &&
                       (value === 'true' || value === '' || value === attrName || value === true);
      if (node[attrName] !== boolValue) {
        node[attrName] = boolValue;
        node.toggleAttribute(attrName, boolValue);
      }
    } else {
      // String/other properties (like value)
      if (node[attrName] !== value) {
        node[attrName] = value;
      }
    }
  } else {
    // Regular attribute
    if (attr) {
      attr.nodeValue = value;
    } else if (node.getAttribute(attrName) !== value) {
      node.setAttribute(attrName, value);
    }
  }
}
