import React, { useEffect, useRef, useState } from 'react';

const MIN = 192;
const MAX = 360;
const DEFAULT = 224;
const KEY = 'cortex:sidebar-width';
const clamp = (width: number) => Math.round(Math.max(MIN, Math.min(MAX, width)));

export function useSidebarWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(KEY));
      return Number.isFinite(saved) && saved >= MIN ? clamp(saved) : DEFAULT;
    } catch { return DEFAULT; }
  });
  useEffect(() => {
    try { localStorage.setItem(KEY, String(width)); } catch { /* Keep working without storage. */ }
  }, [width]);
  return { width, setWidth };
}

export function SidebarResize({ width, onChange }: { width: number; onChange: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      role="separator"
      aria-label="调整侧边栏宽度"
      aria-orientation="vertical"
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={width}
      aria-valuetext={`${width} 像素`}
      tabIndex={0}
      title="拖动调整宽度，双击恢复默认；方向键微调"
      className="absolute inset-y-0 -right-1 z-30 hidden w-2 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 hover:after:bg-[var(--accent-solid)] focus-visible:after:bg-[var(--accent-solid)] focus-visible:outline-none md:block"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current) onChange(clamp(drag.current.width + event.clientX - drag.current.x));
      }}
      onPointerUp={(event) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onDoubleClick={() => onChange(DEFAULT)}
      onKeyDown={(event) => {
        const next = event.key === 'ArrowLeft' ? width - (event.shiftKey ? 32 : 8)
          : event.key === 'ArrowRight' ? width + (event.shiftKey ? 32 : 8)
            : event.key === 'Home' ? MIN : event.key === 'End' ? MAX : null;
        if (next == null) return;
        event.preventDefault();
        onChange(clamp(next));
      }}
    />
  );
}
