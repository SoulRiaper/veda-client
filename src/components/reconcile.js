/**
 * Keyed list reconciliation helpers.
 *
 * Extracted from LoopComponent so the JSX <For> implementation can reuse the
 * same LIS-based ordering algorithm instead of maintaining a second
 * reconciler.
 */

/**
 * Find Longest Increasing Subsequence indices using binary search.
 * Time: O(n log n), Space: O(n)
 * Returns indices into the input array that form the LIS.
 *
 * @param {number[]} arr
 * @returns {number[]}
 */
export function longestIncreasingSubsequence(arr) {
  const n = arr.length;
  if (n === 0) return [];

  // tails[i] = index in arr of smallest tail element for LIS of length i+1
  const tails = [];
  // parent[i] = index of previous element in LIS ending at arr[i]
  const parent = new Array(n).fill(-1);

  for (let i = 0; i < n; i++) {
    const val = arr[i];

    // Binary search for position
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[tails[mid]] < val) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    // lo is the position where val should go
    if (lo > 0) {
      parent[i] = tails[lo - 1];
    }

    if (lo === tails.length) {
      tails.push(i);
    } else {
      tails[lo] = i;
    }
  }

  // Reconstruct LIS indices
  const lis = [];
  let k = tails[tails.length - 1];
  while (k >= 0) {
    lis.push(k);
    k = parent[k];
  }
  lis.reverse();

  return lis;
}

/**
 * Reorder existing DOM elements to match `newKeys`, minimizing moves with LIS.
 *
 * @param {Node} container - Parent that owns the item elements.
 * @param {string[]} newKeys - Desired key order.
 * @param {string[]} oldKeys - Current key order (insertion order of itemsMap).
 * @param {Map<string, {element: Element}>} itemsMap - key -> item data.
 * @param {Node|null} endAnchor - Optional node the list must end before. When
 *   omitted the list is appended at the end of the container (Loop behavior).
 */
export function reconcileOrder(container, newKeys, oldKeys, itemsMap, endAnchor = null) {
  const oldKeySet = new Set(oldKeys);

  // If no existing elements, just append all in order
  if (oldKeys.length === 0) {
    newKeys.forEach(key => {
      const itemData = itemsMap.get(key);
      if (itemData?.element) {
        if (endAnchor) container.insertBefore(itemData.element, endAnchor);
        else container.appendChild(itemData.element);
      }
    });
    return;
  }

  // Map old keys to their positions
  const oldKeyIndex = new Map(oldKeys.map((key, i) => [key, i]));

  // Get positions of new keys in old order (only for keys that existed)
  const positions = [];
  const keyAtPosition = [];
  newKeys.forEach((key, newIndex) => {
    if (oldKeySet.has(key)) {
      positions.push(oldKeyIndex.get(key));
      keyAtPosition.push({ key, newIndex });
    }
  });

  // Find LIS - these elements don't need to move
  const lisIndices = longestIncreasingSubsequence(positions);
  const stablePositions = new Set(lisIndices.map(i => positions[i]));

  // Determine which keys are stable (in LIS)
  const stableKeys = new Set();
  keyAtPosition.forEach((item, i) => {
    if (stablePositions.has(positions[i])) {
      stableKeys.add(item.key);
    }
  });

  // Move elements: iterate in reverse, placing each before its successor
  let nextSibling = endAnchor;
  for (let i = newKeys.length - 1; i >= 0; i--) {
    const key = newKeys[i];
    const itemData = itemsMap.get(key);
    if (!itemData?.element) continue;

    const element = itemData.element;
    const isNew = !oldKeySet.has(key);
    const needsMove = isNew || !stableKeys.has(key);

    if (needsMove) {
      // Element needs to be moved/inserted
      if (nextSibling) {
        if (element.nextSibling !== nextSibling) {
          container.insertBefore(element, nextSibling);
        }
      } else {
        if (element !== container.lastChild) {
          container.appendChild(element);
        }
      }
    }

    nextSibling = element;
  }
}
