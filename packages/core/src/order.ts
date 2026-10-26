/**
 * 同级排序:数值中点法。
 * newOrder(prev, next) 返回二者之间的数;间隙耗尽时由 renumberSiblings 重排该层。
 * 选择数值而非 fractional string:实现简单、可暴力测试;重排只影响单个父级下的兄弟,
 * 单人场景 CRDT 合并冲突可忽略。见 docs/DEVLOG.md。
 */

export const MIN_GAP = 1e-9;

export function newOrder(prev?: number, next?: number): number {
  if (prev == null && next == null) return 0;
  if (prev == null) return next! - 1;
  if (next == null) return prev + 1;
  return (prev + next) / 2;
}

/** 中点间隙是否已耗尽 */
export function gapTooSmall(prev?: number, next?: number): boolean {
  if (prev == null || next == null) return false;
  return next - prev < MIN_GAP * 4;
}

/**
 * 兄弟重排:以 step=1000 重建该层顺序,返回需要写回的 {id, order} 列表。
 * keepFirst 保留第一个元素当前 order(避免无谓写入)。
 */
export function renumberSiblings<T extends { id: string; order: number }>(
  siblings: T[],
): { id: string; order: number }[] {
  const sorted = [...siblings].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const writes: { id: string; order: number }[] = [];
  sorted.forEach((s, i) => {
    const order = i * 1000;
    if (s.order !== order) writes.push({ id: s.id, order });
  });
  return writes;
}
