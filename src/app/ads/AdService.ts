import type { AdBackend, KeyValueStore } from '../../platform/Platform';
import { AD_PLACEMENTS, AD_REWARDS, INTERSTITIAL_RULES } from './placements';
import type { AdPlacementDef } from './placements';

const RECORD_KEY = 'xiaofengdaye.h5.ads';

/** 广告观看记录。独立于游戏存档保存，不改动原版存档结构。 */
interface AdRecord {
  day: string;
  counts: Record<string, number>;
  lastAt: Record<string, number>;
  firstSeenAt: number;
  lastRewardedAt: number;
  lastInterstitialAt: number;
  interstitials: number;
  boostUntil: number;
  boostSpeed: number;
}

export interface AdCheck {
  ok: boolean;
  /** 不可观看时给玩家看的原因 */
  reason: string;
  remaining: number;
}

export interface WatchResult {
  /** 本次完整看完的广告条数 */
  completed: number;
  status: 'completed' | 'partial' | 'skipped' | 'unavailable' | 'blocked';
  message: string;
  /** 广告 SDK 尚未接入，本次是占位跳过 */
  placeholder: boolean;
}

/** 广告打点事件，接入平台数据分析时在 onEvent 里转发 */
export interface AdEvent {
  type: 'request' | 'complete' | 'skip' | 'unavailable' | 'interstitial';
  placement: string;
  detail: string;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function emptyRecord(): AdRecord {
  return {
    day: today(), counts: {}, lastAt: {}, firstSeenAt: Date.now(), lastRewardedAt: 0,
    lastInterstitialAt: 0, interstitials: 0, boostUntil: 0, boostSpeed: 1
  };
}

/**
 * 广告服务：所有广告点位都经过这里。
 * - 统一做每日次数、冷却、并发控制；
 * - 只有平台回报“完整观看”才计数和发奖；
 * - 底层广告 SDK 由平台层的 AdBackend 提供（抖音 tt / TapTap / 原生 APK 桥接 / H5 测试广告）。
 */
export class AdService {
  /** 广告开始 / 结束时回调，用于暂停游戏和声音 */
  onAdStart: () => void = () => {};
  onAdEnd: () => void = () => {};
  onEvent: (event: AdEvent) => void = () => {};
  private busyFlag = false;
  private record: AdRecord;

  constructor(private readonly backend: AdBackend, private readonly store: KeyValueStore) {
    this.record = this.load();
  }

  get busy(): boolean { return this.busyFlag; }

  private load(): AdRecord {
    try {
      const raw = this.store.get(RECORD_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as Partial<AdRecord>;
        const base = emptyRecord();
        return { ...base, ...parsed, counts: { ...(parsed.counts ?? {}) }, lastAt: { ...(parsed.lastAt ?? {}) } };
      }
    } catch { /* 记录损坏时重新开始计数 */ }
    return emptyRecord();
  }

  private persist(): void {
    try { this.store.set(RECORD_KEY, JSON.stringify(this.record)); } catch { /* best effort */ }
  }

  /** 跨天时重置每日计数 */
  private rollDay(): void {
    const day = today();
    if (this.record.day !== day) {
      this.record.day = day;
      this.record.counts = {};
      this.record.interstitials = 0;
      this.persist();
    }
  }

  def(id: string): AdPlacementDef {
    const found = AD_PLACEMENTS.find((item) => item.id === id);
    if (found === undefined) throw new Error(`未知广告点位 ${id}`);
    return found;
  }

  remaining(id: string): number {
    this.rollDay();
    return Math.max(0, this.def(id).dailyLimit - (this.record.counts[id] ?? 0));
  }

  check(id: string, need = 1): AdCheck {
    const remaining = this.remaining(id);
    if (this.busyFlag) return { ok: false, reason: '广告正在播放', remaining };
    if (remaining < need) return { ok: false, reason: '今天的次数已用完，明天再来', remaining };
    const cooldown = this.def(id).cooldownSec * 1000 - (Date.now() - (this.record.lastAt[id] ?? 0));
    if (cooldown > 0) return { ok: false, reason: `${Math.ceil(cooldown / 1000)} 秒后可再次领取`, remaining };
    return { ok: true, reason: '', remaining };
  }

