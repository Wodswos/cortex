import { describe, it, expect } from 'vitest';
import { parseCapture } from '../src/parse';
import { startOfDay, addDays, dayKeyOf, nextWeekday } from '../src/time';

const NOW = new Date(2026, 7, 29, 10, 0); // 2026-08-29 周六 10:00

describe('parseCapture', () => {
  it('纯文本', () => {
    const r = parseCapture('买牛奶', NOW);
    expect(r.title).toBe('买牛奶');
    expect(r.tags).toEqual([]);
    expect(r.dueAt).toBeUndefined();
  });

  it('#tag 多个去重', () => {
    const r = parseCapture('写周报 #work #报告 #work', NOW);
    expect(r.tags).toEqual(['work', '报告']);
    expect(r.title).toBe('写周报');
  });

  it('!P0 / !P2 / ! / !!', () => {
    expect(parseCapture('x !P0', NOW).priority).toBe('P0');
    expect(parseCapture('x !p2', NOW).priority).toBe('P2');
    expect(parseCapture('x !', NOW).priority).toBe('P1');
    expect(parseCapture('x !!', NOW).priority).toBe('P0');
  });

  it('~90m / ~2h 预估', () => {
    expect(parseCapture('重构 ~90m', NOW).estimateMin).toBe(90);
    expect(parseCapture('重构 ~2h', NOW).estimateMin).toBe(120);
  });

  it('@明天 中文', () => {
    const r = parseCapture('交报告 @明天', NOW);
    expect(r.dueAt).toBe(startOfDay(addDays(NOW, 1)).getTime());
  });

  it('@mon 解析为下周一(从周六起)', () => {
    const r = parseCapture('站会 @mon', NOW);
    expect(dayKeyOf(r.dueAt!)).toBe(dayKeyOf(nextWeekday(NOW, 1)));
  });

  it('@2026-09-01 显式日期', () => {
    const r = parseCapture('发布会 @2026-09-01', NOW);
    expect(dayKeyOf(r.dueAt!)).toBe('2026-09-01');
  });

  it('时刻 @21:30 默认今天(未过点)', () => {
    const r = parseCapture('夜跑 @21:30', NOW); // 10:00 < 21:30
    const d = new Date(r.dueAt!);
    expect(d.getHours()).toBe(21);
    expect(d.getMinutes()).toBe(30);
    expect(dayKeyOf(d)).toBe(dayKeyOf(NOW));
  });

  it('时刻已过 → 顺延明天', () => {
    const r = parseCapture('晨跑 @7:00', NOW); // 10:00 已过
    expect(dayKeyOf(r.dueAt!)).toBe(dayKeyOf(addDays(NOW, 1)));
  });

  it('日期 + 时刻组合', () => {
    const r = parseCapture('评审会 @明天 @9:30', NOW);
    const d = new Date(r.dueAt!);
    expect(dayKeyOf(d)).toBe(dayKeyOf(addDays(NOW, 1)));
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(30);
  });

  it('未识别 @ 保留原样', () => {
    const r = parseCapture('联系 @someone 一下', NOW);
    expect(r.title).toContain('@someone');
  });

  it('全语法组合', () => {
    const r = parseCapture('修复登录超时 #bug #auth !P0 ~45m @周一 @14:00', NOW);
    expect(r.title).toBe('修复登录超时');
    expect(r.tags).toEqual(['bug', 'auth']);
    expect(r.priority).toBe('P0');
    expect(r.estimateMin).toBe(45);
    expect(dayKeyOf(r.dueAt!)).toBe(dayKeyOf(nextWeekday(NOW, 1)));
    expect(new Date(r.dueAt!).getHours()).toBe(14);
  });

  it('空标题回退为日期', () => {
    const r = parseCapture('#tag !P1', NOW);
    expect(r.title).toBe(dayKeyOf(NOW));
  });
});
