import { setPlatform } from '../../platform/Platform';
import { MiniGamePlatform } from '../../platform/minigame/MiniGamePlatform';
import type { MiniGameApi } from '../../platform/minigame/MiniGameApi';
import { DOUYIN_AD_UNITS } from '../../platform/minigame/adUnits';
import { Sprites } from '../../scene/Sprites';
import { GameSession } from '../GameSession';
import { CanvasUI, type CanvasSurface, type Viewport } from './CanvasUI';

interface Touch { clientX: number; clientY: number; }
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
session.lowPower = true;
Sprites.bitmapState = 1;
const ui = new CanvasUI(canvas, session, viewport());
const point = (e: TouchEvent): Touch | undefined => e.changedTouches[0] || e.touches[0];
tt.onTouchStart((e) => { const p = point(e); if (p) ui.touchStart(p.clientX, p.clientY); });
tt.onTouchMove((e) => { const p = point(e); if (p) ui.touchMove(p.clientX, p.clientY); });
tt.onTouchEnd((e) => { const p = point(e); if (p) ui.touchEnd(p.clientX, p.clientY); });
tt.onTouchCancel(() => ui.touchCancel());
tt.onWindowResize?.(() => ui.resize(viewport()));
tt.onHide(() => { ui.touchCancel(); session.onBackground(); });
tt.onShow(() => { if (session.ready) session.onForeground(); });
ui.draw();
if (session.ready && session.status !== 'error') session.start();
