/** First instant in a caller's local calendar day. Searching date boundaries
 * handles DST at midnight, rather than assuming that every day lasts 24 hours. */
export function reviewDayStart(day: string, timeZone: string): number {
  const format = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const key = (at: number) => {
    const parts = Object.fromEntries(format.formatToParts(at).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const midnight = Date.parse(`${day}T00:00:00Z`);
  let low = midnight - 36 * 3600000, high = midnight + 36 * 3600000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (key(mid) < day) low = mid + 1; else high = mid;
  }
  if (key(low) !== day) throw new Error('该时区不存在指定日期');
  return low;
}
