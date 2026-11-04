import React, { useEffect, useRef, useState } from 'react';

export const GANTT_MOBILE_NAME_DEFAULT = 128;
const MIN = 104;
const MAX = 208;
const KEY = 'cortex:gantt-mobile-name-width';
const clamp = (width: number) => Math.round(Math.max(MIN, Math.min(MAX, width)));

export function useGanttNameWidth() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(width < 48rem)').matches);
  const [width, setWidth] = useState(() => {
    try {
      const value = Number(localStorage.getItem(KEY));
      return Number.isFinite(value) && value >= MIN ? clamp(value) : GANTT_MOBILE_NAME_DEFAULT;
    } catch { return GANTT_MOBILE_NAME_DEFAULT; }
  });
  useEffect(() => {
    const media = window.matchMedia('(width < 48rem)');
    const change = () => setMobile(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    try { localStorage.setItem(KEY, String(width)); } catch { /* Keep the local preference in memory. */ }
  }, [width]);
  return { mobile, width: mobile ? width : 208, setWidth: (value: number) => setWidth(clamp(value)) };
}

export function GanttNameResize({ width, onChange }: { width: number; onChange: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const update = (event: React.PointerEvent) => {
    if (drag.current) onChange(drag.current.width + event.clientX - drag.current.x);
  };
  return <div
    role="separator"
    aria-label="调整甘特图任务列宽度"
    aria-orientation="vertical"
    aria-valuemin={MIN}
    aria-valuemax={MAX}
    aria-valuenow={width}
    aria-valuetext={`${width} 像素`}
    tabIndex={0}
    title="拖动调整任务列宽度，双击恢复默认；方向键微调"
    className="absolute inset-y-0 -right-2.5 z-30 w-5 cursor-col-resize touch-none select-none after:absolute after:inset-y-2 after:left-1/2 after:w-0.5 after:rounded after:bg-[var(--border-strong)] hover:after:bg-[var(--accent-solid)] focus-visible:after:bg-[var(--accent-solid)] focus-visible:outline-none md:hidden"
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.focus();
      drag.current = { x: event.clientX, width };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={update}
    onPointerUp={event => {
      update(event);
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }}
    onDoubleClick={() => onChange(GANTT_MOBILE_NAME_DEFAULT)}
    onKeyDown={event => {
      const next = event.key === 'ArrowLeft' ? width - (event.shiftKey ? 24 : 8)
        : event.key === 'ArrowRight' ? width + (event.shiftKey ? 24 : 8)
          : event.key === 'Home' ? MIN : event.key === 'End' ? MAX : null;
      if (next == null) return;
      event.preventDefault(); onChange(next);
    }}
  />;
}
