export const TASK_SHEET_PULL_THRESHOLD = 96;
export const TASK_SHEET_PULL_SETTLE_MS = 180;
interface Point { x: number; y: number }

/** Only movement after reaching the scroll boundary counts towards dismissal.
 * Native scrolling owns the rest of the touch sequence, including nested panes. */
export function createTaskSheetPull(start: Point, initiallyAtTop: boolean) {
  let anchor = start;
  let atTop = initiallyAtTop;
  let axis: 'pending' | 'horizontal' | 'vertical' = 'pending';
  let distance = 0;
  let pulling = false;
  return {
    move(point: Point, nowAtTop: boolean) {
      const dx = Math.abs(point.x - start.x), dy = Math.abs(point.y - start.y);
      if (axis === 'pending' && Math.max(dx, dy) >= 8) {
        if (dx > dy * 1.2) axis = 'horizontal';
        else if (dy > dx * 1.2) axis = 'vertical';
      }
      if (!nowAtTop || !atTop) {
        anchor = point;
        atTop = nowAtTop;
        distance = 0;
        pulling = false;
      } else if (axis !== 'horizontal') {
        distance = Math.max(0, point.y - anchor.y);
        if (point.y < anchor.y) anchor = point;
        if (axis === 'vertical' && distance >= 8) pulling = true;
      }
      if (axis === 'horizontal') { distance = 0; pulling = false; }
      const offset = Math.min(240, distance <= 120 ? distance * 0.8 : 96 + (distance - 120) * 0.35);
      return { pulling, offset: pulling ? offset : 0 };
    },
    shouldDismiss: () => pulling && distance >= TASK_SHEET_PULL_THRESHOLD,
  };
}
