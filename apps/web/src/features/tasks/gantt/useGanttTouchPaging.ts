import { useEffect, useRef, type RefObject } from 'react';
import { addDays } from '@cortex/core';
import type { TaskWindow } from '../taskWindow';
import { createGanttTouchPager } from './touchPaging';

const ownGestures = '[data-gantt-bar],button,a,input,textarea,select,[role="separator"],[contenteditable]:not([contenteditable="false"])';

export function useGanttTouchPaging(elementRef: RefObject<HTMLDivElement>, mobile: boolean, projectId: string | null,
  range: TaskWindow, setRange: (start: number, days: number) => void, blocked: boolean) {
  const context = useRef({ range, setRange, blocked });
  context.current = { range, setRange, blocked };
  useEffect(() => {
    const element = elementRef.current;
    if (!mobile || !element) return;
    let pager: ReturnType<typeof createGanttTouchPager> | null = null;
    let id: number | null = null;
    const cancel = () => { pager = null; id = null; element.removeAttribute('data-gantt-panning'); };
    const isCurrent = () => {
      const params = new URLSearchParams(window.location.search);
      return window.location.pathname === '/tasks' && params.get('view') === 'gantt' && params.get('project') === projectId;
    };
    const start = (event: TouchEvent) => {
      cancel();
      if (event.defaultPrevented || event.touches.length !== 1 || context.current.blocked || !isCurrent() || window.getSelection()?.toString()) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(ownGestures)) return;
      const touch = event.touches[0]!;
      id = touch.identifier;
      pager = createGanttTouchPager({ x: touch.clientX, y: touch.clientY, time: performance.now() }, element.scrollLeft, element.scrollWidth - element.clientWidth);
    };
    const move = (event: TouchEvent) => {
      if (!pager) return;
      if (event.touches.length !== 1 || context.current.blocked || !isCurrent()) { cancel(); return; }
      const touch = Array.from(event.touches).find(item => item.identifier === id);
      if (!touch) { cancel(); return; }
      const next = pager.move({ x: touch.clientX, y: touch.clientY, time: performance.now() });
      if (!next.captured) return;
      if (event.cancelable) event.preventDefault();
      element.scrollLeft = next.scrollLeft;
      element.setAttribute('data-gantt-panning', 'true');
    };
    const end = (event: TouchEvent) => {
      if (!pager) return;
      const touch = Array.from(event.changedTouches).find(item => item.identifier === id);
      if (!touch || event.touches.length || context.current.blocked || !isCurrent()) { cancel(); return; }
      const next = pager.move({ x: touch.clientX, y: touch.clientY, time: performance.now() });
      if (next.captured) {
        if (event.cancelable) event.preventDefault();
        element.scrollLeft = next.scrollLeft;
      }
      const direction = pager.finish();
      cancel();
      if (direction) {
        const { range: current, setRange: change } = context.current;
        change(addDays(current.start, current.days * direction).getTime(), current.days);
        element.scrollLeft = 0;
      }
    };
    element.addEventListener('touchstart', start, { passive: true });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end, { passive: false });
    element.addEventListener('touchcancel', cancel);
    return () => {
      cancel();
      element.removeEventListener('touchstart', start);
      element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', cancel);
    };
  }, [elementRef, mobile, projectId]);
}
