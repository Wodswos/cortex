import type { CortexData } from './types';
import { reviewId, validReviewPeriod } from './reviews';

const collections = ['tasks', 'events', 'links', 'sessions', 'habits', 'habitLogs', 'tags', 'reviews'] as const;
const numeric = new Set(['order', 'createdAt', 'updatedAt', 'startAt', 'dueAt', 'completedAt', 'deletedAt', 'archivedAt', 'estimateMin', 'start', 'end', 'startedAt', 'endedAt', 'plannedMin', 'actualMin', 'distractions', 'count', 'targetPerDay']);
const strings = new Set(['id', 'title', 'notes', 'ownerId', 'name', 'date', 'taskId', 'parentId', 'target', 'serverId', 'session', 'icon', 'color', 'reminderAt', 'linkedTaskTemplateId', 'habitId', 'periodStart', 'periodEnd', 'highlights', 'friction', 'nextSteps']);
const nullable = new Set(['parentId', 'taskId', 'linkedTaskTemplateId', 'startAt', 'dueAt', 'completedAt', 'deletedAt', 'archivedAt', 'priority', 'kind', 'facts']);
const nonnegative = new Set(['estimateMin', 'plannedMin', 'actualMin', 'distractions', 'count', 'targetPerDay']);
const enums: Record<string, readonly string[]> = {
  status: ['inbox', 'todo', 'doing', 'done', 'archived'], priority: ['P0', 'P1', 'P2', 'P3'],
  mode: ['focus', 'short-break', 'long-break'], type: ['url', 'obsidian', 'yuque', 'agent', 'tmux'],
};
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
const stringsOnly = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
function check(condition: boolean, field: string): asserts condition { if (!condition) throw new Error(`数据格式错误: ${field}`); }

