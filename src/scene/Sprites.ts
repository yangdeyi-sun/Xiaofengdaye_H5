import { AnimDef, AtlasDef, buildArtManifest, FRAME } from './ArtManifest';

/**
 * 美术图集运行时（art_delivery_v1）：
 * - 图集与静态图按需异步解码（ArtSource 由平台层注入：HarmonyOS 用 ImageSource，网页预览用 createImageBitmap）；
 * - 未解码完成时返回 false，调用方退回 Art.ets 的程序化绘制，保证第一帧与无图环境也能运行；
 * - 裁切坐标按“位图实际宽度 / 图集像素宽度”换算，兼容 ArkUI 以 vp 报告位图尺寸的情况。
 */
export interface ArtSource {
  /** 返回已解码位图；尚未解码时发起加载并返回 null */
  image(path: string): ImageBitmap | null;
}

export class DrawOpts {
  flip: boolean = false;
  alpha: number = 1;
  /** 'center' 内容框中心对齐 (x,y)；'bottom' 内容框底边中点对齐 (x,y) */
  align: string = 'center';
  rotate: number = 0;
  /** true：size 表示整帧宽度（状态角标、天气等不以内容框定位的图集） */
  full: boolean = false;
}

const DEFAULT_OPTS: DrawOpts = new DrawOpts();
const FULL_BOX: number[] = [0, 0, 1, 1];

export class Sprites {
  static src: ArtSource | null = null;
  /**
   * HarmonyOS 部分真机能绘制整张 ImageBitmap，却会让带源裁切参数的 drawImage 静默输出透明像素。
   * 关闭后仅图集帧改走 Art.ets 程序化兼容绘制；地表、皮肤与提示整图仍正常使用。
   */
  static atlasCropEnabled: boolean = true;
  /** 省电模式：全部使用半尺寸图集 */
  static lowOnly: boolean = false;
  /** 紧凑画布（竖屏/高像素密度设备）：优先使用半尺寸图集，降低大纹理在变换画布中的兼容风险。 */
  static compactCanvas: boolean = false;
  /** 减少动态效果：动作停在固定帧 */
  static frozen: boolean = false;
  /** 0 尚未探测，1 位图绘制正常，-1 当前设备改用程序化兼容渲染。 */
  static bitmapState: number = 0;
  static atlases: Map<string, AtlasDef> = buildArtManifest();

