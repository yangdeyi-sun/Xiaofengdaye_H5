import type { UiEnvironment } from './UiEnvironment';

export interface Rect { x: number; y: number; width: number; height: number; }
export interface CanvasSurface {
  width: number; height: number;
  getContext(kind: '2d', options?: unknown): CanvasRenderingContext2D | null;
}
export interface Viewport { width: number; height: number; pixelRatio: number; top: number; bottom: number; }
type Listener = (event: Event) => void;

export function decodeHtml(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#\d+|#x[\da-f]+);/gi, (entity) => {
    const known: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': '\u00a0' };
    if (known[entity]) return known[entity];
    const hex = entity.startsWith('&#x');
    return String.fromCodePoint(parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10));
  });
}

/** Minimal document primitives consumed by GameUI. No globals are patched or installed. */
export class UiElement {
  parentElement: UiElement | null = null;
  children: UiElement[] = [];
  attributes: Record<string, string> = {};
  rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  scrollTop = 0;
  scrollLeft = 0;
  scrollHeight = 0;
  scrollWidth = 0;
  computed: Record<string, string> = {};
  readonly createdAt = Date.now();
  transitionFrom: Rect | null = null;
  private transitionAt = 0;
  private markup = '';
  private text = '';
  private listeners = new Map<string, Listener[]>();
  private surface: CanvasSurface | null = null;
  constructor(readonly tagName: string, readonly document: UiDocument) {}

