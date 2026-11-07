type Point = { x: number; y: number; time: number };

/** Pan to an edge first; paging requires a new gesture starting at that edge.
 * Returning an explicit scroll position avoids mixing native x scrolling with paging. */
export function createGanttTouchPager(start: Point, scrollLeft: number, maxScroll: number) {
  let axis: 'pending' | 'x' | 'y' = 'pending';
  let finished = false;
  let edge = 0;
  let dx = 0;
  let elapsed = 0;
  const max = Math.max(0, maxScroll);
  const origin = Math.max(0, Math.min(max, scrollLeft));
  // Scroll positions can be fractional; one CSS pixel is visually at the edge.
  const startedAtLeft = origin <= 1;
  const startedAtRight = max - origin <= 1;
  return {
    move(point: Point) {
      dx = point.x - start.x;
      const dy = Math.abs(point.y - start.y);
      elapsed = Math.max(1, point.time - start.time);
      if (!finished && axis === 'pending' && Math.max(Math.abs(dx), dy) >= 12) {
        if (Math.abs(dx) > dy * 1.5) axis = 'x';
        else if (dy >= Math.abs(dx) || Math.max(Math.abs(dx), dy) >= 32) axis = 'y';
      }
      // A clear turn after horizontal lock belongs to scrolling, not a page.
      if (axis === 'x' && dy >= 32 && dy >= Math.abs(dx) * 0.8) axis = 'y';
      if (finished || axis !== 'x') return { captured: false, scrollLeft: origin, edge: 0 };
      const requested = origin - dx;
      const next = Math.max(0, Math.min(max, requested));
      edge = requested - next;
      return { captured: true, scrollLeft: next, edge };
    },
    finish(): -1 | 0 | 1 {
      if (finished) return 0;
      finished = true;
      if (axis !== 'x') return 0;
      if (edge > 0 ? !startedAtRight : !startedAtLeft) return 0;
      const distance = Math.abs(edge);
      const quick = distance >= 32 && elapsed <= 220 && Math.abs(dx) / elapsed >= 0.5;
      return distance >= 56 || quick ? edge > 0 ? 1 : -1 : 0;
    },
  };
}
