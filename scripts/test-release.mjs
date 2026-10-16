import { strict as assert } from 'node:assert';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { root, legalDefines } from './release-config.mjs';

const built = spawnSync(process.execPath, [path.join(root, 'scripts/build-douyin.mjs')], { stdio: 'inherit' });
assert.equal(built.status, 0);
let frame;
const touches = {}, store = new Map(), text = [];
const hides = [], shows = [];
const ctx = new Proxy({}, { get(target, prop) {
  if (prop in target) return target[prop];
  if (prop === 'measureText') return (s) => ({ width: [...s].length * 7 });
  if (prop === 'fillText') return (label, x, y) => text.push({ label, x, y });
  if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop() {} });
  if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(64) });
  return () => {};
} });
const sandbox = { console, Date, Math, Promise, Map, Set, Uint8ClampedArray,
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  requestAnimationFrame: (callback) => { frame = callback; return 1; }, cancelAnimationFrame() {},
  tt: {
    getStorageSync: (key) => store.get(key) || '', setStorageSync: (key, value) => store.set(key, value), removeStorageSync: (key) => store.delete(key), getStorageInfoSync: () => ({ keys: [...store.keys()] }),
    createCanvas: () => ({ width: 360, height: 740, getContext: () => ctx }),
    getSystemInfoSync: () => ({ windowWidth: 360, windowHeight: 740, pixelRatio: 2, safeArea: { top: 24, bottom: 720 } }),
    getPerformance: () => ({ now: () => 0 }), createImage: () => ({ width: 0, height: 0 }),
    createInnerAudioContext: () => ({ volume: 0, paused: true, play() {}, stop() {}, pause() {}, destroy() {}, onEnded() {}, onError() {} }),
    onTouchStart: (fn) => { touches.start = fn; }, onTouchMove: (fn) => { touches.move = fn; }, onTouchEnd: (fn) => { touches.end = fn; }, onTouchCancel: (fn) => { touches.cancel = fn; },
    onHide: (fn) => hides.push(fn), onShow: (fn) => shows.push(fn), vibrateShort() {}, vibrateLong() {}
  }
};
vm.createContext(sandbox);
// 真正执行抖音发布入口，故意不提供 window/document/fetch/localStorage。
vm.runInContext(await readFile(path.join(root, 'dist-douyin/game.js'), 'utf8'), sandbox);
assert.equal('document' in sandbox, false);
assert(text.some((t) => t.label === '同意并开始'));
function tapLabel(label) {
  const target = text.slice().reverse().find((t) => t.label === label);
  assert(target, `找不到可触摸文字：${label}`);
  const event = { touches: [{ clientX: target.x + 8, clientY: target.y + 8 }], changedTouches: [{ clientX: target.x + 8, clientY: target.y + 8 }] };
  text.length = 0; touches.start(event); touches.end(event);
}
tapLabel('同意并开始');
assert(text.some((t) => t.label === '知道了'));
tapLabel('知道了');
tapLabel('繁育');
assert(text.some((t) => t.label.startsWith('孵化新卵')));
assert(!text.some((t) => t.label.includes('自动产卵') || t.label.includes('自动培养')));
for (let i = 1; i < 30; i++) frame(i * 100);
hides.forEach((fn) => fn());
const saved = JSON.parse(JSON.parse(store.get('xiaofengdaye.h5.save')).payload);
assert.equal(saved.meta.settings.privacyAccepted, true);
assert.equal(saved.run.colony.autoLay, false);
assert.equal(saved.run.colony.autoHatch, false);
shows.forEach((fn) => fn());
const config = JSON.parse(await readFile(path.join(root, 'dist-douyin/game.json'), 'utf8'));
assert.equal(config.deviceOrientation, 'portrait');
async function verifyAssets(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) await verifyAssets(path.join(dir, e.name));
    else assert(/\.(js|json|png|mp3)$/.test(e.name), `不支持的小游戏文件 ${e.name}`);
  }
}
await verifyAssets(path.join(root, 'dist-douyin'));
// 发布模式不能通过 ?ads=mock 绕过真实广告；未配置广告不能获得观看完成奖励。
const result = await build({ stdin: { contents: `import { WebPlatform } from './src/platform/web/WebPlatform'; import { MiniGamePlatform } from './src/platform/minigame/MiniGamePlatform'; import { DEFAULT_CONFIG } from './src/domain/GameConfig'; export { WebPlatform, MiniGamePlatform, DEFAULT_CONFIG };`, resolveDir: root }, bundle: true, write: false, platform: 'node', format: 'cjs', define: { __PRODUCTION__: 'true', ...legalDefines } });
const module = { exports: {} };
const production = { module, exports: module.exports, location: { search: '?ads=mock' }, URLSearchParams, console };
vm.runInNewContext(result.outputFiles[0].text, production);
for (const track of module.exports.DEFAULT_CONFIG.tracks) {
  const asset = path.join(root, 'public/media', `xf_stat_${track.id.replace('.', '_')}.svg`);
  assert((await stat(asset)).isFile(), `缺少升级图标：${asset}`);
}
const web = new module.exports.WebPlatform();
assert.equal((await web.ads.showRewarded('flower_boost')).status, 'unavailable');
const mini = new module.exports.MiniGamePlatform({ name: 'douyin', api: sandbox.tt, adUnits: { rewarded: {}, rewardedDefault: '', interstitial: '' } });
assert.equal((await mini.ads.showRewarded('flower_boost')).status, 'unavailable');
let adClose;
const configuredMini = new module.exports.MiniGamePlatform({ name: 'douyin', api: { ...sandbox.tt,
  createRewardedVideoAd: () => ({ onClose: (fn) => { adClose = fn; }, onError() {}, show: () => Promise.resolve(), load: () => Promise.resolve() })
}, adUnits: { rewarded: {}, rewardedDefault: 'test-unit', interstitial: '' } });
const ambiguous = configuredMini.ads.showRewarded('flower_boost'); adClose(undefined);
assert.equal((await ambiguous).status, 'skipped');
const finished = configuredMini.ads.showRewarded('flower_boost'); adClose({ isEnded: true });
assert.equal((await finished).status, 'completed');
console.log('小游戏无 DOM 启动、隐私确认、触控繁育、帧循环、前后台保存、发布广告隔离与包内格式检查通过。');
