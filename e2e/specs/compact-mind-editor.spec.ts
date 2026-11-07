import { test, expect, type Page } from '@playwright/test';
test.use({ serviceWorkers: 'block' });
const task = (id: string, patch = {}) => ({ id, title: id, parentId: null, status: 'todo', order: 0, ownerId: 'fixture', tags: [], important: false, urgent: false, createdAt: 1, updatedAt: 1, ...patch });
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
async function seed(page: Page) {
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'compact.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tasks: [task('project', { kind: 'node', project: true, title: '布局测试' }), task('group', { kind: 'node', parentId: 'project', title: '编辑' }), task('leaf', { parentId: 'group', title: '下一步', status: 'doing' })] })) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
  await page.goto('/tasks?project=project&view=mindmap');
  await expect(page.locator('.react-flow__edge-path')).toHaveCount(2);
  await page.getByRole('button', { name: '恢复100%缩放', exact: true }).click();
}
test('time and emphasis share one compact desktop row, no helper paragraph, account footer stays on one line', async ({ page }, testInfo) => {
  await seed(page);
  const filters = page.getByLabel('任务筛选与强调', { exact: true });
  const time = filters.getByRole('combobox', { name: '任务时间范围', exact: true });
  const focus = filters.getByRole('region', { name: '工作概览', exact: true });
  expect(Math.abs((await time.boundingBox())!.y - (await focus.boundingBox())!.y)).toBeLessThan(6);
  for (const label of ['逾期', '全部', '当前工作']) {
    await focus.getByRole('button', { name: label, exact: typeof label === 'string' }).click();
    await expect(page.getByText('查看全部分支；切换上方强调项，查看当前工作在全图中的位置。', { exact: true })).toHaveCount(0);
    await expect(page.locator('.react-flow__edge-path')).toHaveCount(2);
  }
  const account = page.getByLabel('账号与同步', { exact: true });
  const settings = (await account.getByRole('link', { name: '设置与账号', exact: true }).boundingBox())!;
  const status = (await account.getByTitle('本地空间', { exact: true }).boundingBox())!;
  expect(status.y).toBeGreaterThanOrEqual(settings.y); expect(status.y + status.height).toBeLessThanOrEqual(settings.y + settings.height);
  await page.screenshot({ path: testInfo.outputPath('compact-mindmap.png') });
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(time.locator('option[value="custom"]')).toHaveText('自选');
  await time.selectOption('custom');
  const dateRange = page.getByRole('dialog', { name: '选择日期区间', exact: true });
  await expect(dateRange.getByLabel('区间开始日期', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('node width follows uncommitted typing, grows and wraps without breaking edges, and Escape discards the draft', async ({ page, browserName }, testInfo) => {
  await seed(page);
  const card = node(page, 'group').locator('.mind-node');
  const width = () => card.evaluate(el => el.getBoundingClientRect().width);
  const original = await width();
  await node(page, 'group').locator('[data-mind-title]').dblclick();
  const editor = page.getByRole('textbox', { name: '导图节点标题', exact: true });
  const draft = '正在编辑中的中文标题和 English';
  await editor.fill(draft);
  await expect(editor).toBeFocused();
  await expect.poll(width).toBeGreaterThan(original + 40);
  const expanded = await width();
  await expect.poll(async () => {
    const parent = (await card.boundingBox())!, child = (await node(page, 'leaf').boundingBox())!;
    return child.x - parent.x - parent.width;
  }).toBeGreaterThan(20);
  await editor.fill(draft.repeat(5));
  await expect.poll(() => editor.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(48);
  expect(await width()).toBeLessThanOrEqual(300);
  await expect(page.locator('.react-flow__edge-path')).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('mindmap-live-edit.png') });
  await editor.fill('短'); await expect.poll(width).toBeLessThan(expanded);
  await editor.press('Escape'); await expect(node(page, 'group').locator('[data-mind-title]')).toHaveText('编辑');
  await node(page, 'group').locator('[data-mind-title]').dblclick();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('编辑');
  const composing = '中文输入法组合文本';
  const committed = '实时扩展后的标题';
  const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
  if (cdp) {
    await cdp.send('Input.imeSetComposition', {
      text: composing,
      selectionStart: composing.length,
      selectionEnd: composing.length,
      replacementStart: 0,
      replacementEnd: '编辑'.length,
    });
  } else {
    await editor.dispatchEvent('compositionstart');
    await editor.fill(composing);
    await editor.dispatchEvent('compositionupdate', { data: composing });
  }
  await expect(editor).toHaveValue(composing);
  await expect(editor).toBeFocused(); await expect.poll(width).toBeGreaterThan(original);
  await editor.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
  await expect(editor).toBeVisible();
  if (cdp) {
    await cdp.send('Input.insertText', { text: committed });
    await cdp.detach();
  } else {
    await editor.fill(committed);
    await editor.dispatchEvent('compositionend', { data: committed });
  }
  await expect(editor).toHaveValue(committed);
  await editor.press('Enter'); await expect(node(page, 'group').locator('[data-mind-title]')).toHaveText(committed);
});
