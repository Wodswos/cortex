import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Command } from 'cmdk';
import {
  ListTodo, Timer, Activity, Inbox, LayoutDashboard, Settings, Plus, Play,
  CalendarRange, LayoutGrid, GitBranch, Download, Search, Library, BookOpen,
} from 'lucide-react';
import { useCortex, useCortexData } from '@cortex/crdt';
import { activeTasks } from '@cortex/core';
import { useUI } from '../state/ui';
import { useTimer } from '../focus/timer';

export function CommandPalette() {
  const open = useUI((s) => s.commandOpen);
  const setCommand = useUI((s) => s.setCommand);
  const selectTask = useUI((s) => s.selectTask);
  const setQuickCapture = useUI((s) => s.setQuickCapture);
  const data = useCortexData();
  const store = useCortex();
  const navigate = useNavigate();
  const start = useTimer((s) => s.start);

  const [search, setSearch] = useState('');
  const tasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return activeTasks(data.tasks).filter((task) => !query || `${task.title} ${task.status}`.toLocaleLowerCase().includes(query)).slice(0, 50);
  }, [data.tasks, search]);

  const go = (fn: () => void) => () => {
    setCommand(false);
    setSearch('');
    fn();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setCommand}
      label="命令面板"
      shouldFilter
      className="fixed left-1/2 top-[14%] z-50 w-[min(94vw,620px)] -translate-x-1/2"
      overlayClassName="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
      loop
    >
      <div className="glass-raised overflow-hidden rounded-2xl">
        <Command.Input
          value={search}
          onValueChange={setSearch}
          autoFocus
          placeholder="搜索任务、执行命令…"
          className="h-12 w-full border-b border-[var(--border)] bg-transparent px-4 text-base text-foreground placeholder:text-muted/60 outline-none"
        />
        <Command.List className="max-h-[52vh] overflow-y-auto p-2">
          <Command.Empty className="py-8 text-center text-sm text-muted">没有匹配结果</Command.Empty>

          <Command.Group
            heading="操作"
            className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted"
          >
            <Item onSelect={go(() => setQuickCapture(true))} icon={<Plus className="h-4 w-4" />}>
              快速收集 <Kbd> N </Kbd>
            </Item>
            <Item
              onSelect={go(() => {
                start({ mode: 'focus' });
                navigate('/focus');
              })}
              icon={<Play className="h-4 w-4" />}
            >
              开始专注 25 分钟
            </Item>
            <Item onSelect={go(() => navigate('/'))} icon={<LayoutDashboard className="h-4 w-4" />}>
              概览
            </Item>
            <Item onSelect={go(() => navigate('/tasks'))} icon={<ListTodo className="h-4 w-4" />}>
              任务 · 列表
            </Item>
            <Item onSelect={go(() => navigate('/tasks?view=matrix'))} icon={<LayoutGrid className="h-4 w-4" />}>
              任务 · 四象限
            </Item>
            <Item onSelect={go(() => navigate('/tasks?view=mindmap'))} icon={<GitBranch className="h-4 w-4" />}>
              任务 · 导图
            </Item>
            <Item onSelect={go(() => navigate('/inbox'))} icon={<Inbox className="h-4 w-4" />}>
              收集箱
            </Item>
            <Item onSelect={go(() => navigate('/gallery'))} icon={<Library className="h-4 w-4" />}>
              Gallery · 精选路线图
            </Item>
            <Item onSelect={go(() => navigate('/habits'))} icon={<Activity className="h-4 w-4" />}>
              习惯
            </Item>
            <Item onSelect={go(() => navigate('/reviews'))} icon={<BookOpen className="h-4 w-4" />}>
              复盘 · 日报与周报
            </Item>
            <Item
              onSelect={go(() => {
                const blob = new Blob([JSON.stringify(store.exportSnapshot(), null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `cortex-backup-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
              })}
              icon={<Download className="h-4 w-4" />}
            >
              导出数据备份
            </Item>
            <Item onSelect={go(() => navigate('/settings'))} icon={<Settings className="h-4 w-4" />}>
              设置
            </Item>
          </Command.Group>

          <Command.Group
            heading="任务"
            className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted"
          >
            {tasks.map((t) => (
              <Item
                key={t.id}
                value={`${t.title} ${t.status}`}
                onSelect={go(() => {
                  selectTask(t.id);
                  if (location.pathname !== '/tasks') navigate('/tasks');
                })}
                icon={<Search className="h-4 w-4" />}
              >
                <span className="max-w-[420px] truncate">{t.title}</span>
                {t.status === 'done' && <span className="text-xs text-[var(--success)]">已完成</span>}
              </Item>
            ))}
          </Command.Group>
        </Command.List>
      </div>
    </Command.Dialog>
  );
}

function Item({
  children,
  icon,
  ...props
}: React.ComponentProps<typeof Command.Item> & { icon?: React.ReactNode }) {
  return (
    <Command.Item
      className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-sm text-foreground outline-none data-[selected=true]:bg-[color-mix(in_srgb,var(--accent-from)_14%,transparent)]"
      {...props}
    >
      <span className="text-muted [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      {children}
    </Command.Item>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="ml-1 rounded border border-[var(--border)] bg-[var(--surface)] px-1 font-mono text-[10px] text-muted">
      {children}
    </kbd>
  );
}
