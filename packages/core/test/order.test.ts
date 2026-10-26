import { describe, it, expect } from 'vitest';
import { newOrder, gapTooSmall, renumberSiblings, MIN_GAP } from '../src/order';

describe('newOrder 数值中点', () => {
  it('空列表返回 0', () => {
    expect(newOrder()).toBe(0);
  });
  it('头部插入 < 首元素', () => {
    expect(newOrder(undefined, 5)).toBeLessThan(5);
  });
  it('尾部插入 > 尾元素', () => {
    expect(newOrder(5)).toBeGreaterThan(5);
  });
  it('中间插入严格落在 (prev, next)', () => {
    const mid = newOrder(1, 2);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(2);
  });
});

describe('连续插入保持有序(含间隙耗尽检测)', () => {
  it('1 万次随机位置插入,序列单调且有限', () => {
    let arr: number[] = [newOrder()];
    for (let i = 0; i < 10000; i++) {
      const idx = Math.floor(Math.random() * (arr.length + 1));
      const prev = idx > 0 ? arr[idx - 1] : undefined;
      const next = idx < arr.length ? arr[idx] : undefined;
      if (gapTooSmall(prev, next)) {
        // 模拟重排
        const writes = renumberSiblings(arr.map((o, j) => ({ id: String(j), order: o })));
        const map = new Map(arr.map((o, j) => [String(j), o]));
        for (const w of writes) map.set(w.id, w.order);
        arr = arr.map((_, j) => map.get(String(j))!).sort((a, b) => a - b);
        continue;
      }
      const o = newOrder(prev, next);
      if (prev != null && next != null) {
        expect(o).toBeGreaterThan(prev);
        expect(o).toBeLessThan(next);
      }
      arr.splice(idx, 0, o);
    }
    // 全局单调
    for (let i = 1; i < arr.length; i++) expect(arr[i]!).toBeGreaterThanOrEqual(arr[i - 1]!);
    // 无间隙耗尽残留
    for (let i = 1; i < arr.length; i++) expect(arr[i]! - arr[i - 1]!).toBeGreaterThanOrEqual(MIN_GAP);
    expect(Number.isFinite(arr[arr.length - 1]!)).toBe(true);
  });
});

describe('renumberSiblings', () => {
  it('按当前顺序重建为 0,1000,2000…', () => {
    const items = [
      { id: 'c', order: 0.75 },
      { id: 'a', order: 0.5 },
      { id: 'b', order: 0.625 },
    ];
    const writes = renumberSiblings(items);
    const map = new Map(writes.map((w) => [w.id, w.order]));
    expect(map.get('a')).toBe(0);
    expect(map.get('b')).toBe(1000);
    expect(map.get('c')).toBe(2000);
  });
  it('已是规范序时零写入', () => {
    const items = [
      { id: 'a', order: 0 },
      { id: 'b', order: 1000 },
    ];
    expect(renumberSiblings(items)).toEqual([]);
  });
});
