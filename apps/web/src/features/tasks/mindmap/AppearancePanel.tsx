import React, { useEffect, useRef } from 'react';
import { Bold, Italic, RotateCcw, X } from 'lucide-react';
import { MIND_PALETTE, MIND_FONT_KEYS, RESET_MIND_APPEARANCE, type MindAppearance, type MindColor, type Task } from '@cortex/core';
import { cn } from '@cortex/ui';
import { mindColor, FONT_LABELS } from './appearance';

const names = { neutral: '雾灰', blue: '雾蓝', sage: '鼠尾草', sand: '暖沙', rose: '灰粉', lavender: '浅紫' };
const MIXED = 'mixed';

export function AppearancePanel({ tasks, onChange, onClose }: {
  tasks: Task[];
  onChange: (patch: MindAppearance) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  const common = <K extends keyof MindAppearance>(field: K): MindAppearance[K] | typeof MIXED => {
    const value = tasks[0]?.[field] ?? null;
    return tasks.every((task) => (task[field] ?? null) === value) ? value : MIXED;
  };
  const commonToggle = (field: 'mindBold' | 'mindItalic'): boolean | typeof MIXED => {
    const fallback = field === 'mindBold';
    const value = tasks[0]?.[field] ?? fallback;
    return tasks.every((task) => (task[field] ?? fallback) === value) ? value : MIXED;
  };
  const colors = (field: 'mindBackground' | 'mindTextColor', label: string) => {
    const value = common(field);
    return (
      <fieldset className="space-y-2">
        <legend className="text-xs text-muted">{label}{value === MIXED ? ' · 混合' : ''}</legend>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button" aria-label={`${label}：默认`} aria-pressed={value === null}
            title="跟随主题" onClick={() => onChange({ [field]: null })}
            className={cn('h-7 rounded border px-1.5 text-[11px]', value === null ? 'border-[var(--accent-solid)]' : 'border-[var(--border-strong)]')}
          >默认</button>
          {MIND_PALETTE.map((color) => (
            <button
              key={color} type="button" aria-label={`${label}：${names[color]}`} aria-pressed={value === color}
              title={names[color]} onClick={() => onChange({ [field]: color })}
              className={cn('h-7 w-7 rounded border outline-offset-2', value === color ? 'outline outline-2 outline-[var(--accent-solid)]' : 'border-[var(--border-strong)]')}
              style={{ background: mindColor(color, field === 'mindBackground') }}
            />
          ))}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] text-muted">
          <input
            type="color" aria-label={`自定义节点${label}`} className="h-6 w-8 cursor-pointer rounded border border-[var(--border-strong)] bg-transparent p-0.5"
            value={typeof value === 'string' && value.startsWith('#') ? value : field === 'mindBackground' ? '#e8edf3' : '#292c33'}
            onChange={(event) => onChange({ [field]: event.target.value as MindColor })}
          />
          自定义颜色
        </label>
      </fieldset>
    );
  };
  const selectClass = 'h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--background)] px-2 text-xs';
  return (
    <div
      role="dialog" aria-label="节点样式" aria-modal="false"
      className="absolute bottom-24 right-3 z-30 max-h-[calc(100%-110px)] w-[min(320px,calc(100%-24px))] overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--background)] p-4 shadow-lg"
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      }}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">节点样式 <span className="text-xs font-normal text-muted">已选 {tasks.length} 项</span></span>
        <button ref={closeRef} type="button" aria-label="关闭节点样式" onClick={onClose} className="rounded p-1 text-muted hover:bg-[var(--surface)]"><X size={15} /></button>
      </div>
      <div className="space-y-4">
        {colors('mindBackground', '背景')}
        {colors('mindTextColor', '文字')}
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1.5 text-xs text-muted">
            <span>字体</span>
            <select aria-label="节点字体" className={selectClass} value={common('mindFontFamily') ?? ''} onChange={(event) => onChange({ mindFontFamily: event.target.value as MindAppearance['mindFontFamily'] || null })}>
              {common('mindFontFamily') === MIXED && <option value={MIXED} disabled>混合</option>}
              <option value="">跟随分支／霞鹜文楷</option>{MIND_FONT_KEYS.map((font) => <option key={font} value={font}>{FONT_LABELS[font]}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-xs text-muted">
            <span>字号</span>
            <select aria-label="节点字号" className={selectClass} value={common('mindFontSize') ?? ''} onChange={(event) => onChange({ mindFontSize: event.target.value ? Number(event.target.value) : null })}>
              {common('mindFontSize') === MIXED && <option value={MIXED} disabled>混合</option>}
              <option value="">默认 · 16 px</option>{Array.from({ length: 23 }, (_, index) => index + 10).map((size) => <option key={size} value={size}>{size} px</option>)}
            </select>
          </label>
        </div>
        <div className="flex gap-2">
          {([['mindBold', '粗体', Bold], ['mindItalic', '斜体', Italic]] as const).map(([field, label, Icon]) => (
            <button
              key={field} type="button" aria-label={`节点${label}`} aria-pressed={commonToggle(field) === MIXED ? 'mixed' : commonToggle(field) === true}
              onClick={() => onChange({ [field]: commonToggle(field) !== true })}
              className={cn('flex flex-1 items-center justify-center gap-2 rounded-md border py-2 text-xs', commonToggle(field) === true ? 'border-[var(--accent-solid)] bg-[var(--selection)]' : 'border-[var(--border-strong)]')}
            ><Icon size={14} />{label}</button>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
          <span className="text-[10px] text-muted">即时保存 · Ctrl/⌘ + Z 撤销</span>
          <button type="button" onClick={() => onChange(RESET_MIND_APPEARANCE)} className="flex items-center gap-1 text-xs text-muted hover:text-foreground"><RotateCcw size={12} />恢复默认样式</button>
        </div>
        <a href="/fonts/licenses/index.html" target="_blank" rel="noreferrer" className="block text-[10px] text-muted underline underline-offset-2">内置字体均采用 SIL OFL 1.1 开源许可</a>
      </div>
    </div>
  );
}
