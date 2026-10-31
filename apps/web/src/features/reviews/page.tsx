import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowRight, Bell, BookOpen, Check, ChevronDown, Download, PencilLine } from 'lucide-react';
import { Button, cn, Segmented, SegmentedList, SegmentedTrigger } from '@cortex/ui';
import { useCortex, useCortexData } from '@cortex/crdt';
import {
  addDays, dateFromDayKey, dayKeyOf, fmtDuration, periodOfReview, reviewFacts, reviewId,
  reviewMarkdown, reviewPeriod, validDayKey, type Review, type ReviewFacts, type ReviewKind,
  type ReviewPeriod, type ReviewTaskFact, type Settings,
} from '@cortex/core';
import { useUI } from '@/state/ui';
import { useReviewDraft, type ReviewTextField } from './useReviewDraft';
import { useReviewClock } from './ReviewReminder';

const labelOf = (kind: ReviewKind) => kind === 'daily' ? '日报' : '周报';
function periodLabel(period: ReviewPeriod) {
  return period.kind === 'daily' ? period.start : `${period.start} ～ ${dayKeyOf(addDays(dateFromDayKey(period.end), -1))}`;
}

export default function ReviewsPage() {
  const data = useCortexData();
  const store = useCortex();
  const [params, setParams] = useSearchParams();
  const kind: ReviewKind = params.get('kind') === 'weekly' ? 'weekly' : 'daily';
  const now = useReviewClock();
  const date = params.get('date');
  const existing = validDayKey(date) ? data.reviews.find(review => review.id === `${kind}_${date}`) : undefined;
  // Stored weeks keep their original boundaries even if the account later changes weekStartsOn.
  const period = existing ? periodOfReview(existing) : reviewPeriod(kind, validDayKey(date) ? dateFromDayKey(date) : now, data.settings.weekStartsOn);
  const current = reviewPeriod(kind, now, data.settings.weekStartsOn);
  const navigate = (next: ReviewPeriod) => setParams({ kind: next.kind, date: next.start });
  const future = period.start > dayKeyOf(now);
  return (
    <div data-testid="review-page" className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-7 sm:py-8">
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">复盘</h1>
            <p className="mt-2 text-xs leading-5 text-muted">留一点时间，看清进展、阻碍和下一步。</p>
          </div>
          <Segmented value={kind} onValueChange={value => navigate(reviewPeriod(value as ReviewKind, dateFromDayKey(period.start), data.settings.weekStartsOn))}>
            <SegmentedList aria-label="复盘类型">
              <SegmentedTrigger value="daily">日报</SegmentedTrigger>
              <SegmentedTrigger value="weekly">周报</SegmentedTrigger>
            </SegmentedList>
          </Segmented>
        </header>
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <button aria-label="上一期复盘" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-[var(--surface)]" onClick={() => navigate(reviewPeriod(kind, addDays(dateFromDayKey(period.start), kind === 'daily' ? -1 : -7), data.settings.weekStartsOn))}><ArrowLeft size={15} /></button>
          <input aria-label="复盘日期" type="date" max={dayKeyOf(now)} value={period.start} onChange={event => { if (validDayKey(event.target.value)) navigate(reviewPeriod(kind, dateFromDayKey(event.target.value), data.settings.weekStartsOn)); }} className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-transparent px-2 text-xs outline-none focus:border-[var(--accent-solid)]" />
          <button aria-label="下一期复盘" disabled={period.start >= current.start} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-[var(--surface)] disabled:opacity-30" onClick={() => navigate(reviewPeriod(kind, dateFromDayKey(period.end), data.settings.weekStartsOn))}><ArrowRight size={15} /></button>
          <Button variant="ghost" size="sm" onClick={() => navigate(current)}>{kind === 'daily' ? '今天' : '本周'}</Button>
          <span className="ml-auto text-xs text-muted">{kind === 'daily' ? '约 3 分钟' : '约 10 分钟'}</span>
        </div>
        {future ? <p className="py-10 text-sm text-muted">这一天还没到，先回顾已经走过的路。</p> : <ReviewEditor key={`${store.userId}:${reviewId(period)}`} period={period} now={now} />}
      </div>
    </div>
  );
}

