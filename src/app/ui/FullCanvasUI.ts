import { GameUI } from '../GameUI';
import type { GameSession } from '../GameSession';
import { CanvasDocumentRenderer } from './CanvasDocumentRenderer';
import { UiDocument, type CanvasSurface, type UiElement, type Viewport } from './VirtualDocument';
import stylesheet from '../../../styles.css?inline';

interface TouchState { target: UiElement; x: number; y: number; startX: number; startY: number; moved: boolean; scroll: UiElement | null; }

/** Full GameUI on a Canvas host: no alternate menus, game commands, or tutorial implementation. */
export class FullCanvasUI {
  readonly document: UiDocument;
  readonly renderer: CanvasDocumentRenderer;
  readonly controller: GameUI;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly touches = new Map<number, TouchState>();
  private readonly drawerId = `full-canvas-${Math.random().toString(36).slice(2)}`;

  constructor(private readonly surface: CanvasSurface, readonly session: GameSession, viewport: Viewport,
    createCanvas: () => CanvasSurface, reload: () => void = () => {}) {
    const ctx = surface.getContext('2d'); if (!ctx) throw new Error('当前设备不支持Canvas 2D'); this.ctx = ctx;
    this.document = new UiDocument(viewport, createCanvas, reload); this.document.root.attributes.id = 'app';
    this.renderer = new CanvasDocumentRenderer(this.document, ctx, stylesheet, surface);
    this.controller = new GameUI(this.document.root as unknown as HTMLElement, session, this.document.environment);
    this.resize(viewport); this.controller.mount();
    // The compositor runs after GameUI's scene drawer, even when scene canvases are recreated on navigation.
    session.addDrawer(this.drawerId, () => this.draw()); this.draw();
  }

  resize(viewport: Viewport): void {
    this.touchCancel();
    const ratio = Math.max(1, Math.min(2, viewport.pixelRatio));
    this.surface.width = Math.round(viewport.width * ratio); this.surface.height = Math.round(viewport.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.document.resize({ ...viewport, pixelRatio: ratio }); this.draw();
  }
  draw(): void {
    // GameUI may add its scene drawer after navigating from the homepage. Draw the shared scene first.
    this.controller.drawScene();
    this.renderer.draw();
  }

  private scrollParent(node: UiElement, dx = 0, dy = 1): UiElement | null {
    let candidate: UiElement | null = node;
    while (candidate) {
      const s = candidate.computed;
      const vertical = Math.abs(dy) >= Math.abs(dx);
      const overflow = s[vertical ? 'overflow-y' : 'overflow-x'] ?? s.overflow;
      if (['auto', 'scroll'].includes(overflow) && (vertical ? candidate.scrollHeight > candidate.rect.height : candidate.scrollWidth > candidate.rect.width)) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  }

  touchStart(x: number, y: number, id = 1): void {
    this.session.audio.unlock(); this.draw();
    const target = this.renderer.hit(x, y); if (!target) return;
    this.touches.set(id, { target, x, y, startX: x, startY: y, moved: false, scroll: null });
    target.dispatch('pointerdown', { pointerId: id, clientX: x, clientY: y, button: 0 });
    if (target.tagName === 'INPUT') this.setRange(target, x, false);
  }
  touchMove(x: number, y: number, id = 1): void {
    const touch = this.touches.get(id); if (!touch) return;
    const dx = x - touch.x, dy = y - touch.y;
    if (Math.hypot(x - touch.startX, y - touch.startY) > 7) touch.moved = true;
    const target = this.document.capture.get(id) ?? touch.target;
    if (target.tagName === 'CANVAS') target.dispatch('pointermove', { pointerId: id, clientX: x, clientY: y });
    else if (target.tagName === 'INPUT') this.setRange(target, x, false);
    else if (touch.moved) {
      touch.scroll ??= this.scrollParent(target, dx, dy);
      if (touch.scroll) {
        const scroll = touch.scroll;
        scroll.scrollTop = Math.max(0, Math.min(scroll.scrollHeight - scroll.rect.height, scroll.scrollTop - dy));
        scroll.scrollLeft = Math.max(0, Math.min(scroll.scrollWidth - scroll.rect.width, scroll.scrollLeft - dx));
        scroll.dispatch('scroll');
      }
    }
    touch.x = x; touch.y = y; this.draw();
  }
  touchEnd(x: number, y: number, id = 1): void {
    const touch = this.touches.get(id); if (!touch) return;
    const target = this.document.capture.get(id) ?? touch.target;
    target.dispatch('pointerup', { pointerId: id, clientX: x, clientY: y });
    this.touches.delete(id); this.document.capture.delete(id);
    if (target.tagName === 'INPUT') this.setRange(target, x, true);
    else if (!touch.moved && target.tagName !== 'CANVAS' && !target.closest('[disabled]')) target.dispatch('click');
    this.draw();
  }
  touchCancel(id?: number): void {
    for (const [pointerId, touch] of this.touches) {
      if (id !== undefined && pointerId !== id) continue;
      (this.document.capture.get(pointerId) ?? touch.target).dispatch('pointercancel', { pointerId, clientX: touch.x, clientY: touch.y });
      this.document.emitWindow('pointerup', { type: 'pointerup' } as Event);
      this.document.capture.delete(pointerId); this.touches.delete(pointerId);
    }
  }
  wheel(x: number, y: number, dx: number, dy: number): void {
    const target = this.renderer.hit(x, y); if (!target) return;
    const scroll = this.scrollParent(target, dx, dy);
    if (scroll) {
      scroll.scrollTop = Math.max(0, Math.min(scroll.scrollHeight - scroll.rect.height, scroll.scrollTop + dy));
      scroll.scrollLeft = Math.max(0, Math.min(scroll.scrollWidth - scroll.rect.width, scroll.scrollLeft + dx));
      scroll.dispatch('scroll');
    } else target.dispatch('wheel', { deltaY: dy, deltaX: dx, clientX: x, clientY: y });
    this.draw();
  }
  private setRange(input: UiElement, x: number, final: boolean): void {
    const rect = input.getBoundingClientRect(), min = Number(input.attributes.min ?? 0), max = Number(input.attributes.max ?? 100), step = Number(input.attributes.step ?? 1);
    const amount = min + Math.max(0, Math.min(1, (x - rect.x - 7) / Math.max(1, rect.width - 14))) * (max - min);
    input.value = `${Math.max(min, Math.min(max, min + Math.round((amount - min) / step) * step))}`;
    input.dispatch(final ? 'change' : 'input');
  }
  handleBack(): boolean { const handled = this.controller.handleNativeBack(); this.draw(); return handled; }
  destroy(): void { this.touchCancel(); this.controller.destroy(); this.session.removeDrawer(this.drawerId); this.renderer.destroy(); }
}
