import { test, expect, type Page } from '@playwright/test';

const task = (id: string, patch: Record<string, unknown> = {}) => ({ id, title: id, parentId: null, status: 'todo', order: 0, ownerId: 'fixture', tags: [], important: false, urgent: false, createdAt: 1, updatedAt: 1, ...patch });
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const canvas = (page: Page) => page.getByRole('region', { name: '任务导图画布', exact: true });
async function seed(page: Page, tasks: unknown[]) {
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'map.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tasks })) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
}
const viewport = (page: Page) => page.locator('.react-flow__viewport').evaluate((el) => { const m = new DOMMatrix(getComputedStyle(el).transform); return { x: m.e, y: m.f, zoom: m.a }; });
const positions = (page: Page) => page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((el) => ({ id: el.getAttribute('data-id'), transform: (el as HTMLElement).style.transform })));
async function noOverlap(page: Page) {
  await expect.poll(() => page.locator('.react-flow__node').evaluateAll((nodes) => {
    const rects = nodes.map((el) => el.getBoundingClientRect());
    let overlap = 0;
    for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
      const p = rects[a]!, q = rects[b]!;
      if (Math.min(p.right, q.right) - Math.max(p.left, q.left) > 0.5 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 0.5) overlap++;
    }
    return overlap;
  })).toBe(0);
}

