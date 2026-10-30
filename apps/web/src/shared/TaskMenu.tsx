import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Plus, CircleDot, Info, Trash2, Shapes } from 'lucide-react';
import { cn } from '@cortex/ui';
import { addDays, endOfDay, newOrder, PRIORITY_META, PRIORITY_ORDER, Priority, isStructural, isProject } from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { useUI } from '@/state/ui';

const TIME_OPTIONS: { label: string; apply: (now: Date) => number | null }[] = [
  { label: '今天', apply: (now) => endOfDay(now).getTime() - 60000 },
  { label: '明天', apply: (now) => endOfDay(addDays(now, 1)).getTime() - 60000 },
  { label: '未来 7 天内', apply: (now) => endOfDay(addDays(now, 7)).getTime() - 60000 },
  { label: '清除日期', apply: () => null },
];

export function TaskMenu() {
  const data = useCortexData();
  const store = useCortex();
  const ui = useUI();
  const menu = ui.taskMenu;
  const [sub, setSub] = useState<'main' | 'time' | 'priority'>('main');
  /** 级联子菜单的落点(悬停到条目时按其 rect 计算:右侧优先,放不下翻左侧) */
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null);
  const closeTimer = useRef<number | null>(null);

  const cancelCloseSub = () => {
    if (closeTimer.current != null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  /** 离开菜单主体/子菜单一小段宽限期后才收起(鼠标跨过 4px 缝隙不算离开) */
  const scheduleCloseSub = () => {
    cancelCloseSub();
    closeTimer.current = window.setTimeout(() => { setSub('main'); setSubPos(null); }, 160);
  };
  const openSub = (which: 'time' | 'priority', el: HTMLElement) => {
    cancelCloseSub();
    const SW = 176, SH = 240;
    const r = el.getBoundingClientRect();
    // 锚定主面板边缘(而非条目边缘),与面板齐平无缝隙;右侧优先,放不下翻左侧
    const panel = el.closest('.glass-raised')?.getBoundingClientRect();
    let left = (panel?.right ?? r.right) + 4;
    if (left + SW > window.innerWidth - 8) left = Math.max(8, (panel?.left ?? r.left) - SW - 4);
    let top = r.top - 6; // 与被悬停条目顶部对齐
    top = Math.max(8, Math.min(top, window.innerHeight - SH - 8));
    setSub(which);
    setSubPos({ left, top });
  };
  const clearSub = () => { cancelCloseSub(); setSub('main'); setSubPos(null); };

  // 每次打开都回到主菜单
  useEffect(() => {
    if (menu) { clearSub(); }
  }, [menu]);
  useEffect(() => cancelCloseSub, []);

  // Escape 关闭
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ui.closeTaskMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, ui]);

  if (!menu) return null;
  const task = data.tasks.find((t) => t.id === menu.taskId);
  if (!task) return null;

  // 批量目标:右键时若已多选 → 操作作用于整批;否则仅当前任务
  const ids = menu.ids ?? [task.id];
  const multi = ids.length > 1;
  const structural = isStructural(task); // 结构节点:菜单里不给时间/优先级,给「转回 TODO」
  const project = isProject(task);
  const mutate = (patch: Parameters<typeof store.updateTask>[1]) =>
    ids.forEach((id) => store.updateTask(id, { ...patch }));

  // 视图越界修正
  const W = 232, H = 240;
  const x = Math.min(menu.x, typeof window !== 'undefined' ? window.innerWidth - W - 8 : menu.x);
  const y = Math.min(menu.y, typeof window !== 'undefined' ? window.innerHeight - H - 8 : menu.y);

  // id → 直接子 id 映射(用于折叠/展开整棵子树)
  const childrenIds = new Map<string, string[]>();
  for (const t of data.tasks) {
    if (t.parentId == null || t.deletedAt) continue;
    const arr = childrenIds.get(t.parentId);
    if (arr) arr.push(t.id);
    else childrenIds.set(t.parentId, [t.id]);
  }
  const hasChildren = (childrenIds.get(task.id)?.length ?? 0) > 0;

  const close = () => {
    ui.closeTaskMenu();
    setSub('main');
  };

  const addChild = () => {
    const kids = (childrenIds.get(task.id) ?? []).map((id) => data.tasks.find((t) => t.id === id)).filter(Boolean);
    const created = store.createTask({ title: '', status: 'todo', parentId: task.id, order: newOrder(kids.at(-1)?.order) });
    close();
    ui.selectTask(created.id);
  };

  const itemCls =
    'flex w-full cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors text-foreground hover:bg-[color-mix(in_srgb,var(--accent-from)_14%,transparent)] data-[disabled]:opacity-50';

  const MenuItem = ({ children, onSelect, danger, onHover }: {
    children: React.ReactNode;
    onSelect: (el: HTMLElement) => void;
    danger?: boolean;
    /** 悬停:有子菜单的条目借它弹级联面板,普通条目借它收起面板 */
    onHover?: (el: HTMLElement) => void;
  }) => (
    <button
      onClick={(e) => onSelect(e.currentTarget)}
      onMouseEnter={(e) => onHover?.(e.currentTarget)}
      className={cn(itemCls, danger && 'text-[var(--danger)] hover:bg-[var(--danger)]/10')}
    >
      {children}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50"
      onContextMenu={(e) => e.preventDefault()}
      onClick={close}
    >
      {/* 主菜单:悬停到带 › 的条目即在旁边弹级联子菜单(主菜单不消失) */}
      <div
        onClick={(e) => e.stopPropagation()}
        onMouseLeave={scheduleCloseSub}
        className="glass-raised fixed min-w-[176px] rounded-xl p-1.5 shadow-xl"
        style={{ left: x, top: y }}
      >
        <div className="flex flex-col">
          <div className="truncate px-2.5 py-1.5 text-xs text-muted">{task.title || 'Untitled'}</div>
          <MenuItem onHover={clearSub} onSelect={addChild}>
            <Plus className="h-4 w-4 shrink-0" /> 创建子任务
          </MenuItem>
          <MenuItem onHover={clearSub} onSelect={() => { close(); ui.selectTask(task.id); }}>
            <Info className="h-4 w-4 shrink-0" /> 打开详情
          </MenuItem>
          {!project && <MenuItem
            onHover={clearSub}
            onSelect={() => {
              // 以被右击的任务为锚:批量整批转成同一目标类型(setTaskKind 同类型时 no-op)
              const target = structural ? 'todo' : 'node';
              ids.forEach((id) => store.setTaskKind(id, target));
              close();
            }}
          >
            <Shapes className="h-4 w-4 shrink-0" />
            {structural ? '转为 TODO 任务' : task.parentId === null ? '转为项目' : '转为分组'}
          </MenuItem>}
          {project && <MenuItem onHover={clearSub} onSelect={() => { store.setTaskStatus(task.id, 'archived'); close(); }}>归档项目</MenuItem>}
          {!structural && (
            <>
              <MenuItem onHover={(el) => openSub('time', el)} onSelect={(el) => openSub('time', el)}>
                设定时间 <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted" />
              </MenuItem>
              <MenuItem onHover={(el) => openSub('priority', el)} onSelect={(el) => openSub('priority', el)}>
                优先级 <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted" />
              </MenuItem>
            </>
          )}
          {multi && (
            <div className="truncate px-2.5 pb-0.5 text-[10px] text-[var(--accent-from)]">
              已应用到 {ids.length} 个任务
            </div>
          )}
          {hasChildren && (
            <>
              <div className="my-1 h-px bg-[var(--border)]" />
              <MenuItem onHover={clearSub} onSelect={() => { ui.collapseSubtree(task.id, childrenIds); close(); }}>
                折叠全部子任务
              </MenuItem>
              <MenuItem onHover={clearSub} onSelect={() => { ui.expandSubtree(task.id, childrenIds); close(); }}>
                展开全部子任务
              </MenuItem>
            </>
          )}
          <div className="my-1 h-px bg-[var(--border)]" />
          <MenuItem danger onHover={clearSub} onSelect={() => { ids.forEach((id) => store.softDeleteTask(id)); close(); }}>
            <Trash2 className="h-4 w-4 shrink-0" /> {multi ? `删除 ${ids.length} 个任务` : project ? '删除项目' : '删除任务'}
          </MenuItem>
        </div>
      </div>

      {/* 级联子菜单:右侧优先,右边放不下翻左侧;鼠标跨缝隙有 160ms 宽限 */}
      {sub !== 'main' && subPos && (
        <div
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={cancelCloseSub}
          onMouseLeave={scheduleCloseSub}
          className="glass-raised fixed z-50 min-w-[176px] rounded-xl p-1.5 shadow-xl"
          style={{ left: subPos.left, top: subPos.top }}
        >
          {sub === 'time' && (
            <div className="flex flex-col">
              {/* 子菜单里的选项不挂 onHover:悬停选项不收起子菜单(级联菜单语义);
                  曾因 clearSub 在 mouseenter 触发卸载面板,click 落在被移除节点上被吞 */}
              {TIME_OPTIONS.map((o) => (
                <MenuItem key={o.label} onSelect={() => { const v = o.apply(new Date()); mutate({ dueAt: v }); close(); }}>
                  {o.label}
                </MenuItem>
              ))}
              <div className="my-1 h-px bg-[var(--border)]" />
              <MenuItem onSelect={() => { close(); ui.selectTask(task.id); }}>
                <CircleDot className="h-4 w-4 shrink-0 text-muted" /> 自定义… <span className="text-xs text-muted/60">打开详情</span>
              </MenuItem>
            </div>
          )}
          {sub === 'priority' && (
            <div className="flex flex-col">
              {PRIORITY_ORDER.map((p) => (
                <MenuItem key={p} onSelect={() => { ids.forEach((id) => store.setTaskPriority(id, p as Priority)); close(); }}>
                  {PRIORITY_META[p].label}
                </MenuItem>
              ))}
              <div className="my-1 h-px bg-[var(--border)]" />
              <MenuItem onSelect={() => { ids.forEach((id) => store.setTaskPriority(id, 'P3')); close(); }}>
                清除优先级(P3)
              </MenuItem>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
