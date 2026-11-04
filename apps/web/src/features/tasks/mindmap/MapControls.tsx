import { useEffect, useRef } from 'react';
import { Panel, useReactFlow, useStore } from '@xyflow/react';
import { Crosshair, Maximize2, Minus, Plus, SlidersHorizontal, X } from 'lucide-react';
import type { Settings } from '@cortex/core';
import { cn } from '@cortex/ui';
import { DEFAULT_PAN_SPEED, MIN_PAN_SPEED, MAX_PAN_SPEED } from './panSpeed';

type EdgeStyle = Settings['mindEdgeStyle'];
interface MapControlsProps {
  onRoot: () => void;
  edgeStyle: EdgeStyle;
  onEdgeStyleChange: (value: EdgeStyle) => void;
  panSpeed: number;
  onPanSpeedChange: (value: number) => void;
  configOpen: boolean;
  onConfigOpenChange: (value: boolean) => void;
}

/** Subscribe only to zoom so panning does not rerender the map or its task nodes. */
export function MapControls({ onRoot, edgeStyle, onEdgeStyleChange, panSpeed, onPanSpeedChange, configOpen, onConfigOpenChange }: MapControlsProps) {
  const zoom = useStore((state) => state.transform[2]);
  const minZoom = useStore((state) => state.minZoom);
  const maxZoom = useStore((state) => state.maxZoom);
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const percent = Math.round(zoom * 100);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!configOpen) return;
    closeButton.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) onConfigOpenChange(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [configOpen, onConfigOpenChange]);
  const close = () => { onConfigOpenChange(false); trigger.current?.focus(); };
  const buttonClass = 'grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-[var(--surface)] hover:text-foreground disabled:opacity-30';
  return (
    <Panel position="bottom-right" className="!z-30 !m-3">
      <div ref={ref} className="nodrag nopan nowheel relative" onKeyDown={(event) => {
        if (event.key === 'Escape' && configOpen) { event.preventDefault(); event.stopPropagation(); close(); }
      }}>
        <div role="toolbar" aria-label="导图视图控制" className="flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5 shadow-sm">
          <button type="button" aria-label="缩小" title="缩小" className={buttonClass} disabled={zoom <= minZoom} onClick={() => void zoomOut()}><Minus size={15} /></button>
          <button type="button" aria-label="恢复100%缩放" title={`当前缩放 ${percent}%，点击恢复 100%`} onClick={() => void zoomTo(1, { duration: 180 })} className="h-8 min-w-[50px] rounded-md px-1.5 text-xs text-muted hover:bg-[var(--surface)] hover:text-foreground">
            <output aria-label="当前缩放比例" aria-live="off" className="tabular-nums">{percent}%</output>
          </button>
          <button type="button" aria-label="放大" title="放大" className={buttonClass} disabled={zoom >= maxZoom} onClick={() => void zoomIn()}><Plus size={15} /></button>
          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-[var(--border)]" />
          <button type="button" aria-label="根节点" title="回到根节点，恢复可读缩放" className={buttonClass} onClick={onRoot}><Crosshair size={15} /></button>
          <button type="button" aria-label="全局视图" title="显示整张导图" className={buttonClass} onClick={() => void fitView({ padding: 0.18, duration: 300 })}><Maximize2 size={15} /></button>
          <button ref={trigger} type="button" aria-label="导图配置" title="导图配置" aria-expanded={configOpen} aria-controls="mindmap-config" className={cn(buttonClass, configOpen && 'bg-[var(--selection)] text-[var(--accent-solid)]')} onClick={() => onConfigOpenChange(!configOpen)}><SlidersHorizontal size={15} /></button>
        </div>
        {configOpen && <div id="mindmap-config" role="dialog" aria-label="导图配置" aria-modal="false" className="absolute bottom-full right-0 mb-2 max-h-[60vh] w-[min(300px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--background)] p-4 shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-medium">导图配置</span>
            <button ref={closeButton} type="button" aria-label="关闭导图配置" className="rounded p-1 text-muted hover:text-foreground" onClick={close}><X size={15} /></button>
          </div>
          <fieldset>
            <legend className="mb-2 text-xs text-muted">连线样式</legend>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-[var(--surface)] p-1">
              {([['curve', '舒缓'], ['straight', '直线'], ['step', '折线']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={edgeStyle === value} onClick={() => onEdgeStyleChange(value)} className={cn('rounded-md px-2 py-1.5 text-xs transition-colors', edgeStyle === value ? 'bg-[var(--background)] font-medium text-foreground shadow-sm' : 'text-muted hover:text-foreground')}>{label}</button>)}
            </div>
          </fieldset>
          <div className="mt-5 border-t border-[var(--border)] pt-4">
            <label htmlFor="mindmap-pan-speed" className="flex items-center justify-between text-xs text-muted">
              平移速度 <output aria-label="当前平移速度" className="tabular-nums text-foreground">{Number(panSpeed.toFixed(2))}×</output>
            </label>
            <input id="mindmap-pan-speed" aria-label="平移速度" aria-valuetext={`${Number(panSpeed.toFixed(2))} 倍`} type="range" min={MIN_PAN_SPEED} max={MAX_PAN_SPEED} step={0.25} value={panSpeed} onChange={(event) => onPanSpeedChange(Number(event.target.value))} className="my-3 block w-full accent-[var(--accent-solid)]" />
            <div className="flex items-center justify-between text-[10px] text-muted"><span>慢 · 0.5×</span><span>快 · 3×</span></div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted">调整双指滑动或滚轮平移的速度，自动记住当前浏览器的选择。</p>
            <button type="button" aria-label="恢复默认平移速度" onClick={() => onPanSpeedChange(DEFAULT_PAN_SPEED)} className="mt-2 text-xs text-muted underline underline-offset-2 hover:text-foreground">恢复默认</button>
          </div>
        </div>}
      </div>
    </Panel>
  );
}
