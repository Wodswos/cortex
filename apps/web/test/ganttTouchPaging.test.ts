import { describe, expect, it } from 'vitest';
import { createGanttTouchPager } from '../src/features/tasks/gantt/touchPaging';

const point = (x: number, y = 0, time = 400) => ({ x, y, time });
describe('mobile Gantt time navigation', () => {
  it('pages a fitted interval once per deliberate horizontal gesture, in either direction', () => {
    for (const sign of [-1, 1]) {
      const pager = createGanttTouchPager(point(200, 0, 0), 0, 0);
      expect(pager.move(point(200 + sign * 70)).captured).toBe(true);
      expect(pager.finish()).toBe(-sign);
      expect(pager.finish()).toBe(0);
    }
  });
  it('pans a zoomed interval before paging, and counts only movement beyond its edge', () => {
    const pan = createGanttTouchPager(point(300, 0, 0), 0, 300);
    expect(pan.move(point(80)).scrollLeft).toBe(220);
    expect(pan.finish()).toBe(0);
    const edge = createGanttTouchPager(point(300, 0, 0), 250, 300);
    expect(edge.move(point(210))).toEqual({ captured: true, scrollLeft: 300, edge: 40 });
    expect(edge.finish()).toBe(0);
    const next = createGanttTouchPager(point(300, 0, 0), 250, 300);
    next.move(point(190));
    expect(next.finish()).toBe(1);
  });
  it('accepts a clear quick swipe while short slow pulls, vertical and diagonal gestures do not page', () => {
    const quick = createGanttTouchPager(point(200, 0, 0), 0, 0);
    quick.move(point(160, 2, 60));
    expect(quick.finish()).toBe(1);
    for (const end of [point(160, 2), point(195, 80), point(130, 65)]) {
      const pager = createGanttTouchPager(point(200, 0, 0), 0, 0);
      pager.move(end);
      expect(pager.finish()).toBe(0);
    }
    const turn = createGanttTouchPager(point(200, 0, 0), 0, 0);
    expect(turn.move(point(180, 0, 100)).captured).toBe(true);
    expect(turn.move(point(120, 65)).captured).toBe(false);
    expect(turn.finish()).toBe(0);
  });
  it('uses the final finger position, so reversing an edge pull cancels its page', () => {
    const pager = createGanttTouchPager(point(200, 0, 0), 0, 0);
    pager.move(point(110));
    pager.move(point(180));
    expect(pager.finish()).toBe(0);
  });
});
