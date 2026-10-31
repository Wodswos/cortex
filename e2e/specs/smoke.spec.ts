import { test, expect, type BrowserContext, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const password = 'fixture-password';
let sequence = 0;
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  (page as any).__pageErrors = errors;
});
test.afterEach(async ({ page }) => {
  expect((page as any).__pageErrors).toEqual([]);
});
async function account(context: BrowserContext, label: string) {
  const invited = await context.request.post('/api/invites', {
    headers: { Cookie: process.env.E2E_ADMIN_COOKIE! },
    data: {},
  });
  expect(invited.ok()).toBeTruthy();
  const { code } = await invited.json();
  const username = `${label}_${Date.now()}_${++sequence}`;
  const response = await context.request.post('/api/auth/register', {
    data: { username, password, inviteCode: code },
  });
  expect(response.ok()).toBeTruthy();
  return { ...(await response.json()), username } as { id: string; username: string };
}
async function ready(page: Page) {
  await expect(page.getByRole('button', { name: /搜索或执行命令/ })).toBeVisible({ timeout: 15000 });
}
async function capture(page: Page, title: string) {
  await page.keyboard.press('n');
  const input = page.getByPlaceholder(/想到什么写什么/);
  await expect(input).toBeVisible();
  await input.fill(title);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.getByText(/已收集 1 条/)).toBeVisible();
  await page.keyboard.press('Escape');
}
async function seed(page: Page, data: unknown) {
  await page.goto('/settings');
  await ready(page);
  await page.locator('input[type=file]').setInputFiles({
    name: 'fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
}
async function exported(page: Page) {
  await page.goto('/settings');
  await ready(page);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const file = await (await downloading).path();
  return JSON.parse(await readFile(file!, 'utf8'));
}
async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByPlaceholder('用户名', { exact: true }).fill(username);
  await page.getByPlaceholder('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).last().click();
  await ready(page);
}
const task = (id: string, title = id) => ({
  id,
  title,
  ownerId: 'fixture',
  status: 'todo',
  priority: 'P3',
  important: false,
  urgent: false,
  tags: [],
  order: 0,
  createdAt: 1,
  updatedAt: 1,
});

async function composeChinese(page: Page, input: Locator, text: string) {
  const cdp = await page.context().newCDPSession(page);
  await input.focus();
  for (const intermediate of ['n', 'ni', 'nihao']) {
    await cdp.send('Input.imeSetComposition', {
      text: intermediate,
      selectionStart: intermediate.length,
      selectionEnd: intermediate.length,
    });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(intermediate);
  }
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('nihao');
  await cdp.send('Input.insertText', { text });
  await expect(input).toHaveValue(text);
  await cdp.detach();
}

test('Chinese IME confirms text before submitting list and quick capture tasks', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Real composition uses Chromium CDP');
  await page.goto('/tasks');
  await ready(page);
  const input = page.getByRole('textbox', { name: '添加任务', exact: true });
  await composeChinese(page, input, '你好，创建中文任务');
  await expect(page.locator('[data-row]')).toHaveCount(0);
  await input.press('Enter');
  await expect(page.locator('[data-row]').getByText('你好，创建中文任务', { exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  await input.blur();
  await page.keyboard.press('n');
  const quick = page.getByPlaceholder(/想到什么写什么/);
  await composeChinese(page, quick, '你好，中文收集');
  await expect(page.getByText(/已收集 1 条/)).toHaveCount(0);
  await quick.press('Enter');
  await expect(page.getByText(/已收集 1 条/)).toBeVisible();
});

test('new mindmap nodes keep IME focus and ignore composing Enter', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Real composition uses Chromium CDP');
  await seed(page, { tasks: [{ ...task('ime_project', 'IME project'), kind: 'node', parentId: null }] });
  await page.goto('/tasks?view=mindmap');
  const root = page.locator('.react-flow__node[data-id="ime_project"]');
  await root.getByText('IME project', { exact: true }).click();
  await page.keyboard.press('Tab');
  const input = page.getByPlaceholder('输入标题…');
  await expect(input).toBeVisible();
  await composeChinese(page, input, '你好，导图新任务');
  await input.press('Enter');
  await expect(
    page.locator('.react-flow__node').getByText('你好，导图新任务', { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveCount(0);
});

test('calendar drafts cancel without records and create only after confirmation', async ({
  page,
  browserName,
}) => {
  await seed(page, {
    tasks: [{ ...task('calendar_project', 'Calendar project'), kind: 'node', parentId: null }],
  });
  await page.goto('/calendar');
  const cell = page.locator('[data-calendar-date]').nth(15);
  const date = await cell.getAttribute('data-calendar-date');
  await cell.click({ position: { x: 20, y: 65 } });
  const draft = page.getByRole('dialog', { name: '新建日历任务' });
  await expect(draft).toBeVisible();
  await draft.getByLabel('新任务标题', { exact: true }).fill('discard this draft');
  await page.getByRole('heading', { name: '日历', exact: true }).click();
  await expect(draft).toHaveCount(0);
  await cell.click({ position: { x: 20, y: 65 } });
  await page.keyboard.press('Escape');
  await expect(draft).toHaveCount(0);
  await page.reload();
  await expect(cell).toBeVisible();
  await expect(page.getByText('discard this draft', { exact: true })).toHaveCount(0);
  await cell.click({ position: { x: 20, y: 65 } });
  const title = draft.getByLabel('新任务标题', { exact: true });
  if (browserName === 'chromium') await composeChinese(page, title, '日历中文任务');
  else await title.fill('日历中文任务');
  await draft.getByLabel('新任务所属项目').selectOption('calendar_project');
  await draft.getByLabel('新任务优先级').selectOption('P1');
  await draft.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(draft).toHaveCount(0);
  await expect(cell.getByText('日历中文任务', { exact: true })).toBeVisible();
  const data = await exported(page);
  const created = data.data.tasks.filter((item: any) => item.kind !== 'node');
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({ title: '日历中文任务', parentId: 'calendar_project', priority: 'P1' });
  expect(await page.evaluate((stamp) => new Date(stamp).toLocaleDateString('sv-SE'), created[0].dueAt)).toBe(
    date,
  );
});

test('task resources have three stacked areas and distinguish connection failure from no sessions', async ({
  page,
}) => {
  await seed(page, {
    tasks: [task('resources', 'resource task')],
    settings: {
      servers: [{ id: 'bad', name: 'Missing credentials', host: 'user@host.invalid', registered: true }],
    },
  });
  await page.route('**/api/tmux/sessions', (route) =>
    route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ error: '未配置 SSH 登录凭据' }),
    }),
  );
  await page.goto('/tasks');
  await page.getByText('resource task', { exact: true }).click();
  const detail = page.locator('[data-inspector]');
  for (const label of ['tmux 关联', 'Agent 关联', 'Note 关联'])
    await expect(detail.getByRole('region', { name: label })).toBeVisible();
  const bounds = await detail
    .locator('[data-task-resources] > section')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
  expect(bounds[0]).toBeLessThan(bounds[1]);
  expect(bounds[1]).toBeLessThan(bounds[2]);
  await detail.getByLabel('tmux 服务器', { exact: true }).selectOption('bad');
  await expect(detail.getByRole('alert')).toContainText('未配置 SSH 登录凭据');
  await expect(detail.getByLabel('tmux 会话', { exact: true })).toBeDisabled();
  await expect(detail.getByLabel('tmux 会话', { exact: true }).locator('option:checked')).toHaveText(
    '连接失败',
  );
  await detail.getByLabel('Agent 链接', { exact: true }).fill('https://claude.ai/chat/example');
  await detail.getByRole('button', { name: '添加 Agent 链接', exact: true }).click();
  await expect(detail.getByRole('region', { name: 'Agent 关联' }).getByRole('link')).toHaveAttribute(
    'href',
    'https://claude.ai/chat/example',
  );
  await detail.getByLabel('Note 链接', { exact: true }).fill('obsidian://open?vault=work&file=note');
  await detail.getByRole('button', { name: '添加 Note 链接', exact: true }).click();
  await expect(detail.getByRole('region', { name: 'Note 关联' }).getByRole('link')).toHaveAttribute(
    'href',
    'obsidian://open?vault=work&file=note',
  );
});

test('week and day blank slots open cancellable task drafts, including on mobile', async ({ page }) => {
  await page.goto('/calendar');
  await ready(page);
  await page.getByRole('tab', { name: '周', exact: true }).click();
  const slot = page.locator('[data-calendar-week-date]').first();
  const bounds = await slot.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.click(bounds!.x + bounds!.width / 2, 420);
  const draft = page.getByRole('dialog', { name: '新建日历任务' });
  await expect(draft).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(draft).toHaveCount(0);
  await page.getByRole('tab', { name: '日', exact: true }).click();
  const day = page.getByTestId('day-scroll');
  const dayBounds = await day.boundingBox();
  await page.mouse.click(dayBounds!.x + 160, dayBounds!.y + 140);
  await expect(draft).toBeVisible();
  await draft.getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/calendar');
  await page
    .locator('[data-calendar-date]')
    .nth(15)
    .click({ position: { x: 20, y: 60 } });
  await expect(draft).toBeVisible();
  const draftBounds = await draft.boundingBox();
  expect(draftBounds!.x).toBeGreaterThanOrEqual(0);
  expect(draftBounds!.x + draftBounds!.width).toBeLessThanOrEqual(390);
  await draft.getByLabel('新任务标题', { exact: true }).fill('mobile cancelled draft');
  await page.getByRole('heading', { name: '日历', exact: true }).click();
  await expect(draft).toHaveCount(0);
});

test('accent choices preserve circular controls and views are separated from tools', async ({ page }) => {
  await page.goto('/settings');
  await ready(page);
  const palette = page.getByRole('group', { name: '强调色' });
  for (const name of ['石墨', '雾蓝', '松绿', '暖砂', '藕粉']) {
    const color = palette.getByRole('button', { name, exact: true });
    await color.click();
    await expect(color).toHaveAttribute('aria-pressed', 'true');
    expect(
      await color.evaluate((element) => parseFloat(getComputedStyle(element).borderRadius)),
    ).toBeGreaterThanOrEqual(16);
  }
  const views = page.getByRole('navigation', { name: '视图', exact: true });
  for (const name of ['导图', '甘特图', '日历', '四象限'])
    await expect(views.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: '工具', exact: true })
      .getByRole('link', { name: '导图', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg?v=4');
});

test('health + keyboard and native quick capture', async ({ page, request }) => {
  expect((await request.get('/healthz')).ok()).toBeTruthy();
  await page.goto('/');
  await ready(page);
  await expect(page).toHaveTitle(/Cortex/);
  await capture(page, 'keyboard capture');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cortex:quick-capture')));
  await expect(page.getByPlaceholder(/想到什么写什么/)).toBeVisible();
});

test('first offline reload retains account and unvisited lazy views', async ({ context, page }) => {
  await account(context, 'offline');
  await page.goto('/');
  await ready(page);
  await capture(page, 'offline account task');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }),
      );
  });
  await context.setOffline(true);
  await page.reload();
  await ready(page);
  await page.goto('/inbox');
  await expect(page.getByText('offline account task', { exact: true }).first()).toBeVisible();
  await page.goto('/tasks?view=mindmap');
  await expect(page.locator('.react-flow')).toBeVisible();
  await page.goto('/tasks?view=timeline');
  await expect(page.getByTestId('day-scroll')).toBeVisible();
});

