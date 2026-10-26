import { describe, it, expect } from 'vitest';
import { isDueOn, habitStreak, heatmapWeeks, logCountOn, isDoneOn } from '../src/cadence';
import { Habit, HabitLog } from '../src/types';
import { dayKeyOf, addDays } from '../src/time';

const TODAY = new Date(2026, 7, 29); // 周六

function H(partial: Partial<Habit>): Habit {
  return {
    id: 'h1',
    name: 'x',
    icon: 'Check',
    color: '#22d3ee',
    cadence: { type: 'daily' },
    ownerId: 'u1',
    createdAt: new Date(2026, 0, 1).getTime(),
    ...partial,
  } as Habit;
}

function L(habitId: string, dayKey: string, count = 1): HabitLog {
  return { id: `${habitId}-${dayKey}`, habitId, date: dayKey, count, ownerId: 'u1' };
}

describe('isDueOn', () => {
  it('daily 恒真', () => {
    expect(isDueOn(H({ cadence: { type: 'daily' } }), '2026-08-29')).toBe(true);
  });
  it('interval 每 3 天锚定 createdAt', () => {
    const h = H({ cadence: { type: 'interval', everyNDays: 3 }, createdAt: new Date(2026, 7, 26).getTime() });
    expect(isDueOn(h, '2026-08-26')).toBe(true);
    expect(isDueOn(h, '2026-08-29')).toBe(true);
    expect(isDueOn(h, '2026-08-28')).toBe(false);
  });
  it('weekly 指定周一/周三/周五', () => {
    const h = H({ cadence: { type: 'weekly', timesPerWeek: 3, days: [1, 3, 5] } });
    expect(isDueOn(h, '2026-08-31')).toBe(true); // 周一
    expect(isDueOn(h, '2026-08-29')).toBe(false); // 周六
  });
  it('weekly 弹性恒 false', () => {
    const h = H({ cadence: { type: 'weekly', timesPerWeek: 3 } });
    expect(isDueOn(h, '2026-08-29')).toBe(false);
  });
});

describe('habitStreak', () => {
  it('每日习惯连续 4 天(今天已打)', () => {
    const logs = [27, 28, 29].map((d) => L('h1', dayKeyOf(addDays(TODAY, -(29 - d)))));
    const s = habitStreak(H({}), logs, TODAY);
    // 26 号未打 → streak 3
    expect(s).toBe(3);
  });
  it('今天未打不断 streak', () => {
    const logs = [26, 27, 28].map((d) => L('h1', dayKeyOf(addDays(TODAY, -d + 25))));
    const s = habitStreak(H({}), logs, TODAY);
    expect(s).toBeGreaterThanOrEqual(3);
  });
  it('每日多次目标 count 累计', () => {
    const h = H({ targetPerDay: 3 });
    const logs = [
      L('h1', dayKeyOf(TODAY), 2),
      L('h1', dayKeyOf(TODAY), 1),
    ];
    expect(logCountOn(logs, 'h1', dayKeyOf(TODAY))).toBe(3);
    expect(isDoneOn(h, logs, dayKeyOf(TODAY))).toBe(true);
  });
});

describe('heatmapWeeks', () => {
  it('列数 = weeks,每列 7 天,无未来之外越界', () => {
    const cols = heatmapWeeks(H({}), [], 20, TODAY);
    expect(cols.length).toBe(20);
    for (const col of cols) expect(col.length).toBe(7);
    // 最后一列含今天,今天之后标记 future
    const last = cols[cols.length - 1]!;
    const future = last.filter((c) => c.future);
    expect(future.length).toBeGreaterThan(0);
  });
});
