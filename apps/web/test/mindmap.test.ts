import { describe, expect, it } from 'vitest';
import type { Task } from '@cortex/core';
import { layoutMindTree, mindMetrics } from '../src/features/tasks/mindmap/layout';
import { initialMapPosition, mapPositionKey, positionToViewport, readMapPosition, rememberMapPosition } from '../src/features/tasks/mindmap/viewport';

const task = (id: string, title = id): Task => ({ id, title, parentId: null, status: 'todo', ownerId: 'u', order: 0, tags: [], important: false, urgent: false, createdAt: 0, updatedAt: 0 });
describe('content-sized rightward mind map', () => {
  it('keeps the root at the origin and leaves space between variable-height subtrees on the right', () => {
    const root = task('root');
    const main = Array.from({ length: 8 }, (_, index) => task(`main${index}`));
    const leaves = main.flatMap((parent, branch) => Array.from({ length: 5 }, (_, index) => task(`${parent.id}_${index}`, `枝 ${branch} 子任务 ${index}`)));
    const children = (id: string) => id === root.id ? main : leaves.filter((value) => value.id.startsWith(`${id}_`));
    const all = [root, ...main, ...leaves];
    const sizes = new Map(all.map((value, index) => [value.id, { width: 140 + index % 4 * 30, height: 40 + index % 5 * 25 }]));
    const positions = layoutMindTree([root], children, sizes);
    expect(positions.size).toBe(all.length);
    expect(positions.get(root.id)!.x + sizes.get(root.id)!.width / 2).toBe(0);
    expect(positions.get(root.id)!.y + sizes.get(root.id)!.height / 2).toBe(0);
    for (const value of [...main, ...leaves]) expect(positions.get(value.id)!.side).toBe('right');
    for (const parent of [root, ...main]) for (const child of children(parent.id)) {
      expect(positions.get(child.id)!.x).toBeGreaterThan(positions.get(parent.id)!.x + sizes.get(parent.id)!.width);
    }
    for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) {
      const p = positions.get(all[a]!.id)!, q = positions.get(all[b]!.id)!;
      const ps = sizes.get(all[a]!.id)!, qs = sizes.get(all[b]!.id)!;
      expect(p.x + ps.width <= q.x || q.x + qs.width <= p.x || p.y + ps.height <= q.y || q.y + qs.height <= p.y).toBe(true);
    }
  });
  it('handles a deep tree without recursion and centers a single child under its parent', () => {
    const all = Array.from({ length: 12000 }, (_, i) => task(String(i)));
    const positions = layoutMindTree([all[0]!], (id) => all[Number(id) + 1] ? [all[Number(id) + 1]!] : [], new Map());
    expect(positions.size).toBe(all.length);
    expect(positions.get('11999')!.y).toBe(-22);
  });
  it('wraps Chinese titles and remeasures for inherited fonts and larger text', () => {
    const short = mindMetrics(task('short', '小标题'), 2, false);
    const long = mindMetrics(task('long', '这是一段足够长的中文标题，需要完整显示而不是被省略，换行后也不能覆盖其他节点。'), 2, false);
    expect(long.height).toBeGreaterThan(short.height);
    expect(long.width).toBeLessThanOrEqual(310);
    expect(mindMetrics(task('short', '小标题'), 2, false, 'noto-serif-sc').signature).not.toBe(short.signature);
  });
});
describe('readable initial camera and isolated camera memory', () => {
  it('fits a small map and opens a large map at readable zoom around its root', () => {
    expect(initialMapPosition({ x: -100, y: -50, width: 200, height: 100 }, 1000, 700)).toEqual({ centerX: 0, centerY: 0, zoom: 1.05 });
    expect(initialMapPosition({ x: -5000, y: -5000, width: 10000, height: 10000 }, 1000, 700)).toEqual({ centerX: 0, centerY: 0, zoom: 1 });
    expect(initialMapPosition({ x: -5000, y: -5000, width: 10000, height: 10000 }, 390, 600).zoom).toBe(0.9);
    expect(positionToViewport({ centerX: 300, centerY: -20, zoom: 0.8 }, 1000, 600)).toEqual({ x: 260, y: 316, zoom: 0.8 });
  });
  it('separates accounts and projects and ignores invalid or inaccessible storage', () => {
    const values = new Map<string, string>();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
    try {
      const position = { centerX: 52, centerY: -31, zoom: 0.7 };
      rememberMapPosition('user1', 'a', position);
      expect(readMapPosition('user1', 'a')).toEqual(position);
      expect(readMapPosition('user2', 'a')).toBeNull();
      expect(readMapPosition('user1', 'b')).toBeNull();
      for (const raw of ['bad JSON', '{"centerX":null,"centerY":0,"zoom":1}', '{"centerX":0,"centerY":0,"zoom":0.01}', '{"centerX":1e20,"centerY":0,"zoom":1}']) {
        values.set(mapPositionKey('user1', 'a'), raw);
        expect(readMapPosition('user1', 'a')).toBeNull();
      }
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('blocked'); } });
      expect(readMapPosition('user1', 'a')).toBeNull();
      expect(() => rememberMapPosition('user1', 'a', position)).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});