test('stale account tab cannot upload its documents under a new cookie', async ({ context, page }) => {
  await context.addInitScript(() => {
    const Native = window.WebSocket;
    (window as any).__testSockets = [];
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        (window as any).__testSockets.push(this);
      }
    };
  });
  const a = await account(context, 'old_tab_a');
  await page.goto('/');
  await ready(page);
  await capture(page, 'A private task');
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__testSockets.some((ws: WebSocket) => ws.readyState === 1)),
    )
    .toBe(true);
  await account(context, 'new_cookie_b');
  await page.evaluate(() => (window as any).__testSockets.forEach((ws: WebSocket) => ws.close()));
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('cortex-active-user') ?? '{}').id), {
      timeout: 15000,
    })
    .not.toBe(a.id);
  const data = await exported(page);
  expect(data.data.tasks.some((t: any) => t.title === 'A private task')).toBe(false);
  await login(page, a.username);
  const original = await exported(page);
  expect(original.data.tasks.some((t: any) => t.title === 'A private task')).toBe(true);
});

test('anonymous tagged data migrates once across subsequent account logins', async ({ context, page }) => {
  const a = await account(context, 'migrate_a');
  const b = await account(context, 'migrate_b');
  await context.clearCookies();
  await page.goto('/');
  await ready(page);
  await capture(page, 'anonymous task #migrated');
  await login(page, a.username);
  const first = await exported(page);
  expect(first.data.tasks.some((t: any) => t.title === 'anonymous task')).toBe(true);
  expect(first.data.tags.some((t: any) => t.name === 'migrated')).toBe(true);
  await page.getByRole('button', { name: '登出' }).click();
  await ready(page);
  await login(page, b.username);
  const second = await exported(page);
  expect(second.data.tasks.some((t: any) => t.title === 'anonymous task')).toBe(false);
});

