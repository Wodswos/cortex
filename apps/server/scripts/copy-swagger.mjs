import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const output = fileURLToPath(new URL('../dist/swagger/', import.meta.url));
mkdirSync(output, { recursive: true });
for (const name of ['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-bundle.js.LICENSE.txt', 'LICENSE', 'NOTICE']) {
  copyFileSync(require.resolve(`swagger-ui-dist/${name}`), `${output}/${name}`);
}
