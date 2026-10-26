import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = mkdtempSync(join(tmpdir(), 'cortex-e2e-'));
const child = spawn(process.execPath, [fileURLToPath(new URL('../apps/server/dist/index.js', import.meta.url))], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    PUBLIC_DIR: fileURLToPath(new URL('../apps/web/dist', import.meta.url)),
    PORT: process.env.E2E_PORT ?? '39901',
    NODE_ENV: 'test', COOKIE_SECURE: 'false', PUBLIC_ORIGIN: '',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => { console.error(error); rmSync(dataDir, { recursive: true, force: true }); process.exitCode = 1; });
child.on('exit', (code) => { rmSync(dataDir, { recursive: true, force: true }); process.exitCode = code ?? 0; });