test('P2 capture and search beyond the first forty tasks', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await capture(page, 'P2 capture !P2');
  expect((await exported(page)).data.tasks.find((t: any) => t.title === 'P2 capture')).toMatchObject({
    priority: 'P2',
    important: false,
    urgent: true,
  });
  await seed(page, { tasks: Array.from({ length: 45 }, (_, i) => task(`task_${i}`, `search fixture ${i}`)) });
  await page.getByRole('button', { name: /搜索或执行命令/ }).click();
  await page.getByPlaceholder('搜索任务、执行命令…').fill('search fixture 44');
  await expect(page.getByRole('option', { name: 'search fixture 44' })).toBeVisible();
});

test('clicking a cross-midnight event preserves the complete interval', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const start = await page.evaluate(() => {
    const d = new Date();
    d.setHours(-1, 0, 0, 0);
    return d.getTime();
  });
  const end = start + 3 * 3600000;
  await seed(page, {
    events: [
      {
        id: 'cross_midnight',
        title: 'overnight',
        kind: 'personal',
        start,
        end,
        ownerId: 'fixture',
        completed: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
  await page.goto('/tasks?view=timeline');
  await page.getByTestId('day-scroll').evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.getByTestId('event-cross_midnight').click({ position: { x: 100, y: 10 } });
  const event = (await exported(page)).data.events.find((e: any) => e.id === 'cross_midnight');
  expect(event).toMatchObject({ start, end });
});

test('an untouched focused inspector never overwrites a remote edit', async ({
  browser,
  context,
  page,
  baseURL,
}) => {
  await account(context, 'inspector');
  await seed(page, { tasks: [task('inspector_task', 'original title')] });
  await page.goto('/tasks');
  await ready(page);
  await page.getByText('original title', { exact: true }).first().click();
  const title = page.getByLabel('任务标题', { exact: true });
  await expect(title).toBeVisible();
  await title.focus();
  const other = await browser.newContext({
    storageState: await context.storageState(),
    baseURL,
    timezoneId: 'Asia/Shanghai',
  });
  try {
    const remote = await other.newPage();
    await remote.goto('/tasks');
    await ready(remote);
    await remote.getByText('original title', { exact: true }).first().click();
    const edit = remote.getByLabel('任务标题', { exact: true });
    await edit.fill('remote changed title');
    await edit.press('Tab');
    await expect(title).toHaveValue('remote changed title');
    await title.press('Tab');
    await expect(edit).toHaveValue('remote changed title');
    expect((await exported(page)).data.tasks.find((t: any) => t.id === 'inspector_task').title).toBe(
      'remote changed title',
    );
  } finally {
    await other.close();
  }
});

test('title and notes survive immediate outside dismissal, explicit close and reload', async ({ page }) => {
  await seed(page, { tasks: [task('save_draft', 'before edit')] });
  await page.goto('/tasks');
  await ready(page);
  await page.locator('[data-row]').getByText('before edit', { exact: true }).click();
  await page.getByLabel('任务标题', { exact: true }).fill('saved on blank click');
  await page.locator('main').click({ position: { x: 100, y: 450 } });
  await expect(page.getByLabel('任务标题', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-row]').getByText('saved on blank click', { exact: true })).toBeVisible();
  await page.locator('[data-row]').getByText('saved on blank click', { exact: true }).click();
  await page.getByLabel('任务备注', { exact: true }).fill('notes saved on blank click');
  await page.locator('main').click({ position: { x: 100, y: 450 } });
  await expect(page.getByLabel('任务备注', { exact: true })).toHaveCount(0);
  await page.locator('[data-row]').getByText('saved on blank click', { exact: true }).click();
  await expect(page.getByLabel('任务备注', { exact: true })).toHaveValue('notes saved on blank click');
  await page.getByLabel('任务标题', { exact: true }).fill('saved on close');
  await page.getByRole('button', { name: '关闭任务详情', exact: true }).click();
  await expect(page.getByLabel('任务标题', { exact: true })).toHaveCount(0);
  await page.reload();
  await page.locator('[data-row]').getByText('saved on close', { exact: true }).click();
  await expect(page.getByLabel('任务备注', { exact: true })).toHaveValue('notes saved on blank click');
});

test('project drag order persists, keeps hierarchy and supports keyboard sorting and undo', async ({
  page,
}) => {
  await seed(page, {
    tasks: [
      { ...task('project_a', 'Project A'), kind: 'node', parentId: null, order: 0 },
      { ...task('ordinary', 'ordinary root'), parentId: null, order: 0.5 },
      { ...task('project_b', 'Project B'), kind: 'node', parentId: null, order: 1 },
      { ...task('project_c', 'Project C'), kind: 'node', parentId: null, order: 2 },
      { ...task('child_a', 'project child'), parentId: 'project_a' },
    ],
  });
  await page.goto('/tasks');
  await ready(page);
  const nav = page.getByRole('navigation', { name: '项目', exact: true });
  await expect(nav.getByRole('link')).toHaveText(['Project A', 'Project B', 'Project C']);
  const grip = nav.getByRole('button', { name: '拖动项目 Project A 排序', exact: true });
  await nav.locator('[data-project-row="project_a"]').hover();
  const from = await grip.boundingBox(),
    to = await nav.locator('[data-project-row="project_c"]').boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2 + 8, { steps: 3 });
  await page.mouse.move(to!.x + to!.width - 14, to!.y + to!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(nav.getByRole('link')).toHaveText(['Project B', 'Project C', 'Project A']);
  await expect(page.getByRole('status', { name: '项目排序保存状态' })).toHaveText('顺序已保存');
  await page.reload();
  await ready(page);
  await expect(nav.getByRole('link')).toHaveText(['Project B', 'Project C', 'Project A']);
  await grip.focus();
  await page.keyboard.press('Space');
  await expect(grip).toHaveAttribute('aria-pressed', 'true');
  // dnd-kit attaches keyboard listeners on the next browser task after activation.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await page.keyboard.press('ArrowUp');
  await expect(
    page.getByRole('status').filter({ hasText: '项目 Project A 移到 Project C 位置' }),
  ).toHaveCount(1);
  await page.keyboard.press('ArrowUp');
  await expect(
    page.getByRole('status').filter({ hasText: '项目 Project A 移到 Project B 位置' }),
  ).toHaveCount(1);
  await page.keyboard.press('Space');
  await expect(nav.getByRole('link')).toHaveText(['Project A', 'Project B', 'Project C']);
  await page.keyboard.press('Control+z');
  await expect(nav.getByRole('link')).toHaveText(['Project B', 'Project C', 'Project A']);
  const data = await exported(page);
  expect(data.data.tasks.find((value: any) => value.id === 'child_a').parentId).toBe('project_a');
  for (const id of ['project_a', 'project_b', 'project_c'])
    expect(data.data.tasks.find((value: any) => value.id === id).parentId).toBeNull();
});

test('week defaults to this week in Gantt while explicit views and matrix navigation remain available', async ({ page }) => {
  await page.goto('/tasks?scope=week');
  await ready(page);
  await expect(page.getByRole('tab', { name: '甘特图', exact: true })).toHaveAttribute('data-state', 'active');
  const weekLink = page.getByRole('navigation', { name: '工作导航' }).getByRole('link', { name: '本周', exact: true });
  await expect(weekLink).toHaveAttribute('aria-current', 'page');
  const dates = page.locator('input[type="date"]');
  const thisWeek = await dates.first().inputValue();
  await page.getByRole('button', { name: '下周', exact: true }).click();
  await expect(dates.first()).not.toHaveValue(thisWeek);
  await weekLink.click();
  await expect(dates.first()).toHaveValue(thisWeek);
  await page.getByRole('tab', { name: '列表', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '添加任务', exact: true })).toBeVisible();
  await expect(weekLink).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expect(page.getByRole('tab', { name: '列表', exact: true })).toHaveAttribute('data-state', 'active');
  await weekLink.click();
  await expect(page.getByRole('tab', { name: '甘特图', exact: true })).toHaveAttribute('data-state', 'active');
  const matrix = page.getByRole('navigation', { name: '视图', exact: true }).getByRole('link', { name: '四象限', exact: true });
  await matrix.click();
  await expect(page).toHaveURL(/view=matrix/);
  await expect(page.getByRole('tab', { name: '四象限', exact: true })).toHaveAttribute('data-state', 'active');
  await expect(matrix).toHaveAttribute('aria-current', 'page');
});

const listRow = (page: Page, id: string) => page.locator(`[data-row][data-task-id="${id}"]`);
async function startListDrag(page: Page, id: string, fromTitle = false, grabBottom = false) {
  const row = listRow(page, id);
  const handle = fromTitle ? row.getByRole('button').filter({ hasText: /^Drag / }) : row.getByRole('button', { name: /^拖动任务 / });
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + (grabBottom ? box.height - 3 : 3);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 6, { steps: 3 });
  await expect(page.getByRole('status', { name: '任务拖动提示', exact: true })).toBeVisible();
}

test('list drag previews pointer intent, opens collapsed parents, moves branches and supports outdent and undo', async ({ page }) => {
  await seed(page, { tasks: [
    { ...task('drag_a', 'Drag project A'), kind: 'node', parentId: null, order: 0 },
    { ...task('drag_a1', 'Drag child A1'), parentId: 'drag_a', order: 0 },
    { ...task('drag_a2', 'Drag child A2'), parentId: 'drag_a', order: 1 },
    { ...task('drag_b', 'Drag project B'), kind: 'node', parentId: null, order: 1 },
    { ...task('drag_move', 'Drag moving branch'), parentId: null, order: 2 },
    { ...task('drag_leaf', 'Drag moving leaf'), parentId: 'drag_move', order: 0 },
  ] });
  await page.goto('/tasks');
  await listRow(page, 'drag_a').getByRole('button', { name: '收起 Drag project A', exact: true }).click();
  await expect(listRow(page, 'drag_a1')).toHaveCount(0);
  const target = (await listRow(page, 'drag_a').boundingBox())!;
  await startListDrag(page, 'drag_move', true);
  await page.mouse.move(target.x + 160, target.y + target.height / 2, { steps: 12 });
  await expect(listRow(page, 'drag_a')).toHaveAttribute('data-drop-placement', 'inside');
  expect((await listRow(page, 'drag_a').boundingBox())!.y).toBeCloseTo(target.y, 1);
  await expect(page.getByRole('status', { name: '任务拖动提示', exact: true })).toContainText('挂为子任务 → Drag project A');
  await page.mouse.up();
  await expect(listRow(page, 'drag_a1')).toBeVisible();
  await expect(listRow(page, 'drag_move')).toHaveCSS('margin-left', '16px');
  await expect(listRow(page, 'drag_leaf')).toHaveCSS('margin-left', '32px');
  await expect(page.getByLabel('任务标题', { exact: true })).toHaveCount(0);

  // The gutter projects to the ancestor, and the insertion line follows its whole branch.
  await startListDrag(page, 'drag_move', false, true);
  const child = (await listRow(page, 'drag_a1').boundingBox())!;
  await page.mouse.move(target.x + 5, child.y + child.height / 2, { steps: 12 });
  await expect(listRow(page, 'drag_a2')).toHaveAttribute('data-drop-placement', 'after');
  await expect(page.getByRole('status', { name: '任务拖动提示', exact: true })).toContainText('插到后面 → Drag project A');
  await page.mouse.up();
  await expect(listRow(page, 'drag_move')).toHaveCSS('margin-left', '0px');
  await expect(listRow(page, 'drag_leaf')).toHaveCSS('margin-left', '16px');

  // An invalid cycle and a release outside the list both leave the hierarchy untouched.
  await startListDrag(page, 'drag_a');
  const descendant = (await listRow(page, 'drag_a1').boundingBox())!;
  await page.mouse.move(descendant.x + 160, descendant.y + descendant.height / 2, { steps: 10 });
  await expect(page.locator('[data-drop-placement]')).toHaveCount(0);
  await page.mouse.up();
  await startListDrag(page, 'drag_move');
  await page.mouse.move(15, 450, { steps: 10 });
  await expect(page.locator('[data-drop-placement]')).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.press('Control+z');
  await expect(listRow(page, 'drag_move')).toHaveCSS('margin-left', '16px');
  const result = await exported(page);
  const tasks = result.data.tasks;
  expect(tasks.find((item: any) => item.id === 'drag_move').parentId).toBe('drag_a');
  expect(tasks.find((item: any) => item.id === 'drag_leaf').parentId).toBe('drag_move');
  expect(tasks.find((item: any) => item.id === 'drag_a').parentId).toBeNull();
});

test('list drag sorts at row edges independently of grab point and Escape cancels the preview', async ({ page }) => {
  await seed(page, { tasks: [
    { ...task('edge_a', 'Drag Alpha'), parentId: null, order: 0 },
    { ...task('edge_b', 'Drag Beta'), parentId: null, order: 1 },
    { ...task('edge_c', 'Drag Gamma'), parentId: null, order: 2 },
  ] });
  await page.goto('/tasks');
  const alpha = (await listRow(page, 'edge_a').boundingBox())!;
  await startListDrag(page, 'edge_c', false, true);
  await page.mouse.move(alpha.x + 150, alpha.y + 2, { steps: 12 });
  await expect(listRow(page, 'edge_a')).toHaveAttribute('data-drop-placement', 'before');
  await page.mouse.up();
  expect(await page.locator('[data-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-task-id')))).toEqual(['edge_c', 'edge_a', 'edge_b']);
  const movedAlpha = (await listRow(page, 'edge_a').boundingBox())!;
  await startListDrag(page, 'edge_c');
  await page.mouse.move(movedAlpha.x + 150, movedAlpha.y + movedAlpha.height - 2, { steps: 12 });
  await expect(listRow(page, 'edge_a')).toHaveAttribute('data-drop-placement', 'after');
  await page.mouse.up();
  expect(await page.locator('[data-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-task-id')))).toEqual(['edge_a', 'edge_c', 'edge_b']);
  await startListDrag(page, 'edge_b');
  const gamma = (await listRow(page, 'edge_c').boundingBox())!;
  await page.mouse.move(gamma.x + 150, gamma.y + gamma.height / 2, { steps: 12 });
  await expect(listRow(page, 'edge_c')).toHaveAttribute('data-drop-placement', 'inside');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('[data-drop-placement]')).toHaveCount(0);
  const result = await exported(page);
  expect(result.data.tasks.every((item: any) => item.parentId === null)).toBe(true);
  const ids = [...result.data.tasks].sort((a: any, b: any) => a.order - b.order).map((item: any) => item.id);
  expect(ids).toEqual(['edge_a', 'edge_c', 'edge_b']);
});

