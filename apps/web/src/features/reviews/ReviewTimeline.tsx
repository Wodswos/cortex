import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowUpRight, BookOpen, Check, PencilLine, Search } from 'lucide-react';
import { cn, Segmented, SegmentedList, SegmentedTrigger } from '@cortex/ui';
import { addDays, dateFromDayKey, dayKeyOf, fmtDuration, type Review, type ReviewKind } from '@cortex/core';

export function ReviewTimeline({ reviews }: { reviews: Review[] }) {
  const [params, setParams] = useSearchParams();
  const type = params.get('type');
  const filter: ReviewKind | 'all' = type === 'daily' || type === 'weekly' ? type : 'all';
  const search = params.get('q') ?? '';
  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = reviews.filter(review => (filter === 'all' || review.kind === filter)
      && [review.periodStart, dayKeyOf(addDays(dateFromDayKey(review.periodEnd), -1)), review.kind === 'daily' ? '日报' : '周报', review.highlights, review.friction, review.resolution, review.nextSteps]
        .join(' ').toLowerCase().includes(query))
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart) || a.kind.localeCompare(b.kind));
    const months = new Map<string, Review[]>();
    for (const review of sorted) {
      const month = review.periodStart.slice(0, 7);
      if (!months.has(month)) months.set(month, []);
      months.get(month)!.push(review);
    }
    return [...months];
  }, [reviews, filter, search]);
  const count = groups.reduce((total, [, entries]) => total + entries.length, 0);
  const update = (nextFilter: string, query: string) => {
    const next = new URLSearchParams({ view: 'timeline' });
    if (nextFilter !== 'all') next.set('type', nextFilter);
    if (query) next.set('q', query);
    setParams(next, { replace: true });
  };
  const detailHref = (review: Review) => {
    const next = new URLSearchParams({ kind: review.kind, date: review.periodStart, from: 'timeline' });
    if (filter !== 'all') next.set('type', filter);
    if (search) next.set('q', search);
    return `/reviews?${next}`;
  };

  return <section aria-label="复盘时间线">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 className="text-base font-medium">复盘时间线</h2>
        <p className="mt-1.5 text-xs leading-5 text-muted">按复盘日期从近到远，回看每一次进展与思考。草稿也会保留在这里。</p>
      </div>
      <span role="status" aria-label="时间线记录数" className="text-xs tabular-nums text-muted">{count === reviews.length ? `共 ${count} 篇` : `${count} / ${reviews.length} 篇`}</span>
    </div>
    <div className="mb-7 flex flex-wrap items-center gap-3">
      <Segmented value={filter} onValueChange={value => update(value, search)}>
        <SegmentedList aria-label="时间线类型">
          <SegmentedTrigger value="all">全部</SegmentedTrigger>
          <SegmentedTrigger value="daily">日报</SegmentedTrigger>
          <SegmentedTrigger value="weekly">周报</SegmentedTrigger>
        </SegmentedList>
      </Segmented>
      <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--border)] px-3 sm:ml-auto sm:max-w-xs">
        <Search size={14} aria-hidden="true" className="shrink-0 text-muted" />
        <input aria-label="搜索时间线" type="search" value={search} onChange={event => update(filter, event.target.value)} placeholder="搜索日期、内容或解决办法" className="min-w-0 w-full bg-transparent text-xs outline-none placeholder:text-muted" />
      </label>
    </div>
    {groups.map(([month, entries]) => <section key={month} aria-label={`${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`} className="mb-8">
      <h3 className="mb-4 text-sm font-medium tabular-nums">{month.slice(0, 4)} 年 {Number(month.slice(5))} 月<span className="ml-2 text-xs font-normal text-muted">{entries.length} 篇</span></h3>
      <ol className="ml-1.5 space-y-4 border-l border-[var(--border)] pl-5 sm:pl-7">
        {entries.map(review => {
          const completed = review.completedAt != null;
          const label = review.kind === 'daily' ? '日报' : '周报';
          const end = dayKeyOf(addDays(dateFromDayKey(review.periodEnd), -1));
          const details = [
            { title: '阻碍与反思', text: review.friction },
            { title: '如何解决？', text: review.resolution },
            { title: '下一步', text: review.nextSteps },
          ].filter(section => section.text?.trim());
          const sections = [
            { title: review.kind === 'daily' ? '计划与进展' : '进展与收获', text: review.highlights },
            ...details,
          ].filter(section => section.text?.trim());
          return <li key={review.id} className="relative">
            <span aria-hidden="true" className={cn('absolute -left-[25px] top-6 h-2 w-2 rounded-full ring-4 ring-[var(--background)] sm:-left-[33px]', completed ? 'bg-[var(--accent-solid)]' : 'bg-[var(--muted-foreground)]')} />
            <article aria-label={`${label} ${review.periodStart}`} className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 sm:p-5">
              <header className="flex flex-wrap items-center justify-between gap-3">
                <Link to={detailHref(review)} aria-label={`查看${label} ${review.periodStart}`} className="group flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded text-sm font-medium hover:text-[var(--accent-solid)]">
                  <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-normal', review.kind === 'weekly' ? 'bg-[color-mix(in_srgb,var(--accent-solid)_10%,transparent)] text-[var(--accent-solid)]' : 'bg-[var(--surface)] text-muted')}>{label}</span>
                  <span className="tabular-nums"><time dateTime={review.periodStart}>{review.periodStart}</time>{review.kind === 'weekly' && <> ～ <time dateTime={end}>{end}</time></>}</span>
                  <ArrowUpRight size={14} aria-hidden="true" className="shrink-0 text-muted group-hover:text-[var(--accent-solid)]" />
                </Link>
                <span className={cn('inline-flex items-center gap-1 text-[11px]', completed ? 'text-[var(--accent-solid)]' : 'text-muted')}>{completed ? <Check size={12} /> : <PencilLine size={12} />}{completed ? '已复盘' : '草稿'}</span>
              </header>
              {sections.length ? review.kind === 'daily' ? <div className="mt-4">
                {review.highlights.trim() && <div className="min-w-0">
                  <h4 className="text-xs font-medium text-muted">计划与进展</h4>
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6">{review.highlights}</p>
                </div>}
                {details.length > 0 && <dl className={cn('space-y-1.5 text-xs text-muted', review.highlights.trim() && 'mt-4 border-t border-[var(--border)] pt-3')}>
                  {details.map(section => <div key={section.title} className="flex min-w-0 items-baseline gap-2">
                    <dt className="shrink-0 text-[11px]">{section.title}</dt>
                    <dd className="min-w-0 flex-1 truncate">{section.text}</dd>
                  </div>)}
                </dl>}
              </div> : <div className="mt-4 grid gap-4 sm:grid-cols-2">{sections.map(section => <div key={section.title} className="min-w-0">
                <h4 className="text-[11px] text-muted">{section.title}</h4>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-6">{section.text}</p>
              </div>)}</div> : <p className="mt-4 text-xs text-muted">尚未填写内容，点击日期继续编辑。</p>}
              {completed && review.facts && <p className="mt-4 border-t border-[var(--border)] pt-3 text-[11px] text-muted">完成 {review.facts.completed.length} 项任务<span className="mx-2">·</span>专注 {fmtDuration(review.facts.focusMin)}</p>}
            </article>
          </li>;
        })}
      </ol>
    </section>)}
    {!count && <div className="rounded-xl border border-dashed border-[var(--border)] px-5 py-14 text-center">
      <BookOpen size={24} aria-hidden="true" className="mx-auto mb-4 text-muted" />
      <p className="text-sm">{reviews.length ? '没有匹配的复盘' : '时间线从第一篇复盘开始'}</p>
      <p className="mt-2 text-xs leading-5 text-muted">{reviews.length ? '试试其他关键词，或切换日报、周报筛选。' : '写下日报或周报后，就能在这里按时间回看。'}</p>
      {reviews.length > 0 && <button onClick={() => update('all', '')} className="mt-4 text-xs text-[var(--accent-solid)]">查看全部复盘</button>}
    </div>}
  </section>;
}
