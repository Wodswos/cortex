import { describe, it, expect } from 'vitest';
import { GALLERIES, buildImportTasks, countNodes } from '../src/gallery';

describe('gallery', () => {
  it('只预置分布式系统一个领域', () => {
    expect(GALLERIES.map((g) => g.id)).toEqual(['distributed-systems']);
  });

  it('buildImportTasks:DFS 先序、父先于子、兄弟 order 递增', () => {
    const g = GALLERIES[0];
    const rootKey = 'container-1';
    const items = buildImportTasks(g.tree, rootKey);

    // 顶级节点 parentKey = rootKey
    const topLevel = items.filter((i) => i.parentKey === rootKey);
    expect(topLevel.length).toBe(g.tree.length);
    for (const [i, t] of topLevel.entries()) {
      expect(t.order).toBe(i * 1000);
    }

    // 每个节点的 key 都能唯一标识自己;内部节点的 parentKey 指向一个存在的父 key
    const keys = new Set(items.map((i) => i.key));
    expect(keys.size).toBe(items.length);
    for (const it of items.slice(1)) {
      expect(it.parentKey === rootKey || keys.has(it.parentKey)).toBe(true);
    }

    // 无孤儿:没有节点以自身为父
    for (const it of items) {
      expect(it.parentKey).not.toBe(it.key);
    }
  });

  it('countNodes 与展开条目数一致', () => {
    for (const g of GALLERIES) {
      expect(buildImportTasks(g.tree, 'r').length).toBe(countNodes(g.tree));
    }
  });
});