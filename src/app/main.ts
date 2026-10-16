import { setPlatform, platform } from '../platform/Platform';
import { WebPlatform } from '../platform/web/WebPlatform';
import { BrowserUI } from './BrowserUI';
import { GameSession } from './GameSession';
import { Sprites } from '../scene/Sprites';

// H5 入口：使用浏览器平台。小游戏入口改为 setPlatform(new MiniGamePlatform({ name: 'douyin', api: tt, ... }))
setPlatform(new WebPlatform('./'));

const root = document.querySelector<HTMLElement>('#app');

if (root === null) {
  throw new Error('缺少 #app 根节点');
}

const session = new GameSession();
// 调试入口：网址带 ?debug=1 时可在控制台通过 window.__xf 访问会话
try { if (new URLSearchParams(location.search).get('debug') === '1') (window as unknown as { __xf: GameSession }).__xf = session; } catch { /* ignore */ }

try {
  session.init();
} catch (error) {
  console.error('启动失败', error);
  session.status = 'error';
  session.bootError = error instanceof Error ? error.message : '初始化失败，请刷新页面重试。';
}

const ui = new BrowserUI(root, session);
ui.mount();
try { if (new URLSearchParams(location.search).get('debug') === '1') { (window as unknown as { __xfui: BrowserUI }).__xfui = ui; (window as unknown as { __xfSprites: typeof Sprites }).__xfSprites = Sprites; } } catch { /* ignore */ }

if (session.ready && session.status !== 'error') session.start();

let unlocked = false;
const unlockAudio = (): void => {
  if (unlocked) return;
  unlocked = true;
  document.removeEventListener('pointerdown', unlockAudio, true);
  document.removeEventListener('keydown', unlockAudio, true);
  void session.audio.unlock();
};
document.addEventListener('pointerdown', unlockAudio, { capture: true });
document.addEventListener('keydown', unlockAudio, { capture: true });

platform().onHide(() => session.onBackground());
platform().onShow(() => {
  if (!session.onForeground()) ui.syncSessionStatus();
});

window.addEventListener('storage', (event) => {
  if (event.key === 'xiaofengdaye.h5.writer' && !session.ensureWriter()) ui.syncSessionStatus();
});

let disposed = false;
window.addEventListener('beforeunload', () => {
  if (disposed) return;
  disposed = true;
  ui.destroy();
  session.dispose();
});
