import { addDays as dfAddDays, startOfWeek as dfStartOfWeek } from 'date-fns';

/** 本地时区 'YYYY-MM-DD' */
export function dayKeyOf(d: Date | number): string {
  const dt = typeof d === 'number' ? new Date(d) : d;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function dateFromDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function startOfDay(d: Date | number): Date {
  const dt = typeof d === 'number' ? new Date(d) : new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

export function endOfDay(d: Date | number): Date {
  const dt = startOfDay(d);
  dt.setDate(dt.getDate() + 1);
  return dt; // 次日 00:00(开区间)
}

export function addDays(d: Date | number, n: number): Date {
  return dfAddDays(typeof d === 'number' ? new Date(d) : d, n);
}

export function startOfWeek(d: Date | number, weekStartsOn: 0 | 1 = 1): Date {
  return dfStartOfWeek(typeof d === 'number' ? new Date(d) : d, { weekStartsOn });
}

export function minutesOfDay(d: Date | number): number {
  const dt = typeof d === 'number' ? new Date(d) : d;
  return dt.getHours() * 60 + dt.getMinutes();
}

/** 日视图等宽对齐用:分 → 像素 */
export function minuteToPx(min: number, pxPerHour: number): number {
  return (min / 60) * pxPerHour;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function fmtHM(ms: number): string {
  const dt = new Date(ms);
  return `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}

export const WEEKDAY_ZH = ['一', '二', '三', '四', '五', '六', '日'];

/** iso: 1=Mon..7=Sun */
export function weekdayOf(d: Date | number): number {
  const day = (typeof d === 'number' ? new Date(d) : d).getDay(); // 0=Sun
  return day === 0 ? 7 : day;
}

/** 下一个周几(从 from 起,当天算当天) */
export function nextWeekday(from: Date, iso: number): Date {
  const target = iso % 7; // Date.getDay(): 0=Sun
  let d = startOfDay(from);
  for (let i = 0; i < 8; i++) {
    if (d.getDay() === target) return d;
    d = addDays(d, 1);
  }
  return d;
}

export function isSameDayKey(a: Date | number, b: Date | number): boolean {
  return dayKeyOf(a) === dayKeyOf(b);
}

/** Calendar coordinates: every local date occupies one column, including 23/25-hour days. */
export function calendarDaysBetween(a: Date | number, b: Date | number): number {
  const first = new Date(a), second = new Date(b);
  return (Date.UTC(second.getFullYear(), second.getMonth(), second.getDate()) - Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())) / 86400000;
}
export function calendarPosition(time: number, origin: Date | number): number {
  const start = startOfDay(time).getTime();
  return calendarDaysBetween(origin, time) + (time - start) / (endOfDay(time).getTime() - start);
}
export function timeAtCalendarPosition(position: number, origin: Date | number): number {
  const start = addDays(startOfDay(origin), Math.floor(position)).getTime();
  return start + (position - Math.floor(position)) * (endOfDay(start).getTime() - start);
}