test('list drag appends after filtered children and supports a touch handle', async ({ page, browserName }) => {
  const due = await page.evaluate(() => { const date = new Date(); date.setHours(23, 0, 0, 0); return date.getTime(); });
  await seed(page, { tasks: [
    { ...task('filter_parent', 'Drag target project'), parentId: null, kind: 'node', order: 0 },
    { ...task('filter_today', 'Drag visible child'), parentId: 'filter_parent', dueAt: due, order: 0 },
    { ...task('filter_hidden', 'Drag hidden child'), parentId: 'filter_parent', dueAt: due + 30 * 86400000, order: 100 },
    { ...task('filter_source', 'Drag filtered source'), parentId: null, dueAt: due, order: 1 },
  ] });
  await page.goto('/tasks');
  await page.getByLabel('筛选任务', { exact: true }).selectOption('today');
  await expect(listRow(page, 'filter_hidden')).toHaveCount(0);
  if (browserName === 'chromium') {
    await page.setViewportSize({ width: 390, height: 844 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const handle = (await listRow(page, 'filter_source').getByRole('button', { name: /^拖动任务 / }).boundingBox())!;
    const point = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(200); // Touch activation deliberately waits 160ms to allow scrolling.
    const target = (await listRow(page, 'filter_parent').boundingBox())!;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: target.x + 150, y: target.y + target.height / 2 }] });
    await expect(listRow(page, 'filter_parent')).toHaveAttribute('data-drop-placement', 'inside');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await startListDrag(page, 'filter_source');
    const target = (await listRow(page, 'filter_parent').boundingBox())!;
    await page.mouse.move(target.x + 150, target.y + target.height / 2, { steps: 10 });
    await page.mouse.up();
  }
  await page.getByLabel('筛选任务', { exact: true }).selectOption('all');
  await expect(listRow(page, 'filter_hidden')).toBeVisible();
  const result = await exported(page);
  const source = result.data.tasks.find((item: any) => item.id === 'filter_source');
  const hidden = result.data.tasks.find((item: any) => item.id === 'filter_hidden');
  expect(source.parentId).toBe('filter_parent');
  expect(source.order).toBeGreaterThan(hidden.order);
  await page.goto('/tasks');
  await expect(listRow(page, 'filter_source')).toHaveCSS('margin-left', '16px');
});

