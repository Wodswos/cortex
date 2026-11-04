import { CalendarDays, GanttChartSquare, GitBranch, LayoutGrid, ListTodo } from 'lucide-react';
export const TASK_VIEWS = [
  { key: 'list', label: '列表', icon: ListTodo },
  { key: 'mindmap', label: '导图', icon: GitBranch },
  { key: 'matrix', label: '四象限', icon: LayoutGrid },
  { key: 'gantt', label: '甘特图', icon: GanttChartSquare },
  { key: 'timeline', label: '日历', icon: CalendarDays },
] as const;