test('rightward hierarchy wraps long Chinese titles; focus and selection keep the graph and camera stable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const long = '这是一个比较长的中文任务标题，需要自动换行并完整呈现全部文字内容，还应当为相邻任务留出足够空间。';
  await seed(page, [task('project', { title: '导图体验升级', kind: 'node', project: true }),
    task('group', { title: '视觉与排版', kind: 'node', parentId: 'project' }),
    task('left', { title: '交互体验', kind: 'node', parentId: 'project', order: 1 }),
    task('long', { title: long, parentId: 'group', status: 'doing' }),
    task('next', { title: '另一项待推进的工作', parentId: 'group', order: 1 }),
    task('future', { title: '其他工作', parentId: 'left' }),
  ]);
  await page.goto('/tasks?project=project&view=mindmap');
  await expect(node(page, 'project').locator('[data-mind-title]')).toHaveCSS('font-size', '16px');
  await expect(node(page, 'group').locator('[data-mind-title]')).toHaveCSS('font-size', '16px');
  await expect(node(page, 'left').locator('[data-mind-side]')).toHaveAttribute('data-mind-side', 'right');
  const title = node(page, 'long').locator('[data-mind-title]');
  await expect(title).toHaveText(long);
  await expect.poll(() => title.evaluate((el) => el.clientHeight)).toBeGreaterThan(42);
  await noOverlap(page);
  await page.getByRole('button', { name: '全局视图', exact: true }).click();
  await expect.poll(async () => (await viewport(page)).zoom).toBeGreaterThan(0.1);
  // Wait for the explicit fit animation to finish before comparing camera position.
  await page.waitForTimeout(350);
  const camera = await viewport(page), layout = await positions(page);
  await title.click();
  await expect(page.locator('[data-inspector]')).toHaveCount(0);
  await page.waitForTimeout(320);
  expect(await viewport(page)).toEqual(camera);
  await page.getByRole('button', { name: '查看所选任务详情', exact: true }).click();
  await expect(page.getByRole('region', { name: '任务详情', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭任务详情', exact: true }).click();
  await page.getByRole('region', { name: '工作概览' }).getByRole('button', { name: /^当前工作/ }).click();
  await expect(node(page, 'future').locator('[data-mind-muted]')).toHaveAttribute('data-mind-muted', 'true');
  expect(await positions(page)).toEqual(layout);
  expect(await viewport(page)).toEqual(camera);
  await noOverlap(page);
  await page.screenshot({ path: testInfo.outputPath('mindmap-current-work.png') });
});

test('large maps open near the root and remember each project camera through navigation, reload and resize', async ({ page }) => {
  const tasks = [task('a', { title: 'Large project A', kind: 'node', project: true }), task('b', { title: 'Large project B', kind: 'node', project: true })];
  for (const parentId of ['a', 'b']) for (let i = 0; i < 40; i++) tasks.push(task(`${parentId}_${i}`, { title: `工作项 ${i}，检查大导图的视角`, parentId, order: i }));
  await seed(page, tasks);
  await page.goto('/tasks?project=a&view=mindmap');
  await expect.poll(async () => (await viewport(page)).zoom).toBe(1);
  await expect(node(page, 'a')).toBeInViewport();
  const root = (await node(page, 'a').boundingBox())!, box = (await canvas(page).boundingBox())!;
  expect(Math.abs(root.x + root.width / 2 - box.x - box.width / 2)).toBeLessThan(2);
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + box.width / 2 + 95, box.y + 180, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
  await page.getByRole('button', { name: '缩小', exact: true }).click();
  await expect.poll(async () => (await viewport(page)).zoom).toBeLessThan(1);
  await page.waitForTimeout(250);
  const a = await viewport(page);
  await page.getByRole('navigation', { name: '项目', exact: true }).getByRole('link', { name: 'Large project B', exact: true }).click();
  await page.getByRole('tab', { name: '导图', exact: true }).click();
  await expect.poll(async () => (await viewport(page)).zoom).toBe(1);
  await page.getByRole('navigation', { name: '项目', exact: true }).getByRole('link', { name: 'Large project A', exact: true }).click();
  await expect.poll(() => viewport(page)).toEqual(a);
  await page.reload();
  await expect.poll(() => viewport(page)).toEqual(a);
  const centerBefore = { x: (box.width / 2 - a.x) / a.zoom, y: (box.height / 2 - a.y) / a.zoom };
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => {
    const next = await viewport(page), b = (await canvas(page).boundingBox())!;
    return Math.abs((b.width / 2 - next.x) / next.zoom - centerBefore.x) + Math.abs((b.height / 2 - next.y) / next.zoom - centerBefore.y);
  }).toBeLessThan(2);
  await page.getByRole('button', { name: '根节点', exact: true }).click();
  await expect.poll(async () => (await viewport(page)).zoom).toBe(0.9);
  await expect(node(page, 'a')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('default WenKai and optional licensed fonts load locally, inherit to children and survive reload', async ({ page }) => {
  test.setTimeout(60000);
  const externalFonts: string[] = [], fontRequests: string[] = [], failures: string[] = [];
  page.on('request', (request) => { if (/\.(woff2?|ttf)(\?|$)/.test(request.url())) { fontRequests.push(request.url()); if (new URL(request.url()).origin !== new URL(page.url()).origin) externalFonts.push(request.url()); } });
  page.on('pageerror', (error) => failures.push(error.message));
  await seed(page, [task('fonts', { kind: 'node', project: true, title: '中文字体 ABC 123' }), task('child', { parentId: 'fonts', title: '子任务：复盘与计划 ABC 123' })]);
  await page.goto('/tasks?project=fonts&view=mindmap');
  await expect(node(page, 'fonts')).toBeVisible();
  await expect(node(page, 'fonts').locator('[data-mind-title]')).toHaveCSS('font-family', /LXGW WenKai/);
  await expect(node(page, 'fonts').locator('[data-mind-title]')).toHaveCSS('font-size', '16px');
  await expect(node(page, 'fonts').locator('[data-mind-title]')).toHaveCSS('font-weight', '700');
  await expect.poll(() => page.evaluate(async () => (await document.fonts.load('700 16px "LXGW WenKai"', '中文 ABC 123')).length)).toBeGreaterThan(0);
  expect(fontRequests.every((url) => url.includes('lxgw-wenkai'))).toBe(true);
  await node(page, 'fonts').locator('[data-mind-title]').click();
  await page.getByRole('button', { name: '调整所选节点样式', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '节点样式', exact: true });
  for (const [key, family] of [['noto-sans-sc', 'Noto Sans SC Variable'], ['noto-serif-sc', 'Noto Serif SC Variable'], ['inter', 'Inter Variable'], ['jetbrains-mono', 'JetBrains Mono Variable'], ['lxgw-wenkai', 'LXGW WenKai']] as const) {
    await panel.getByLabel('节点字体', { exact: true }).selectOption(key);
    await expect(node(page, 'child').locator('[data-mind-title]')).toHaveCSS('font-family', new RegExp(family));
    await expect.poll(() => page.evaluate(async (font) => (await document.fonts.load(`16px "${font}"`, '中文 ABC 123')).length, family), { timeout: 15000 }).toBeGreaterThan(0);
    await noOverlap(page);
  }
  expect(fontRequests.length).toBeGreaterThan(0);
  expect(externalFonts).toEqual([]);
  await page.reload();
  await expect(node(page, 'child').locator('[data-mind-title]')).toHaveCSS('font-family', /LXGW WenKai/);
  await expect.poll(() => page.evaluate(async () => (await document.fonts.load('16px "LXGW WenKai"', '中文')).length)).toBeGreaterThan(0);
  for (const file of ['noto-sans-sc', 'noto-serif-sc', 'lxgw-wenkai', 'inter', 'jetbrains-mono']) {
    const response = await page.request.get(`/fonts/licenses/${file}.txt`);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('SIL OPEN FONT LICENSE');
  }
  expect(failures).toEqual([]);
});
