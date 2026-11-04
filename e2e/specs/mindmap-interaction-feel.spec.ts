import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const task = (id: string, patch: Record<string, unknown> = {}) => ({ id, title: id, parentId: null, status: 'todo', order: 0, ownerId: 'fixture', tags: [], important: false, urgent: false, createdAt: 1, updatedAt: 1, ...patch });
async function seed(page: Page, tasks: unknown[]) {
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'interaction.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tasks })) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
}
const project = task('project', { title: 'Project', kind: 'node', project: true });
const canvas = (page: Page) => page.getByRole('region', { name: '任务导图画布', exact: true });

test('hover and selection share one frame without resizing or moving tasks, in either color scheme', async ({ page }, testInfo) => {
  await seed(page, [project, task('alpha', { parentId: 'project' }), task('beta', { parentId: 'project', order: 1 })]);
  await page.goto('/tasks?project=project&view=mindmap');
  const node = page.locator('.react-flow__node[data-id="alpha"]');
  const card = node.locator('.mind-node');
  await expect(page.locator('.react-flow__edge-path')).toHaveCount(2);
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.getByRole('button', { name: '根节点', exact: true }).click();
  await page.waitForTimeout(220); // complete the explicit camera animation before measuring
  const original = await card.boundingBox();
  const frameGeometry = () => card.evaluate(element => {
    const style = getComputedStyle(element, '::after');
    return { top: style.top, right: style.right, bottom: style.bottom, left: style.left, width: style.width, height: style.height, radius: style.borderRadius, border: style.borderWidth };
  });
  const previewFrame = await frameGeometry();
  const camera = await page.locator('.react-flow__viewport').getAttribute('style');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.mouse.move(0, 0);
    await expect.poll(() => card.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('0');
    await card.hover();
    await expect.poll(() => card.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('1');
    const ring = await card.evaluate(element => { const style = getComputedStyle(element, '::after'); return { color: style.borderColor, events: style.pointerEvents, border: style.borderWidth }; });
    expect(ring.color).toContain('/ 0.35');
    expect(ring.events).toBe('none');
    expect(ring.border).toBe('2px');
    expect(await card.boundingBox()).toEqual(original);
    expect(await page.locator('.react-flow__viewport').getAttribute('style')).toBe(camera);
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`task-hover-${colorScheme}.png`) });
  }
  const innerBorder = await card.evaluate(element => getComputedStyle(element).borderColor);
  await node.click();
  await expect(node).toHaveClass(/selected/);
  await expect.poll(() => card.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('1');
  expect(await frameGeometry()).toEqual(previewFrame);
  expect(await card.boundingBox()).toEqual(original);
  expect(await card.evaluate(element => getComputedStyle(element).borderColor)).toBe(innerBorder);
  expect(await card.evaluate(element => getComputedStyle(element, '::after').borderColor)).not.toContain('/ 0.35');
  expect(await card.evaluate(element => getComputedStyle(element, '::after').transitionDuration)).toBe('0s');
  await page.mouse.move(0, 0);
  await expect.poll(() => card.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('1');
  await page.screenshot({ path: testInfo.outputPath('task-selected-dark.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await card.evaluate(element => parseFloat(getComputedStyle(element, '::after').transitionDuration))).toBeLessThan(0.001);
});

test('press selection preserves modifier toggles and selected batches while node controls retain their own actions', async ({ page }) => {
  await seed(page, [project, task('alpha', { parentId: 'project' }), task('beta', { parentId: 'project', order: 1 })]);
  await page.goto('/tasks?project=project&view=mindmap');
  const alpha = page.locator('.react-flow__node[data-id="alpha"]');
  const beta = page.locator('.react-flow__node[data-id="beta"]');
  await alpha.locator('[data-mind-title]').click();
  await beta.locator('[data-mind-title]').click({ modifiers: ['Control'] });
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  const box = (await alpha.locator('[data-mind-title]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  await page.mouse.up();
  await beta.locator('[data-mind-title]').click({ modifiers: ['Control'] });
  await expect(beta).not.toHaveClass(/selected/);
  await expect(alpha).toHaveClass(/selected/);
  await beta.getByRole('checkbox', { name: '完成', exact: true }).click();
  await expect(alpha).toHaveClass(/selected/);
  await expect(beta).not.toHaveClass(/selected/);
  await expect(beta.getByRole('checkbox', { name: '标记未完成', exact: true })).toBeVisible();
});

test('help and configuration close on real blank-canvas clicks, including touch, despite canvas event handling', async ({ page }) => {
  await seed(page, [project, task('child', { parentId: 'project' })]);
  await page.goto('/tasks?project=project&view=mindmap');
  const help = page.locator('details[aria-label="导图操作说明"]');
  const summary = help.locator('summary');
  for (const button of ['left', 'middle', 'right'] as const) {
    await summary.click();
    await expect(help).toHaveAttribute('open', '');
    await help.getByRole('heading', { name: '浏览画布', exact: true }).click();
    await expect(help).toHaveAttribute('open', '');
    const box = (await canvas(page).boundingBox())!;
    await page.mouse.click(box.x + box.width - 20, box.y + 30, { button });
    await expect(help).not.toHaveAttribute('open', '');
  }
  await page.getByRole('button', { name: '导图配置', exact: true }).click();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + 30);
  await expect(page.getByRole('dialog', { name: '导图配置', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await summary.click();
  const mobile = (await canvas(page).boundingBox())!;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mobile.x + mobile.width - 12, y: mobile.y + 20 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(help).not.toHaveAttribute('open', '');
  await cdp.detach();
});

test('selection is immediate without measuring the whole map, moving the camera or treating small pointer jitter as task edits', async ({ page }) => {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.measureText;
    (window as any).__mindMeasureCalls = 0;
    CanvasRenderingContext2D.prototype.measureText = function (text) { (window as any).__mindMeasureCalls++; return original.call(this, text); };
  });
  const children = Array.from({ length: 200 }, (_, index) => task(`child${index}`, { title: `任务 ${index}`, parentId: 'project', order: index, status: index === 99 ? 'doing' : 'todo' }));
  await seed(page, [project, ...children]);
  await page.goto('/tasks?project=project&view=mindmap&mindFocus=doing');
  await expect(page.locator('.react-flow__node')).toHaveCount(201);
  await expect.poll(() => page.evaluate(async () => (await document.fonts.load('700 16px "LXGW WenKai"', '任务 100')).length)).toBeGreaterThan(0);
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  const viewport = () => page.locator('.react-flow__viewport').getAttribute('style');
  const camera = await viewport();
  const geometry = await page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).style.transform));
  const miniMap = await page.locator('.react-flow__minimap').boundingBox();
  await expect(page.locator('.react-flow__pane')).toHaveCSS('cursor', 'default');
  const target = (id: number) => page.locator(`.react-flow__node[data-id="child${id}"]`);
  await expect(target(100)).toHaveCSS('cursor', 'default');
  await page.evaluate(() => { (window as any).__mindMeasureCalls = 0; });
  for (const id of [100, 99, 100, 99, 100]) {
    const title = target(id).locator('[data-mind-title]');
    const b = (await title.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await expect(target(id)).toHaveClass(/selected/); // feedback arrives before mouseup
    await page.mouse.move(b.x + b.width / 2 + 3, b.y + b.height / 2 + 2);
    await page.mouse.up();
    await expect(target(id)).toHaveClass(/selected/);
  }
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.evaluate(() => (window as any).__mindMeasureCalls)).toBe(0);
  expect(await viewport()).toBe(camera);
  expect(await page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).style.transform))).toEqual(geometry);
  expect(await page.locator('.react-flow__minimap').boundingBox()).toEqual(miniMap);
  await expect(target(100).locator('.mind-node')).toHaveCSS('box-shadow', 'none');
  await expect(target(100).locator('.mind-node')).toHaveCSS('transition-duration', '0s');
  await expect(page.locator('[data-inspector]')).toHaveCount(0);
  await expect(page.locator('.react-flow__edge-path')).toHaveCount(200);
  await page.goto('/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const data = JSON.parse(await readFile((await (await download).path())!, 'utf8')).data;
  expect(data.tasks).toHaveLength(201);
  expect(data.tasks.every((item: any) => item.updatedAt === 1)).toBe(true);
  for (const original of children) expect(data.tasks.find((item: any) => item.id === original.id)).toMatchObject({ title: original.title, parentId: 'project', order: original.order });
});