  get id(): string { return this.attributes.id ?? ''; }
  get type(): string { return this.attributes.type ?? ''; }
  get value(): string { return this.attributes.value ?? ''; }
  set value(value: string) { this.attributes.value = value; this.document.invalidate(); }
  get valueAsNumber(): number { return Number(this.value); }
  get hidden(): boolean { return this.hasAttribute('hidden'); }
  set hidden(value: boolean) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get dataset(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.attributes)) if (key.startsWith('data-')) {
      result[key.slice(5).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())] = value;
    }
    return result;
  }
  get classList(): { toggle(name: string, force?: boolean): void; contains(name: string): boolean } {
    return {
      toggle: (name, force) => {
        const values = new Set((this.attributes.class ?? '').split(/\s+/).filter(Boolean));
        if (force ?? !values.has(name)) values.add(name); else values.delete(name);
        this.setAttribute('class', [...values].join(' '));
      },
      contains: (name) => (this.attributes.class ?? '').split(/\s+/).includes(name)
    };
  }
  get innerHTML(): string { return this.markup; }
  set innerHTML(value: string) {
    this.markup = value; this.children = parseHtml(value, this); this.text = '';
    this.document.invalidate();
  }
  get textContent(): string { return this.tagName === '#TEXT' ? this.text : this.children.map((c) => c.textContent).join(''); }
  set textContent(value: string) {
    this.text = value; this.children = [];
    if (this.tagName !== '#TEXT') {
      const text = new UiElement('#TEXT', this.document); text.text = value; text.parentElement = this; this.children = [text];
    }
    this.document.invalidate();
  }
  setAttribute(key: string, value: string): void {
    if (this.attributes[key] === value) return;
    if (key === 'class' && this.computed.transition && /transform|right/.test(this.computed.transition)) {
      this.transitionFrom = { ...this.rect }; this.transitionAt = Date.now();
    }
    this.attributes[key] = value; this.document.invalidate();
  }
  removeAttribute(key: string): void { if (this.hasAttribute(key)) { delete this.attributes[key]; this.document.invalidate(); } }
  getAttribute(key: string): string | null { return this.attributes[key] ?? null; }
  hasAttribute(key: string): boolean { return this.attributes[key] !== undefined; }
  matches(selector: string): boolean { return matchesSelector(this, selector); }
  querySelector<T = UiElement>(selector: string): T | null { return this.querySelectorAll<T>(selector)[0] ?? null; }
  querySelectorAll<T = UiElement>(selector: string): T[] {
    const found: UiElement[] = [];
    const visit = (node: UiElement): void => { for (const child of node.children) {
      if (child.tagName === '#TEXT') continue;
      if (child.matches(selector)) found.push(child); visit(child);
    } };
    visit(this); return found as T[];
  }
  closest<T = UiElement>(selector: string): T | null {
    let node: UiElement | null = this;
    while (node) { if (node.matches(selector)) return node as T; node = node.parentElement; }
    return null;
  }
  addEventListener(type: string, callback: Listener, _options?: unknown): void {
    const callbacks = this.listeners.get(type) ?? []; callbacks.push(callback); this.listeners.set(type, callbacks);
  }
  dispatch(type: string, values: Record<string, unknown> = {}): Event {
    let stopped = false;
    const event = { type, target: this as UiElement, currentTarget: this as UiElement, cancelable: true, defaultPrevented: false, ...values,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { stopped = true; } };
    let node: UiElement | null = this;
    while (node) {
      event.currentTarget = node;
      node.listeners.get(type)?.slice().forEach((callback) => callback(event as unknown as Event));
      if (stopped) break;
      node = node.parentElement;
    }
    if (!stopped) this.document.emitWindow(type, event as unknown as Event);
    return event as unknown as Event;
  }
  getBoundingClientRect(): DOMRect {
    this.document.ensureLayout();
    let { x, y } = this.rect;
    const { width, height } = this.rect;
    const own = this.visualOffset(); x += own.x; y += own.y;
    if (this.computed.position !== 'fixed') {
      let ancestor = this.parentElement;
      while (ancestor) {
        x -= ancestor.scrollLeft; y -= ancestor.scrollTop;
        const offset = ancestor.visualOffset(); x += offset.x; y += offset.y;
        if (ancestor.computed.position === 'fixed') break;
        ancestor = ancestor.parentElement;
      }
    }
    return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height } as DOMRect;
  }
  visualOffset(): { x: number; y: number } {
    if (!this.transitionFrom) return { x: 0, y: 0 };
    const duration = Number(this.computed.transition.match(/([\d.]+)s/)?.[1] ?? 0.22) * 1000;
    const progress = Math.min(1, (Date.now() - this.transitionAt) / duration);
    if (progress >= 1) { this.transitionFrom = null; return { x: 0, y: 0 }; }
    const remaining = (1 - progress) ** 3;
    return { x: (this.transitionFrom.x - this.rect.x) * remaining, y: (this.transitionFrom.y - this.rect.y) * remaining };
  }
  setPointerCapture(id: number): void { this.document.capture.set(id, this); }
  releasePointerCapture(id: number): void { this.document.capture.delete(id); }
  getContext(kind: '2d', options?: unknown): CanvasRenderingContext2D | null {
    if (this.tagName !== 'CANVAS') return null;
    this.surface ??= this.document.createCanvas();
    return this.surface.getContext(kind, options);
  }
  get canvasSurface(): CanvasSurface | null { return this.surface; }
  get width(): number { return this.surface?.width ?? 0; }
  set width(value: number) { this.surface ??= this.document.createCanvas(); this.surface.width = value; }
  get height(): number { return this.surface?.height ?? 0; }
  set height(value: number) { this.surface ??= this.document.createCanvas(); this.surface.height = value; }
}

const VOID_TAGS = new Set(['IMG', 'INPUT', 'BR', 'HR', 'META', 'LINK']);
export function parseHtml(html: string, parent: UiElement): UiElement[] {
  const root = new UiElement('FRAGMENT', parent.document), stack = [root];
  // Quoted attribute values may contain ">" (e.g. tooltips); keep them within the opening tag.
  const tokens = html.match(/<!--[\s\S]*?-->|<\/?[a-zA-Z][^<>]*(?:"[^"<>]*"[^<>]*)*>|[^<]+/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith('<!--')) continue;
    if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
    if (token.startsWith('<')) {
      const match = token.match(/^<([\w-]+)/); if (!match) continue;
      const node = new UiElement(match[1].toUpperCase(), parent.document);
      const attrs = token.slice(match[0].length).replace(/\/?\s*>$/, '');
      const pattern = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g;
      let attr: RegExpExecArray | null;
      while ((attr = pattern.exec(attrs))) node.attributes[attr[1]] = decodeHtml(attr[2] ?? attr[3] ?? attr[4] ?? '');
      node.parentElement = stack[stack.length - 1]; node.parentElement.children.push(node);
      if (!VOID_TAGS.has(node.tagName) && !token.endsWith('/>')) stack.push(node);
    } else {
      const value = decodeHtml(token.replace(/\s+/g, ' '));
      if (!value.trim()) continue;
      const text = new UiElement('#TEXT', parent.document); text.textContent = value;
      text.parentElement = stack[stack.length - 1]; text.parentElement.children.push(text);
    }
  }
  root.children.forEach((node) => { node.parentElement = parent; });
  return root.children;
}

