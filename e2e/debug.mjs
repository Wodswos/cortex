/** 黑屏复现:CDP 连容器化无头 Chromium,收集 console/pageerror,截图 */
import { chromium } from '@playwright/test';

const BASE = process.env.DEBUG_BASE ?? 'http://localhost:30090';
const CDP = process.env.CDP_URL ?? 'http://localhost:9222';

const browser = await chromium.connectOverCDP(CDP);
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 6).join('\n')}`));
page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(BASE, { waitUntil: 'networkidle' }).catch((e) => errors.push(`[goto] ${e.message}`));
await page.waitForTimeout(2500);

const rootHtml = await page.evaluate(() => document.getElementById('root')?.innerHTML?.length ?? 0);
const bodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 300);
console.log('title:', await page.title());
console.log('root innerHTML length:', rootHtml);
console.log('body text:', JSON.stringify(bodyText));
console.log('--- errors ---');
console.log(errors.length ? errors.join('\n---\n') : '(none)');
await page.screenshot({ path: 'debug-screenshot.png' });
await context.close();
await browser.close();
process.exit(0);