test('project actions appear on hover or keyboard focus within one selected row, retain right-click access and remain visible on touch', async ({ page }, testInfo) => {
  await seed(page, [project, task('other', { title: 'Other', kind: 'node', project: true })]);
  await page.goto('/tasks?project=project');
  const row = page.locator('[data-project-row="project"]');
  const link = row.getByRole('link', { name: 'Project', exact: true });
  const menu = row.getByRole('button', { name: '项目 Project 菜单', exact: true });
  const grip = row.getByRole('button', { name: '拖动项目 Project 排序', exact: true });
  await page.mouse.move(900, 10);
  await expect(menu).toHaveCSS('opacity', '0');
  await expect(grip).toHaveCSS('opacity', '0');
  await expect(row).toHaveAttribute('data-selected', 'true');
  await expect(link).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect(await row.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await row.hover();
  await expect(menu).toHaveCSS('opacity', '1');
  await expect(grip).toHaveCSS('opacity', '1');
  const b = (await row.boundingBox())!, m = (await menu.boundingBox())!;
  expect(m.x).toBeGreaterThanOrEqual(b.x); expect(m.x + m.width).toBeLessThanOrEqual(b.x + b.width);
  const url = page.url();
  await menu.click();
  await expect(page.getByRole('button', { name: '编辑项目', exact: true })).toBeVisible();
  expect(page.url()).toBe(url);
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'Project', exact: true }).click();
  await expect(menu).toHaveCSS('opacity', '0');
  await link.focus();
  await expect(menu).toHaveCSS('opacity', '1');
  await page.keyboard.press('Tab');
  await expect(menu).toBeFocused();
  await link.click({ button: 'right' });
  await expect(page.getByRole('button', { name: '编辑项目', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: testInfo.outputPath('project-selected-row.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await expect(menu).toHaveCSS('opacity', '1');
  await expect(grip).toHaveCSS('opacity', '1');
  await cdp.detach();
});

test('deliberate node dragging still reparents tasks after the pointer passes the intent threshold', async ({ page }) => {
  await seed(page, [project, task('alpha', { title: 'Alpha', parentId: 'project', order: 0 }), task('beta', { title: 'Beta', parentId: 'project', order: 1 })]);
  await page.goto('/tasks?project=project&view=mindmap');
  await expect(page.locator('.react-flow__edge-path')).toHaveCount(2);
  await expect.poll(() => page.evaluate(async () => (await document.fonts.load('700 16px "LXGW WenKai"', 'Alpha Beta')).length)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '全局视图', exact: true }).click();
  await page.waitForTimeout(350); // Finish the requested fit animation before taking drag coordinates.
  const source = page.locator('.react-flow__node[data-id="alpha"]');
  const target = page.locator('.react-flow__node[data-id="beta"]');
  const start = (await source.locator('[data-mind-title]').boundingBox())!, end = (await target.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
  await expect(source).toHaveCSS('cursor', 'grabbing');
  await expect(target.getByText('挂到它下面', { exact: true })).toBeVisible();
  await page.mouse.up();
  await expect(target.getByRole('button', { name: '折叠 Beta 的子项', exact: true })).toBeVisible();
  await expect(source).toHaveCSS('cursor', 'default');
  await expect(page.locator('.react-flow__edge-path')).toHaveCount(2);
  await page.goto('/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const data = JSON.parse(await readFile((await (await download).path())!, 'utf8')).data;
  expect(data.tasks.find((item: any) => item.id === 'alpha').parentId).toBe('beta');
});
