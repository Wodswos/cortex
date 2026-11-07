import { describe, expect, it } from 'vitest';
import { createTaskSheetPull } from '../src/shared/taskSheetPull';

describe('mobile task sheet pull', () => {
  it('requires a deliberate downward pull from the top and applies resistance', () => {
    const pull = createTaskSheetPull({ x: 10, y: 100 }, true);
    expect(pull.move({ x: 11, y: 105 }, true)).toEqual({ pulling: false, offset: 0 });
    expect(pull.move({ x: 12, y: 160 }, true)).toEqual({ pulling: true, offset: 48 });
    expect(pull.shouldDismiss()).toBe(false);
    expect(pull.move({ x: 12, y: 220 }, true)).toEqual({ pulling: true, offset: 96 });
    expect(pull.shouldDismiss()).toBe(true);
    expect(pull.move({ x: 12, y: 400 }, true).offset).toBeLessThan(200);
  });
  it('does not count content scrolling before the finger reaches the top', () => {
    const pull = createTaskSheetPull({ x: 10, y: 100 }, false);
    expect(pull.move({ x: 10, y: 300 }, false)).toEqual({ pulling: false, offset: 0 });
    expect(pull.move({ x: 10, y: 350 }, true)).toEqual({ pulling: false, offset: 0 });
    expect(pull.shouldDismiss()).toBe(false);
    expect(pull.move({ x: 10, y: 410 }, true).offset).toBe(48);
    expect(pull.shouldDismiss()).toBe(false);
    pull.move({ x: 10, y: 460 }, true);
    expect(pull.shouldDismiss()).toBe(true);
  });
  it('keeps upward scrolling and horizontal gestures from dismissing the sheet', () => {
    const up = createTaskSheetPull({ x: 10, y: 200 }, true);
    expect(up.move({ x: 10, y: 100 }, true)).toEqual({ pulling: false, offset: 0 });
    expect(up.shouldDismiss()).toBe(false);
    const across = createTaskSheetPull({ x: 10, y: 100 }, true);
    across.move({ x: 90, y: 105 }, true);
    expect(across.move({ x: 95, y: 300 }, true)).toEqual({ pulling: false, offset: 0 });
    expect(across.shouldDismiss()).toBe(false);
  });
  it('allows reversing a content scroll into a new top-boundary pull', () => {
    const pull = createTaskSheetPull({ x: 10, y: 300 }, true);
    pull.move({ x: 10, y: 200 }, false);
    pull.move({ x: 10, y: 300 }, false);
    pull.move({ x: 10, y: 350 }, true);
    pull.move({ x: 10, y: 460 }, true);
    expect(pull.shouldDismiss()).toBe(true);
  });
  it('rebounds when the user reverses or content can scroll upwards again', () => {
    const pull = createTaskSheetPull({ x: 10, y: 100 }, true);
    pull.move({ x: 10, y: 240 }, true);
    expect(pull.shouldDismiss()).toBe(true);
    expect(pull.move({ x: 10, y: 120 }, true).offset).toBe(16);
    expect(pull.shouldDismiss()).toBe(false);
    expect(pull.move({ x: 10, y: 150 }, false)).toEqual({ pulling: false, offset: 0 });
  });
});
