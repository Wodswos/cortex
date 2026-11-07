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
  it('only pans when the gesture reaches an edge from within the interval, even if pulled far or fast', () => {
    const pan = createGanttTouchPager(point(300, 0, 0), 0, 300);
    expect(pan.move(point(80)).scrollLeft).toBe(220);
    expect(pan.finish()).toBe(0);
    const edge = createGanttTouchPager(point(300, 0, 0), 250, 300);
    expect(edge.move(point(210))).toEqual({ captured: true, scrollLeft: 300, edge: 40 });
    expect(edge.finish()).toBe(0);
    for (const [origin, destination] of [[250, 100], [50, 500]]) {
      for (const time of [60, 400]) {
        const first = createGanttTouchPager(point(300, 0, 0), origin, 300);
        const result = first.move(point(destination, 0, time));
        expect(result.scrollLeft).toBe(destination < 300 ? 300 : 0);
        expect(first.finish()).toBe(0);
      }
    }
  });
  it('pages only after a new gesture starts at the corresponding edge', () => {
    for (const [origin, destination, direction] of [[300, 190, 1], [0, 410, -1]]) {
      const next = createGanttTouchPager(point(300, 0, 0), origin, 300);
      next.move(point(destination));
      expect(next.finish()).toBe(direction);
    }
    // Starting at one edge does not authorize crossing the entire other edge.
    for (const [origin, destination] of [[0, -100], [300, 700]]) {
      const crossing = createGanttTouchPager(point(300, 0, 0), origin, 300);
      crossing.move(point(destination, 0, 60));
      expect(crossing.finish()).toBe(0);
    }
  });
  it('allows fractional edge rounding without treating an interior offset as an edge', () => {
    for (const [origin, destination, expected] of [[0.5, 400, -1], [299.5, 200, 1], [1.5, 400, 0], [298.5, 200, 0]]) {
      const pager = createGanttTouchPager(point(300, 0, 0), origin, 300);
      pager.move(point(destination));
      expect(pager.finish()).toBe(expected);
    }
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
