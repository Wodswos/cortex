import { useEffect, useRef } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';

const sections = [
  ['浏览画布', [
    '双指滑动或滚轮平移；鼠标中键或右键拖动空白处也可移动。',
    '双指捏合，或使用右下角的 − / + 缩放；点击百分比恢复 100%。',
    '右下角可回到根节点、显示全图，或在配置中调整平移速度与连线样式。',
  ]],
  ['选择与查看', [
    '单击选中节点，点击“详情”或按 ⌘ / Ctrl + Enter 查看任务详情。',
    '拖动空白处框选；按住 ⌘ / Ctrl 或 Shift 点选多个节点。',
    '⌘ / Ctrl + A 选中当前图中所有已展开节点；编辑文字时只全选文字。',
  ]],
  ['创建与编辑', [
    '选中后按 Tab 添加子任务，Enter 添加同级任务；项目根节点按 Enter 添加子任务。',
    '双击编辑标题，Enter 保存，Shift + Enter 换行，Esc 取消。',
    '点击“样式”调整背景、文字与字体；多选后可批量应用。',
  ]],
  ['调整结构', [
    '拖到节点中间成为子任务，上下边缘插到它前后；拖到空白处按上下位置调整同级顺序。',
    '在“全部任务”视图中，拖到“全部任务”根节点可移至顶层。',
    'Delete 删除所选；⌘ / Ctrl + Z 撤销，⌘ / Ctrl + Shift + Z 重做。',
  ]],
] as const;

export function MapHelp() {
  const ref = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (ref.current?.open && event.target instanceof Node && !ref.current.contains(event.target)) ref.current.open = false;
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, []);
  return (
    <details ref={ref} className="nodrag nopan nowheel absolute bottom-3 left-3 z-30 text-xs text-muted" aria-label="导图操作说明" onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape' && ref.current?.open) { event.preventDefault(); ref.current.open = false; summary.current?.focus(); }
    }}>
      <summary ref={summary} aria-label="导图操作说明" title="导图操作说明" className="flex h-9 cursor-pointer list-none items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 shadow-sm sm:px-3">
        <HelpCircle size={14} />
        <span className="hidden sm:inline">操作说明</span>
        <ChevronDown size={12} className="hidden sm:block" />
      </summary>
      <div role="dialog" aria-label="导图操作说明内容" aria-modal="false" className="absolute bottom-full left-0 mb-2 max-h-[60vh] w-[min(340px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 shadow-lg">
        <div className="space-y-4">
          {sections.map(([title, lines]) => <section key={title}>
            <h3 className="mb-2 text-xs font-medium text-foreground">{title}</h3>
            <ul className="space-y-2 pl-3 leading-relaxed marker:text-[var(--border-strong)] [list-style-type:disc]">{lines.map((line) => <li key={line}>{line}</li>)}</ul>
          </section>)}
        </div>
        <p className="mt-4 border-t border-[var(--border)] pt-3 text-[11px] leading-relaxed">每个项目会自动记住上次的缩放和位置。</p>
      </div>
    </details>
  );
}