test('list drag scrolls long lists and keeps the pointer target after scrolling', async ({ page }) => {
  await seed(page, { tasks: Array.from({ length: 36 }, (_, index) => ({
    ...task(`scroll_${index}`, `Drag scroll ${index}`), parentId: null, order: index,
  })) });
  await page.goto('/tasks');
  const list = page.locator('[data-task-list]');
  await startListDrag(page, 'scroll_0', true);
  const bounds = (await list.boundingBox())!;
  await page.mouse.move(bounds.x + 150, bounds.y + bounds.height - 8, { steps: 15 });
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(30);
  await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const target = (await listRow(page, 'scroll_35').boundingBox())!;
  await page.mouse.move(target.x + 150, target.y + target.height / 2, { steps: 12 });
  await expect(listRow(page, 'scroll_35')).toHaveAttribute('data-drop-placement', 'inside');
  const preview = (await page.locator('[data-task-drag-preview]').boundingBox())!;
  expect(preview.y).toBeGreaterThanOrEqual(0);
  expect(preview.y + preview.height).toBeLessThanOrEqual(720);
  await page.mouse.up();
  await expect(listRow(page, 'scroll_0')).toHaveCSS('margin-left', '16px');
  await expect(page.getByRole('status', { name: '保存状态', exact: true })).toHaveText('已保存');
  const result = await exported(page);
  expect(result.data.tasks.find((item: any) => item.id === 'scroll_0').parentId).toBe('scroll_35');
  expect(result.data.tasks).toHaveLength(36);
});