function simpleMatch(node: UiElement, token: string): boolean {
  if (node.tagName === '#TEXT') return false;
  let valid = true;
  token = token.replace(/:not\(([^)]+)\)/g, (_m, inner: string) => { if (simpleMatch(node, inner)) valid = false; return ''; });
  token = token.replace(/:(first-child|last-child|nth-child\((\d+)\)|empty|disabled|root)/g, (m, kind: string, nth: string) => {
    const siblings = node.parentElement?.children.filter((c) => c.tagName !== '#TEXT') ?? [];
    if (kind === 'first-child' && siblings[0] !== node) valid = false;
    if (kind === 'last-child' && siblings[siblings.length - 1] !== node) valid = false;
    if (nth && siblings[Number(nth) - 1] !== node) valid = false;
    if (kind === 'empty' && node.children.length > 0) valid = false;
    if (kind === 'disabled' && !node.hasAttribute('disabled')) valid = false;
    if (kind === 'root' && node.tagName !== 'ROOT') valid = false;
    return '';
  });
  if (token.includes(':')) return false;
  token = token.replace(/\[([^\]=]+)(?:=["']?([^\]"']+)["']?)?\]/g, (_m, name: string, value?: string) => {
    if (!node.hasAttribute(name) || (value !== undefined && node.getAttribute(name) !== value)) valid = false;
    return '';
  });
  const tag = token.match(/^[\w-]+/); if (tag && node.tagName !== tag[0].toUpperCase()) return false;
  for (const match of token.matchAll(/([.#])([\w-]+)/g)) {
    if (match[1] === '#' ? node.id !== match[2] : !node.classList.contains(match[2])) valid = false;
  }
  return valid;
}

export function matchesSelector(node: UiElement, selector: string): boolean {
  return selector.split(',').some((part) => {
    const tokens = part.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
    let cursor: UiElement | null = node;
    if (!simpleMatch(node, tokens.pop() ?? '*')) return false;
    while (tokens.length) {
      const token = tokens.pop()!;
      if (token === '>') { cursor = cursor?.parentElement ?? null; if (!cursor || !simpleMatch(cursor, tokens.pop()!)) return false; }
      else {
        cursor = cursor?.parentElement ?? null;
        while (cursor && !simpleMatch(cursor, token)) cursor = cursor.parentElement;
        if (!cursor) return false;
      }
    }
    return true;
  });
}

export class UiDocument {
  readonly root = new UiElement('ROOT', this);
  readonly capture = new Map<number, UiElement>();
  private windowListeners = new Map<string, Listener[]>();
  private resizeListeners = new Set<() => void>();
  dirty = true;
  layout: () => void = () => {};
  constructor(public viewport: Viewport, readonly createCanvas: () => CanvasSurface, readonly reload: () => void) {}
  invalidate(): void { this.dirty = true; }
  ensureLayout(): void { if (this.dirty) { this.dirty = false; this.layout(); } }
  emitWindow(type: string, event: Event): void { this.windowListeners.get(type)?.forEach((callback) => callback(event)); }
  resize(viewport: Viewport): void {
    this.viewport = viewport; this.invalidate(); this.ensureLayout(); this.resizeListeners.forEach((callback) => callback());
  }
  get environment(): UiEnvironment {
    const document = this;
    return { manualScene: true, window: { get devicePixelRatio() { return document.viewport.pixelRatio; }, addEventListener: ((type: string, callback: Listener) => {
      const values = this.windowListeners.get(type) ?? []; values.push(callback); this.windowListeners.set(type, values);
    }) as Window['addEventListener'] }, history: { pushState() {}, replaceState() {} },
    location: { href: '', reload: this.reload }, query: () => null,
    observeResize: (callback) => ({ observe: () => { this.resizeListeners.add(callback); }, disconnect: () => this.resizeListeners.delete(callback) }) };
  }
}