function ReviewEditor({ period, now }: { period: ReviewPeriod; now: number }) {
  const data = useCortexData();
  const store = useCortex();
  const draft = useReviewDraft(period);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const completed = draft.review?.completedAt != null && !draft.dirty;
  const liveFacts = useMemo(() => reviewFacts(data, period, now), [data.tasks, data.sessions, period.kind, period.start, period.end, now]);
  const facts = completed && draft.review?.facts ? draft.review.facts : liveFacts;
  const weekly = period.kind === 'weekly';
  const questions: { field: ReviewTextField; title: string; prompt: string }[] = [
    { field: 'highlights', title: weekly ? '本周真正推进了什么？' : '今天真正推进了什么？', prompt: weekly ? '哪些成果最有价值？哪件事比上周更进一步？' : '记一件有价值的进展，也可以是一点新的理解。' },
    { field: 'friction', title: '哪里卡住了，为什么？', prompt: '是依赖、目标不清，还是投入方式？下次可以怎样调整？' },
    { field: 'nextSteps', title: weekly ? '下周最重要的是什么？' : '明天最重要的一步是什么？', prompt: '写下 1–3 个具体行动，让下一次开始更轻松。' },
  ];
  const hasText = questions.some(question => draft.value(question.field).trim());
  const finish = async () => {
    setBusy(true); setError('');
    try {
      await draft.commit();
      store.stopUndoCapture(); store.completeReview(period); store.stopUndoCapture();
      await store.flushPersistence();
    } catch (error) { setError(error instanceof Error ? error.message : '保存失败，请重试'); }
    finally { setBusy(false); }
  };
  const download = async () => {
    setError('');
    try {
      await draft.commit();
      const review = store.getData().reviews.find(item => item.id === reviewId(period));
      if (!review) return;
      const snapshot = review.completedAt != null && review.facts ? review.facts : reviewFacts(store.getData(), period);
      const url = URL.createObjectURL(new Blob([reviewMarkdown(review, snapshot)], { type: 'text/markdown;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `cortex-${period.kind}-${period.start}.md`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('导出前保存失败，请保留页面并重试'); }
  };
  const dailyEntries = data.reviews.filter(review => review.kind === 'daily' && review.periodStart >= period.start && review.periodStart < period.end).sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <article className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="border-b border-[var(--border)] px-5 py-5 sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-medium">{periodLabel(period)}</h2>
            <span className={cn('inline-flex items-center gap-1.5 text-xs', completed ? 'text-[var(--accent-solid)]' : 'text-muted')}>
              {completed ? <><Check size={13} />已复盘</> : <><PencilLine size={13} />{draft.review || draft.dirty ? '草稿' : '待复盘'}</>}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted">{completed ? '这份复盘已保存。工作回顾保留完成复盘时的记录。' : '不必写得完整，先写最值得记住的一件事。内容会自动保存。'}</p>
          <p className="mt-3 text-xs text-muted lg:hidden">完成 {facts.completed.length} 项任务<span className="mx-2">·</span>专注 {fmtDuration(facts.focusMin)}</p>
        </div>
        <div className="space-y-8 px-5 py-6 sm:px-7">
          {questions.map((question, index) => (
            <label key={question.field} className="block">
              <span className="mb-3 flex items-center gap-2.5 text-sm font-medium"><span className="text-[11px] font-normal tabular-nums text-muted">0{index + 1}</span>{question.title}</span>
              <textarea
                aria-label={question.title}
                value={draft.value(question.field)}
                onChange={event => draft.change(question.field, event.target.value)}
                onBlur={() => { void draft.commit(); }}
                onCompositionStart={draft.compositionStart}
                onCompositionEnd={draft.compositionEnd}
                readOnly={completed} disabled={busy} maxLength={100000}
                placeholder={question.prompt}
                className="min-h-28 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3.5 py-3 text-sm leading-7 text-foreground outline-none transition-colors placeholder:text-muted/65 focus:border-[var(--accent-solid)] read-only:border-transparent read-only:bg-[var(--surface)] disabled:opacity-70"
              />
            </label>
          ))}
        </div>
        <footer className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] px-5 py-4 sm:px-7">
          <span role="status" aria-label="复盘保存状态" className="mr-auto text-[11px] text-muted">{draft.status || (draft.review ? '已保存' : '填写后自动保存')}</span>
          <button aria-label="导出复盘 Markdown" disabled={!hasText || busy} onClick={() => void download()} title="导出 Markdown" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-[var(--surface)] disabled:opacity-30"><Download size={15} /></button>
          {completed ? <Button variant="outline" size="sm" onClick={async () => {
            store.stopUndoCapture(); store.updateReview(period, { completedAt: null }); store.stopUndoCapture();
            try { await store.flushPersistence(); } catch { setError('本地保存失败，请保留页面'); }
          }}>继续编辑</Button> : <Button variant="primary" size="sm" disabled={!hasText || busy} onClick={() => void finish()}><Check size={14} />{busy ? '正在保存…' : '完成复盘'}</Button>}
          {error && <p role="alert" className="w-full text-xs text-[var(--danger)]">{error}</p>}
        </footer>
      </article>
      <aside className="min-w-0 space-y-6">
        <section aria-label="工作回顾" className="rounded-xl bg-[var(--surface)] p-4">
          <h2 className="text-sm font-medium">工作回顾</h2>
          <p className="mt-1.5 text-[11px] leading-5 text-muted">{completed ? '完成复盘时的记录快照' : '按现有任务状态和专注记录汇总'}</p>
          <div className="mt-4 grid grid-cols-2 gap-3 border-b border-[var(--border)] pb-4">
            <div><div className="text-xl font-medium tabular-nums" data-testid="review-completed-count">{facts.completed.length}<span className="ml-1 text-xs font-normal text-muted">项</span></div><div className="mt-1 text-[11px] text-muted">完成任务</div></div>
            <div><div className="text-xl font-medium tabular-nums" data-testid="review-focus-duration">{fmtDuration(facts.focusMin)}</div><div className="mt-1 text-[11px] text-muted">专注时间</div></div>
          </div>
          <FactList title="已完成" tasks={facts.completed} empty="这段时间还没有已完成的任务记录。" />
          <FactList title="到期未完成" tasks={facts.pending} empty="这段时间没有到期未完成的任务。" />
          {facts.projects.length > 0 && <details className="mt-4 border-t border-[var(--border)] pt-3">
            <summary className="cursor-pointer text-xs text-muted">{completed ? '归档时项目进度' : '相关项目当前进度'}</summary>
            <div className="mt-3 space-y-3">{facts.projects.map(project => <div key={project.id}>
              <div className="mb-1.5 flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 truncate">{project.title}</span><span className="text-muted">{project.done}/{project.total}</span></div>
              <div className="h-1 overflow-hidden rounded-full bg-[var(--border)]"><div className="h-full rounded-full bg-[var(--accent-solid)]" style={{ width: `${project.total ? project.done / project.total * 100 : 0}%` }} /></div>
            </div>)}</div>
          </details>}
        </section>
        {weekly && <section aria-label="本周日报" className="px-1">
          <h2 className="text-xs font-medium">这一周的日报 <span className="ml-1 text-muted">{dailyEntries.filter(review => review.completedAt != null).length} 篇已复盘</span></h2>
          {dailyEntries.length ? <div className="mt-3 space-y-2">{dailyEntries.map(review => <Link key={review.id} to={`/reviews?kind=daily&date=${review.periodStart}`} className="block rounded-md px-2 py-2 hover:bg-[var(--surface)]"><span className="flex justify-between text-xs"><span>{review.periodStart}</span><span className="text-muted">{review.completedAt != null ? '已复盘' : '草稿'}</span></span><span className="mt-1 block truncate text-xs text-muted">{review.highlights || review.friction || review.nextSteps}</span></Link>)}</div> : <p className="mt-3 text-xs leading-5 text-muted">写下的日报会汇集在这里，帮你回想这一周。</p>}
        </section>}
        <ReviewHistory reviews={data.reviews} selectedId={reviewId(period)} />
        <ReminderSettings settings={data.settings} />
      </aside>
    </div>
  );
}

function FactList({ title, tasks, empty }: { title: string; tasks: ReviewTaskFact[]; empty: string }) {
  const selectTask = useUI(state => state.selectTask);
  return <details open className="mt-4">
    <summary className="cursor-pointer text-xs font-medium">{title}<span className="ml-1.5 font-normal text-muted">{tasks.length}</span></summary>
    {tasks.length ? <ul className="mt-2 max-h-52 space-y-2 overflow-y-auto">{tasks.map(task => <li key={task.id}><button onClick={() => selectTask(task.id)} className="w-full rounded px-1 py-1 text-left text-xs leading-5 hover:bg-[var(--background)]"><span className="block break-words">{task.title}</span><span className="block truncate text-[10px] text-muted">{task.project}</span></button></li>)}</ul> : <p className="mt-2 text-[11px] leading-5 text-muted">{empty}</p>}
  </details>;
}

function ReviewHistory({ reviews, selectedId }: { reviews: Review[]; selectedId: string }) {
  const [search, setSearch] = useState('');
  const sorted = [...reviews].filter(review => `${review.periodStart} ${review.highlights} ${review.friction} ${review.nextSteps}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.periodStart.localeCompare(a.periodStart) || a.kind.localeCompare(b.kind));
  return <section aria-label="复盘历史" className="px-1">
    <h2 className="flex items-center gap-2 text-xs font-medium"><BookOpen size={13} />复盘记录<span className="font-normal text-muted">{reviews.length}</span></h2>
    {reviews.length > 6 && <input aria-label="搜索复盘" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索日期或内容" className="mt-3 h-8 w-full rounded-md border border-[var(--border)] bg-transparent px-2 text-xs outline-none focus:border-[var(--accent-solid)]" />}
    <nav aria-label="历史复盘" className="mt-3 max-h-64 space-y-1 overflow-y-auto">{sorted.map(review => <Link key={review.id} aria-current={review.id === selectedId ? 'page' : undefined} to={`/reviews?kind=${review.kind}&date=${review.periodStart}`} className={cn('flex items-center gap-2 rounded-md px-2 py-2 text-xs', review.id === selectedId ? 'bg-[var(--surface)]' : 'text-muted hover:bg-[var(--surface)] hover:text-foreground')}>
      <span>{review.periodStart}</span><span>{labelOf(review.kind)}</span><span className="ml-auto text-[10px]">{review.completedAt != null ? '已复盘' : '草稿'}</span>
    </Link>)}</nav>
    {!sorted.length && <p className="text-xs leading-5 text-muted">{reviews.length ? '没有匹配的复盘。' : '写下第一句，开始积累自己的复盘记录。'}</p>}
  </section>;
}

function ReminderSettings({ settings }: { settings: Settings }) {
  const store = useCortex();
  const [status, setStatus] = useState('');
  const update = async (patch: Partial<Settings>) => {
    store.stopUndoCapture(); store.updateSettings(patch); store.stopUndoCapture();
    try { await store.flushPersistence(); setStatus('提醒设置已保存'); } catch { setStatus('提醒设置保存失败，请重试'); }
  };
  return <details className="border-t border-[var(--border)] px-1 pt-4">
    <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-muted"><Bell size={13} /><span>复盘提醒</span><ChevronDown size={12} className="ml-auto" /></summary>
    <div className="mt-3 space-y-3 text-xs">
      <p className="leading-5 text-muted">每天 {settings.reviewDailyTime} · 每周{['日', '一', '二', '三', '四', '五', '六'][settings.reviewWeeklyDay]} {settings.reviewWeeklyTime}</p>
      <div className="flex items-center justify-between gap-2"><label className="flex items-center gap-2"><input type="checkbox" checked={settings.reviewDailyEnabled} onChange={event => void update({ reviewDailyEnabled: event.target.checked })} />日报提醒</label><input aria-label="日报提醒时间" type="time" value={settings.reviewDailyTime} onChange={event => { if (event.target.validity.valid && event.target.value) void update({ reviewDailyTime: event.target.value }); }} className="min-w-0 rounded border border-[var(--border)] bg-transparent p-1" /></div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={settings.reviewWeeklyEnabled} onChange={event => void update({ reviewWeeklyEnabled: event.target.checked })} />周报提醒</label>
      <div className="flex gap-2"><select aria-label="周报提醒星期" value={settings.reviewWeeklyDay} onChange={event => void update({ reviewWeeklyDay: Number(event.target.value) })} className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] p-1.5">{['日', '一', '二', '三', '四', '五', '六'].map((day, index) => <option key={day} value={index}>星期{day}</option>)}</select><input aria-label="周报提醒时间" type="time" value={settings.reviewWeeklyTime} onChange={event => { if (event.target.validity.valid && event.target.value) void update({ reviewWeeklyTime: event.target.value }); }} className="min-w-0 rounded border border-[var(--border)] bg-transparent p-1" /></div>
      <p className="text-[11px] leading-5 text-muted">按设备本地时间，在打开应用时提醒；离开网页后不会定时推送。未完成的复盘会在下次打开时提示。</p>
      {status && <p role="status" className="text-[11px] text-muted">{status}</p>}
    </div>
  </details>;
}