/** Validate the complete input before mutating any document. Supports older optional fields. */
export function validateCortexData(value: unknown): Partial<CortexData> {
  check(record(value), 'data');
  check(collections.some((key) => key in value) || 'settings' in value, '缺少数据集合');
  for (const name of collections) {
    const rows = value[name];
    if (rows === undefined) continue;
    check(Array.isArray(rows) && rows.length <= 200000, name);
    const ids = new Set<string>();
    for (const row of rows) {
      check(record(row) && typeof row.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(row.id) && !ids.has(row.id), `${name}.id`);
      ids.add(row.id as string);
      for (const [field, fieldValue] of Object.entries(row)) {
        if (fieldValue == null) { check(nullable.has(field), `${name}.${field}`); continue; }
        if (numeric.has(field)) check(typeof fieldValue === 'number' && Number.isFinite(fieldValue), `${name}.${field}`);
        if (nonnegative.has(field)) check(typeof fieldValue === 'number' && fieldValue >= 0, `${name}.${field}`);
        if (strings.has(field)) check(typeof fieldValue === 'string', `${name}.${field}`);
        if (enums[field]) check(typeof fieldValue === 'string' && enums[field]!.includes(fieldValue), `${name}.${field}`);
        if (['important', 'urgent', 'completed', 'project'].includes(field)) check(typeof fieldValue === 'boolean', `${name}.${field}`);
        if (field === 'tags' || field === 'cancelledUnits') check(stringsOnly(fieldValue), `${name}.${field}`);
      }
      if (name === 'tasks') {
        check(row.tags === undefined || stringsOnly(row.tags), 'task.tags');
        check(row.kind == null || row.kind === 'todo' || row.kind === 'node', 'task.kind');
      }
      if (name === 'events' && typeof row.start === 'number' && typeof row.end === 'number') check(row.end >= row.start, 'event.end');
      if (name === 'events') check(row.kind === undefined || ['focus', 'meeting', 'personal', 'routine'].includes(String(row.kind)), 'event.kind');
      if (name === 'reviews') {
        const period = { kind: row.kind, start: row.periodStart, end: row.periodEnd } as import('./types').ReviewPeriod;
        check(validReviewPeriod(period) && row.id === reviewId(period), 'review.period');
        for (const field of ['highlights', 'friction', 'nextSteps']) check(typeof row[field] === 'string' && String(row[field]).length <= 100000, `review.${field}`);
        if (row.facts != null) {
          const facts = row.facts;
          check(record(facts) && typeof facts.capturedAt === 'number' && Number.isFinite(facts.capturedAt)
            && typeof facts.focusMin === 'number' && Number.isFinite(facts.focusMin) && facts.focusMin >= 0, 'review.facts');
          for (const key of ['completed', 'pending']) check(Array.isArray(facts[key]) && facts[key].length <= 200000 && facts[key].every((task: unknown) => record(task) && typeof task.id === 'string' && typeof task.title === 'string' && typeof task.project === 'string'), `review.facts.${key}`);
          check(Array.isArray(facts.projects) && facts.projects.every((project: unknown) => record(project) && typeof project.id === 'string' && typeof project.title === 'string' && Number.isInteger(project.done) && Number.isInteger(project.total) && Number(project.done) >= 0 && Number(project.total) >= Number(project.done)), 'review.facts.projects');
        }
        if (row.completedAt != null) check(row.facts != null, 'review.completedFacts');
      }
      if (name === 'habitLogs') check(typeof row.count === 'number' && Number.isInteger(row.count) && row.count >= 0 && row.count <= 10000, 'habitLog.count');
      if (name === 'habits') {
        check(record(row.cadence), 'habit.cadence');
        const c = row.cadence;
        check(['daily', 'weekly', 'interval', 'custom'].includes(String(c.type)), 'cadence.type');
        if (c.type === 'weekly') check(Number.isInteger(c.timesPerWeek) && Number(c.timesPerWeek) >= 1 && Number(c.timesPerWeek) <= 100 && (c.days === undefined || Array.isArray(c.days) && c.days.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)), 'cadence.weekly');
        if (c.type === 'custom') check(typeof c.cron === 'string', 'cadence.cron');
        if (c.type === 'interval') check(Number.isInteger(c.everyNDays) && Number(c.everyNDays) > 0, 'cadence.interval');
        if (row.targetPerDay !== undefined) check(Number.isInteger(row.targetPerDay) && Number(row.targetPerDay) >= 1 && Number(row.targetPerDay) <= 10000, 'habit.targetPerDay');
      }
    }
  }
  if (value.settings !== undefined) {
    check(record(value.settings), 'settings');
    const settings = value.settings;
    if (settings.hiddenRoots !== undefined) check(stringsOnly(settings.hiddenRoots), 'settings.hiddenRoots');
    if (settings.servers !== undefined) {
      check(Array.isArray(settings.servers) && settings.servers.every((server) => record(server) && typeof server.id === 'string' && typeof server.host === 'string' && typeof server.name === 'string'), 'settings.servers');
    }
    if (settings.accent !== undefined) check(['cyan-violet', 'emerald', 'amber', 'rose', 'mono'].includes(String(settings.accent)), 'settings.accent');
    if (settings.completedDisplay !== undefined) check(['inline-gray', 'hidden'].includes(String(settings.completedDisplay)), 'settings.completedDisplay');
    if (settings.mindEdgeStyle !== undefined) check(['curve', 'straight', 'step'].includes(String(settings.mindEdgeStyle)), 'settings.mindEdgeStyle');
    if (settings.weekStartsOn !== undefined) check(settings.weekStartsOn === 0 || settings.weekStartsOn === 1, 'settings.weekStartsOn');
    for (const key of ['reviewDailyEnabled', 'reviewWeeklyEnabled']) if (settings[key] !== undefined) check(typeof settings[key] === 'boolean', `settings.${key}`);
    for (const key of ['reviewDailyTime', 'reviewWeeklyTime']) if (settings[key] !== undefined) check(typeof settings[key] === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(settings[key]), `settings.${key}`);
    if (settings.reviewWeeklyDay !== undefined) check(Number.isInteger(settings.reviewWeeklyDay) && Number(settings.reviewWeeklyDay) >= 0 && Number(settings.reviewWeeklyDay) <= 6, 'settings.reviewWeeklyDay');
    if (settings.pomodoro !== undefined) {
      check(record(settings.pomodoro), 'settings.pomodoro');
      for (const key of ['focusMin', 'shortBreakMin', 'longBreakMin', 'longEvery']) if (key in settings.pomodoro) check(typeof settings.pomodoro[key] === 'number' && Number.isFinite(settings.pomodoro[key]) && Number(settings.pomodoro[key]) > 0 && Number(settings.pomodoro[key]) <= 1440, `settings.pomodoro.${key}`);
      if ('autoStartBreak' in settings.pomodoro) check(typeof settings.pomodoro.autoStartBreak === 'boolean', 'settings.pomodoro.autoStartBreak');
    }
  }
  return value as Partial<CortexData>;
}