test('list drag outdents dated work without changing its date or pretending to reorder date groups', async ({ page }) => {
  const dueAt = Date.now() + 86400000;
  await seed(page, { tasks: [
    { ...task('dated_project', 'Drag dated project'), kind: 'node', parentId: null },
    { ...task('dated_peer', 'Drag undated child'), parentId: 'dated_project', order: 0 },
    { ...task('dated_action', 'Drag dated action'), parentId: 'dated_project', order: 1, dueAt },
  ] });
  await page.goto('/tasks');
  const project = (await listRow(page, 'dated_project').boundingBox())!;
  const peer = (await listRow(page, 'dated_peer').boundingBox())!;
  await startListDrag(page, 'dated_action');
  await page.mouse.move(project.x + 5, peer.y + peer.height / 2, { steps: 12 });
  await expect(listRow(page, 'dated_project')).toHaveAttribute('data-drop-placement', 'root');
  await expect(page.getByRole('status', { name: '任务拖动提示', exact: true })).toHaveText('移出至顶层（按日期分组）');
  await page.mouse.up();
  await expect(listRow(page, 'dated_action')).toHaveCSS('margin-left', '0px');
  await expect(page.getByRole('status', { name: '保存状态', exact: true })).toHaveText('已保存');
  const result = await exported(page);
  expect(result.data.tasks.find((item: any) => item.id === 'dated_action')).toMatchObject({ parentId: null, dueAt });
});

