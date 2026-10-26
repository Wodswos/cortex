import { defineConfig } from '@playwright/test';

/**
 * E2E:跑在「真栈」上 —— 先起 server(含静态 web 构建产物),Playwright 直接打它。
 * 前置:pnpm build(web + server 已构建)。
 * 跑法:pnpm --filter @cortex/e2e e2e
 */
export default defineConfig({
  testDir: './specs',
  globalSetup: './setup.ts',
  workers: 1,
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${process.env.E2E_PORT ?? '39901'}`,
    timezoneId: 'Asia/Shanghai',
  },
  webServer: {
    command: 'node server.mjs',
    url: `http://127.0.0.1:${process.env.E2E_PORT ?? '39901'}/healthz`,
    reuseExistingServer: false,
    timeout: 15_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } } },
    // webkit 与 iOS Safari 同引擎,是手机端行为的最接近近似(Linux 上可跑)
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
