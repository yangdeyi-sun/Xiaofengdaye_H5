import { setPlatform } from '../../platform/Platform';
import { WebPlatform } from '../../platform/web/WebPlatform';
import { GameSession } from '../GameSession';
import { FullCanvasUI } from '../ui/FullCanvasUI';

// 浏览器只作为 Canvas 端的本地预览工具；抖音入口不导入此文件。
setPlatform(new WebPlatform('./'));
const canvas = document.querySelector('canvas')!;
const session = new GameSession(); session.init();
const viewport = () => ({ width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio, top: 0, bottom: 0 });
const ui = new FullCanvasUI(canvas, session, viewport(), () => document.createElement('canvas'), () => location.reload());
// Same debug switch as H5, used for deterministic cross-host acceptance checks.
if (new URLSearchParams(location.search).get('debug') === '1') Object.assign(window, { __xf: session, __xfui: ui.controller, __xfCanvas: ui });
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); ui.touchStart(e.clientX, e.clientY, e.pointerId); });
canvas.addEventListener('pointermove', (e) => ui.touchMove(e.clientX, e.clientY, e.pointerId));
canvas.addEventListener('pointerup', (e) => ui.touchEnd(e.clientX, e.clientY, e.pointerId));
canvas.addEventListener('pointercancel', (e) => ui.touchCancel(e.pointerId));
canvas.addEventListener('wheel', (e) => { e.preventDefault(); ui.wheel(e.clientX, e.clientY, e.deltaX, e.deltaY); }, { passive: false });
window.addEventListener('resize', () => ui.resize(viewport()));
window.addEventListener('pagehide', () => { ui.destroy(); session.dispose(); });
ui.draw(); if (session.ready) session.start();
