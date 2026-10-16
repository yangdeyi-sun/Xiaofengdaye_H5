/**
 * 把 public/audio 下的 .wav / .ogg 母带转码成运行时使用的 .mp3。
 * 需要本机安装 ffmpeg（Windows：winget install ffmpeg，然后重开终端）。
 *
 * 码率：音效单声道 64k；背景音乐（bgm/）立体声 56k。
 * 只有母带比 mp3 新时才重新转码；加 --force 全部重转。
 */
import { spawnSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audioRoot = path.join(root, 'public', 'audio');
const force = process.argv.includes('--force');

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (/\.(wav|ogg)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function optionsFor(file) {
  const rel = path.relative(audioRoot, file).replaceAll('\\', '/');
  if (rel.includes('/bgm/') || rel.includes('/music/')) return ['-ac', '2', '-ar', '44100', '-b:a', '56k'];
  if (rel.includes('/ambience/') || rel.includes('/weather/')) return ['-ac', '1', '-ar', '44100', '-b:a', '40k'];
  return ['-ac', '1', '-ar', '44100', '-b:a', '64k'];
}

const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
if (probe.status !== 0) {
  console.error('未找到 ffmpeg，请先安装并确保 ffmpeg 在 PATH 中。');
  process.exit(1);
}

let converted = 0;
for (const source of await walk(audioRoot)) {
  const target = source.replace(/\.(wav|ogg)$/i, '.mp3');
  if (!force) {
    const [src, dst] = await Promise.all([stat(source), stat(target).catch(() => null)]);
    if (dst !== null && dst.mtimeMs >= src.mtimeMs) continue;
  }
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', source, '-map_metadata', '-1', '-codec:a', 'libmp3lame', ...optionsFor(source), target], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`转码失败：${source}`);
    process.exit(1);
  }
  converted++;
}
console.log(`音频转码完成：${converted} 个文件`);
