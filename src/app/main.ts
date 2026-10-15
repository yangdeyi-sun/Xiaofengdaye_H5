import { BrowserUI } from './BrowserUI';
import { GameSession } from './GameSession';

const root = document.querySelector<HTMLElement>('#app');

if (root === null) {
  throw new Error('缺少 #app 根节点');
}

const session = new GameSession();

try {
  session.init();
} catch (error) {
  console.error('启动失败', error);
  session.status = 'error';
  session.bootError = error instanceof Error ? error.message : '初始化失败，请刷新页面重试。';
}

const ui = new BrowserUI(root, session);
ui.mount();

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

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    session.onBackground();
  } else if (!session.onForeground()) {
    ui.syncSessionStatus();
  }
});

window.addEventListener('pagehide', () => {
  session.onBackground();
});

window.addEventListener('pageshow', () => {
  if (document.visibilityState !== 'hidden' && !session.onForeground()) ui.syncSessionStatus();
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
