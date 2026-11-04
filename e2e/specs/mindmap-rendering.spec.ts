import { test, expect, type Page } from '@playwright/test';

const task = (id: string, patch: Record<string, unknown> = {}) => ({ id, title: id, parentId: null, status: 'todo', order: 0, ownerId: 'fixture', tags: [], important: false, urgent: false, createdAt: 1, updatedAt: 1, ...patch });
async function seed(page: Page) {
  const tasks = [task('serve', { title: 'Serve', kind: 'node', project: true }), task('other', { title: 'Other', kind: 'node', project: true })];
  for (let index = 0; index < 12; index++) tasks.push(task(`task${index}`, { title: `任务${index}`, parentId: index < 4 ? 'serve' : `task${index % 4}`, order: index }));
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'map.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tasks })) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
}
const edgePaths = (page: Page) => page.locator('.react-flow__edge-path');

test('connections survive delayed font completion, same-size title edits and switching projects without reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let releaseFont!: () => void;
  const fontGate = new Promise<void>((resolve) => { releaseFont = resolve; });
  await page.route('**/*lxgw-wenkai*.woff2', async (route) => { await fontGate; await route.continue(); });
  await seed(page);
  await page.goto('/tasks?project=serve&view=mindmap');
  await expect(page.locator('.react-flow__node')).toHaveCount(13);
  await expect(edgePaths(page)).toHaveCount(12);
  // All short labels keep the same card dimensions when the web font arrives.
  releaseFont();
  await page.evaluate(async () => { await document.fonts.load('700 16px "LXGW WenKai"', 'Serve 任务'); await document.fonts.ready; });
  await expect(edgePaths(page)).toHaveCount(12);
  const frameCounts = await page.evaluate(async () => {
    const counts: number[] = [];
    document.fonts.dispatchEvent(new Event('loadingdone'));
    for (let frame = 0; frame < 12; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      counts.push(document.querySelectorAll('.react-flow__edge-path').length);
    }
    return counts;
  });
  expect(frameCounts).toEqual(Array(12).fill(12));
  for (let iteration = 0; iteration < 4; iteration++) {
    await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
    await page.getByRole('region', { name: '工作概览', exact: true }).getByRole('button', { name: iteration % 2 ? '全图' : /^进行中/ }).click();
    await expect(edgePaths(page)).toHaveCount(12);
  }
  await page.getByRole('button', { name: '全局视图', exact: true }).click();
  const first = page.locator('.react-flow__node[data-id="task0"] [data-mind-title]');
  for (const title of ['任务甲', '任务乙', '任务丙']) {
    await first.dblclick();
    const editor = page.getByRole('textbox', { name: '导图节点标题', exact: true });
    await editor.fill(title);
    await editor.press('Enter');
    await expect(first).toHaveText(title);
    await expect(edgePaths(page)).toHaveCount(12);
  }
  const nav = page.getByRole('navigation', { name: '项目', exact: true });
  for (let iteration = 0; iteration < 3; iteration++) {
    await nav.getByRole('link', { name: 'Other', exact: true }).click();
    await page.getByRole('tab', { name: '导图', exact: true }).click();
    await expect(edgePaths(page)).toHaveCount(0);
    await nav.getByRole('link', { name: 'Serve', exact: true }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(13);
    await expect(edgePaths(page)).toHaveCount(12);
  }
  expect(errors).toEqual([]);
});

