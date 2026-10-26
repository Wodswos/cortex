import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkgs = (name: string) => path.resolve(root, '../../packages', name);

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'cortex-offline-shell',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle).filter((name) => /\.(?:js|css)$/.test(name)).map((name) => `/${name}`).sort();
      const version = createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0, 12);
      const source = readFileSync(path.join(root, 'public/sw.js'), 'utf8')
        .replace("'cortex-v3-dev'", `'cortex-v3-${version}'`)
        .replace('const PRECACHE_ASSETS = [];', `const PRECACHE_ASSETS = ${JSON.stringify(assets)};`);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  }],
  resolve: {
    alias: {
      '@cortex/core': pkgs('core/src/index.ts'),
      '@cortex/crdt': pkgs('crdt/src/index.ts'),
      '@cortex/ui/theme.css': pkgs('ui/src/theme.css'),
      '@cortex/ui': pkgs('ui/src/index.ts'),
      '@cortex/platform': pkgs('platform/src/index.ts'),
      '@': path.resolve(root, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:30090',
        changeOrigin: false,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
