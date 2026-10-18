import { setPlatform } from '../../platform/Platform';
import { MiniGamePlatform } from '../../platform/minigame/MiniGamePlatform';
import type { MiniGameApi } from '../../platform/minigame/MiniGameApi';
import { DOUYIN_AD_UNITS } from '../../platform/minigame/adUnits';
import { GameSession } from '../GameSession';
import { FullCanvasUI } from '../ui/FullCanvasUI';
import type { CanvasSurface, Viewport } from '../ui/VirtualDocument';

interface Touch { identifier: number; clientX: number; clientY: number; }
interface TouchEvent { touches: Touch[]; changedTouches: Touch[]; }
interface SystemInfo { windowWidth: number; windowHeight: number; pixelRatio: number; safeArea?: { top: number; bottom: number }; }
interface DouyinHost extends MiniGameApi {
  createCanvas(): CanvasSurface;
  getSystemInfoSync(): SystemInfo;
  onTouchStart(callback: (e: TouchEvent) => void): void;
  onTouchMove(callback: (e: TouchEvent) => void): void;
  onTouchEnd(callback: (e: TouchEvent) => void): void;
  onTouchCancel(callback: () => void): void;
  onWindowResize?(callback: () => void): void;
}
declare const tt: DouyinHost;

setPlatform(new MiniGamePlatform({ name: 'douyin', api: tt, adUnits: DOUYIN_AD_UNITS, imageExtension: 'png' }));
const session = new GameSession();
const canvas = tt.createCanvas();
const viewport = (): Viewport => {
  const info = tt.getSystemInfoSync();
  return { width: info.windowWidth, height: info.windowHeight, pixelRatio: info.pixelRatio,
    top: info.safeArea?.top || 0, bottom: Math.max(0, info.windowHeight - (info.safeArea?.bottom ?? info.windowHeight)) };
};
session.init();
const ui = new FullCanvasUI(canvas, session, viewport(), () => tt.createCanvas());
tt.onTouchStart((e) => e.changedTouches.forEach((p) => ui.touchStart(p.clientX, p.clientY, p.identifier)));
tt.onTouchMove((e) => e.changedTouches.forEach((p) => ui.touchMove(p.clientX, p.clientY, p.identifier)));
tt.onTouchEnd((e) => e.changedTouches.forEach((p) => ui.touchEnd(p.clientX, p.clientY, p.identifier)));
tt.onTouchCancel(() => ui.touchCancel());
tt.onWindowResize?.(() => ui.resize(viewport()));
tt.onHide(() => { ui.touchCancel(); session.onBackground(); });
tt.onShow(() => { if (session.ready) session.onForeground(); });
ui.draw();
if (session.ready && session.status !== 'error') session.start();
