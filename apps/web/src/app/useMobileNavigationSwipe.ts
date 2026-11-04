import { useEffect, type RefObject } from 'react';
import { createSidebarSwipe } from './sidebarSwipe';

const controls = 'button,a,input,textarea,select,label,[contenteditable]:not([contenteditable="false"]),[tabindex]:not([tabindex="-1"]),[role="button"],[role="dialog"],[role="slider"],[role="separator"],[draggable="true"],[data-row],[data-habit-row],[data-inspector],[data-destructive-dialog],[data-sidebar-swipe-ignore],[data-gantt-scroll],[data-calendar-week-date],[data-calendar-event],.react-flow,.xterm,svg,canvas,img,video';

function blankTarget(target: EventTarget | null, frame: HTMLElement, open: boolean) {
  if (!(target instanceof HTMLElement)) return false;
  if (open && target.matches('.workspace-navigation-backdrop')) return true;
  if (!target.closest(open ? '.workspace-sidebar' : 'main,header') || target.closest(controls)) return false;
  if ([...target.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())) return false;
  for (let element: HTMLElement | null = target; element && element !== frame; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (['auto', 'scroll'].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 1) return false;
    if (style.touchAction === 'none' || /\bpan-(x|left|right)\b/.test(style.touchAction)) return false;
  }
  return true;
}

/** Touch events continue through native pointer cancellation. Paint the drawer
 * directly while dragging, and let the existing CSS transition settle it. */
export function useMobileNavigationSwipe(frameRef: RefObject<HTMLDivElement>, enabled: boolean, open: boolean, onOpenChange: (value: boolean) => void) {
  useEffect(() => {
    const frame = frameRef.current;
    const drawer = frame?.querySelector<HTMLElement>('.workspace-sidebar');
    const backdrop = frame?.querySelector<HTMLElement>('.workspace-navigation-backdrop');
    if (!enabled || !frame || !drawer || !backdrop) return;
    let gesture: ReturnType<typeof createSidebarSwipe> | null = null;
    let touchId: number | null = null;
    let dragging = false;
    const clearPaint = () => {
      drawer.removeAttribute('data-sidebar-dragging');
      backdrop.removeAttribute('data-sidebar-dragging');
      drawer.style.removeProperty('--sidebar-swipe-x');
      backdrop.style.removeProperty('--sidebar-swipe-opacity');
    };
    const cancel = () => { gesture = null; touchId = null; dragging = false; clearPaint(); };
    const start = (event: TouchEvent) => {
      cancel();
      if (event.defaultPrevented || !window.matchMedia('(width < 48rem)').matches || event.touches.length !== 1 || window.getSelection()?.toString() || !blankTarget(event.target, frame, open)) return;
      const touch = event.touches[0]!;
      touchId = touch.identifier;
      gesture = createSidebarSwipe({ x: touch.clientX, y: touch.clientY, time: event.timeStamp }, !open, drawer.getBoundingClientRect().width);
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1 || window.getSelection()?.toString()) { cancel(); return; }
      const touch = [...event.touches].find(item => item.identifier === touchId);
      if (!touch) { cancel(); return; }
      const sample = gesture.move({ x: touch.clientX, y: touch.clientY, time: event.timeStamp });
      if (sample.cancelled) { cancel(); return; }
      if (!sample.dragging) return;
      dragging = true;
      if (event.cancelable) event.preventDefault();
      drawer.style.setProperty('--sidebar-swipe-x', `${sample.offset}px`);
      backdrop.style.setProperty('--sidebar-swipe-opacity', String(sample.progress));
      drawer.setAttribute('data-sidebar-dragging', '');
      backdrop.setAttribute('data-sidebar-dragging', '');
    };
    const end = (event: TouchEvent) => {
      if (!gesture) return;
      const touch = [...event.changedTouches].find(item => item.identifier === touchId);
      if (!touch || event.touches.length) { cancel(); return; }
      const sample = gesture.move({ x: touch.clientX, y: touch.clientY, time: event.timeStamp });
      const commit = gesture.shouldCommit();
      if ((dragging || sample.dragging) && event.cancelable) event.preventDefault();
      // Preserve the last painted position as the transition's starting point.
      if (dragging) void drawer.getBoundingClientRect();
      if (commit) onOpenChange(!open);
      cancel();
    };
    frame.addEventListener('touchstart', start, { passive: true });
    frame.addEventListener('touchmove', move, { passive: false });
    frame.addEventListener('touchend', end, { passive: false });
    frame.addEventListener('touchcancel', cancel);
    return () => {
      frame.removeEventListener('touchstart', start);
      frame.removeEventListener('touchmove', move);
      frame.removeEventListener('touchend', end);
      frame.removeEventListener('touchcancel', cancel);
      cancel();
    };
  }, [frameRef, enabled, open, onOpenChange]);
}
