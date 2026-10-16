import type { AdBackend, RewardedResult } from '../Platform';

/**
 * 原生 App（WebView 壳）广告桥接接口。
 *
 * 适用场景：把 H5 打包成 Android APK 上架 TapTap，并在原生层接入穿山甲 / GroMore / TapADN 等广告 SDK。
 * 原生层需要向 WebView 注入名为 XFNativeAds 的对象（Android: addJavascriptInterface），并实现：
 *
 *   XFNativeAds.showRewarded(requestId: string, placement: string): void
 *   XFNativeAds.showInterstitial(requestId: string, placement: string): void
 *
 * 广告结束后，原生层在主线程执行 JS 回调：
 *
 *   window.__xfAdCallback(requestId, status)
 *     status = 'completed'  完整观看，可发奖励（激励视频以 SDK 的 onRewardVerify 为准）
 *            | 'skipped'    中途关闭
 *            | 'unavailable' 无填充 / 加载失败
 *            | 'shown'      插屏已展示
 *
 * 检测不到 XFNativeAds 时，WebPlatform 会退回测试广告。
 */
export interface NativeAdBridge {
  showRewarded(requestId: string, placement: string): void;
  showInterstitial(requestId: string, placement: string): void;
}

type NativeStatus = 'completed' | 'skipped' | 'unavailable' | 'shown';

interface BridgeWindow {
  XFNativeAds?: NativeAdBridge;
  __xfAdCallback?: (requestId: string, status: NativeStatus) => void;
}

/** 原生层超过这个时间没有回调，视为广告不可用，避免界面永远卡在“广告加载中” */
const TIMEOUT_MS = 90_000;

export function detectNativeBridge(): NativeAdBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as BridgeWindow).XFNativeAds;
  return bridge !== undefined && typeof bridge.showRewarded === 'function' ? bridge : null;
}

export class NativeBridgeAds implements AdBackend {
  private readonly waiting = new Map<string, (status: NativeStatus) => void>();
  private seq = 0;

  constructor(private readonly bridge: NativeAdBridge) {
    (window as unknown as BridgeWindow).__xfAdCallback = (requestId: string, status: NativeStatus) => {
      const resolve = this.waiting.get(requestId);
      if (resolve === undefined) return;
      this.waiting.delete(requestId);
      resolve(status);
    };
  }

  private request(kind: 'rewarded' | 'interstitial', placement: string): Promise<NativeStatus> {
    const requestId = `xf${Date.now().toString(36)}${(this.seq++).toString(36)}`;
    return new Promise<NativeStatus>((resolve) => {
      const timer = setTimeout(() => {
        if (this.waiting.delete(requestId)) resolve('unavailable');
      }, TIMEOUT_MS);
      this.waiting.set(requestId, (status) => { clearTimeout(timer); resolve(status); });
      try {
        if (kind === 'rewarded') this.bridge.showRewarded(requestId, placement);
        else this.bridge.showInterstitial(requestId, placement);
      } catch {
        clearTimeout(timer);
        this.waiting.delete(requestId);
        resolve('unavailable');
      }
    });
  }

  async showRewarded(placement: string): Promise<RewardedResult> {
    const status = await this.request('rewarded', placement);
    if (status === 'completed') return { status: 'completed', detail: 'native' };
    if (status === 'skipped') return { status: 'skipped', detail: 'native' };
    return { status: 'unavailable', detail: `native:${status}` };
  }

  async showInterstitial(placement: string): Promise<boolean> {
    return (await this.request('interstitial', placement)) === 'shown';
  }
}
