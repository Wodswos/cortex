type WheelSample = { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; time: number };

/** A wheel stream includes trackpad momentum; lock its axis and page only once until idle. */
export function createWheelPager() {
  let last = -Infinity, x = 0, y = 0;
  let axis: 'x' | 'y' | null = null;
  let paged = false;
  const reset = () => { last = -Infinity; x = 0; y = 0; axis = null; paged = false; };
  return {
    reset,
    sample(event: WheelSample, pageSize: number): { prevent: boolean; direction: -1 | 0 | 1 } {
      if (event.ctrlKey || event.metaKey || event.shiftKey) { reset(); return { prevent: false, direction: 0 }; }
      if (event.time - last > 300) reset();
      last = event.time;
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageSize : 1;
      x += event.deltaX * scale; y += event.deltaY * scale;
      if (!axis && Math.max(Math.abs(x), Math.abs(y)) >= 10) {
        if (Math.abs(x) > Math.abs(y) * 1.35) axis = 'x';
        else if (Math.abs(y) >= Math.abs(x) || Math.max(Math.abs(x), Math.abs(y)) > 40) axis = 'y';
      }
      const prevent = axis === 'x';
      if (!prevent || paged || Math.abs(x) < 72) return { prevent, direction: 0 };
      paged = true;
      return { prevent, direction: x > 0 ? 1 : -1 };
    },
  };
}
