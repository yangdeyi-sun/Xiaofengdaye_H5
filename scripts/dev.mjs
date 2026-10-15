import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

const dist = path.join(root, 'dist');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.wav': 'audio/wav', '.ogg': 'audio/ogg'
};
const port = Number(process.env.PORT ?? 4173);
createServer((req, res) => {
  const raw = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const relative = raw === '/' ? 'index.html' : raw.replace(/^\/+/, '');
  let file = path.resolve(dist, relative);
  if (!file.startsWith(dist + path.sep) && file !== path.join(dist, 'index.html')) {
    res.writeHead(403).end('Forbidden'); return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => {
  console.log(`小峰大业 H5: http://127.0.0.1:${port}`);
});
