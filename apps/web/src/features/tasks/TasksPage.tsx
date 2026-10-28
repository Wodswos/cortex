import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { cn, Segmented, SegmentedList, SegmentedTrigger } from '@cortex/ui';
import {
  ListTodo,
  LayoutGrid,
  GitBranch,
  CalendarRange,
  GanttChartSquare,
  Library,
  Check,
  ChevronDown,
} from 'lucide-react';
import { useCortex, useCortexData } from '@cortex/crdt';
const ListView = lazy(() => import('./list/ListView').then((module) => ({ default: module.ListView })));
const MatrixView = lazy(() =>
  import('./matrix/MatrixView').then((module) => ({ default: module.MatrixView })),
);
const MindMapView = lazy(() =>
  import('./mindmap/MindMapView').then((module) => ({ default: module.MindMapView })),
);
const TimelineView = lazy(() =>
  import('./timeline/TimelineView').then((module) => ({ default: module.TimelineView })),
);
const GanttView = lazy(() => import('./gantt/GanttView').then((module) => ({ default: module.GanttView })));

const VIEWS = [
  { key: 'list', label: '列表', icon: ListTodo },
  { key: 'timeline', label: '时间线', icon: CalendarRange },
  { key: 'gantt', label: '甘特', icon: GanttChartSquare },
  { key: 'matrix', label: '四象限', icon: LayoutGrid },
  { key: 'mindmap', label: '导图', icon: GitBranch },
] as const;

type ViewKey = (typeof VIEWS)[number]['key'];

const COMPLETED_OPTIONS = [
  { key: 'inline-gray', label: '显示为灰色' },
  { key: 'hidden', label: '隐藏' },
] as const;

/** 已完成项展现形式:下拉选择(原位变灰 / 隐藏),按钮文案随当前模式变化 */
function CompletedDisplaySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: 'inline-gray' | 'hidden') => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted transition-colors hover:text-foreground"
        title="已完成 Task 的展现形式"
      >
        <Check className="h-3.5 w-3.5" />
        {value === 'hidden' ? '隐藏已完成' : '显示已完成'}
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 min-w-[150px] rounded-xl glass-raised p-1.5 shadow-xl">
          {COMPLETED_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => {
                onChange(o.key);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                value === o.key
                  ? 'bg-[color-mix(in_srgb,var(--accent-from)_14%,transparent)] text-foreground'
                  : 'text-muted hover:text-foreground hover:bg-[var(--surface)]',
              )}
            >
              <span className="grid h-3 w-3 place-items-center">
                {value === o.key && <Check className="h-3 w-3 text-[var(--accent-from)]" />}
              </span>
              <span>已完成项{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TasksPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('view');
  const scope = params.get('scope');
  const view = VIEWS.some((value) => value.key === requested)
    ? (requested as ViewKey)
    : scope === 'week' ? 'gantt' : 'list';
  const data = useCortexData();
  const store = useCortex();
  const projectId = params.get('project');
  const project = data.tasks.find((task) => task.id === projectId);
  const title = project?.title || (scope === 'today' ? '今天' : scope === 'week' ? '本周' : '全部任务');
  const display = data.settings.completedDisplay ?? 'inline-gray';

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border)] px-5 py-3 lg:px-7">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">{title}</h1>
        <Segmented
          value={view}
          onValueChange={(v) => {
            const next = new URLSearchParams(params);
            next.set('view', v);
            setParams(next, { replace: true });
          }}
        >
          <SegmentedList>
            {VIEWS.map(({ key, label, icon: Icon }) => (
              <SegmentedTrigger
                key={key}
                value={key}
                className="inline-flex items-center justify-center gap-1.5 px-2.5 text-xs md:px-3 md:text-xs"
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">{label}</span>
              </SegmentedTrigger>
            ))}
          </SegmentedList>
        </Segmented>

        {/* 右上角:已完成任务展现 + Gallery 入口 */}
        <div className="flex items-center gap-2">
          <CompletedDisplaySelect
            value={display}
            onChange={(v) => store.updateSettings({ completedDisplay: v })}
          />
          <Link
            to="/gallery"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted transition-colors hover:text-foreground"
            title="Gallery 精选路线图"
          >
            <Library className="h-3.5 w-3.5" /> 模板
          </Link>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div role="status" className="p-6 text-sm text-muted">
              正在载入视图…
            </div>
          }
        >
          {view === 'list' && <ListView />}
          {view === 'timeline' && <TimelineView />}
          {view === 'gantt' && <GanttView />}
          {view === 'matrix' && <MatrixView />}
          {view === 'mindmap' && <MindMapView />}
        </Suspense>
      </div>
    </div>
  );
}
