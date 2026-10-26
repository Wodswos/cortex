import { create } from 'zustand';
import { TaskFilter } from '@cortex/core';

interface UIState {
  quickCaptureOpen: boolean;
  commandOpen: boolean;
  selectedTaskId: string | null; // 详情抽屉(右滑/底部)
  collapsed: Record<string, boolean>; // 任务树折叠状态
  filter: TaskFilter;
  taskMenu: { taskId: string; ids: string[]; x: number; y: number } | null; // 任务右键菜单锚点(ids=批量操作对象)
  tmuxView: { serverId: string; session: string } | null; // tmux 会话直连终端
  setQuickCapture: (open: boolean) => void;
  setCommand: (open: boolean) => void;
  selectTask: (id: string | null) => void;
  toggleCollapsed: (id: string) => void;
  setFilter: (f: TaskFilter) => void;
  openTaskMenu: (taskId: string, x: number, y: number, ids?: string[]) => void;
  closeTaskMenu: () => void;
  openTmuxView: (serverId: string, session: string) => void;
  closeTmuxView: () => void;
  // 整棵子树折叠/展开(下钻到全部后代)
  collapseSubtree: (rootId: string, children: Map<string | null, string[]>) => void;
  expandSubtree: (rootId: string, children: Map<string | null, string[]>) => void;
}

export const useUI = create<UIState>((set, get) => ({
  quickCaptureOpen: false,
  commandOpen: false,
  selectedTaskId: null,
  collapsed: {},
  filter: { kind: 'all' },
  taskMenu: null,
  tmuxView: null,
  setQuickCapture: (open) => set({ quickCaptureOpen: open }),
  setCommand: (open) => set({ commandOpen: open }),
  selectTask: (id) => set({ selectedTaskId: id }),
  toggleCollapsed: (id) => set({ collapsed: { ...get().collapsed, [id]: !get().collapsed[id] } }),
  setFilter: (filter) => set({ filter }),
  openTaskMenu: (taskId, x, y, ids) => set({ taskMenu: { taskId, ids: ids && ids.length > 0 ? ids : [taskId], x, y } }),
  closeTaskMenu: () => set({ taskMenu: null }),
  openTmuxView: (serverId, session) => set({ tmuxView: { serverId, session } }),
  closeTmuxView: () => set({ tmuxView: null }),
  collapseSubtree: (rootId, children) => {
    const ids = [rootId];
    let i = 0;
    while (i < ids.length) {
      const cur = ids[i++];
      for (const c of children.get(cur) ?? []) ids.push(c);
    }
    const collapsed = { ...get().collapsed };
    for (const id of ids) collapsed[id] = true;
    set({ collapsed });
  },
  expandSubtree: (rootId, children) => {
    const ids = [rootId];
    let i = 0;
    while (i < ids.length) {
      const cur = ids[i++];
      for (const c of children.get(cur) ?? []) ids.push(c);
    }
    const collapsed = { ...get().collapsed };
    for (const id of ids) collapsed[id] = false;
    set({ collapsed });
  },
}));
