type Point = { x: number; y: number; time: number };

export const SIDEBAR_SWIPE_DISTANCE = 48;
const FLICK_DISTANCE = 24;

/** Lock by direction, rather than cancelling every small vertical wobble. */
export function createSidebarSwipe(start: Point, opening: boolean, width: number) {
  let axis: 'pending' | 'horizontal' | 'cancelled' = 'pending';
  let distance = 0;
  let duration = 0;
  return {
    move(point: Point) {
      const dx = (point.x - start.x) * (opening ? 1 : -1);
      const dy = Math.abs(point.y - start.y);
      duration = Math.max(0, point.time - start.time);
      if (dx < -12 || dy > Math.max(72, Math.abs(dx) * 1.4)) axis = 'cancelled';
      if (axis === 'pending') {
        if (dy >= 16 && dy > Math.abs(dx) * 1.25) axis = 'cancelled';
        else if (dx >= 10 && dx > dy * 1.15) axis = 'horizontal';
      }
      distance = Math.max(0, Math.min(width, dx));
      const progress = opening ? distance / width : 1 - distance / width;
      return { dragging: axis === 'horizontal', cancelled: axis === 'cancelled', progress, offset: opening ? distance - width : -distance };
    },
    shouldCommit() {
      const flick = distance >= FLICK_DISTANCE && duration >= 32 && duration <= 260 && distance / duration >= 0.35;
      return axis === 'horizontal' && (distance >= SIDEBAR_SWIPE_DISTANCE || flick);
    },
  };
}
