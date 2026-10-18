import type {
  AdBackend, AudioBackend, DrawableImage, ImageLoader, KeyValueStore, Platform, RewardedResult, SoundHandle
} from '../Platform';
import { NativeBridgeAds, detectNativeBridge } from './NativeBridgeAds';
import { UnavailableAds } from '../UnavailableAds';

declare const __PRODUCTION__: boolean;

interface OrientationBridge { setOrientation(value: string): void; }
interface OrientationWindow extends Window { XFNativeOrientation?: OrientationBridge; }
interface LockableOrientation extends ScreenOrientation { lock?: (value: string) => Promise<void>; }

/** 浏览器 localStorage。每次调用时才读取全局对象，便于测试注入内存实现。 */
class WebStorage implements KeyValueStore {
  probe(): boolean {
    try {
      localStorage.setItem('xiaofengdaye.probe', '1');
      localStorage.removeItem('xiaofengdaye.probe');
      return true;
    } catch {
      return false;
    }
  }
  get(key: string): string | null { return localStorage.getItem(key); }
  set(key: string, value: string): void { localStorage.setItem(key, value); }
  remove(key: string): void { localStorage.removeItem(key); }
  keys(): string[] {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null) out.push(key);
    }
    return out;
  }
}

class WebSound implements SoundHandle {
  private readonly el: HTMLAudioElement;
  private finished = false;

  constructor(path: string, loop: boolean) {
    this.el = new Audio(`./${path}`);
    this.el.loop = loop;
    this.el.preload = 'auto';
  }

  get volume(): number { return this.el.volume; }
  set volume(value: number) { this.el.volume = Math.max(0, Math.min(1, value)); }
  get paused(): boolean { return this.el.paused; }
  play(): Promise<void> { return this.el.play(); }
  pause(): void { this.el.pause(); }
  stop(): void { this.el.pause(); try { this.el.currentTime = 0; } catch { /* not seekable yet */ } }
  onFinish(callback: () => void): void {
    const once = (): void => {
      if (this.finished) return;
      this.finished = true;
      callback();
    };
    this.el.addEventListener('ended', once, { once: true });
    this.el.addEventListener('error', once, { once: true });
  }
  dispose(): void { this.el.pause(); this.el.removeAttribute('src'); this.el.load(); }
}

class WebAudio implements AudioBackend {
  create(path: string, loop: boolean): SoundHandle { return new WebSound(path, loop); }
}

class WebImages implements ImageLoader {
  constructor(private readonly base: string) {}
  async load(path: string): Promise<DrawableImage> {
    const response = await fetch(this.base + path);
    if (!response.ok) throw new Error(`${response.status} ${path}`);
    return createImageBitmap(await response.blob());
  }
}

/**
 * 广告占位：还没有接入任何广告 SDK 时使用。
 * 不展示任何东西，直接当作“已看完”返回，让奖励流程可以先跑通；接入真实 SDK 后由对应实现替换。
 */
export class PlaceholderAds implements AdBackend {
  showRewarded(placement: string): Promise<RewardedResult> {
    return Promise.resolve({ status: 'completed', detail: `placeholder:${placement}` });
  }
  showInterstitial(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/**
 * H5 测试广告。H5 版本身不接真实广告联盟，这里用一个可关闭的倒计时弹层模拟平台激励视频，
 * 用来验证奖励发放、次数上限和中途关闭等流程。
 * 只在网址带 ?ads=mock 时启用；?ads=none 模拟“暂无广告”；?adtime=2 把倒计时改成 2 秒。
 */
class WebMockAds implements AdBackend {
  private showing = false;

  private params(): URLSearchParams {
    try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); }
  }

