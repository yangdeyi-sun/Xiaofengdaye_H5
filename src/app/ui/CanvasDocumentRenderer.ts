import Yoga from 'yoga-layout-prebuilt';
import { platform } from '../../platform/Platform';
import { StyleSheet, canvasColor, cssLength, splitCss, type Style } from './StyleSheet';
import { UiDocument, UiElement, type Rect, type CanvasSurface } from './VirtualDocument';

type YNode = ReturnType<typeof Yoga.Node.create>;
interface Fragment { node: UiElement; text?: string; image?: ImageBitmap; x: number; y: number; width: number; height: number; style: Style; }
interface Box { node: UiElement | null; yoga: YNode; children: Box[]; inline?: UiElement[]; fixed?: boolean; relocated?: boolean; detached?: Box[]; }
interface Hit { node: UiElement; rect: Rect; clip: Rect; }
const EDGES = ['left', 'top', 'right', 'bottom'] as const;
const EDGE_CODES = [Yoga.EDGE_LEFT, Yoga.EDGE_TOP, Yoga.EDGE_RIGHT, Yoga.EDGE_BOTTOM] as const;
const INLINE = new Set(['inline', 'inline-block']);

/** Paint the exact markup and stylesheet emitted by GameUI into a mini-game Canvas. */
export class CanvasDocumentRenderer {
  readonly styles: StyleSheet;
  private boxes = new Map<UiElement, Box>();
  private images = new Map<string, ImageBitmap>();
  private pendingImages = new Set<string>();
  private fragments = new Map<UiElement, Fragment[]>();
  private fixed: Box[] = [];
  private readonly measured = new Map<string, TextMetrics>();
  private readonly layoutConfig = Yoga.Config.create();
  private backdropSurface: CanvasSurface | null = null;
  hits: Hit[] = [];

  constructor(readonly document: UiDocument, readonly ctx: CanvasRenderingContext2D, stylesheet: string,
    private readonly surface?: CanvasSurface) {
    this.styles = new StyleSheet(stylesheet);
    this.layoutConfig.setPointScaleFactor(0);
    document.layout = () => this.layout();
  }
  private length(value: string | undefined, reference: number, style?: Style): number | undefined {
    return cssLength(value, reference, this.document.viewport, parseFloat(style?.['font-size'] ?? '16'));
  }
  private font(style: Style): string { return `${style['font-style'] ?? 'normal'} ${style['font-weight'] ?? '400'} ${style['font-size']} ${style['font-family']}`; }
  private measure(text: string): TextMetrics {
    const key = `${this.ctx.font}|${text}`;
    let measured = this.measured.get(key);
    if (!measured) { measured = this.ctx.measureText(text); if (this.measured.size > 4096) this.measured.clear(); this.measured.set(key, measured); }
    return measured;
  }
  private lineHeight(style: Style): number {
    const size = parseFloat(style['font-size']);
    const value = style['line-height'];
    if (value === 'normal') return size * 1.5;
    return /^[\d.]+$/.test(value) ? Number(value) * size : this.length(value, size, style) ?? size * 1.5;
  }
  image(path: string): ImageBitmap | undefined {
    const existing = this.images.get(path);
    if (!existing && !this.pendingImages.has(path)) {
      this.pendingImages.add(path);
      void platform().images.load(path).then((image) => { this.images.set(path, image); this.document.invalidate(); })
        .catch((error) => { console.warn('界面图片加载失败', path, error); });
    }
    return existing;
  }

  private computeStyles(node: UiElement, inherited: Style): void {
    const style = this.styles.resolve(node, inherited, this.document.viewport);
    style['font-size'] = `${this.length(style['font-size'], parseFloat(inherited['font-size'] ?? '16'), inherited) ?? 16}px`;
    node.computed = style;
    for (const child of node.children) this.computeStyles(child, style);
  }

  layout(): void {
    this.computeStyles(this.document.root, {});
    // Grid columns use the actual available width from the preceding flex layout pass.
    for (let pass = 0; pass < 3; pass++) {
      this.fixed = []; this.boxes.clear(); this.fragments.clear();
      const root = this.build(this.document.root, this.document.viewport.width);
      root.yoga.setWidth(this.document.viewport.width); root.yoga.setHeight(this.document.viewport.height);
      for (const box of this.fixed) root.yoga.insertChild(box.yoga, root.yoga.getChildCount());
      root.yoga.calculateLayout(this.document.viewport.width, this.document.viewport.height, Yoga.DIRECTION_LTR);
      this.commit(root, 0, 0);
      // Fixed descendants are laid out relative to the viewport, independent of their DOM ancestry.
      for (const box of this.fixed) this.commit(box, 0, 0);
      root.yoga.freeRecursive();
    }
    this.updateScroll(this.document.root);
  }

