/** 只读 .ics 日历订阅导出(RFC 5545 子集)。CRLF 行尾。 */

export interface ICalEvent {
  uid: string;
  title: string;
  start: Date;
  end?: Date; // 缺省 = start + 30min
  allDay?: boolean;
  description?: string;
  completed?: boolean;
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function fold(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const point = char.codePointAt(0)!;
    const size = point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (bytes + size > 75) {
      parts.push(current);
      current = ' ';
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n');
}

function icsUTC(d: Date): string {
  return (
    String(d.getUTCFullYear()).padStart(4, '0') +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0') +
    'T' +
    String(d.getUTCHours()).padStart(2, '0') +
    String(d.getUTCMinutes()).padStart(2, '0') +
    '00Z'
  );
}

function icsDate(d: Date): string {
  return (
    String(d.getFullYear()).padStart(4, '0') +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  );
}

export function generateICS(events: ICalEvent[], calName = 'Cortex'): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cortex//Cortex Calendar//CN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${esc(calName)}`,
  ];
  const stamp = icsUTC(new Date());
  for (const e of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.uid}@cortex`);
    lines.push(`DTSTAMP:${stamp}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(e.start)}`);
      if (e.end) lines.push(`DTEND;VALUE=DATE:${icsDate(e.end)}`);
    } else {
      lines.push(`DTSTART:${icsUTC(e.start)}`);
      const end = e.end ?? new Date(e.start.getTime() + 30 * 60000);
      lines.push(`DTEND:${icsUTC(end)}`);
    }
    lines.push(`SUMMARY:${esc(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.completed) lines.push('STATUS:COMPLETED');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