  /**
   * 连续观看 count 条激励视频。每看完一条调用一次 onEach（可用于分段发奖）。
   * 中途关闭或无广告时停止，已看完的部分仍然有效。
   */
  async watch(id: string, count = 1, onEach?: (index: number) => void): Promise<WatchResult> {
    const gate = this.check(id, 1);
    if (!gate.ok) return { completed: 0, status: 'blocked', message: gate.reason, placeholder: false };
    const total = Math.max(1, Math.min(count, gate.remaining));
    this.busyFlag = true;
    this.onAdStart();
    let completed = 0;
    let status: WatchResult['status'] = 'completed';
    let placeholder = false;
    try {
      for (let i = 0; i < total; i++) {
        this.onEvent({ type: 'request', placement: id, detail: `${i + 1}/${total}` });
        const result = await this.backend.showRewarded(id);
        if (result.status === 'completed') {
          completed++;
          if (result.detail.startsWith('placeholder')) placeholder = true;
          this.record.counts[id] = (this.record.counts[id] ?? 0) + 1;
          this.record.lastAt[id] = Date.now();
          this.record.lastRewardedAt = Date.now();
          this.persist();
          this.onEvent({ type: 'complete', placement: id, detail: `${i + 1}/${total}` });
          onEach?.(i);
          continue;
        }
        this.onEvent({ type: result.status === 'skipped' ? 'skip' : 'unavailable', placement: id, detail: result.detail });
        status = result.status === 'skipped' ? 'skipped' : 'unavailable';
        break;
      }
    } finally {
      this.busyFlag = false;
      this.onAdEnd();
    }
    if (completed === total) return { completed, status: 'completed', message: '', placeholder };
    if (completed > 0) return { completed, status: 'partial', message: `已看完 ${completed}/${total} 个广告`, placeholder };
    return {
      completed, status, placeholder,
      message: status === 'unavailable' ? '暂时没有可播放的广告，请稍后再试' : '广告没有看完，未获得奖励'
    };
  }

  // ---------------- 花潮加速 ----------------

  boostSpeed(): number {
    return Date.now() < this.record.boostUntil ? this.record.boostSpeed : 1;
  }

  boostRemainingSec(): number {
    return Math.max(0, Math.ceil((this.record.boostUntil - Date.now()) / 1000));
  }

  /** 开启加速：已有更高倍率且未结束时保留更高倍率，并按新倍率重新计时 */
  applyBoost(speed: number): void {
    const now = Date.now();
    const keepHigher = now < this.record.boostUntil && this.record.boostSpeed > speed;
    this.record.boostSpeed = keepHigher ? this.record.boostSpeed : speed;
    this.record.boostUntil = now + AD_REWARDS.boostMinutes * 60_000;
    this.persist();
  }

  // ---------------- 插屏 ----------------

  /** 在自然断点调用（例如换季）；不满足节奏规则时直接跳过 */
  async maybeInterstitial(trigger: string): Promise<boolean> {
    this.rollDay();
    const now = Date.now();
    const rules = INTERSTITIAL_RULES;
    if (this.busyFlag) return false;
    if (now - this.record.firstSeenAt < rules.graceMinutes * 60_000) return false;
    if (now - this.record.lastInterstitialAt < rules.minIntervalSec * 1000) return false;
    if (now - this.record.lastRewardedAt < rules.afterRewardedSec * 1000) return false;
    if (this.record.interstitials >= rules.dailyLimit) return false;
    this.busyFlag = true;
    this.onAdStart();
    let shown = false;
    try {
      shown = await this.backend.showInterstitial(trigger);
    } finally {
      this.busyFlag = false;
      this.onAdEnd();
    }
    if (shown) {
      this.record.lastInterstitialAt = Date.now();
      this.record.interstitials++;
      this.persist();
      this.onEvent({ type: 'interstitial', placement: trigger, detail: '' });
    }
    return shown;
  }
}