  showRewarded(placement: string): Promise<RewardedResult> {
    const params = this.params();
    if (params.get('ads') === 'none') return Promise.resolve({ status: 'unavailable', detail: 'mock: ads=none' });
    if (this.showing || typeof document === 'undefined') return Promise.resolve({ status: 'unavailable', detail: 'busy' });
    const seconds = Math.max(1, Math.min(30, Number(params.get('adtime')) || 5));
    this.showing = true;
    return new Promise<RewardedResult>((resolve) => {
      const layer = document.createElement('div');
      layer.className = 'modal-layer mock-ad-layer';
      layer.innerHTML = `<section class="modal-card mock-ad-card" role="dialog" aria-label="测试广告">
        <p class="eyebrow">测试广告 · ${placement}</p>
        <h2>这里将播放平台激励视频</h2>
        <p class="muted">H5 测试版用倒计时代替真实广告。上架小游戏后会换成抖音 / TapTap 的激励视频。</p>
        <div class="mock-ad-bar"><i></i></div>
        <p class="mock-ad-count"></p>
        <div class="choice-row"><button type="button" class="btn ghost" data-mock="close">关闭（不领取奖励）</button></div>
      </section>`;
      document.body.appendChild(layer);
      const bar = layer.querySelector<HTMLElement>('.mock-ad-bar i');
      const count = layer.querySelector<HTMLElement>('.mock-ad-count');
      const closeButton = layer.querySelector<HTMLButtonElement>('[data-mock="close"]');
      const started = Date.now();
      let done = false;
      const finish = (status: RewardedResult['status']): void => {
        window.clearInterval(timer);
        layer.remove();
        this.showing = false;
        resolve({ status, detail: 'mock' });
      };
      const timer = window.setInterval(() => {
        const elapsed = (Date.now() - started) / 1000;
        const ratio = Math.min(1, elapsed / seconds);
        if (bar !== null) bar.style.width = `${Math.round(ratio * 100)}%`;
        if (!done && count !== null) count.textContent = `还剩 ${Math.max(0, Math.ceil(seconds - elapsed))} 秒`;
        if (!done && ratio >= 1) {
          done = true;
          if (count !== null) count.textContent = '观看完成';
          if (closeButton !== null) { closeButton.textContent = '领取奖励'; closeButton.className = 'btn primary'; }
        }
      }, 100);
      closeButton?.addEventListener('click', (event) => {
        event.stopPropagation();
        finish(done ? 'completed' : 'skipped');
      });
    });
  }

  showInterstitial(placement: string): Promise<boolean> {
    if (this.params().get('ads') === 'none' || this.showing || typeof document === 'undefined') return Promise.resolve(false);
    this.showing = true;
    return new Promise<boolean>((resolve) => {
      const layer = document.createElement('div');
      layer.className = 'modal-layer mock-ad-layer';
      layer.innerHTML = `<section class="modal-card mock-ad-card"><p class="eyebrow">测试插屏 · ${placement}</p><h2>这里将展示平台插屏广告</h2><div class="choice-row"><button type="button" class="btn primary" data-mock="close">关闭</button></div></section>`;
      document.body.appendChild(layer);
      layer.querySelector('[data-mock="close"]')?.addEventListener('click', (event) => {
        event.stopPropagation();
        layer.remove();
        this.showing = false;
        resolve(true);
      });
    });
  }
}

export class WebPlatform implements Platform {
  readonly name: string;
  readonly storage = new WebStorage();
  readonly audio = new WebAudio();
  readonly images: ImageLoader;
  readonly ads: AdBackend;

  /**
   * @param assetBase 美术资源根路径
   * @param ads 指定广告实现；不传时：检测到原生 App 注入的 XFNativeAds 就走原生 SDK，
   *            网址带 ?ads=mock / ?ads=none 时用测试广告，否则用占位广告（直接跳过并发奖）
   */
  constructor(assetBase = './', ads?: AdBackend) {
    this.name = typeof navigator !== 'undefined' && navigator.userAgent.includes('XiaofengdayeAndroid') ? 'android' : 'web';
    this.images = new WebImages(assetBase);
    const bridge = detectNativeBridge();
    let mode = '';
    try { mode = new URLSearchParams(location.search).get('ads') ?? ''; } catch { /* 非浏览器环境 */ }
    const production = typeof __PRODUCTION__ !== 'undefined' && __PRODUCTION__;
    this.ads = ads ?? (bridge !== null ? new NativeBridgeAds(bridge)
      : production ? new UnavailableAds()
      : (mode === 'mock' || mode === 'none' ? new WebMockAds() : new PlaceholderAds()));
  }

  /** 当前是否只是广告占位（界面据此提示“广告未接入，已直接发放”） */
  get adsArePlaceholder(): boolean { return this.ads instanceof PlaceholderAds; }

  vibrate(ms: number): void {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(ms);
  }

  async setOrientation(orientation: 'landscape' | 'portrait'): Promise<boolean> {
    const bridge = (window as OrientationWindow).XFNativeOrientation;
    if (bridge !== undefined) {
      bridge.setOrientation(orientation);
      return true;
    }
    const target = orientation === 'landscape' ? 'landscape-primary' : 'portrait-primary';
    const api = screen.orientation as LockableOrientation;
    if (typeof api?.lock !== 'function') return false;
    try { await api.lock(target); return true; } catch { return false; }
  }

  perfNow(): number { return performance.now(); }
  requestFrame(callback: (now: number) => void): number { return requestAnimationFrame(callback); }
  cancelFrame(handle: number): void { cancelAnimationFrame(handle); }

  onHide(callback: () => void): void {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') callback(); });
    window.addEventListener('pagehide', () => callback());
  }

  onShow(callback: () => void): void {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') callback(); });
    window.addEventListener('pageshow', () => { if (document.visibilityState !== 'hidden') callback(); });
  }
}
