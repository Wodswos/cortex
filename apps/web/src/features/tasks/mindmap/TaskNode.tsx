import React, { useEffect, useLayoutEffect, useRef, useState, memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { isStructural, priorityOf, type MindFont, type Task } from '@cortex/core';
import { useCortex } from '@cortex/crdt';
import { cn } from '@cortex/ui';
import { useUI } from '@/state/ui';
import { TaskCheckbox } from '@/shared/components';
import { branchColor, mindColor, titleAppearance } from './appearance';
import { VIRTUAL_ROOT_ID, type BranchSide, type MindMetrics } from './layout';

export interface MindNodeData extends Record<string, unknown> {
  task: Task; depth: number; side: BranchSide; branch: number; metrics: MindMetrics;
  font?: MindFont | null;
  progress: { done: number; total: number };
  hasChildren: boolean; signalLabel?: string; attention?: boolean; muted: boolean;
  editing: boolean; seedChar?: string | null;
  dropHint?: 'child' | 'before' | 'after';
  onCommit?: (title: string) => void;
  onRefocus?: () => void;
}
const handleStyle: React.CSSProperties = { opacity: 0, width: 0, height: 0, minWidth: 0, minHeight: 0, border: 0 };

export const TaskNode = memo(function TaskNode({ data, selected }: NodeProps<Node<MindNodeData>>) {
  const { task, depth, branch, side, metrics, progress, hasChildren, editing, seedChar, dropHint, onCommit, onRefocus } = data;
  const store = useCortex();
  const collapsed = useUI((state) => !!state.collapsed[task.id]);
  const toggleCollapsed = useUI((state) => state.toggleCollapsed);
  const virtual = task.id === VIRTUAL_ROOT_ID;
  const structural = virtual || isStructural(task);
  const root = depth === 0;
  const color = branchColor(branch);
  const titleStyle = titleAppearance(task, depth, data.font);
  const [draft, setDraft] = useState(task.title);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    if (!editing) return;
    finished.current = false;
    setDraft(seedChar ?? task.title);
    const focus = () => { if (inputRef.current && document.activeElement !== inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } };
    focus(); const frame = requestAnimationFrame(focus); const timer = setTimeout(focus, 60);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [editing, seedChar]);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input) { input.style.height = '0px'; input.style.height = `${input.scrollHeight}px`; }
  }, [draft, editing]);
  const finish = (title = draft) => { if (!finished.current) { finished.current = true; onCommit?.(title); } };
  const priority = priorityOf(task);
  const background = mindColor(task.mindBackground, true) ?? (root ? 'var(--mind-root)' : depth === 1 || structural ? `color-mix(in srgb, ${color} ${depth === 1 ? '10%' : '5%'}, var(--background))` : 'var(--background)');
  const footer = progress.total > 0 || !!data.signalLabel;
  return (
    <div
      data-mind-kind={root ? 'root' : depth === 1 ? 'main' : structural ? 'group' : 'task'}
      data-mind-depth={depth}
      data-mind-side={side}
      data-mind-muted={data.muted && !selected ? 'true' : 'false'}
      className={cn('group mind-node relative rounded-xl border', selected && 'mind-node-selected', task.status === 'done' && 'mind-node-done')}
      style={{
        width: metrics.width, padding: `${metrics.padY}px ${metrics.padX}px`, background,
        borderColor: root ? 'var(--mind-root)' : depth === 1 ? `color-mix(in srgb, ${color} 30%, var(--border))` : 'var(--border)',
        color: root && !task.mindBackground ? 'var(--mind-root-text)' : 'var(--foreground)',
        opacity: data.muted && !selected ? 0.3 : task.status === 'done' ? 0.65 : 1,
        boxShadow: root ? '0 4px 14px rgb(0 0 0 / 0.06)' : undefined,
        outline: dropHint ? `2px ${dropHint === 'child' ? 'dashed' : 'solid'} var(--accent-solid)` : undefined,
        outlineOffset: dropHint ? 5 : undefined,
      }}
    >
      {(['left', 'right'] as const).flatMap((position) => (['source', 'target'] as const).map((type) => <Handle key={`${type}-${position}`} id={`${type}-${position}`} type={type} position={position === 'left' ? Position.Left : Position.Right} isConnectable={false} style={{ ...handleStyle, [position]: -1 }} />))}
      {hasChildren && <button
        aria-label={`${collapsed ? '展开' : '折叠'} ${task.title} 的子项`}
        title={collapsed ? '展开子级' : '收起子级'}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); toggleCollapsed(task.id); }}
        className={cn('nodrag nopan absolute -bottom-2 z-10 grid h-5 w-5 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--background)] text-muted shadow-sm hover:text-foreground focus-visible:opacity-100', side === 'left' && !root ? '-left-2' : '-right-2', !collapsed && 'opacity-0 group-hover:opacity-100')}
      >{collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</button>}
      {dropHint && <span className="pointer-events-none absolute -top-7 left-0 z-20 whitespace-nowrap rounded-md bg-[var(--accent-solid)] px-2 py-1 text-[10px] text-white">{virtual ? '升为根任务' : dropHint === 'child' ? '挂到它下面' : dropHint === 'before' ? '插到它前面' : '插到它后面'}</span>}
      {!structural && priority !== 'P3' && <span title={`优先级 ${priority}`} className="pointer-events-none absolute right-2 top-2 h-1.5 w-1.5 rounded-full" style={{ background: `var(--${priority.toLowerCase()})` }} />}
      <div className="flex items-start gap-2">
        {!structural && <span className="nodrag nopan mt-0.5 shrink-0" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}><TaskCheckbox done={task.status === 'done'} onChange={() => store.toggleTaskDone(task.id)} className="!h-4 !w-4" /></span>}
        {editing ? <textarea
          ref={inputRef} aria-label="导图节点标题" placeholder="输入标题…" rows={1} value={draft}
          className="nodrag nopan block min-w-0 flex-1 cursor-text resize-none overflow-hidden bg-transparent p-0 outline-none"
          style={{ ...titleStyle, color: titleStyle.color ?? 'inherit' }}
          onChange={(event) => setDraft(event.target.value)} onBlur={() => finish()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation(); if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish(); onRefocus?.(); }
            else if (event.key === 'Escape') { event.preventDefault(); finish(task.title); onRefocus?.(); }
          }}
        /> : <span data-mind-title className={cn('min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]', task.status === 'done' && 'line-through')} style={titleStyle}>{task.title || '未命名'}</span>}
      </div>
      {footer && <div className={cn('mt-1.5 flex min-h-[15px] items-center gap-2 text-[10px] leading-[15px]', !structural && 'pl-6')} style={{ color: root && !task.mindBackground ? 'var(--mind-root-muted)' : 'var(--muted-foreground)' }}>
        {progress.total > 0 && <span className="shrink-0 tabular-nums">{progress.done}/{progress.total} 完成</span>}
        {data.signalLabel && <span className="min-w-0 truncate" style={{ color: data.attention ? 'var(--mind-warning)' : undefined }}>{data.signalLabel}</span>}
      </div>}
    </div>
  );
});