  private build(node: UiElement, parentWidth: number, containing: Box | null = null): Box {
    const yoga = Yoga.Node.createWithConfig(this.layoutConfig), box: Box = { node, yoga, children: [], fixed: node.computed.position === 'fixed' };
    this.boxes.set(node, box);
    const s = node.computed, font = parseFloat(s['font-size']);
    const positioned = node.tagName === 'ROOT' || ['relative', 'absolute', 'fixed'].includes(s.position) ? box : containing;
    const viewport = this.document.viewport;
    const reference = box.fixed ? viewport.width : parentWidth;
    const ownWidth = this.length(s.width, reference, s) ?? (node.rect.width || parentWidth);
    const innerWidth = Math.max(0, ownWidth - EDGES.reduce((sum, edge) => edge === 'left' || edge === 'right'
      ? sum + (this.length(s[`padding-${edge}`], ownWidth, s) ?? 0) + (this.length(s[`border-${edge}-width`], ownWidth, s) ?? 0) : sum, 0));
    if (s.display === 'none') yoga.setDisplay(Yoga.DISPLAY_NONE);
    yoga.setFlexShrink(Number(s['flex-shrink'] ?? '1'));
    if (s['flex-grow']) yoga.setFlexGrow(Number(s['flex-grow']));
    if (s['flex-basis']) yoga.setFlexBasis(s['flex-basis'].endsWith('%') ? s['flex-basis'] : this.length(s['flex-basis'], reference, s) ?? 0);
    const dimensions = ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height'] as const;
    for (const key of dimensions) {
      const value = s[key]; if (!value || value === 'auto' || value === 'none') continue;
      const numeric = /^-?[\d.]+%$/.test(value) ? value : this.length(value, key.includes('height') ? viewport.height : reference, s);
      if (numeric === undefined) continue;
      if (key === 'width') yoga.setWidth(numeric);
      if (key === 'height') yoga.setHeight(numeric);
      if (key === 'min-width') yoga.setMinWidth(numeric);
      if (key === 'min-height') yoga.setMinHeight(numeric);
      if (key === 'max-width') yoga.setMaxWidth(numeric);
      if (key === 'max-height') yoga.setMaxHeight(numeric);
    }
    EDGES.forEach((edge, i) => {
      const margin = s[`margin-${edge}`];
      if (margin === 'auto') yoga.setMarginAuto(EDGE_CODES[i]);
      else if (margin) yoga.setMargin(EDGE_CODES[i], this.length(margin, reference, s) ?? 0);
      const padding = this.length(s[`padding-${edge}`], reference, s); if (padding !== undefined) yoga.setPadding(EDGE_CODES[i], padding);
      const border = this.length(s[`border-${edge}-width`], reference, s); if (border !== undefined) yoga.setBorder(EDGE_CODES[i], border);
      const position = s[edge];
      if (position && position !== 'auto') yoga.setPosition(EDGE_CODES[i], /^-?[\d.]+%$/.test(position) ? position : this.length(position, edge === 'left' || edge === 'right' ? reference : viewport.height, s) ?? 0);
    });
    if (s.position === 'absolute' || box.fixed) yoga.setPositionType(Yoga.POSITION_TYPE_ABSOLUTE);
    if (s['aspect-ratio']) yoga.setAspectRatio(Number(s['aspect-ratio']));
    if (INLINE.has(s.display) && node.parentElement?.computed.display === 'block' &&
      node.parentElement.children.some((child) => !INLINE.has(child.computed.display))) yoga.setMinHeight(this.lineHeight(node.parentElement.computed));
    if (['auto', 'scroll', 'hidden'].includes(s.overflow) || s['overflow-x'] || s['overflow-y']) yoga.setOverflow(Yoga.OVERFLOW_SCROLL);
    if (node.tagName === 'IMG') {
      const image = this.image(node.attributes.src ?? '');
      const ratio = image && image.height > 0 ? image.width / image.height : node.classList.contains('ui-icon') ? 1 : 2.5;
      yoga.setMeasureFunc((width: number, mode: number) => {
        const w = mode === Yoga.MEASURE_MODE_UNDEFINED ? image?.width ?? 25 : Math.min(width, image?.width ?? width);
        return { width: w, height: w / ratio };
      });
      return box;
    }
    if (node.tagName === 'CANVAS') return box;
    if (node.tagName === 'INPUT') { if (!s.width) yoga.setWidth(129); return box; }
    const isFlex = s.display === 'flex', isGrid = s.display === 'grid';
    if (!isFlex && !isGrid && node.children.every((c) => c.computed.display === 'none' ||
      (INLINE.has(c.computed.display) && !['BUTTON', 'INPUT'].includes(c.tagName) && !['absolute', 'fixed'].includes(c.computed.position)))) {
      box.inline = node.tagName === '#TEXT' ? [node] : node.children;
      yoga.setMeasureFunc((width: number, mode: number) => {
        const flow = this.inlineLayout(box.inline!, s, mode === Yoga.MEASURE_MODE_UNDEFINED ? Infinity : width);
        return { width: flow.width, height: flow.height };
      });
      return box;
    }
    if (node.tagName === '#TEXT') {
      box.inline = [node];
      yoga.setMeasureFunc((width: number, mode: number) => {
        const flow = this.inlineLayout([node], s, mode === Yoga.MEASURE_MODE_UNDEFINED ? Infinity : width);
        return { width: flow.width, height: flow.height };
      });
      return box;
    }
    const row = isFlex && (s['flex-direction'] ?? 'row').startsWith('row');
    yoga.setFlexDirection(row ? Yoga.FLEX_DIRECTION_ROW : Yoga.FLEX_DIRECTION_COLUMN);
    if (s['flex-wrap'] === 'wrap') yoga.setFlexWrap(Yoga.WRAP_WRAP);
    yoga.setAlignItems(this.align(s['align-items'] ?? (isFlex ? 'stretch' : 'stretch')));
    const justify: Record<string, number> = { center: Yoga.JUSTIFY_CENTER, 'flex-end': Yoga.JUSTIFY_FLEX_END,
      'space-between': Yoga.JUSTIFY_SPACE_BETWEEN, 'space-around': Yoga.JUSTIFY_SPACE_AROUND, 'space-evenly': Yoga.JUSTIFY_SPACE_EVENLY };
    yoga.setJustifyContent((justify[s['justify-content']] ?? Yoga.JUSTIFY_FLEX_START) as Parameters<YNode['setJustifyContent']>[0]);
    if (isGrid && s['place-items'] === 'center' && !s['grid-template-columns']) yoga.setJustifyContent(Yoga.JUSTIFY_CENTER);
    const children = node.children.filter((child) => child.computed.display !== 'none');
    const ordinary: Box[] = [];
    for (const child of children) {
      const childBox = this.build(child, innerWidth, positioned); box.children.push(childBox);
      if (childBox.fixed) this.fixed.push(childBox);
      else if (child.computed.position === 'absolute' && positioned && positioned !== box) {
        childBox.relocated = true; (positioned.detached ??= []).push(childBox);
      }
      else ordinary.push(childBox);
    }
    const gap = this.length(s[row ? 'column-gap' : 'row-gap'], innerWidth, s) ?? 0;
    if (isFlex && row && s['flex-wrap'] === 'wrap') {
      // Yoga 1 has no gap property. An anonymous row with an extra trailing gap gives
      // the same wrap boundary as CSS gap, without moving the final item to a new line.
      const wrap: Box = { node: null, yoga: Yoga.Node.createWithConfig(this.layoutConfig), children: ordinary };
      const gapY = this.length(s['row-gap'], innerWidth, s) ?? 0;
      const parentStyle = node.parentElement?.computed;
      const shrinkToFit = !s.width && !Number(s['flex-grow']) && parentStyle?.display === 'flex' && (parentStyle['flex-direction'] ?? 'row') === 'row';
      const preferred = ordinary.reduce((sum, child) => {
        const cs = child.node?.computed ?? s;
        const content = this.inlineLayout(child.node?.children ?? [], cs, Infinity).width;
        const insets = ['left', 'right'].reduce((n, edge) => n + (this.length(cs[`padding-${edge}`], innerWidth, cs) ?? 0) +
          (this.length(cs[`border-${edge}-width`], innerWidth, cs) ?? 0), 0);
        return sum + (this.length(cs.width, innerWidth, cs) ?? content + insets) + gap;
      }, 0);
      wrap.yoga.setWidth(shrinkToFit ? Math.min(innerWidth + gap, preferred) : innerWidth + gap);
      if (shrinkToFit) wrap.yoga.setMargin(Yoga.EDGE_RIGHT, -gap);
      wrap.yoga.setFlexDirection(Yoga.FLEX_DIRECTION_ROW); wrap.yoga.setFlexWrap(Yoga.WRAP_WRAP);
      wrap.yoga.setAlignItems(this.align(s['align-items'] ?? 'stretch')); wrap.yoga.setAlignContent(Yoga.ALIGN_FLEX_START);
      wrap.yoga.setJustifyContent((justify[s['justify-content']] ?? Yoga.JUSTIFY_FLEX_START) as Parameters<YNode['setJustifyContent']>[0]);
      ordinary.forEach((child, index) => {
        const right = child.yoga.getMargin(Yoga.EDGE_RIGHT), bottom = child.yoga.getMargin(Yoga.EDGE_BOTTOM);
        child.yoga.setMargin(Yoga.EDGE_RIGHT, gap + (right.unit === Yoga.UNIT_POINT ? right.value : 0));
        child.yoga.setMargin(Yoga.EDGE_BOTTOM, gapY + (bottom.unit === Yoga.UNIT_POINT ? bottom.value : 0));
        wrap.yoga.insertChild(child.yoga, index);
      });
      wrap.yoga.setMargin(Yoga.EDGE_BOTTOM, -gapY);
      yoga.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN); yoga.insertChild(wrap.yoga, 0);
      box.children = [...box.children.filter((child) => child.fixed || child.relocated), wrap];
    } else if (isGrid && s['grid-template-columns']) {
      this.grid(box, ordinary, innerWidth, s);
    } else if (isGrid && s['place-items'] === 'center' && (s.height || s['min-height'])) {
      // CSS grid's implicit rows stretch independently; centered cards keep their intrinsic height.
      // This matters for the homepage's empty swarm row above its card.
      for (const child of ordinary) {
        if (child.node?.computed.position === 'absolute') { yoga.insertChild(child.yoga, yoga.getChildCount()); continue; }
        const track: Box = { node: null, yoga: Yoga.Node.createWithConfig(this.layoutConfig), children: [child] };
        const childWidth = this.length(child.node?.computed.width, innerWidth, child.node?.computed) ?? innerWidth;
        track.yoga.setWidth(Math.max(innerWidth, childWidth)); track.yoga.setFlexGrow(1); track.yoga.setFlexShrink(0);
        track.yoga.setAlignItems(Yoga.ALIGN_CENTER); track.yoga.setJustifyContent(Yoga.JUSTIFY_CENTER);
        child.yoga.setFlexShrink(0); track.yoga.insertChild(child.yoga, 0); yoga.insertChild(track.yoga, yoga.getChildCount());
        const index = box.children.indexOf(child); if (index >= 0) box.children[index] = track;
      }
      yoga.setAlignItems(Yoga.ALIGN_FLEX_START); yoga.setJustifyContent(Yoga.JUSTIFY_FLEX_START);
    } else {
      let previous: Box | null = null;
      ordinary.forEach((child, i) => {
        yoga.insertChild(child.yoga, yoga.getChildCount());
        if (isFlex && !row && child.node && !child.node.computed.height && !child.node.computed['min-height'] &&
          !Number(child.node.computed['flex-grow']) && !child.node.computed.overflow) child.yoga.setFlexShrink(0);
        if (!isFlex) {
          child.yoga.setFlexShrink(0);
          if (!isGrid && child.node?.computed.display === 'inline-block' && !child.node.computed.width) child.yoga.setAlignSelf(Yoga.ALIGN_FLEX_START);
          if (!isGrid && child.node?.computed.position !== 'absolute') {
            const bottom = previous?.yoga.getMargin(Yoga.EDGE_BOTTOM), top = child.yoga.getMargin(Yoga.EDGE_TOP);
            if (bottom?.unit === Yoga.UNIT_POINT && top.unit === Yoga.UNIT_POINT) {
              const collapsed = Math.max(bottom.value, top.value, 0) + Math.min(bottom.value, top.value, 0);
              child.yoga.setMargin(Yoga.EDGE_TOP, collapsed - bottom.value);
            }
            previous = child;
          }
        }
        if (child.node?.computed['align-self']) child.yoga.setAlignSelf(this.align(child.node.computed['align-self']));
        if (i < ordinary.length - 1 && child.node?.computed.position !== 'absolute' && gap) {
          const code = row ? Yoga.EDGE_RIGHT : Yoga.EDGE_BOTTOM;
          const existing = child.yoga.getMargin(code); child.yoga.setMargin(code, gap + (existing.unit === Yoga.UNIT_POINT ? existing.value : 0));
        }
      });
    }
    for (const detached of box.detached ?? []) yoga.insertChild(detached.yoga, yoga.getChildCount());
    return box;
  }

  private align(value: string): Parameters<YNode['setAlignItems']>[0] {
    return ({ center: Yoga.ALIGN_CENTER, 'flex-start': Yoga.ALIGN_FLEX_START, start: Yoga.ALIGN_FLEX_START,
      'flex-end': Yoga.ALIGN_FLEX_END, end: Yoga.ALIGN_FLEX_END, baseline: Yoga.ALIGN_BASELINE } as const)[value] ?? Yoga.ALIGN_STRETCH;
  }

  private grid(box: Box, children: Box[], width: number, style: Style): void {
    let columns = style['grid-template-columns'];
    columns = columns.replace(/repeat\((\d+),\s*(.*)\)/, (_m, n: string, column: string) => Array(Number(n)).fill(column).join(' '));
    const parts = splitCss(columns, ' '), gapX = this.length(style['column-gap'], width, style) ?? 0,
      gapY = this.length(style['row-gap'], width, style) ?? 0;
    let fixed = 0, totalFraction = 0;
    const specs = parts.map((part) => {
      const fraction = part.match(/([\d.]+)fr/);
      if (fraction) { const fr = Number(fraction[1]); totalFraction += fr; return { fr, fixed: 0 }; }
      const px = this.length(part, width, style) ?? 0; fixed += px; return { fr: 0, fixed: px };
    });
    const remaining = Math.max(0, width - fixed - gapX * (parts.length - 1));
    const sizes = specs.map((spec) => spec.fr ? remaining * spec.fr / totalFraction : spec.fixed);
    const rows: Box[][] = [];
    // Explicit full-width grid rows (the brew meter) follow the ordinary first row.
    const normal = children.filter((child) => !child.node?.computed['grid-column']?.includes('/'));
    const spanning = children.filter((child) => child.node?.computed['grid-column']?.includes('/'));
    for (let i = 0; i < normal.length; i += sizes.length) rows.push(normal.slice(i, i + sizes.length));
    spanning.forEach((child) => rows.push([child]));
    // A label spanning two rows, used by the boost tier, sits beside a vertical description.
    if (normal[0]?.node?.computed['grid-row']?.startsWith('span') && normal.length === 3 && sizes.length === 2) {
      const right: Box = { node: null, yoga: Yoga.Node.createWithConfig(this.layoutConfig), children: [normal[1], normal[2]] };
      right.yoga.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN); right.yoga.setWidth(sizes[1]);
      right.children.forEach((child, i) => { right.yoga.insertChild(child.yoga, i); if (i === 0) child.yoga.setMargin(Yoga.EDGE_BOTTOM, gapY); });
      rows.splice(0, rows.length, [normal[0], right]);
    }
    box.children = box.children.filter((child) => child.fixed);
    rows.forEach((cells, rowIndex) => {
      const row: Box = { node: null, yoga: Yoga.Node.createWithConfig(this.layoutConfig), children: cells };
      row.yoga.setFlexDirection(Yoga.FLEX_DIRECTION_ROW); row.yoga.setAlignItems(this.align(style['align-items'] ?? 'stretch'));
      row.yoga.setWidth(width);
      const fillHeight = rows.length === 1 && style.height && style.height !== 'auto';
      if (fillHeight) { row.yoga.setFlexGrow(1); row.yoga.setFlexBasis(0); row.yoga.setMinHeight(0); }
      row.yoga.setFlexShrink(fillHeight ? 1 : 0); if (rowIndex < rows.length - 1) row.yoga.setMargin(Yoga.EDGE_BOTTOM, gapY);
      cells.forEach((cell, column) => {
        cell.yoga.setWidth(spanning.includes(cell) ? width : sizes[column]); cell.yoga.setFlexShrink(0);
        cell.yoga.setFlexGrow(0); cell.yoga.setFlexBasis(Number.NaN);
        if (column < cells.length - 1) cell.yoga.setMargin(Yoga.EDGE_RIGHT, gapX);
        row.yoga.insertChild(cell.yoga, column);
      });
      box.yoga.insertChild(row.yoga, box.yoga.getChildCount()); box.children.push(row);
    });
  }

  private commit(box: Box, parentX: number, parentY: number): void {
    const layout = box.yoga.getComputedLayout();
    let x = parentX + layout.left, y = parentY + layout.top;
    const node = box.node;
    if (node) {
      const transform = node.computed.transform ?? '';
      for (const m of transform.matchAll(/translate(X|Y)?\(([^)]+)\)/g)) {
        const values = splitCss(m[2]);
        if (m[1] !== 'Y') x += this.length(values[0], layout.width, node.computed) ?? 0;
        if (m[1] !== 'X') y += this.length(m[1] === 'Y' ? values[0] : values[1], layout.height, node.computed) ?? 0;
      }
      node.rect = { x, y, width: layout.width, height: layout.height };
      if (box.inline) {
        const insetX = box.yoga.getComputedPadding(Yoga.EDGE_LEFT) + box.yoga.getComputedBorder(Yoga.EDGE_LEFT),
          insetY = box.yoga.getComputedPadding(Yoga.EDGE_TOP) + box.yoga.getComputedBorder(Yoga.EDGE_TOP);
        const contentWidth = Math.max(0, layout.width - insetX - box.yoga.getComputedPadding(Yoga.EDGE_RIGHT) - box.yoga.getComputedBorder(Yoga.EDGE_RIGHT));
        const flow = this.inlineLayout(box.inline, node.computed, contentWidth);
        this.fragments.set(node, flow.fragments.map((fragment) => ({ ...fragment, x: fragment.x + insetX, y: fragment.y + insetY })));
      }
    }
    for (const child of box.children) { if (!child.fixed && !child.relocated) this.commit(child, x, y); }
    for (const child of box.detached ?? []) this.commit(child, x, y);
  }

  private inlineLayout(nodes: UiElement[], parent: Style, maxWidth: number): { width: number; height: number; fragments: Fragment[] } {
    const fragments: Fragment[] = []; let x = 0, y = 0, max = 0, height = this.lineHeight(parent), rowStart = 0;
    const closeRow = (): void => {
      const free = Number.isFinite(maxWidth) ? Math.max(0, maxWidth - x) : 0;
      const align = parent['text-align'] === 'center' ? free / 2 : parent['text-align'] === 'right' ? free : 0;
      for (let i = rowStart; i < fragments.length; i++) { fragments[i].x += align; fragments[i].y += (height - fragments[i].height) / 2; }
      max = Math.max(max, x); y += height; x = 0; height = this.lineHeight(parent); rowStart = fragments.length;
    };
    const visit = (node: UiElement): void => {
      const style = node.computed;
      if (style.display === 'none') return;
      if (node.tagName === 'BR') { closeRow(); return; }
      if (node.tagName === 'IMG') {
        const image = this.image(node.attributes.src ?? ''), width = this.length(style.width, maxWidth, style) ?? 25,
          h = this.length(style.height, maxWidth, style) ?? (image ? width * image.height / image.width : width);
        if (x > 0 && x + width > maxWidth && parent['white-space'] !== 'nowrap') closeRow();
        fragments.push({ node, image, x, y, width, height: h, style }); x += width; height = Math.max(height, h); return;
      }
      if (node.tagName !== '#TEXT') { node.children.forEach(visit); return; }
      this.ctx.font = this.font(style);
      const text = parent['white-space'] === 'pre-wrap' ? node.textContent : node.textContent.replace(/\s+/g, ' ');
      const words = text.match(/[a-zA-Z0-9.,%+×/秒\-]+|./gu) ?? [];
      for (let i = words.length - 1; i > 0; i--) if (/^[，。、：；？！）】》”’\])]/.test(words[i])) {
        words[i - 1] += words[i]; words.splice(i, 1);
      }
      for (const word of words) {
        const width = this.measure(word).width, h = this.lineHeight(style);
        if (x > 0 && x + width > maxWidth && parent['white-space'] !== 'nowrap') closeRow();
        if (x === 0 && word === ' ') continue;
        fragments.push({ node, text: word, x, y, width, height: h, style }); x += width; height = Math.max(height, h);
      }
    };
    nodes.forEach(visit);
    if (fragments.length > rowStart || y === 0) closeRow();
    return { width: max, height: nodes.length ? y : 0, fragments };
  }

  private updateScroll(node: UiElement): void {
    for (const child of node.children) this.updateScroll(child);
    const bottom = this.length(node.computed['padding-bottom'], node.rect.width, node.computed) ?? 0,
      right = this.length(node.computed['padding-right'], node.rect.width, node.computed) ?? 0;
    node.scrollHeight = Math.max(node.rect.height, ...node.children.filter((child) => !['absolute', 'fixed'].includes(child.computed.position)).map((child) => child.rect.y + child.rect.height + bottom - node.rect.y));
    node.scrollWidth = Math.max(node.rect.width, ...node.children.filter((child) => !['absolute', 'fixed'].includes(child.computed.position)).map((child) => child.rect.x + child.rect.width + right - node.rect.x));
    node.scrollTop = Math.max(0, Math.min(node.scrollTop, node.scrollHeight - node.rect.height));
    node.scrollLeft = Math.max(0, Math.min(node.scrollLeft, node.scrollWidth - node.rect.width));
  }

  draw(): void {
    this.document.ensureLayout(); this.hits = [];
    const v = this.document.viewport;
    this.ctx.clearRect(0, 0, v.width, v.height);
    this.paint(this.document.root, { x: 0, y: 0, width: v.width, height: v.height }, 0, 0, 1);
  }

  private paint(node: UiElement, clip: Rect, scrollX: number, scrollY: number, opacity: number): void {
    const s = node.computed, c = this.ctx;
    if (s.display === 'none' || s.visibility === 'hidden') return;
    if (s.position === 'fixed') { scrollX = 0; scrollY = 0; }
    const animated = node.visualOffset(); scrollX -= animated.x; scrollY -= animated.y;
    if (node.parentElement?.classList.contains('home-swarm')) {
      const delay = parseFloat(s['animation-delay'] ?? '0') * 1000;
      const phase = (1 - Math.cos((Date.now() - node.createdAt - delay) / 5000 * Math.PI * 2)) / 2;
      scrollX -= 22 * phase; scrollY += 16 * phase;
    }
    const rect = { ...node.rect, x: node.rect.x - scrollX, y: node.rect.y - scrollY };
    opacity *= Number(s.opacity ?? '1');
    c.save(); c.globalAlpha = opacity;
    if (s.filter && typeof c.filter === 'string') c.filter = s.filter;
    const radiusParts = splitCss(s['border-radius'] ?? '0', ' ');
    const radius = radiusParts.map((part) => this.length(part, Math.min(rect.width, rect.height), s) ?? 0);
    const backdrop = s['backdrop-filter']?.match(/blur\(([\d.]+)px\)/);
    if (backdrop) { c.save(); this.roundRect(rect, radius); c.clip(); this.blurBackdrop(Number(backdrop[1])); c.restore(); }
    this.roundRect(rect, radius); const background = s.background ?? s['background-color'];
    if (background && background !== 'transparent' && background !== 'none') {
      const shadow = s['box-shadow'];
      if (shadow) {
        const parts = splitCss(shadow, ' '); c.shadowOffsetX = parseFloat(parts[0]) || 0; c.shadowOffsetY = parseFloat(parts[1]) || 0;
        c.shadowBlur = parseFloat(parts[2]) || 0; c.shadowColor = canvasColor(parts.find((part) => /^(#|rgb)/.test(part)) ?? 'rgba(59,42,20,0.18)');
      }
      c.fillStyle = this.background(background, rect); c.fill(); c.shadowBlur = 0; c.shadowColor = 'transparent';
      if (background.startsWith('repeating-linear-gradient')) {
        c.save(); this.roundRect(rect, radius); c.clip(); c.fillStyle = '#f2b53a'; c.fillRect(rect.x, rect.y, rect.width, rect.height);
        const offset = ((Date.now() - node.createdAt) / 1200 * 28) % 28;
        c.fillStyle = '#e8a317';
        for (let x = -rect.height - 28 + offset; x < rect.width + rect.height; x += 28) {
          c.beginPath(); c.moveTo(rect.x + x, rect.y); c.lineTo(rect.x + x + 14, rect.y);
          c.lineTo(rect.x + x + 14 + rect.height, rect.y + rect.height); c.lineTo(rect.x + x + rect.height, rect.y + rect.height); c.closePath(); c.fill();
        }
        c.restore();
      }
      const imageMatch = background.match(/url\(['"]?([^)'"\s]+)['"]?\)/);
      if (imageMatch) { const image = this.image(imageMatch[1]); if (image) { c.save(); this.roundRect(rect, radius); c.clip(); this.drawImage(image, rect, 'cover'); c.restore(); } }
      if (node.classList.contains('home-screen')) { c.fillStyle = this.background('linear-gradient(180deg, rgb(45 54 24 / 20%), rgb(45 29 12 / 60%))', rect); c.fillRect(rect.x, rect.y, rect.width, rect.height); }
    }
    EDGES.forEach((edge, i) => {
      const width = this.length(s[`border-${edge}-width`], rect.width, s) ?? 0;
      if (width <= 0) return;
      c.strokeStyle = canvasColor(s[`border-${edge}-color`] ?? s['border-color'] ?? '#d8bc85'); c.lineWidth = width;
      if (EDGES.every((e) => s[`border-${e}-width`] === s[`border-${edge}-width`])) {
        if (i === 0) { this.roundRect({ x: rect.x + width / 2, y: rect.y + width / 2, width: rect.width - width, height: rect.height - width }, radius); c.stroke(); }
      } else {
        c.beginPath();
        if (edge === 'left' || edge === 'right') { const x = rect.x + (edge === 'right' ? rect.width - width / 2 : width / 2); c.moveTo(x, rect.y); c.lineTo(x, rect.y + rect.height); }
        else { const y = rect.y + (edge === 'bottom' ? rect.height - width / 2 : width / 2); c.moveTo(rect.x, y); c.lineTo(rect.x + rect.width, y); }
        c.stroke();
      }
    });
    if (s['pointer-events'] !== 'none') this.hits.push({ node, rect, clip });
    let childClip = clip;
    if ([s.overflow, s['overflow-x'], s['overflow-y']].some((value) => ['auto', 'hidden', 'scroll'].includes(value))) {
      this.roundRect(rect, radius); c.clip(); childClip = intersect(clip, rect);
    }
    if (node.tagName === 'IMG') { const image = this.image(node.attributes.src ?? ''); if (image) this.drawImage(image, rect, s['object-fit'] ?? 'contain'); }
    if (node.tagName === 'CANVAS' && node.canvasSurface) c.drawImage(node.canvasSurface as unknown as CanvasImageSource, rect.x, rect.y, rect.width, rect.height);
    if (node.tagName === 'INPUT') this.drawRange(node, rect);
    const fragments = this.fragments.get(node);
    if (fragments) for (const fragment of fragments) {
      const fr = { x: rect.x + fragment.x, y: rect.y + fragment.y, width: fragment.width, height: fragment.height };
      if (fragment.image) this.drawImage(fragment.image, fr, 'contain');
      else if (fragment.text) {
        c.font = this.font(fragment.style); c.fillStyle = canvasColor(fragment.style.color); c.textAlign = 'left'; c.textBaseline = 'alphabetic';
        const metrics = this.measure(fragment.text), ascent = metrics.fontBoundingBoxAscent ?? parseFloat(fragment.style['font-size']) * 1.18,
          descent = metrics.fontBoundingBoxDescent ?? parseFloat(fragment.style['font-size']) * 0.32;
        c.fillText(fragment.text, fr.x, fr.y + (fr.height - ascent - descent) / 2 + ascent);
        if (fragment.style['text-decoration']?.includes('underline')) c.fillRect(fr.x, fr.y + (fr.height - ascent - descent) / 2 + ascent + 2, fr.width, 1);
      }
    }
    const z = (element: UiElement): number => {
      if (element.computed['z-index'] !== undefined) return Number(element.computed['z-index']) || 0;
      return Math.max(0, ...element.children.map(z));
    };
    const children = [...node.children].sort((a, b) => z(a) - z(b));
    // Inline descendants are already painted as fragments, including their own fonts and icons.
    if (!fragments) for (const child of children) this.paint(child, childClip, scrollX + node.scrollLeft, scrollY + node.scrollTop, opacity);
    if (node.scrollHeight > node.rect.height + 2 && ['auto', 'scroll'].includes(s.overflow ?? s['overflow-y'])) {
      const track = Math.max(20, rect.height * rect.height / node.scrollHeight);
      c.fillStyle = 'rgba(122,101,69,0.35)'; c.fillRect(rect.x + rect.width - 4, rect.y + (rect.height - track) * node.scrollTop / (node.scrollHeight - rect.height), 3, track);
    }
    c.restore();
  }

  private background(value: string, rect: Rect): string | CanvasGradient {
    const gradient = value.match(/(?:repeating-)?(linear|radial)-gradient\(([\s\S]*)\)/);
    if (gradient) {
      const parts = splitCss(gradient[2]); const first = parts[0];
      const stops = parts.filter((part) => /^(#|rgb|white|black)/.test(part));
      const angle = first.includes('deg') ? parseFloat(first) * Math.PI / 180 : Math.PI;
      const result = gradient[1] === 'radial'
        ? this.ctx.createRadialGradient(rect.x + rect.width / 2, rect.y + rect.height * 0.2, 0, rect.x + rect.width / 2, rect.y + rect.height * 0.2, Math.max(rect.width, rect.height))
        : this.ctx.createLinearGradient(rect.x + rect.width / 2 - Math.sin(angle) * rect.width / 2, rect.y + rect.height / 2 + Math.cos(angle) * rect.height / 2,
          rect.x + rect.width / 2 + Math.sin(angle) * rect.width / 2, rect.y + rect.height / 2 - Math.cos(angle) * rect.height / 2);
      stops.forEach((part, i) => {
        const color = part.match(/^(#[\da-fA-F]+|rgba?\([^)]*\)|white|black)/)?.[0] ?? '#fff8e7';
        const stop = part.slice(color.length).match(/([\d.]+)%/);
        result.addColorStop(stop ? Number(stop[1]) / 100 : i / Math.max(1, stops.length - 1), canvasColor(color));
      });
      return result;
    }
    return canvasColor(value.match(/^(#[\da-fA-F]+|rgba?\([^)]*\)|white|black|transparent)/)?.[0] ?? 'transparent');
  }

  private blurBackdrop(radius: number): void {
    if (!this.surface) return;
    this.backdropSurface ??= this.document.createCanvas();
    const layer = this.backdropSurface, offscreen = layer.getContext('2d'); if (!offscreen) return;
    const v = this.document.viewport;
    const supportsFilter = typeof offscreen.filter === 'string';
    const width = supportsFilter ? this.surface.width : Math.max(1, Math.ceil(v.width / (radius * 2))),
      height = supportsFilter ? this.surface.height : Math.max(1, Math.ceil(v.height / (radius * 2)));
    if (layer.width !== width) layer.width = width;
    if (layer.height !== height) layer.height = height;
    offscreen.clearRect(0, 0, width, height); offscreen.imageSmoothingEnabled = true;
    if (supportsFilter) offscreen.filter = `blur(${radius * v.pixelRatio}px)`;
    offscreen.drawImage(this.surface as unknown as CanvasImageSource, 0, 0, width, height);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(layer as unknown as CanvasImageSource, 0, 0, v.width, v.height);
  }

  private drawImage(image: ImageBitmap, rect: Rect, fit: string): void {
    const ratio = fit === 'cover' ? Math.max(rect.width / image.width, rect.height / image.height) : Math.min(rect.width / image.width, rect.height / image.height);
    const width = image.width * ratio, height = image.height * ratio;
    if (fit === 'cover') {
      const sourceWidth = rect.width / ratio, sourceHeight = rect.height / ratio;
      this.ctx.drawImage(image, (image.width - sourceWidth) / 2, (image.height - sourceHeight) / 2, sourceWidth, sourceHeight, rect.x, rect.y, rect.width, rect.height);
    } else this.ctx.drawImage(image, rect.x + (rect.width - width) / 2, rect.y + (rect.height - height) / 2, width, height);
  }
  private drawRange(node: UiElement, rect: Rect): void {
    const c = this.ctx, min = Number(node.attributes.min ?? 0), max = Number(node.attributes.max ?? 100), fraction = Math.max(0, Math.min(1, (node.valueAsNumber - min) / (max - min || 1)));
    c.fillStyle = '#d8cbb3'; c.fillRect(rect.x, rect.y + rect.height / 2 - 2, rect.width, 4);
    c.fillStyle = '#b7791f'; c.fillRect(rect.x, rect.y + rect.height / 2 - 2, rect.width * fraction, 4);
    c.beginPath(); c.arc(rect.x + 7 + (rect.width - 14) * fraction, rect.y + rect.height / 2, 7, 0, Math.PI * 2); c.fill();
  }
  private roundRect(rect: Rect, values: number[]): void {
    const c = this.ctx, max = Math.min(rect.width, rect.height) / 2;
    const [a, b, d, e] = [values[0], values[1] ?? values[0], values[2] ?? values[0], values[3] ?? values[1] ?? values[0]].map((v) => Math.min(max, Math.max(0, v ?? 0)));
    const { x, y, width: w, height: h } = rect;
    c.beginPath(); c.moveTo(x + a, y); c.lineTo(x + w - b, y); c.quadraticCurveTo(x + w, y, x + w, y + b);
    c.lineTo(x + w, y + h - d); c.quadraticCurveTo(x + w, y + h, x + w - d, y + h);
    c.lineTo(x + e, y + h); c.quadraticCurveTo(x, y + h, x, y + h - e); c.lineTo(x, y + a); c.quadraticCurveTo(x, y, x + a, y); c.closePath();
  }
  hit(x: number, y: number): UiElement | null {
    return this.hits.slice().reverse().find((hit) => contains(hit.rect, x, y) && contains(hit.clip, x, y))?.node ?? null;
  }
  destroy(): void {
    this.document.layout = () => {};
    Yoga.Config.destroy(this.layoutConfig);
    this.images.clear(); this.pendingImages.clear(); this.measured.clear(); this.fragments.clear(); this.hits = [];
  }
}

function contains(rect: Rect, x: number, y: number): boolean { return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height; }
function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}
