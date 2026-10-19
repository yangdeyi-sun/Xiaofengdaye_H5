/**
 * 广告点位配置（游戏设计层，与具体平台无关）。
 * 每个点位在平台后台对应一个广告位 ID，见 src/platform/minigame/adUnits.ts。
 * 上线后按数据调整这里的次数和奖励倍率，不需要改业务代码。
 */
export interface AdPlacementDef {
  id: string;
  name: string;
  /** 每天最多观看次数（按观看完成的广告条数计） */
  dailyLimit: number;
  /** 两次观看之间的冷却（秒） */
  cooldownSec: number;
}

export const AdPlacement = {
  OfflineDouble: 'offline_double',
  FlowerBoost: 'flower_boost',
  BearAid: 'bear_aid',
  WinterSupply: 'winter_supply',
  ColonyRevive: 'colony_revive',
  SwarmBonus: 'swarm_bonus',
  SpringSupply: 'spring_supply',
  HoneyTopUp: 'honey_topup',
  SeasonEvent: 'season_event',
  LuckyHatch: 'lucky_hatch'
} as const;

export const AD_PLACEMENTS: AdPlacementDef[] = [
  { id: AdPlacement.OfflineDouble, name: '离线收益翻倍', dailyLimit: 4, cooldownSec: 0 },
  { id: AdPlacement.FlowerBoost, name: '花潮加速', dailyLimit: 8, cooldownSec: 0 },
  { id: AdPlacement.BearAid, name: '邻巢援军', dailyLimit: 3, cooldownSec: 0 },
  { id: AdPlacement.WinterSupply, name: '紧急补给', dailyLimit: 2, cooldownSec: 300 },
  { id: AdPlacement.ColonyRevive, name: '蜂群重振', dailyLimit: 1, cooldownSec: 0 },
  { id: AdPlacement.SwarmBonus, name: '分蜂加成', dailyLimit: 3, cooldownSec: 0 },
  { id: AdPlacement.SpringSupply, name: '春季补给', dailyLimit: 3, cooldownSec: 0 },
  { id: AdPlacement.HoneyTopUp, name: '补齐差额', dailyLimit: 6, cooldownSec: 60 },
  { id: AdPlacement.SeasonEvent, name: '季节事件两全', dailyLimit: 6, cooldownSec: 0 },
  { id: AdPlacement.LuckyHatch, name: '幸运孵化', dailyLimit: 3, cooldownSec: 0 }
];

/** 奖励数值 */
export const AD_REWARDS = {
  /** 离线收益额外再给一份（×2） */
  offlineMultiplier: 1,
  /** 花潮加速：看 1 个广告 2×，连看 2 个广告 4× */
  boostTiers: [
    { speed: 2, ads: 1 },
    { speed: 4, ads: 2 }
  ],
  boostMinutes: 10,
  /** 紧急补给：蜂蜜容量的比例，至少 minHoney */
  winterSupplyRatio: 0.3,
  winterSupplyMinHoney: 80,
  /** 分蜂加成：额外获得本次传承点的比例 */
  swarmBonusRatio: 0.5,
  /** 春季补给：熬过冬天后，每个春天可领一次，蜂蜜容量的比例，至少 springSupplyMinHoney */
  springSupplyRatio: 0.25,
  springSupplyMinHoney: 100,
  /** 补齐差额：只在只差蜂蜜、且差额不超过所需蜂蜜的这个比例时提供 */
  topUpMaxRatio: 0.4
};

/** 插屏广告节奏 */
export const INTERSTITIAL_RULES = {
  /** 首次游戏后多少分钟内不出插屏 */
  graceMinutes: 15,
  /** 两次插屏最短间隔（秒） */
  minIntervalSec: 180,
  /** 看完激励视频后多久内不出插屏（秒） */
  afterRewardedSec: 90,
  dailyLimit: 6
};
