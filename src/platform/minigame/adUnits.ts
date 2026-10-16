/**
 * 广告位 ID。在抖音开放平台「流量主 → 广告管理」/ TapTap 开发者后台创建广告位后，把 ID 填到这里。
 * 留空的广告位在小游戏里会表现为“暂无广告”，玩家不会受到惩罚。
 *
 * 一个激励视频广告位可以被多个游戏点位复用；按点位分开建广告位的好处是能在后台看到每个点位的收入。
 */
export interface AdUnitConfig {
  /** 激励视频：游戏内点位 id → 平台广告位 id */
  rewarded: Record<string, string>;
  /** 激励视频兜底广告位：点位没有单独配置时使用 */
  rewardedDefault: string;
  /** 插屏广告位 */
  interstitial: string;
}

export const DOUYIN_AD_UNITS: AdUnitConfig = {
  rewarded: {
    offline_double: '',
    flower_boost: '',
    bear_aid: '',
    winter_supply: '',
    colony_revive: '',
    swarm_bonus: ''
  },
  rewardedDefault: '',
  interstitial: ''
};

export const TAPTAP_AD_UNITS: AdUnitConfig = {
  rewarded: {},
  rewardedDefault: '',
  interstitial: ''
};
