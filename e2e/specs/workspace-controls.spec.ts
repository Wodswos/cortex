import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const task = (id: string, patch: Record<string, unknown> = {}) => ({
  id, title: id, status: 'todo', parentId: null, order: 0, ownerId: 'fixture', tags: [],
  important: false, urgent: false, priority: 'P3', createdAt: 1, updatedAt: 1, ...patch,
});
async function seed(page: Page, data: unknown) {
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
}
async function exported(page: Page) {
  await page.locator('a[href="/settings"]').first().click();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, 'utf8')).data;
}
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const selected = (page: Page) => page.locator('.react-flow__node.selected');
const canvas = (page: Page) => page.getByRole('region', { name: '任务导图画布', exact: true });
const stylePanel = (page: Page) => page.getByRole('dialog', { name: '节点样式', exact: true });

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  (page as any).__workspaceErrors = errors;
});
test.afterEach(async ({ page }) => { expect((page as any).__workspaceErrors).toEqual([]); });

test('sidebar resizing follows the pointer, persists, supports keyboard and reset, and stays an overlay on mobile', async ({ page }) => {
  await page.goto('/tasks');
  const separator = page.getByRole('separator', { name: '调整侧边栏宽度', exact: true });
  const sidebar = page.locator('aside.workspace-sidebar');
  await expect(separator).toHaveAttribute('aria-valuenow', '224');
  const box = (await separator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 64, box.y + 100, { steps: 8 });
  await page.mouse.up();
  await expect(separator).toHaveAttribute('aria-valuenow', '288');
  expect((await sidebar.boundingBox())!.width).toBe(288);
  await page.reload();
  await expect(separator).toHaveAttribute('aria-valuenow', '288');
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '296');
  await page.keyboard.press('End');
  await expect(separator).toHaveAttribute('aria-valuenow', '360');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await expect(sidebar).toHaveCSS('position', 'fixed');
  expect((await sidebar.boundingBox())!.width).toBeLessThanOrEqual(342);
  await expect(separator).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '关闭导航', exact: true }).click({ position: { x: 385, y: 100 } });
  await page.setViewportSize({ width: 1280, height: 900 });
  await separator.dblclick();
  await expect(separator).toHaveAttribute('aria-valuenow', '224');
});

