import { build } from 'esbuild';
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

/**
 * 不进入发布包的源素材：
 * - .wav / .ogg 是音频母带，运行时只用转码后的 .mp3（npm run audio 重新生成）；
 * - store_feature_* 是商店宣传图，只在上架后台上传。
 */
const EXCLUDED = [/\.wav$/i, /\.ogg$/i, /\.md$/i, /[\\/]store_feature_\d+\.webp$/i];
const keep = (source) => !EXCLUDED.some((pattern) => pattern.test(source));

/** 列出实际存在的运行时音频，注入代码；缺少的音频会被静音而不是去请求一个 404 */
async function listAudio(dir, base = 'audio') {
  const out = [];
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const rel = `${base}/${entry.name}`;
    if (entry.isDirectory()) out.push(...await listAudio(path.join(dir, entry.name), rel));
    else if (/\.mp3$/i.test(entry.name)) out.push(rel);
  }
  return out;
}
const audioFiles = await listAudio(path.join(root, 'public', 'audio'));

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'assets'), { recursive: true });
await build({
  entryPoints: [path.join(root, 'src/app/main.ts')],
  outfile: path.join(dist, 'assets/app.js'),
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: process.argv.includes('--minify'),
  sourcemap: !process.argv.includes('--minify'),
  define: { __AUDIO_FILES__: JSON.stringify(audioFiles) },
  logLevel: 'info'
});
await cp(path.join(root, 'index.html'), path.join(dist, 'index.html'));
await cp(path.join(root, 'styles.css'), path.join(dist, 'styles.css'));
const publicDir = path.join(root, 'public');
for (const entry of await readdir(publicDir)) {
  await cp(path.join(publicDir, entry), path.join(dist, entry), { recursive: true, filter: keep });
}

async function sizeOf(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? await sizeOf(full) : (await stat(full)).size;
  }
  return total;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const total = await sizeOf(dist);
const parts = {};
for (const name of ['assets', 'art', 'audio', 'media']) {
  try { parts[name] = await sizeOf(path.join(dist, name)); } catch { /* missing */ }
}
const lowArt = await sizeOf(path.join(dist, 'art', 'v1', 'low')).catch(() => 0);
console.log(`H5 build ready: ${dist}`);
console.log(`音频：找到 ${audioFiles.length} 个 mp3（缺少的音效会静音，清单见 docs/AUDIO_PLAN.md）`);
console.log(`包体合计 ${mb(total)}（代码 ${mb(parts.assets ?? 0)} · 美术 ${mb(parts.art ?? 0)}，其中低清 ${mb(lowArt)} · 音频 ${mb(parts.audio ?? 0)} · 图标 ${mb(parts.media ?? 0)}）`);
if (total > 20 * 1024 * 1024) {
  console.warn('⚠ 超过抖音小游戏总包 20MB 上限：需要把音乐或其中一套美术放到 CDN。');
}
