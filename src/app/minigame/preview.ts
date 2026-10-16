import { setPlatform } from '../../platform/Platform';
import { WebPlatform } from '../../platform/web/WebPlatform';
import { Sprites } from '../../scene/Sprites';
import { GameSession } from '../GameSession';
import { CanvasUI } from './CanvasUI';

// 浏览器只作为 Canvas 端的本地预览工具；抖音入口不导入此文件。
setPlatform(new WebPlatform('./'));
const canvas = document.querySelector('canvas')!;
const session = new GameSession(); session.init(); session.lowPower = true; Sprites.bitmapState = 1;
const viewport = () => ({ width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio, top: 0, bottom: 0 });
const ui = new CanvasUI(canvas, session, viewport());
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); ui.touchStart(e.clientX, e.clientY); });
canvas.addEventListener('pointermove', (e) => ui.touchMove(e.clientX, e.clientY));
canvas.addEventListener('pointerup', (e) => ui.touchEnd(e.clientX, e.clientY));
canvas.addEventListener('pointercancel', () => ui.touchCancel());
window.addEventListener('resize', () => ui.resize(viewport()));
window.addEventListener('pagehide', () => session.dispose());
ui.draw(); if (session.ready) session.start();
