/**
 * 小游戏宿主 API 的最小类型声明。
 * 抖音小游戏的全局对象是 tt，TapTap 小游戏、微信小游戏的接口形态基本一致（全局对象名不同）。
 * 这里只声明本项目用到的部分，接入时以各平台官方文档为准。
 */

export interface MiniCallbackOptions {
  success?: (res?: unknown) => void;
  fail?: (err?: unknown) => void;
  complete?: () => void;
}

export interface MiniInnerAudioContext {
  src: string;
  loop: boolean;
  volume: number;
  autoplay: boolean;
  readonly paused: boolean;
  play(): void;
  pause(): void;
  stop(): void;
  onEnded(callback: () => void): void;
  onError(callback: (err: unknown) => void): void;
  destroy(): void;
}

export interface MiniImage {
  src: string;
  width: number;
  height: number;
  onload: (() => void) | null;
  onerror: ((err: unknown) => void) | null;
}

export interface MiniRewardedCloseResult {
  /** 是否完整看完广告 */
  isEnded: boolean;
  /** 再得广告：一共看了几次 */
  count?: number;
}

export interface MiniRewardedVideoAd {
  show(): Promise<void>;
  load(): Promise<void>;
  onClose(callback: (res: MiniRewardedCloseResult | undefined) => void): void;
  offClose(callback: (res: MiniRewardedCloseResult | undefined) => void): void;
  onError(callback: (err: unknown) => void): void;
  offError(callback: (err: unknown) => void): void;
  destroy?(): void;
}

export interface MiniInterstitialAd {
  show(): Promise<void>;
  load(): Promise<void>;
  onClose(callback: () => void): void;
  onError(callback: (err: unknown) => void): void;
  destroy(): void;
}

export interface MiniStorageInfo {
  keys: string[];
}

export interface MiniPerformance {
  now(): number;
}

export interface MiniGameApi {
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: string): void;
  removeStorageSync(key: string): void;
  getStorageInfoSync(): MiniStorageInfo;
  createInnerAudioContext(): MiniInnerAudioContext;
  createImage(): MiniImage;
  vibrateShort(options?: MiniCallbackOptions): void;
  vibrateLong(options?: MiniCallbackOptions): void;
  createRewardedVideoAd(options: { adUnitId: string; multiton?: boolean }): MiniRewardedVideoAd;
  createInterstitialAd?(options: { adUnitId: string }): MiniInterstitialAd;
  getPerformance?(): MiniPerformance;
  onShow(callback: (res?: unknown) => void): void;
  onHide(callback: () => void): void;
}
