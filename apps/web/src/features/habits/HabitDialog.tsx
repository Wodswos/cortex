import React, { useRef, useState } from 'react';
import { useCortex } from '@cortex/crdt';
import { habitReminderTimes, MAX_HABIT_REMINDER_TIMES, validateHabitConfig, type Cadence, type Habit } from '@cortex/core';
import { Plus, X } from 'lucide-react';
import { Button, Dialog, DialogContent, Input, cn } from '@cortex/ui';
import { notifSupported, requestNotifPermission, type NotifPermission } from '@cortex/platform';
import { isComposing } from '@/shared/ime';

const COLORS = ['#6b80ae', '#659083', '#a78560', '#8c79a4', '#a47586', '#648f9c'];
type Frequency = 'daily' | 'weekly-times' | 'weekly-days' | 'interval' | 'custom';
export function HabitDialog({ habit, onClose }: { habit?: Habit; onClose: () => void }) {
  const store = useCortex();
  const original = habit?.cadence;
  const [name, setName] = useState(habit?.name ?? '');
  const [target, setTarget] = useState(String(habit?.targetPerDay ?? 1));
  const [color, setColor] = useState(habit?.color ?? COLORS[0]!);
  const [frequency, setFrequency] = useState<Frequency>(original?.type === 'weekly' ? original.days?.length ? 'weekly-days' : 'weekly-times' : original?.type ?? 'daily');
  const [times, setTimes] = useState(String(original?.type === 'weekly' ? original.timesPerWeek : 3));
  const [interval, setInterval] = useState(String(original?.type === 'interval' ? original.everyNDays : 2));
  const [days, setDays] = useState(original?.type === 'weekly' && original.days?.length ? original.days : [1, 3, 5]);
  const initialTimes = habit ? habitReminderTimes(habit) : [];
  const [reminderTimes, setReminderTimes] = useState(initialTimes.length ? initialTimes : ['']);
  const configuredTimes = reminderTimes.filter(Boolean).sort();
  const hasTime = configuredTimes.length > 0;
  const [remind, setRemind] = useState(initialTimes.length > 0 && habit?.reminderEnabled !== false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [permission, setPermission] = useState<NotifPermission>(() => notifSupported() ? Notification.permission : 'unsupported');
  const createdId = useRef<string | null>(null);
  const colors = [...new Set([...COLORS, ...(habit?.color ? [habit.color] : [])])];
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    try {
      let cadence: Cadence = { type: 'daily' };
      if (frequency === 'weekly-times') cadence = { type: 'weekly', timesPerWeek: Number(times) };
      if (frequency === 'weekly-days') {
        if (!days.length) throw new Error('请至少选择一周中的一天');
        cadence = { type: 'weekly', days: [...days].sort((a, b) => a - b), timesPerWeek: days.length };
      }
      if (frequency === 'interval') cadence = { type: 'interval', everyNDays: Number(interval) };
      if (frequency === 'custom' && original?.type === 'custom') cadence = original;
      const patch = { name: name.trim(), targetPerDay: Number(target), color, cadence, reminderTimes: configuredTimes, reminderEnabled: hasTime && remind && frequency !== 'custom' };
      validateHabitConfig(patch);
      const existingId = habit?.id ?? createdId.current;
      if (existingId && !store.getData().habits.some(item => item.id === existingId && !item.deletedAt && !item.archivedAt)) throw new Error('该习惯已被删除或归档，请关闭后重新查看');
      setBusy(true); setError('');
      store.stopUndoCapture();
      if (existingId) {
        // Save only edited fields so an unrelated remote change survives an open form.
        const baseline = habit ? { name: habit.name, targetPerDay: habit.targetPerDay ?? 1, color: habit.color, cadence: habit.cadence, reminderTimes: habitReminderTimes(habit), reminderEnabled: habitReminderTimes(habit).length > 0 && habit.reminderEnabled !== false } : null;
        const changed = baseline ? Object.fromEntries(Object.entries(patch).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(baseline[key as keyof typeof baseline]))) : patch;
        store.updateHabit(existingId, changed);
      } else createdId.current = store.createHabit(patch).id;
      store.stopUndoCapture();
      await store.flushPersistence();
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试'); }
    finally { setBusy(false); }
  };
  const field = 'h-9 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--accent-solid)]';
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent title={habit ? '编辑习惯' : '新习惯'} className="top-[8%] max-h-[84dvh] overflow-y-auto sm:w-[440px]">
      <form className="space-y-4" onSubmit={event => void submit(event)} onKeyDown={event => { if (event.key === 'Enter' && isComposing(event)) event.preventDefault(); }}>
        <label className="block space-y-1.5 text-sm"><span>习惯名称</span><Input autoFocus required maxLength={200} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="例如：阅读、散步、喝水" /></label>
        <fieldset disabled={busy}><legend className="mb-2 text-xs text-muted">标记颜色</legend><div className="flex flex-wrap gap-2">{colors.map((value, index) => <button type="button" key={value} aria-label={`颜色 ${index + 1}`} aria-pressed={color === value} onClick={() => setColor(value)} className={cn('h-6 w-6 rounded-full border border-black/5 outline-offset-2', color === value && 'outline-2 outline-[var(--accent-solid)]')} style={{ background: value }} />)}</div></fieldset>
        <div className="grid grid-cols-2 gap-3">
          <label className="block min-w-0 space-y-1.5 text-sm"><span>每日目标次数</span><Input type="number" required min={1} max={10000} step={1} disabled={busy} value={target} onChange={event => setTarget(event.target.value)} /></label>
          <label className="block min-w-0 space-y-1.5 text-sm"><span>频率</span><select aria-label="习惯频率" className={field} disabled={busy} value={frequency} onChange={event => setFrequency(event.target.value as Frequency)}><option value="daily">每天</option><option value="weekly-times">每周 N 次</option><option value="weekly-days">指定周几</option><option value="interval">每 N 天</option>{original?.type === 'custom' && <option value="custom">自定义（保留现有规则）</option>}</select></label>
        </div>
        {frequency === 'weekly-times' && <label className="block space-y-1.5 text-sm"><span>每周目标次数</span><Input aria-label="每周目标次数" type="number" required min={1} max={100} step={1} disabled={busy} value={times} onChange={event => setTimes(event.target.value)} /><span className="block text-xs leading-relaxed text-muted">本周打卡累计达到目标后不再提醒；尚未完成时，在设置时间提醒。</span></label>}
        {frequency === 'weekly-days' && <fieldset disabled={busy}><legend className="mb-2 text-sm">打卡日期</legend><div className="flex gap-1.5">{[1, 2, 3, 4, 5, 6, 7].map(day => <button type="button" key={day} aria-label={`星期${['一', '二', '三', '四', '五', '六', '日'][day - 1]}`} aria-pressed={days.includes(day)} onClick={() => setDays(previous => previous.includes(day) ? previous.filter(value => value !== day) : [...previous, day])} className={cn('h-8 min-w-0 flex-1 rounded-md text-xs', days.includes(day) ? 'bg-[var(--selection)] font-semibold text-[var(--accent-solid)]' : 'bg-[var(--surface)] text-muted')}>{['一', '二', '三', '四', '五', '六', '日'][day - 1]}</button>)}</div></fieldset>}
        {frequency === 'interval' && <label className="block space-y-1.5 text-sm"><span>间隔天数</span><Input aria-label="间隔天数" type="number" required min={1} max={3650} step={1} disabled={busy} value={interval} onChange={event => setInterval(event.target.value)} /><span className="block text-xs text-muted">从最初创建当天起计算，编辑不会改变起算日期。</span></label>}
        <div className="space-y-3 border-t border-[var(--border)] pt-4">
          <fieldset disabled={busy} className="space-y-2">
            <legend className="mb-1.5 text-sm">打卡时间（可选）</legend>
            {reminderTimes.map((time, index) => <div key={index} className="flex items-center gap-2">
              <Input aria-label={index === 0 ? '打卡时间' : `打卡时间 ${index + 1}`} type="time" className="min-w-0 flex-1" value={time} onChange={event => {
                const next = reminderTimes.map((value, i) => i === index ? event.target.value : value);
                if (!hasTime && next.some(Boolean)) setRemind(true);
                if (!next.some(Boolean)) setRemind(false);
                setReminderTimes(next);
              }} />
              {time && configuredTimes.length > 1 && Number(target) > 0 && <span className="shrink-0 text-xs tabular-nums text-muted">累计 {Math.ceil(Number(target) * (configuredTimes.indexOf(time) + 1) / configuredTimes.length)} 次</span>}
              {(time || reminderTimes.length > 1) && <button type="button" aria-label={reminderTimes.length === 1 ? '清除时间' : `移除打卡时间 ${index + 1}`} title="移除时间" className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted hover:bg-[var(--surface)] hover:text-foreground" onClick={() => {
                const next = reminderTimes.filter((_, i) => i !== index);
                setReminderTimes(next.length ? next : ['']);
                if (!next.some(Boolean)) setRemind(false);
              }}><X size={14} /></button>}
            </div>)}
            {reminderTimes.length < MAX_HABIT_REMINDER_TIMES && <button type="button" className="inline-flex items-center gap-1 py-1 text-xs text-muted hover:text-foreground" onClick={() => setReminderTimes(previous => [...previous, ''])}><Plus size={13} />添加时间</button>}
          </fieldset>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-3.5 w-3.5 accent-[var(--accent-solid)]" checked={hasTime && remind && frequency !== 'custom'} disabled={busy || !hasTime || frequency === 'custom'} onChange={event => setRemind(event.target.checked)} />到时提醒</label>
          <p className="text-xs leading-relaxed text-muted">{frequency === 'custom' ? '现有自定义规则暂不支持到时提醒。' : '多个时间会按比例分配每日目标，完成当前进度后等下一时间再提醒；提前打卡也计入目标。提醒在应用打开时生效，关闭网页后不会推送。'}</p>
          {hasTime && remind && frequency !== 'custom' && <div className="text-xs leading-relaxed text-muted">{permission === 'granted' ? '浏览器通知已开启。' : permission === 'unsupported' || !window.isSecureContext ? '当前访问方式仅支持应用内提醒。' : permission === 'denied' ? '浏览器通知已被禁用，仍会显示应用内提醒。' : <button type="button" className="text-[var(--accent-solid)] underline underline-offset-2" onClick={() => void requestNotifPermission().then(setPermission)}>开启浏览器通知</button>}</div>}
        </div>
        {error && <p role="alert" className="text-xs text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={busy || !name.trim()}>{busy ? '正在保存…' : habit ? '保存修改' : '创建'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
