import { build } from 'esbuild';
import { mkdir, rm, writeFile, readFile, readdir, stat, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, config, legalDefines, checkRelease } from './release-config.mjs';
import { convertIcons } from './convert-minigame-icons.mjs';
import { canvasUiPlugins } from './ui-build.mjs';

if (process.argv.includes('--release')) checkRelease('douyin');
const output = path.join(root, 'dist-douyin');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
// 声音素材尚未制作时注入空清单，运行时不会请求不存在的文件。
const audio = [];
async function copyAudio(dir, rel = '') {
  let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const next = path.posix.join(rel, e.name);
    if (e.isDirectory()) await copyAudio(path.join(dir, e.name), next);
    else if (e.name.endsWith('.mp3')) {
      audio.push(`audio/${next}`);
      const destination = path.join(output, 'audio', next);
      await mkdir(path.dirname(destination), { recursive: true });
      await (await import('node:fs/promises')).copyFile(path.join(dir, e.name), destination);
    }
  }
}
await copyAudio(path.join(root, 'public/audio'));
await build({ entryPoints: [path.join(root, 'src/app/minigame/douyin.ts')], outfile: path.join(output, 'game.js'),
  bundle: true, minify: true, platform: 'neutral', mainFields: ['browser', 'module', 'main'], format: 'iife', target: ['es2020'], loader: { '.css': 'text' }, plugins: canvasUiPlugins,
  define: { __AUDIO_FILES__: JSON.stringify(audio), __PRODUCTION__: 'true',
    __DOUYIN_REWARDED_ID__: JSON.stringify(config.douyinRewardedAdUnitId),
    __DOUYIN_INTERSTITIAL_ID__: JSON.stringify(config.douyinInterstitialAdUnitId), ...legalDefines } });
// Every tier=low atlas always loads its half-size page in the shared Sprites renderer.
// Ship full-size pages only for tier=hi; pruning unreachable copies preserves every rendered pixel.
const manifestSource = await readFile(path.join(root, 'src/scene/ArtManifest.ts'), 'utf8');
const fullPages = [];
for (const match of manifestSource.matchAll(/new AtlasDef\('([^']+)',\s*(\d+),\s*\[[^\]]*\],\s*'([^']+)'/g)) {
  if (match[3] !== 'hi') continue;
  for (let page = 0; page < Number(match[2]); page++) fullPages.push(`${match[1]}${Number(match[2]) > 1 ? `_${page}` : ''}.webp`);
}
const converted = spawnSync(process.env.PYTHON || 'python', [path.join(root, 'scripts/convert-minigame-art.py'), path.join(root, 'public/art/v1'), path.join(output, 'art/v1'), JSON.stringify(fullPages)], { stdio: 'inherit' });
if (converted.status !== 0) throw new Error('美术转换失败：需要 Python 3 和 Pillow（python -m pip install Pillow）');
await convertIcons(path.join(root, 'public/media'), path.join(output, 'media'));
await copyFile(path.join(root, 'node_modules/yoga-layout-prebuilt/license'), path.join(output, 'THIRD_PARTY_LICENSE_YOGA.txt'));
await writeFile(path.join(output, 'game.json'), JSON.stringify({ deviceOrientation: 'portrait', showStatusBar: false }, null, 2));
await writeFile(path.join(output, 'project.config.json'), JSON.stringify({ appid: config.douyinAppId, projectname: config.appName, description: '蜜蜂王国经营游戏', setting: { es6: true, minified: true } }, null, 2));
async function size(dir) { let bytes = 0; for (const e of await readdir(dir, { withFileTypes: true })) bytes += e.isDirectory() ? await size(path.join(dir, e.name)) : (await stat(path.join(dir, e.name))).size; return bytes; }
const bytes = await size(output);
if (bytes > 20 * 1024 * 1024) throw new Error(`抖音非分包总包超过20MB：${bytes}`);
console.log(`抖音小游戏构建：${output}（${(bytes / 1024 / 1024).toFixed(2)} MB，非分包，最大20 MB）`);
if (!config.douyinAppId) console.log('尚未填写 AppID：可先在开发工具导入测试；提交审核前运行 npm run release:check。');