  /**
   * 某些 HarmonyOS 设备的 drawImage 会静默成功但不输出像素。场景首帧用透明小区域做一次探测；
   * 若读不到任何非透明像素，后续 Sprite API 返回 false，让调用方走 Art.ets 程序化回退。
   */
  static probeCanvas(ctx: CanvasRenderingContext2D): void {
    if (!Sprites.atlasCropEnabled || Sprites.bitmapState !== 0 || Sprites.src === null) {
      return;
    }
    const o = new DrawOpts();
    o.align = 'bottom';
    ctx.clearRect(0, 0, 52, 52);
    // 使用与地图相同的非单位缩放；问题设备只在变换坐标系内静默丢失 drawImage。
    ctx.save();
    ctx.translate(26, 26);
    ctx.scale(1.4, 1.4);
    ctx.translate(-26, -26);
    const ready = Sprites.draw(ctx, 'atlas_skep', 'normal', 0, 26, 50, 44, o);
    ctx.restore();
    if (!ready) {
      ctx.clearRect(0, 0, 52, 52);
      return;
    }
    let visible = false;
    try {
      const data = ctx.getImageData(0, 0, 52, 52).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 8) {
          visible = true;
          break;
        }
      }
    } catch (e) {
      visible = false;
    }
    ctx.clearRect(0, 0, 52, 52);
    Sprites.bitmapState = visible ? 1 : -1;
  }

  static has(atlas: string, anim: string): boolean {
    const a = Sprites.atlases.get(atlas);
    return a !== undefined && a.anims.has(anim);
  }

  static anim(atlas: string, anim: string): AnimDef | null {
    const a = Sprites.atlases.get(atlas);
    if (a === undefined) {
      return null;
    }
    const d = a.anims.get(anim);
    return d === undefined ? null : d;
  }

  /** 动作时长（秒） */
  static duration(atlas: string, anim: string): number {
    const d = Sprites.anim(atlas, anim);
    if (d === null) {
      return 0.6;
    }
    return d.frames.length / 3 / Math.max(0.5, d.fps);
  }

  static frameIndex(d: AnimDef, t: number): number {
    const n = Math.floor(d.frames.length / 3);
    if (n <= 1) {
      return 0;
    }
    if (Sprites.frozen && d.loop) {
      return Math.min(3, n - 1);
    }
    const i = Math.floor(Math.max(0, t) * d.fps);
    return d.loop ? i % n : Math.min(n - 1, i);
  }

  static pagePath(a: AtlasDef, page: number, low: boolean): string {
    const suffix = a.pages > 1 ? `_${page}` : '';
    return `art/v1/${low ? 'low/' : ''}${a.name}${suffix}.webp`;
  }

  /** 预取一组图集（进入场景时调用，避免首次出现时的空白帧） */
  static warm(atlas: string): void {
    const src = Sprites.src;
    const a = Sprites.atlases.get(atlas);
    if (src === null || a === undefined) {
      return;
    }
    const low = Sprites.lowOnly || Sprites.compactCanvas || a.tier === 'low';
    for (let p = 0; p < a.pages; p++) {
      src.image(Sprites.pagePath(a, p, low));
    }
  }

  /**
   * 绘制图集一帧。size 为“内容框宽度”（世界/屏幕单位），内容框由生成器从首帧透明度测得。
   * 返回 false 表示位图尚未就绪，调用方应使用程序化回退。
   */
  static draw(ctx: CanvasRenderingContext2D, atlas: string, anim: string, t: number, x: number, y: number,
    size: number, opts: DrawOpts = DEFAULT_OPTS): boolean {
    if (!Sprites.atlasCropEnabled || Sprites.bitmapState < 0) {
      return false;
    }
    const src = Sprites.src;
    const a = Sprites.atlases.get(atlas);
    if (src === null || a === undefined) {
      return false;
    }
    const d = a.anims.get(anim);
    if (d === undefined) {
      return false;
    }
    const fi = Sprites.frameIndex(d, t) * 3;
    const page = d.frames[fi];
    const low = Sprites.lowOnly || Sprites.compactCanvas || a.tier === 'low';
    const bmp = src.image(Sprites.pagePath(a, page, low));
    if (bmp === null) {
      return false;
    }
    if (bmp.width <= 0 || bmp.height <= 0) {
      return false;
    }
    const pageW = page < a.pageW.length ? a.pageW[page] : bmp.width;
    const pxW = low ? pageW / 2 : pageW;
    const k = bmp.width / Math.max(1, pxW);
    const div = low ? 2 : 1;
    const fs = FRAME / div;
    const sx = d.frames[fi + 1] / div * k;
    const sy = d.frames[fi + 2] / div * k;
    const sw = fs * k;
    if (sw <= 0 || sx < 0 || sy < 0 || sx + sw > bmp.width + 1 || sy + sw > bmp.height + 1) {
      return false;
    }
    const box = opts.full ? FULL_BOX : a.box;
    const bw = Math.max(0.05, box[2] - box[0]);
    const dw = size / bw;
    // 内容框中心 / 底边在帧内的位置
    const cxN = (box[0] + box[2]) / 2;
    const cyN = opts.align === 'bottom' ? box[3] : (box[1] + box[3]) / 2;
    ctx.save();
    if (opts.alpha < 1) {
      ctx.globalAlpha = ctx.globalAlpha * Math.max(0, opts.alpha);
    }
    ctx.translate(x, y);
    if (opts.rotate !== 0) {
      ctx.rotate(opts.rotate);
    }
    if (opts.flip) {
      ctx.scale(-1, 1);
    }
    try {
      ctx.drawImage(bmp, sx, sy, sw, sw, -cxN * dw, -cyN * dw, dw, dw);
    } catch (e) {
      ctx.restore();
      Sprites.bitmapState = -1;
      return false;
    }
    ctx.restore();
    return true;
  }

  /** 静态图（地表、覆盖层、皮肤背景、反馈图标等） */
  static image(path: string): ImageBitmap | null {
    const src = Sprites.src;
    return src === null ? null : src.image(path);
  }

  /** 以世界坐标平铺一张无缝图（地表 / 四季覆盖 / 皮肤背景） */
  static tile(ctx: CanvasRenderingContext2D, path: string, x0: number, y0: number, x1: number, y1: number,
    tileSize: number, alpha: number): boolean {
    if (Sprites.bitmapState < 0) {
      return false;
    }
    const bmp = Sprites.image(path);
    if (bmp === null || bmp.width <= 0 || bmp.height <= 0) {
      return false;
    }
    const ix0 = Math.floor(x0 / tileSize);
    const iy0 = Math.floor(y0 / tileSize);
    const ix1 = Math.floor(x1 / tileSize);
    const iy1 = Math.floor(y1 / tileSize);
    if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) > 400) {
      return false;
    }
    ctx.save();
    if (alpha < 1) {
      ctx.globalAlpha = alpha;
    }
    // +0.5 重叠避免缩放时出现接缝
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        ctx.drawImage(bmp, ix * tileSize, iy * tileSize, tileSize + 0.5, tileSize + 0.5);
      }
    }
    ctx.restore();
    return true;
  }

  /** 绘制整张静态图，(x,y) 为中心 */
  static still(ctx: CanvasRenderingContext2D, path: string, x: number, y: number, w: number, h: number,
    alpha: number): boolean {
    if (Sprites.bitmapState < 0) {
      return false;
    }
    const bmp = Sprites.image(path);
    if (bmp === null || bmp.width <= 0 || bmp.height <= 0) {
      return false;
    }
    ctx.save();
    if (alpha < 1) {
      ctx.globalAlpha = ctx.globalAlpha * alpha;
    }
    ctx.drawImage(bmp, x - w / 2, y - h / 2, w, h);
    ctx.restore();
    return true;
  }

  /** 裁切静态图的一部分（u0,v0,u1,v1 为归一化坐标）绘制到目标矩形 */
  static crop(ctx: CanvasRenderingContext2D, path: string, u0: number, v0: number, u1: number, v1: number,
    dx: number, dy: number, dw: number, dh: number): boolean {
    if (Sprites.bitmapState < 0) {
      return false;
    }
    const bmp = Sprites.image(path);
    if (bmp === null || bmp.width <= 0 || bmp.height <= 0) {
      return false;
    }
    const W = bmp.width;
    const H = bmp.height;
    ctx.drawImage(bmp, u0 * W, v0 * H, (u1 - u0) * W, (v1 - v0) * H, dx, dy, dw, dh);
    return true;
  }
}

