import { build } from 'esbuild';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import { root, legalDefines } from './release-config.mjs';
import { canvasUiPlugins } from './ui-build.mjs';

const output = path.join(root, '.test-ui-dist');
await mkdir(output, { recursive: true });
try {
  await build({ entryPoints: [path.join(root, 'src/sim/ui-tests.ts')], outfile: path.join(output, 'ui.cjs'), bundle: true,
    platform: 'node', format: 'cjs', loader: { '.css': 'text' }, plugins: canvasUiPlugins, logLevel: 'warning' });
  const tested = spawnSync(process.execPath, [path.join(output, 'ui.cjs')], { stdio: 'inherit', cwd: root });
  if (tested.status !== 0) process.exitCode = tested.status ?? 1;
  else {
    await build({ entryPoints: [path.join(root, 'src/app/minigame/douyin.ts')], outfile: path.join(output, 'game.js'), bundle: true,
      platform: 'neutral', mainFields: ['browser', 'main'], format: 'iife', loader: { '.css': 'text' }, plugins: canvasUiPlugins,
      define: { __PRODUCTION__: 'true', __AUDIO_FILES__: '[]', __DOUYIN_REWARDED_ID__: '""', __DOUYIN_INTERSTITIAL_ID__: '""', ...legalDefines }, logLevel: 'warning' });
    const code = await readFile(path.join(output, 'game.js'), 'utf8');
    const storage = new Map(), callbacks = {}, timers = new Map(); let timerId = 0;
    const drawn = [];
    const context = new Proxy({ fillText: (text, x, y) => drawn.push({ text, x, y }), measureText: (text) => ({ width: text.length * 8, fontBoundingBoxAscent: 19, fontBoundingBoxDescent: 5 }),
      createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
      getImageData: () => ({ data: new Uint8ClampedArray(52 * 52 * 4) }) }, { get: (object, key) => key in object ? object[key] : () => {} });
    const canvas = () => ({ width: 390, height: 844, getContext: () => context });
    const tt = { createCanvas: canvas, getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 2 }),
      setStorageSync: (key, value) => storage.set(key, value), getStorageSync: (key) => storage.get(key) ?? '',
      removeStorageSync: (key) => storage.delete(key), getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
      getPerformance: () => ({ now: () => 1000 }), vibrateShort() {}, vibrateLong() {},
      createImage: () => ({}), createInnerAudioContext: () => ({ play() {}, stop() {}, destroy() {}, onEnded() {}, onError() {} }),
      onShow: (callback) => { callbacks.show = callback; }, onHide: (callback) => { callbacks.hide = callback; },
      onTouchStart: (callback) => { callbacks.start = callback; }, onTouchMove: (callback) => { callbacks.move = callback; },
      onTouchEnd: (callback) => { callbacks.end = callback; }, onTouchCancel: (callback) => { callbacks.cancel = callback; }, onWindowResize() {} };
    // A real mini game has no window, document, navigator, location, HTML element classes or ResizeObserver.
    const sandbox = { tt, console, performance: { now: () => 1000 },
      setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; }, clearTimeout: (id) => timers.delete(id),
      setInterval: (callback) => { timers.set(++timerId, callback); return timerId; }, clearInterval: (id) => timers.delete(id) };
    vm.runInNewContext(code, sandbox, { timeout: 15000, filename: 'douyin-game.js' });
    if (!callbacks.start || !callbacks.end || !storage.has('xiaofengdaye.h5.save')) throw new Error('小游戏未正常完成冷启动');
    const tapText = (text) => {
      const glyphs = [...text];
      const index = drawn.findLastIndex((_value, i) => glyphs.every((glyph, j) => drawn[i + j]?.text === glyph));
      if (index < 0) throw new Error(`原生宿主未显示${text}`);
      const glyph = drawn[index], point = { identifier: 7, clientX: glyph.x + 2, clientY: glyph.y - 8 };
      drawn.length = 0;
      callbacks.start({ touches: [point], changedTouches: [point] });
      callbacks.end({ touches: [], changedTouches: [point] });
    };
    tapText('同意并开始'); tapText('设置');
    if (!drawn.some((glyph, i) => glyph.text === '音' && drawn[i + 1]?.text === '画')) throw new Error('原生宿主未进入完整版设置界面');
    callbacks.cancel(); callbacks.hide(); callbacks.show();
    console.log('Douyin bundle without DOM/BOM: cold start, privacy, homepage, full settings, touch and lifecycle passed');
  }
} finally { await rm(output, { recursive: true, force: true }); }