test('sidebar project menu edits without opening the project and deletes a subtree as one undoable action', async ({ page }) => {
  await seed(page, { tasks: [task('project', { title: 'Project old', kind: 'node', project: true }), task('child', { parentId: 'project' }), task('grandchild', { parentId: 'child' }), task('unrelated')] });
  await page.goto('/tasks');
  await page.getByRole('button', { name: '项目 Project old 菜单', exact: true }).click();
  await page.getByRole('button', { name: '编辑项目', exact: true }).click();
  await page.getByRole('textbox', { name: '任务标题', exact: true }).fill('项目已重命名');
  await page.keyboard.press('Escape');
  const nav = page.getByRole('navigation', { name: '项目', exact: true });
  await expect(nav.getByRole('link', { name: '项目已重命名', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: '项目已重命名', exact: true }).click({ button: 'right' });
  await page.getByRole('button', { name: '删除项目', exact: true }).click();
  await page.getByRole('dialog', { name: '删除项目', exact: true }).getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(nav.getByRole('link')).toHaveCount(0);
  await expect(page.locator('[data-row][data-task-id="child"]')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销 (⌘Z)', exact: true }).click();
  await expect(nav.getByRole('link', { name: '项目已重命名', exact: true })).toBeVisible();
  await expect(page.locator('[data-row][data-task-id="grandchild"]')).toHaveCount(1);
  await page.getByRole('button', { name: '项目 项目已重命名 菜单', exact: true }).click();
  await page.getByRole('button', { name: '删除项目', exact: true }).click();
  await page.getByRole('dialog', { name: '删除项目', exact: true }).getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '删除项目', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(nav.getByRole('link')).toHaveCount(0);
  const data = await exported(page);
  for (const id of ['project', 'child', 'grandchild']) expect(data.tasks.find((value: any) => value.id === id).deletedAt).toBeGreaterThan(0);
  expect(data.tasks.find((value: any) => value.id === 'unrelated').deletedAt).toBeFalsy();
});

test('mind-map Ctrl/Cmd+A selects only visible real nodes, preserves text editing, and supports modifier multi-selection', async ({ page }) => {
  await seed(page, { settings: { completedDisplay: 'hidden' }, tasks: [task('project', { kind: 'node', project: true }),
    task('alpha', { parentId: 'project', title: 'Alpha title', status: 'doing' }), task('beta', { parentId: 'project', title: 'Beta title' }),
    task('complete', { parentId: 'project', status: 'done' }), task('other', { kind: 'node', project: true }), task('outside', { parentId: 'other' }),
  ] });
  await page.goto('/tasks?project=project&view=mindmap');
  await expect(node(page, 'alpha')).toBeVisible();
  await canvas(page).focus();
  await page.keyboard.press('Control+a');
  await expect(selected(page)).toHaveCount(3);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await page.getByRole('button', { name: '清除', exact: true }).click();
  await page.keyboard.press('Meta+a');
  await expect(selected(page)).toHaveCount(3);
  await page.getByRole('button', { name: '清除', exact: true }).click();
  await node(page, 'alpha').getByText('Alpha title', { exact: true }).dblclick();
  const input = page.getByRole('textbox', { name: '导图节点标题', exact: true });
  await expect(input).toBeFocused();
  await input.press('Control+a');
  expect(await input.evaluate((element: HTMLInputElement) => element.selectionEnd! - element.selectionStart!)).toBe('Alpha title'.length);
  await expect(selected(page)).toHaveCount(1);
  await input.press('Enter');
  // Clear selection before explicitly adding two nodes with modifier-clicks.
  await page.getByRole('button', { name: '清除', exact: true }).click();
  await page.keyboard.down('Control');
  await node(page, 'alpha').getByText('Alpha title', { exact: true }).click();
  await node(page, 'beta').getByText('Beta title', { exact: true }).click();
  await page.keyboard.up('Control');
  await expect(selected(page)).toHaveCount(2);
  await page.getByRole('region', { name: '工作概览', exact: true }).getByRole('button', { name: /^当前工作/ }).click();
  await page.keyboard.press('Control+a');
  await expect(selected(page)).toHaveCount(3); // focus dims context without removing it
  await expect(node(page, 'beta')).toBeVisible();
  await page.goto('/tasks?view=mindmap&mindFocus=all');
  await expect(node(page, '__cortex_all__')).toBeVisible();
  await canvas(page).focus();
  await page.keyboard.press('Control+a');
  await expect(selected(page)).toHaveCount(5);
  await expect(node(page, '__cortex_all__')).not.toHaveClass(/selected/);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`mind-map batch appearance persists, undoes and keeps edges aligned in ${scheme} theme`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: scheme });
    await seed(page, { tasks: [task('project', { kind: 'node', project: true }),
      task('group', { kind: 'node', project: false, parentId: 'project', title: 'Structural phase' }),
      task('alpha', { parentId: 'group', title: '工作内容 Alpha' }), task('beta', { parentId: 'project', title: 'Beta work', mindFontSize: 12 }),
      task('foreign', { kind: 'node', project: true }),
    ] });
    await page.goto('/tasks?project=project&view=mindmap');
    await expect(node(page, 'alpha')).toBeVisible();
    await canvas(page).focus(); await page.keyboard.press('Control+a');
    await expect(selected(page)).toHaveCount(4);
    await page.getByRole('button', { name: '调整所选节点样式', exact: true }).click();
    const panel = stylePanel(page);
    await expect(panel.getByLabel('节点字号', { exact: true })).toHaveValue('mixed');
    await panel.getByRole('button', { name: '背景：鼠尾草', exact: true }).click();
    await panel.getByLabel('节点字体', { exact: true }).selectOption('mono');
    await panel.getByLabel('节点字号', { exact: true }).selectOption('24');
    await expect(panel.getByRole('button', { name: '节点粗体', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await panel.getByRole('button', { name: '节点粗体', exact: true }).click();
    await expect(node(page, 'alpha').locator('[data-mind-title]')).toHaveCSS('font-weight', '400');
    await panel.getByRole('button', { name: '节点粗体', exact: true }).click();
    await panel.getByRole('button', { name: '节点斜体', exact: true }).click();
    for (const id of ['project', 'group', 'alpha', 'beta']) {
      const title = node(page, id).locator('[data-mind-title]');
      await expect(title).toHaveCSS('font-size', '24px');
      await expect(title).toHaveCSS('font-weight', '700');
      await expect(title).toHaveCSS('font-style', 'italic');
    }
    await expect.poll(() => page.evaluate(() => {
      let error = 0;
      for (const edge of document.querySelectorAll<SVGGElement>('.react-flow__edge')) {
        const [sourceId, targetId] = edge.dataset.id!.split('->');
        const source = document.querySelector(`[data-id="${sourceId}"]`)!.getBoundingClientRect();
        const targetElement = document.querySelector(`[data-id="${targetId}"]`)!;
        const target = targetElement.getBoundingClientRect();
        const left = targetElement.querySelector('[data-mind-side="left"]') !== null;
        const path = edge.querySelector<SVGPathElement>('.react-flow__edge-path')!;
        const start = path.getPointAtLength(0).matrixTransform(path.getScreenCTM()!);
        const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(path.getScreenCTM()!);
        error = Math.max(error, Math.abs(start.x - (left ? source.left : source.right)), Math.abs(end.x - (left ? target.right : target.left)), Math.abs(start.y - source.y - source.height / 2), Math.abs(end.y - target.y - target.height / 2));
      }
      return error;
    })).toBeLessThan(0.6);
    await panel.getByRole('button', { name: '关闭节点样式', exact: true }).click();
    await page.keyboard.press('Control+z');
    for (const id of ['project', 'group', 'alpha', 'beta']) await expect(node(page, id).locator('[data-mind-title]')).toHaveCSS('font-style', 'normal');
    await page.keyboard.press('Control+Shift+z');
    await expect(node(page, 'alpha').locator('[data-mind-title]')).toHaveCSS('font-style', 'italic');
    await page.getByRole('button', { name: '调整所选节点样式', exact: true }).click();
    await panel.getByLabel('自定义节点背景', { exact: true }).fill('#243848');
    await expect(node(page, 'alpha').locator('[data-mind-title]')).toHaveCSS('color', 'rgb(245, 246, 248)');
    await panel.getByLabel('自定义节点文字', { exact: true }).fill('#f3e8c8');
    for (const id of ['project', 'group', 'alpha', 'beta']) await expect(node(page, id).locator('[data-mind-title]')).toHaveCSS('color', 'rgb(243, 232, 200)');
    await expect(node(page, 'alpha').locator('.group').first()).toHaveCSS('background-color', 'rgb(36, 56, 72)');
    await page.getByRole('button', { name: '全局视图', exact: true }).click();
    await expect(node(page, 'alpha')).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`mindmap-${scheme}.png`) });
    await page.reload();
    await expect(node(page, 'alpha').locator('[data-mind-title]')).toHaveCSS('color', 'rgb(243, 232, 200)');
    const data = await exported(page);
    for (const id of ['project', 'group', 'alpha', 'beta']) expect(data.tasks.find((value: any) => value.id === id)).toMatchObject({ mindBackground: '#243848', mindTextColor: '#f3e8c8', mindFontFamily: 'mono', mindFontSize: 24, mindBold: true, mindItalic: true });
    expect(data.tasks.find((value: any) => value.id === 'alpha')).toMatchObject({ title: '工作内容 Alpha', parentId: 'group', status: 'todo' });
    expect(data.tasks.find((value: any) => value.id === 'foreign').mindBackground).toBeUndefined();
    await page.goto('/tasks?project=project&view=mindmap');
    await canvas(page).focus(); await page.keyboard.press('Control+a');
    await page.getByRole('button', { name: '调整所选节点样式', exact: true }).click();
    await panel.getByRole('button', { name: '恢复默认样式', exact: true }).click();
    await expect(node(page, 'alpha').locator('[data-mind-title]')).toHaveCSS('font-size', '16px');
    await expect(node(page, 'group').locator('[data-mind-title]')).toHaveCSS('font-size', '16px');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(panel).toBeVisible();
    const bounds = (await panel.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await panel.getByRole('button', { name: '恢复默认样式', exact: true }).scrollIntoViewIfNeeded();
    await expect(panel.getByRole('button', { name: '恢复默认样式', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
