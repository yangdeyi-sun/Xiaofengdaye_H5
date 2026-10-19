import type {
  AdBackend, AudioBackend, ClipboardBackend, CloudSaveBackend, DrawableImage, ImageLoader, KeyValueStore, Platform, TextInputBackend,
  RewardedResult, SoundHandle
} from '../Platform';
import type { AdUnitConfig } from './adUnits';
import type {
  MiniGameApi, MiniInnerAudioContext, MiniInterstitialAd, MiniRewardedCloseResult, MiniRewardedVideoAd
} from './MiniGameApi';

class MiniStorage implements KeyValueStore {
  constructor(private readonly api: MiniGameApi) {}
  probe(): boolean {
    try {
      this.api.setStorageSync('xiaofengdaye.probe', '1');
      this.api.removeStorageSync('xiaofengdaye.probe');
      return true;
    } catch {
      return false;
    }
  }
  get(key: string): string | null {
    const value = this.api.getStorageSync(key);
    // 小游戏读取不存在的键返回空字符串
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
  set(key: string, value: string): void { this.api.setStorageSync(key, value); }
  remove(key: string): void { this.api.removeStorageSync(key); }
  keys(): string[] {
    try { return this.api.getStorageInfoSync().keys.slice(); } catch { return []; }
  }
}

class MiniSound implements SoundHandle {
  private readonly ctx: MiniInnerAudioContext;
  private finished = false;
  private disposed = false;

  constructor(api: MiniGameApi, src: string, loop: boolean) {
    this.ctx = api.createInnerAudioContext();
    this.ctx.src = src;
    this.ctx.loop = loop;
    this.ctx.autoplay = false;
  }

  get volume(): number { return this.ctx.volume; }
  set volume(value: number) { if (!this.disposed) this.ctx.volume = Math.max(0, Math.min(1, value)); }
  get paused(): boolean { return this.disposed || this.ctx.paused; }
  play(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('disposed'));
    try { this.ctx.play(); return Promise.resolve(); } catch (error) { return Promise.reject(error); }
  }
  pause(): void { if (!this.disposed) this.ctx.pause(); }
  stop(): void { if (!this.disposed) this.ctx.stop(); }
  onFinish(callback: () => void): void {
    const once = (): void => {
      if (this.finished) return;
      this.finished = true;
      callback();
    };
    this.ctx.onEnded(once);
    this.ctx.onError(once);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try { this.ctx.stop(); this.ctx.destroy(); } catch { /* already released */ }
  }
}

class MiniAudio implements AudioBackend {
  constructor(private readonly api: MiniGameApi, private readonly base: string) {}
  create(path: string, loop: boolean): SoundHandle { return new MiniSound(this.api, this.base + path, loop); }
}

class MiniImages implements ImageLoader {
  constructor(private readonly api: MiniGameApi, private readonly base: string, private readonly extension = 'webp') {}
  load(path: string): Promise<DrawableImage> {
    return new Promise<DrawableImage>((resolve, reject) => {
      const image = this.api.createImage();
      image.onload = () => resolve(image as unknown as DrawableImage);
      image.onerror = (err) => reject(err instanceof Error ? err : new Error(`image ${path}`));
      image.src = this.base + path.replace(/\.(webp|svg)$/, `.${this.extension}`);
    });
  }
}

/**
 * 小游戏广告。按平台规范：
 * - 只在 onClose 回调中 isEnded === true 时发奖励；
 * - show() 失败先 load() 再试一次，仍失败视为“暂无广告”；
 * - 每个广告位只创建一次实例，回调统一分发，避免重复注册导致重复发奖。
 */
class MiniAds implements AdBackend {
  private readonly rewarded = new Map<string, MiniRewardedVideoAd>();
  private pending: ((result: RewardedResult) => void) | null = null;
  private interstitial: MiniInterstitialAd | null = null;

  constructor(private readonly api: MiniGameApi, private readonly units: AdUnitConfig) {}

  private unitFor(placement: string): string {
    const specific = this.units.rewarded[placement];
    return specific !== undefined && specific.length > 0 ? specific : this.units.rewardedDefault;
  }

  private instance(unitId: string): MiniRewardedVideoAd {
    const existing = this.rewarded.get(unitId);
    if (existing !== undefined) return existing;
    const ad = this.api.createRewardedVideoAd({ adUnitId: unitId });
    ad.onClose((res: MiniRewardedCloseResult | undefined) => {
      const ended = res?.isEnded === true;
      this.settle({ status: ended ? 'completed' : 'skipped', detail: `count=${res?.count ?? ''}` });
    });
    ad.onError((err: unknown) => {
      this.settle({ status: 'unavailable', detail: JSON.stringify(err) });
    });
    this.rewarded.set(unitId, ad);
    return ad;
  }

  private settle(result: RewardedResult): void {
    const resolve = this.pending;
    this.pending = null;
    resolve?.(result);
  }

  showRewarded(placement: string): Promise<RewardedResult> {
    const unitId = this.unitFor(placement);
    if (unitId.length === 0) return Promise.resolve({ status: 'unavailable', detail: `unconfigured:${placement}` });
    if (this.pending !== null) return Promise.resolve({ status: 'unavailable', detail: 'busy' });
    let ad: MiniRewardedVideoAd;
    try {
      ad = this.instance(unitId);
    } catch (error) {
      return Promise.resolve({ status: 'unavailable', detail: String(error) });
    }
    return new Promise<RewardedResult>((resolve) => {
      this.pending = resolve;
      ad.show()
        .catch(() => ad.load().then(() => ad.show()))
        .catch((err: unknown) => this.settle({ status: 'unavailable', detail: JSON.stringify(err) }));
    });
  }

