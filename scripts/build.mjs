import { build } from 'esbuild';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'assets'), { recursive: true });
await build({
  entryPoints: [path.join(root, 'src/app/main.ts')],
  outfile: path.join(dist, 'assets/app.js'),
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  sourcemap: true,
  logLevel: 'info'
});
await cp(path.join(root, 'index.html'), path.join(dist, 'index.html'));
await cp(path.join(root, 'styles.css'), path.join(dist, 'styles.css'));
const publicDir = path.join(root, 'public');
for (const entry of await readdir(publicDir)) {
  await cp(path.join(publicDir, entry), path.join(dist, entry), { recursive: true });
}

console.log(`H5 build ready: ${dist}`);
