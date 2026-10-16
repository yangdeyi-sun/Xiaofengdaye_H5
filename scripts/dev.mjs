import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const previewArgs = process.argv.includes('--canvas-preview') ? ['--canvas-preview'] : [];
const built = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs'), ...previewArgs], { cwd: root, stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

const dist = path.join(root, 'dist');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg', '.png': 'image/png'
};
const port = Number(process.env.PORT ?? 4173);
createServer((req, res) => {
  const raw = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const relative = raw === '/' ? 'index.html' : raw.replace(/^\/+/, '');
  let file = path.resolve(dist, relative);
  if (!file.startsWith(dist + path.sep) && file !== path.join(dist, 'index.html')) {
    res.writeHead(403).end('Forbidden'); return;
  }
  // 只有页面路径回退到 index.html；缺失的资源返回 404，避免图片/音频把网页当成文件反复加载
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (path.extname(relative) !== '') { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found'); return; }
    file = path.join(dist, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => {
  console.log(`小峰大业 H5: http://127.0.0.1:${port}`);
});
