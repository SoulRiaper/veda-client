export interface ReconcileItem {
  element: Element | null;
}

export declare function longestIncreasingSubsequence(arr: number[]): number[];

export declare function reconcileOrder(
  container: Node,
  newKeys: string[],
  oldKeys: string[],
  itemsMap: Map<string, ReconcileItem>,
  endAnchor?: Node | null
): void;