test('zoom percentage follows controls, gestures, restored cameras and a one-click 100% reset', async ({ page }) => {
  await seed(page);
  await page.goto('/tasks?project=serve&view=mindmap');
  const percent = page.getByLabel('当前缩放比例', { exact: true });
  const actual = () => page.locator('.react-flow__viewport').evaluate((element) => `${Math.round(new DOMMatrix(getComputedStyle(element).transform).a * 100)}%`);
  const agrees = () => expect.poll(async () => (await percent.textContent()) === await actual()).toBe(true);
  await expect(percent).toHaveText(/^[0-9]+%$/);
  await agrees();
  const initial = Number((await percent.textContent())!.replace('%', ''));
  await page.getByRole('button', { name: '缩小', exact: true }).click();
  await expect.poll(async () => Number((await percent.textContent())!.replace('%', ''))).toBeLessThan(initial);
  await agrees();
  await page.getByRole('button', { name: '恢复100%缩放', exact: true }).click();
  await expect(percent).toHaveText('100%');
  await agrees();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect.poll(async () => Number((await percent.textContent())!.replace('%', ''))).toBeGreaterThan(100);
  await agrees();
  const box = (await page.getByRole('region', { name: '任务导图画布', exact: true }).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const beforePinch = await percent.textContent();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 150);
  await page.keyboard.up('Control');
  await expect.poll(() => percent.textContent()).not.toBe(beforePinch);
  await agrees();
  await page.getByRole('button', { name: '全局视图', exact: true }).click();
  await page.waitForTimeout(350); // Explicit fit animation also writes the saved camera.
  await agrees();
  const saved = await percent.textContent();
  await page.getByRole('tab', { name: '列表', exact: true }).click();
  await page.getByRole('tab', { name: '导图', exact: true }).click();
  await expect(percent).toHaveText(saved!);
  await agrees();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '根节点', exact: true }).click();
  await expect(percent).toHaveText('90%');
  await agrees();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Mac trackpad panning is faster by default, adjustable and remembered; controls and configuration stay at the bottom right', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36' });
  });
  await seed(page);
  await page.goto('/tasks?project=serve&view=mindmap');
  await expect(edgePaths(page)).toHaveCount(12);
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  const canvas = page.getByRole('region', { name: '任务导图画布', exact: true });
  const viewport = () => page.locator('.react-flow__viewport').evaluate((element) => { const m = new DOMMatrix(getComputedStyle(element).transform); return { x: m.e, y: m.f, zoom: m.a }; });
  const toolbar = page.getByRole('toolbar', { name: '导图视图控制', exact: true });
  const box = (await canvas.boundingBox())!, controls = (await toolbar.boundingBox())!;
  expect(box.x + box.width - controls.x - controls.width).toBeLessThan(20);
  expect(box.y + box.height - controls.y - controls.height).toBeLessThan(20);
  const wheel = async (speed: number) => {
    const before = await viewport();
    const b = (await canvas.boundingBox())!;
    await page.mouse.move(b.x + 30, b.y + 80);
    await page.mouse.wheel(64, 96);
    await expect.poll(async () => { const after = await viewport(); return Math.abs(after.x - before.x + 64 * speed) + Math.abs(after.y - before.y + 96 * speed); }).toBeLessThan(1);
    expect((await viewport()).zoom).toBe(before.zoom);
  };
  await wheel(1); // The former implicit library default was 0.5.
  const configButton = page.getByRole('button', { name: '导图配置', exact: true });
  const config = page.getByRole('dialog', { name: '导图配置', exact: true });
  await configButton.click();
  const speed = config.getByRole('slider', { name: '平移速度', exact: true });
  await expect(speed).toHaveValue('1');
  await speed.focus();
  await speed.press('End');
  for (let index = 0; index < 4; index++) await speed.press('ArrowLeft');
  await expect(speed).toBeFocused();
  await expect(speed).toHaveValue('2');
  await expect(config.getByLabel('当前平移速度', { exact: true })).toHaveText('2×');
  await config.getByRole('button', { name: '折线', exact: true }).click();
  await expect(config.getByRole('button', { name: '折线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(edgePaths(page)).toHaveCount(12);
  const beforeConfigWheel = await viewport();
  const c = (await config.boundingBox())!;
  await page.mouse.move(c.x + 20, c.y + 80);
  await page.mouse.wheel(0, 96);
  await page.waitForTimeout(100);
  expect(await viewport()).toEqual(beforeConfigWheel);
  await config.getByRole('button', { name: '关闭导图配置', exact: true }).click();
  await wheel(2);
  await page.getByRole('tab', { name: '列表', exact: true }).click();
  await page.getByRole('tab', { name: '导图', exact: true }).click();
  await configButton.click();
  await expect(speed).toHaveValue('2');
  await config.press('Escape');
  await expect(config).toHaveCount(0);
  await expect(configButton).toBeFocused();
  await page.reload();
  await configButton.click();
  await expect(speed).toHaveValue('2');
  await expect(config.getByRole('button', { name: '折线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '关闭导图配置', exact: true }).click();
  await page.getByRole('button', { name: '根节点', exact: true }).click();
  await expect(page.getByLabel('当前缩放比例', { exact: true })).toHaveText('100%');
  await page.waitForTimeout(220); // The root camera also animates its position when the zoom is already 100%.
  await wheel(2);
  // macOS's Meta+wheel zoom remains independent of the pan-speed multiplier.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Meta');
  const beforeZoom = (await viewport()).zoom;
  await page.mouse.wheel(0, 80);
  await page.keyboard.up('Meta');
  await expect.poll(async () => (await viewport()).zoom).not.toBe(beforeZoom);
  await configButton.click();
  await config.getByRole('button', { name: '恢复默认平移速度', exact: true }).click();
  await expect(speed).toHaveValue('1');
  await page.screenshot({ path: testInfo.outputPath('map-controls-desktop.png') });
  await page.setViewportSize({ width: 320, height: 740 });
  const mobile = (await config.boundingBox())!;
  expect(mobile.x).toBeGreaterThanOrEqual(0);
  expect(mobile.x + mobile.width).toBeLessThanOrEqual(320);
  await expect(speed).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('map-controls-mobile.png') });
  await config.press('Escape');
  const help = page.locator('details[aria-label="导图操作说明"]');
  await help.locator('summary').click();
  await expect(help.getByRole('heading')).toHaveText(['浏览画布', '选择与查看', '创建与编辑', '调整结构']);
  await expect(help.getByRole('button')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Configuration and help dismiss each other and never create/edit a task.
  await configButton.click();
  await expect(help).not.toHaveAttribute('open', '');
  await help.locator('summary').click();
  await expect(config).toHaveCount(0);
  await help.locator('summary').press('Escape');
  await expect(help).not.toHaveAttribute('open', '');
  await expect(edgePaths(page)).toHaveCount(12);
});