/** 种区 → 美术主题 */
export function regionTheme(regionId: string): string {
  if (regionId === 'rainy') {
    return 'wetland';
  }
  if (regionId === 'drought') {
    return 'dryland';
  }
  if (regionId === 'alpine' || regionId === 'rooftop') {
    return regionId;
  }
  return 'meadow';
}

/** 季节 → 四季覆盖层 */
export function seasonOverlay(season: string): string {
  if (season === 'summer') {
    return 'summer';
  }
  if (season === 'autumn' || season === 'winterPrep') {
    return 'autumn';
  }
  if (season === 'winter') {
    return 'winter';
  }
  return 'spring';
}

/** 建筑枚举 → 图集名（runtime_bindings.json） */
export function buildingAtlas(bld: string): string {
  if (bld === 'scoutRoom') {
    return 'atlas_buildings_scout';
  }
  if (bld === 'foragerRoom') {
    return 'atlas_buildings_forager';
  }
  if (bld === 'guardRoom') {
    return 'atlas_buildings_guard';
  }
  return `atlas_buildings_${bld}`;
}

/** 建筑枚举 → 皮肤图集中的帧名 */
export function buildingSkinFrame(bld: string): string {
  if (bld === 'scoutRoom') {
    return 'scout';
  }
  if (bld === 'foragerRoom') {
    return 'forager';
  }
  if (bld === 'guardRoom') {
    return 'guard';
  }
  return bld;
}