  showInterstitial(_placement: string): Promise<boolean> {
    const create = this.api.createInterstitialAd;
    if (this.units.interstitial.length === 0 || create === undefined) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      try {
        if (this.interstitial === null) {
          this.interstitial = create.call(this.api, { adUnitId: this.units.interstitial });
        }
        const ad = this.interstitial;
        ad.load()
          .then(() => ad.show())
          .then(() => resolve(true))
          .catch(() => {
            // 抖音插屏实例出错后需要销毁重建
            try { ad.destroy(); } catch { /* ignore */ }
            this.interstitial = null;
            resolve(false);
          });
      } catch {
        resolve(false);
      }
    });
  }
}

export interface MiniGamePlatformOptions {
  /** 'douyin' | 'taptap' | 'wechat' */
  name: string;
  api: MiniGameApi;
  adUnits: AdUnitConfig;
  /** 资源根路径：留空表示包内资源；填 CDN 地址（以 / 结尾）则从远程加载 */
  assetBase?: string;
  imageExtension?: 'webp' | 'png';
  /** 可选云存档实现（抖音云 / 自建服务） */
  cloud?: CloudSaveBackend;
}

/** tt.setClipboardData / tt.getClipboardData；宿主不支持时返回失败，由界面改用存档码文本 */
class MiniClipboard implements ClipboardBackend {
  constructor(private readonly api: MiniGameApi) {}
  write(text: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (typeof this.api.setClipboardData !== 'function') { resolve(false); return; }
      try { this.api.setClipboardData({ data: text, success: () => resolve(true), fail: () => resolve(false) }); } catch { resolve(false); }
    });
  }
  read(): Promise<string | null> {
    return new Promise((resolve) => {
      if (typeof this.api.getClipboardData !== 'function') { resolve(null); return; }
      try {
        this.api.getClipboardData({
          success: (res?: unknown) => { const data = (res as { data?: unknown } | undefined)?.data; resolve(typeof data === 'string' ? data : null); },
          fail: () => resolve(null)
        });
      } catch { resolve(null); }
    });
  }
}

/** tt.showKeyboard：确认（onKeyboardConfirm）返回文字，收起键盘不确认（onKeyboardComplete 先到）视为取消 */
class MiniKeyboard implements TextInputBackend {
  constructor(private readonly api: MiniGameApi) {}

  prompt(initial: string, maxLength: number): Promise<string | null> {
    const api = this.api;
    return new Promise((resolve) => {
      if (typeof api.showKeyboard !== 'function' || typeof api.onKeyboardConfirm !== 'function') { resolve(null); return; }
      let done = false;
      const finish = (value: string | null): void => {
        if (done) return;
        done = true;
        try { api.offKeyboardConfirm?.(onConfirm); api.offKeyboardComplete?.(onComplete); } catch { /* ignore */ }
        try { api.hideKeyboard?.(); } catch { /* ignore */ }
        resolve(value);
      };
      const onConfirm = (res: { value: string }): void => finish(String(res?.value ?? ''));
      const onComplete = (res: { value: string }): void => finish(res === undefined ? null : String(res.value ?? ''));
      try {
        api.onKeyboardConfirm(onConfirm);
        api.onKeyboardComplete?.(onComplete);
        api.showKeyboard({ defaultValue: initial, maxLength, multiple: false, confirmHold: false, confirmType: 'done', fail: () => finish(null) });
      } catch { finish(null); }
    });
  }
}

export class MiniGamePlatform implements Platform {
  readonly name: string;
  readonly storage: KeyValueStore;
  readonly audio: AudioBackend;
  readonly images: ImageLoader;
  readonly ads: AdBackend;
  readonly clipboard: ClipboardBackend;
  readonly textInput: TextInputBackend;
  /** 云存档：接入抖音云或自建服务后在入口处传入；未传入时不显示云存档 */
  readonly cloud?: CloudSaveBackend;
  private readonly api: MiniGameApi;

  constructor(options: MiniGamePlatformOptions) {
    const base = options.assetBase ?? '';
    this.name = options.name;
    this.api = options.api;
    this.storage = new MiniStorage(options.api);
    this.audio = new MiniAudio(options.api, base);
    this.images = new MiniImages(options.api, base, options.imageExtension);
    this.ads = new MiniAds(options.api, options.adUnits);
    this.clipboard = new MiniClipboard(options.api);
    this.textInput = new MiniKeyboard(options.api);
    this.cloud = options.cloud;
  }

  vibrate(ms: number): void {
    try {
      if (ms >= 300) this.api.vibrateLong();
      else this.api.vibrateShort();
    } catch { /* 部分机型不支持振动 */ }
  }

  perfNow(): number {
    const perf = this.api.getPerformance?.();
    return perf !== undefined ? perf.now() : Date.now();
  }

  requestFrame(callback: (now: number) => void): number {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
    return setTimeout(() => callback(this.perfNow()), 16) as unknown as number;
  }

  cancelFrame(handle: number): void {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
    else clearTimeout(handle);
  }

  onHide(callback: () => void): void { this.api.onHide(callback); }
  onShow(callback: () => void): void { this.api.onShow(() => callback()); }
}
