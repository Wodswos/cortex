import { isStructural, type MindFont, type Task } from '@cortex/core';
import { titleAppearance } from './appearance';

export const VIRTUAL_ROOT_ID = '__cortex_all__';
export type BranchSide = 'left' | 'right';
export interface MindMetrics { width: number; height: number; padX: number; padY: number; signature: string }
export interface MindPosition { x: number; y: number; depth: number; side: BranchSide; branch: number }
let context: CanvasRenderingContext2D | null | undefined;

export function mindMetrics(task: Task, depth: number, footer: boolean, inheritedFont?: MindFont | null): MindMetrics {
  const style = titleAppearance(task, depth, inheritedFont);
  const size = Number(style.fontSize);
  if (context === undefined && typeof document !== 'undefined') context = document.createElement('canvas').getContext('2d');
  if (context) context.font = `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`;
  const measure = (text: string) => context?.measureText(text).width ?? [...text].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? size : size * 0.6), 0);
  const padX = depth === 0 ? 22 : depth === 1 ? 16 : 14;
  const padY = depth === 0 ? 14 : depth === 1 ? 11 : 8;
  const checkbox = !isStructural(task) && task.id !== VIRTUAL_ROOT_ID ? 24 : 0;
  const text = task.title || '未命名';
  const widest = Math.max(...text.split('\n').map(measure));
  const titleWidth = Math.ceil(Math.min(depth === 0 ? 280 : depth === 1 ? 220 : 256, Math.max(depth === 0 ? 124 : 72, widest)));
  let lines = 0;
  for (const line of text.split('\n')) {
    let width = 0; lines++;
    for (const char of line) {
      const next = measure(char);
      if (width && width + next > titleWidth) { lines++; width = 0; }
      width += next;
    }
  }
  return {
    width: titleWidth + checkbox + padX * 2 + 2,
    height: Math.ceil(lines * size * 1.5 + padY * 2 + 2 + (footer ? 21 : 0)),
    padX, padY,
    signature: JSON.stringify([text, depth, footer, style.fontSize, style.fontFamily, style.fontWeight, style.fontStyle]),
  };
}

/** Content-sized subtrees. All branches expand to the right; focus never changes geometry. */
export function layoutMindTree(
  roots: Task[],
  children: (id: string) => Task[],
  sizes: Map<string, { width: number; height: number }>,
): Map<string, MindPosition> {
  const result = new Map<string, MindPosition>();
  const spans = new Map<string, number>();
  const sizeOf = (id: string) => sizes.get(id) ?? { width: 160, height: 44 };
  // Iterative postorder makes layout linear, even for deep project trees.
  const stack = roots.map((task) => ({ task, after: false }));
  while (stack.length) {
    const { task, after } = stack.pop()!;
    const kids = children(task.id);
    if (!after) {
      stack.push({ task, after: true });
      for (const child of kids) stack.push({ task: child, after: false });
    } else spans.set(task.id, Math.max(sizeOf(task.id).height, kids.reduce((sum, child) => sum + spans.get(child.id)!, 0) + Math.max(0, kids.length - 1) * 14));
  }
  let rootY = 0;
  for (const root of roots) {
    const rootSize = sizeOf(root.id);
    result.set(root.id, { x: -rootSize.width / 2, y: rootY - rootSize.height / 2, depth: 0, side: 'right', branch: 0 });
    const main = children(root.id);
    const branches = main.map((task, index) => ({ task, index }));
    const height = branches.reduce((sum, { task }) => sum + spans.get(task.id)!, 0) + Math.max(0, branches.length - 1) * 36;
    let cursor = rootY - height / 2;
    const pending: { task: Task; parent: string; center: number; depth: number; branch: number }[] = [];
    for (const { task, index } of branches) {
      pending.push({ task, parent: root.id, center: cursor + spans.get(task.id)! / 2, depth: 1, branch: index });
      cursor += spans.get(task.id)! + 36;
    }
    while (pending.length) {
      const { task, parent, center, depth, branch } = pending.pop()!;
      const parentPos = result.get(parent)!;
      const size = sizeOf(task.id);
      const gap = depth === 1 ? 58 : 40;
      const x = parentPos.x + sizeOf(parent).width + gap;
      result.set(task.id, { x, y: center - size.height / 2, depth, side: 'right', branch });
      const kids = children(task.id);
      const kidsHeight = kids.reduce((sum, child) => sum + spans.get(child.id)!, 0) + Math.max(0, kids.length - 1) * 14;
      let childY = center - kidsHeight / 2;
      for (const child of kids) {
        pending.push({ task: child, parent: task.id, center: childY + spans.get(child.id)! / 2, depth: depth + 1, branch });
        childY += spans.get(child.id)! + 14;
      }
    }
    rootY += Math.max(rootSize.height, height) + 64;
  }
  return result;
}
