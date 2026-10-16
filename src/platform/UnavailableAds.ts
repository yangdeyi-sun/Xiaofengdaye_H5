import type { AdBackend, RewardedResult } from './Platform';

/** 未配置真实广告时不发放“观看完成”奖励。基础经营不依赖广告。 */
export class UnavailableAds implements AdBackend {
  showRewarded(): Promise<RewardedResult> { return Promise.resolve({ status: 'unavailable', detail: 'not_configured' }); }
  showInterstitial(): Promise<boolean> { return Promise.resolve(false); }
}