test('mindmap focuses current work and factual risks while retaining project paths and full progress', async ({
  page,
}) => {
  const due = await page.evaluate(() => {
    const date = new Date();
    date.setHours(23, 59, 59, 999);
    return {
      week: date.getTime(),
      overdue: date.getTime() - 14 * 86400000,
      future: date.getTime() + 21 * 86400000,
    };
  });
  await seed(page, {
    tasks: [
      { ...task('focus_project', 'Focus project'), kind: 'node', parentId: null },
      { ...task('focus_section', 'Current phase'), kind: 'node', parentId: 'focus_project' },
      { ...task('focus_doing', 'Current action'), status: 'doing', parentId: 'focus_section' },
      { ...task('focus_week', 'Week action'), parentId: 'focus_section', dueAt: due.week },
      { ...task('focus_done', 'Finished action'), status: 'done', parentId: 'focus_section' },
      { ...task('focus_future', 'Future backlog'), parentId: 'focus_project', dueAt: due.future },
      { ...task('focus_overdue', 'Past deadline'), parentId: 'focus_project', dueAt: due.overdue },
      {
        ...task('focus_important', 'Unplanned important'),
        parentId: 'focus_project',
        priority: 'P1',
        important: true,
      },
    ],
  });
  await page.goto('/tasks?view=mindmap');
  const overview = page.getByRole('region', { name: '工作概览', exact: true });
  const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
  await expect(overview.getByRole('button', { name: '当前工作 2', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const id of ['focus_project', 'focus_section', 'focus_doing', 'focus_week'])
    await expect(node(id)).toBeVisible();
  for (const id of ['focus_done', 'focus_future', 'focus_overdue', 'focus_important'])
    await expect(node(id)).toHaveCount(0);
  await expect(node('focus_project').getByText('1/6', { exact: true })).toBeVisible();
  await overview.getByRole('button', { name: '逾期 1', exact: true }).click();
  await expect(node('focus_overdue')).toBeVisible();
  await expect(node('focus_project')).toBeVisible();
  await expect(node('focus_doing')).toHaveCount(0);
  await overview.getByRole('button', { name: '重要未排期 1', exact: true }).click();
  await expect(node('focus_important')).toBeVisible();
  await expect(node('focus_overdue')).toHaveCount(0);
  await overview.getByRole('button', { name: '全图', exact: true }).click();
  for (const id of ['focus_done', 'focus_future', 'focus_overdue', 'focus_important'])
    await expect(node(id)).toBeVisible();
  const help = page.locator('details[aria-label="导图操作说明"]');
  await expect(help).not.toHaveAttribute('open', '');
  await help.locator('summary').click();
  await expect(help.locator('li')).toHaveCount(6);
  await help.getByRole('button', { name: '折线', exact: true }).click();
  await help.locator('summary').click();
  await expect(help).not.toHaveAttribute('open', '');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('mindmap edges meet node boundaries and stay level through filtered project paths', async ({ page, browserName }) => {
  await seed(page, {
    tasks: [
      { ...task('align_project_a', 'Project A'), kind: 'node', parentId: null },
      { ...task('align_phase_a', 'Phase A'), kind: 'node', parentId: 'align_project_a' },
      {
        ...task('align_current', 'Current important work'),
        parentId: 'align_phase_a', status: 'doing', priority: 'P1', important: true,
      },
      { ...task('align_backlog', 'Later work'), parentId: 'align_phase_a' },
      { ...task('align_project_b', 'Project with a longer title'), kind: 'node', parentId: null },
      {
        ...task('align_parent', 'Action with children'),
        parentId: 'align_project_b', status: 'doing', priority: 'P1', important: true,
      },
      { ...task('align_phase_b', 'Phase B'), kind: 'node', parentId: 'align_parent' },
      {
        ...task('align_unplanned', 'Unplanned important work'),
        parentId: 'align_phase_b', priority: 'P1', important: true,
      },
    ],
  });
  await page.goto('/tasks?view=mindmap');
  const overview = page.getByRole('region', { name: '工作概览', exact: true });
  const help = page.locator('details[aria-label="导图操作说明"]');
  await expect(page.locator('.react-flow__node[data-id="align_current"]')).toBeVisible();

  const geometryErrors = () => page.evaluate(() => {
    const errors: string[] = [];
    const rects = new Map([...document.querySelectorAll<HTMLElement>('.react-flow__node')]
      .map((node) => [node.dataset.id!, node.getBoundingClientRect()]));
    const close = (label: string, actual: number, expected: number) => {
      if (Math.abs(actual - expected) > 0.5)
        errors.push(`${label}: ${actual.toFixed(2)} != ${expected.toFixed(2)}`);
    };
    const children = new Map<string, string[]>();
    for (const edge of document.querySelectorAll<SVGGElement>('.react-flow__edge')) {
      const [sourceId, targetId] = edge.dataset.id!.split('->');
      children.set(sourceId, [...(children.get(sourceId) ?? []), targetId]);
      const source = rects.get(sourceId)!;
      const target = rects.get(targetId)!;
      const path = edge.querySelector<SVGPathElement>('.react-flow__edge-path')!;
      const matrix = path.getScreenCTM()!;
      const start = path.getPointAtLength(0).matrixTransform(matrix);
      const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
      close(`${sourceId} edge start x`, start.x, source.right);
      close(`${sourceId} edge start y`, start.y, source.y + source.height / 2);
      close(`${targetId} edge end x`, end.x, target.left);
      close(`${targetId} edge end y`, end.y, target.y + target.height / 2);
    }
    if (children.size === 0) errors.push('No edges measured');
    for (const [id, kids] of children) {
      if (kids.length !== 1) continue;
      const parent = rects.get(id)!;
      const child = rects.get(kids[0])!;
      close(`${id} single child center`, parent.y + parent.height / 2, child.y + child.height / 2);
    }
    for (const line of document.querySelectorAll('[data-structural-line]')) {
      const node = line.closest<HTMLElement>('.react-flow__node')!;
      const nodeRect = rects.get(node.dataset.id!)!;
      const lineRect = line.getBoundingClientRect();
      close(`${node.dataset.id} line left`, lineRect.left, nodeRect.left);
      close(`${node.dataset.id} line right`, lineRect.right, nodeRect.right);
      close(`${node.dataset.id} line center`, lineRect.y + lineRect.height / 2, nodeRect.y + nodeRect.height / 2);
    }
    return errors;
  });

  // Reuse nodes across focus/style changes to catch stale handle measurements as well.
  for (const style of ['舒缓', '直线', '折线']) {
    await help.locator('summary').click();
    await help.getByRole('button', { name: style, exact: true }).click();
    await help.locator('summary').click();
    for (const [focus, visible, hidden] of [
      ['全图', 'align_backlog', null],
      ['当前工作', 'align_current', 'align_backlog'],
      ['重要未排期', 'align_unplanned', 'align_backlog'],
    ] as const) {
      await overview.getByRole('button', { name: new RegExp(`^${focus}( |$)`) }).click();
      await expect(page.locator(`.react-flow__node[data-id="${visible}"]`)).toBeVisible();
      if (hidden) await expect(page.locator(`.react-flow__node[data-id="${hidden}"]`)).toHaveCount(0);
      await expect.poll(geometryErrors).toEqual([]);
    }
  }
  await page.getByRole('button', { name: 'Project A', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="__cortex_all__"]')).toHaveCount(0);
  await expect.poll(geometryErrors).toEqual([]);
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="__cortex_all__"]')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await expect.poll(() => page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  }
  await expect.poll(geometryErrors).toEqual([]);
});

test('calendar has task titles, multi-day events, editing and date navigation', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const stamp = await page.evaluate(() => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    return date.getTime();
  });
  const key = await page.evaluate((value) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }, stamp);
  await seed(page, {
    tasks: [{ ...task('calendar_task', 'calendar deadline'), dueAt: stamp }],
    events: [
      {
        id: 'multi_day',
        title: 'multi day event',
        start: stamp - 16 * 3600000,
        end: stamp + 36 * 3600000,
        kind: 'personal',
        ownerId: 'fixture',
        completed: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
  await page.getByRole('link', { name: '日历', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '日历', exact: true })).toBeVisible();
  await expect(page.getByTestId('calendar-month')).toBeVisible();
  const cell = page.locator(`[data-calendar-date="${key}"]`);
  await expect(cell.getByText('calendar deadline', { exact: true })).toBeVisible();
  await expect(cell.getByText('multi day event', { exact: true })).toBeVisible();
  await cell.getByText('calendar deadline', { exact: true }).click();
  await expect(page.locator('input[value="calendar deadline"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await cell.getByRole('button', { name: `${key}，查看日程`, exact: true }).click();
  await expect(page.getByTestId('day-scroll')).toBeVisible();
  await page.getByRole('tab', { name: '周', exact: true }).click();
  await expect(page.getByRole('tab', { name: '周', exact: true })).toHaveAttribute('data-state', 'active');
});

test('today finds a due child under an undated project, inline capture inherits project', async ({
  page,
}) => {
  await page.goto('/');
  await ready(page);
  const dueAt = await page.evaluate(() => {
    const date = new Date();
    date.setHours(18, 0, 0, 0);
    return date.getTime();
  });
  await seed(page, {
    tasks: [
      { ...task('project', 'Project Aurora'), kind: 'node' },
      { ...task('due_child', 'action for today'), parentId: 'project', dueAt },
      { ...task('later_child', 'later action'), parentId: 'project' },
    ],
  });
  await page.getByRole('link', { name: '今天', exact: true }).first().click();
  await expect(page.getByText('action for today', { exact: true })).toBeVisible();
  await expect(page.locator('[data-row]').getByText('later action', { exact: true })).toHaveCount(0);
  await page
    .getByRole('navigation', { name: '项目', exact: true })
    .getByRole('link', { name: 'Project Aurora' })
    .click();
  await expect(page.getByRole('heading', { name: 'Project Aurora', exact: true })).toBeVisible();
  const input = page.getByRole('textbox', { name: '添加任务', exact: true });
  await input.fill('new project action');
  await input.press('Enter');
  await expect(page.getByText('new project action', { exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  const data = await exported(page);
  expect(data.data.tasks.find((item: any) => item.title === 'new project action')).toMatchObject({
    parentId: 'project',
  });
});

test('mobile navigation and task editing stay accessible without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, { tasks: [task('mobile_task', 'mobile edit')] });
  await page.goto('/tasks');
  await ready(page);
  await page.getByText('mobile edit', { exact: true }).click();
  await expect(page.locator('input[value="mobile edit"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await page
    .getByRole('navigation', { name: '移动导航' })
    .getByRole('link', { name: '日历', exact: true })
    .click();
  await expect(page.getByTestId('calendar-month')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('calendar drag moves a task to another date', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const dates = await page.evaluate(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const next = new Date(today);
    next.setDate(next.getDate() + 1);
    const key = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { stamp: today.getTime(), from: key(today), to: key(next) };
  });
  await seed(page, { tasks: [{ ...task('drag_date', 'move this deadline'), dueAt: dates.stamp }] });
  await page.goto('/calendar');
  const source = page
    .locator(`[data-calendar-date="${dates.from}"]`)
    .getByText('move this deadline', { exact: true });
  const target = page.locator(`[data-calendar-date="${dates.to}"]`);
  await source.dragTo(target);
  await expect(target.getByText('move this deadline', { exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: '日历操作状态', exact: true })).toContainText('已移至');
});
