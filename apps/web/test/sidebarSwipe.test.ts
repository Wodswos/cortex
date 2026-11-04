import { describe, expect, it } from 'vitest';
import { createSidebarSwipe } from '../src/app/sidebarSwipe';

describe('mobile sidebar swipe', () => {
  it('tracks a slightly diagonal finger movement and opens after 48 pixels', () => {
    const swipe = createSidebarSwipe({ x: 10, y: 100, time: 0 }, true, 224);
    expect(swipe.move({ x: 34, y: 118, time: 100 })).toMatchObject({ dragging: true, cancelled: false, offset: -200 });
    expect(swipe.shouldCommit()).toBe(false);
    expect(swipe.move({ x: 65, y: 135, time: 400 })).toMatchObject({ dragging: true, cancelled: false, offset: -169 });
    expect(swipe.shouldCommit()).toBe(true);
  });
  it('recognizes a deliberate short flick and allows a slower full-distance swipe', () => {
    const flick = createSidebarSwipe({ x: 0, y: 0, time: 0 }, true, 224);
    flick.move({ x: 28, y: 4, time: 60 });
    expect(flick.shouldCommit()).toBe(true);
    const slow = createSidebarSwipe({ x: 0, y: 0, time: 0 }, true, 224);
    slow.move({ x: 80, y: 20, time: 1200 });
    expect(slow.shouldCommit()).toBe(true);
  });
  it('leaves vertical scrolling and reverse-direction movement alone', () => {
    const vertical = createSidebarSwipe({ x: 0, y: 0, time: 0 }, true, 224);
    expect(vertical.move({ x: 6, y: 18, time: 100 }).cancelled).toBe(true);
    expect(vertical.move({ x: 100, y: 20, time: 200 }).dragging).toBe(false);
    expect(vertical.shouldCommit()).toBe(false);
    const reverse = createSidebarSwipe({ x: 0, y: 0, time: 0 }, true, 224);
    expect(reverse.move({ x: -30, y: 0, time: 100 }).cancelled).toBe(true);
    expect(reverse.shouldCommit()).toBe(false);
  });
  it('rebounds a short pull or a pull reversed before lifting the finger', () => {
    const swipe = createSidebarSwipe({ x: 0, y: 0, time: 0 }, true, 224);
    swipe.move({ x: 30, y: 4, time: 300 });
    expect(swipe.shouldCommit()).toBe(false);
    swipe.move({ x: 100, y: 4, time: 500 });
    expect(swipe.shouldCommit()).toBe(true);
    swipe.move({ x: 18, y: 4, time: 700 });
    expect(swipe.shouldCommit()).toBe(false);
  });
  it('supports left swipes to close and clamps the surface at its final edge', () => {
    const swipe = createSidebarSwipe({ x: 200, y: 100, time: 0 }, false, 224);
    expect(swipe.move({ x: 140, y: 110, time: 300 })).toMatchObject({ dragging: true, offset: -60 });
    expect(swipe.shouldCommit()).toBe(true);
    expect(swipe.move({ x: -100, y: 110, time: 400 }).offset).toBe(-224);
  });
});
