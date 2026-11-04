import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const task = (id: string, patch = {}) => ({ id, title: id, parentId: null, status: 'todo', ownerId: 'fixture', order: 0, tags: [], important: false, urgent: false, createdAt: 1, updatedAt: 1, ...patch });

test('delayed node observation and concurrent font relayout preserve connections and precise box selection', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeObserver = window.ResizeObserver;
    const deliveries: (() => void)[] = [];
    let held = true;
    window.ResizeObserver = class extends NativeObserver {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          if (held && entries.some((entry) => entry.target.matches('.react-flow__node'))) deliveries.push(() => callback(entries, observer));
          else callback(entries, observer);
        });
      }
    };
    (window as any).__deliverNodeMeasurementsDuringLayout = () => {
      if (!deliveries.length) throw new Error('No initial node measurements were captured');
      const original = CanvasRenderingContext2D.prototype.measureText;
      CanvasRenderingContext2D.prototype.measureText = function (value) {
        CanvasRenderingContext2D.prototype.measureText = original;
        held = false;
        for (const deliver of deliveries.splice(0)) deliver();
        return original.call(this, value);
      };
      document.fonts.dispatchEvent(new Event('loadingdone'));
    };
    (window as any).__pendingNodeMeasurements = () => deliveries.length;
    (window as any).__holdNodeMeasurements = () => { held = true; };
  });
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'geometry.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tasks: [task('root', { kind: 'node', project: true }), ...Array.from({ length: 6 }, (_, index) => task(`branch_${index}`, { parentId: 'root', order: index }))] })) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
  await page.goto('/tasks?project=root&view=mindmap');
  await expect(page.locator('.react-flow__node')).toHaveCount(7);
  await expect.poll(() => page.evaluate(() => (window as any).__pendingNodeMeasurements())).toBeGreaterThan(0);
  // A background tab can defer this first delivery; initialization must not depend on it.
  await expect(page.locator('.react-flow__edge-path')).toHaveCount(6);
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  await page.evaluate(() => (window as any).__deliverNodeMeasurementsDuringLayout());
  await expect(page.locator('.react-flow__edge-path')).toHaveCount(6);
  await page.getByRole('button', { name: '全局视图', exact: true }).click();
  await page.waitForTimeout(350); // Wait for the requested fit animation before dragging in screen coordinates.
  const target = page.locator('.react-flow__node[data-id="branch_2"]');
  await expect(target).toBeVisible();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x - 8, box.y - 6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 8, box.y + box.height + 6, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
  await expect(target).toHaveClass(/selected/);
  // Re-enter through the sidebar's remembered project view, with cached fonts.
  // Repeat the user's reviews -> project path without refreshing or a second retry.
  for (let iteration = 0; iteration < 5; iteration++) {
    await page.getByRole('navigation', { name: '工具', exact: true }).getByRole('link', { name: '复盘', exact: true }).click();
    await expect(page.getByRole('heading', { name: '复盘', exact: true })).toBeVisible();
    await page.evaluate(() => (window as any).__holdNodeMeasurements());
    await page.getByRole('navigation', { name: '项目', exact: true }).getByRole('link', { name: 'root', exact: true }).click();
    await expect(page.getByRole('tab', { name: '导图', exact: true })).toHaveAttribute('data-state', 'active');
    await expect(page.locator('.react-flow__edge-path')).toHaveCount(6);
    await page.getByRole('button', { name: '全局视图', exact: true }).click();
    await page.waitForTimeout(350);
    const next = (await target.boundingBox())!;
    await page.mouse.move(next.x - 8, next.y - 6);
    await page.mouse.down();
    await page.mouse.move(next.x + next.width + 8, next.y + next.height + 6, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
    await expect(target).toHaveClass(/selected/);
    await page.evaluate(() => (window as any).__deliverNodeMeasurementsDuringLayout());
    await expect(page.locator('.react-flow__edge-path')).toHaveCount(6);
  }
});
