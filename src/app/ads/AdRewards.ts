import { BigNum } from '../../common/BigNum';
import type { GameEngine } from '../../domain/GameEngine';
import type { OfflineReport, ThreatEvent } from '../../domain/State';
import { ALL_RES, Res, SeasonId, ThreatPhase, ThreatType } from '../../domain/Types';
import { AD_REWARDS } from './placements';

/**
 * 广告奖励的发放逻辑。只在广告“完整观看”后调用。
 * 资源一律走 EconomyService.add，因此仍受仓库容量与溢出缓冲规则约束，并写入资源流水（reason = ad_reward）。
 */
const REASON = 'ad_reward';

/** 离线收益再发一份；返回实际入库的数量（仓库满时进入溢出缓冲） */
export function grantOfflineDouble(engine: GameEngine, report: OfflineReport): Record<string, number> {
  const granted: Record<string, number> = {};
  ALL_RES.forEach((res: string) => {
    const gain = BigNum.parse(report.gains[res] ?? '0');
    if (gain.isNegative() || gain.isZero()) return;
    const extra = gain.mulN(AD_REWARDS.offlineMultiplier);
    granted[res] = engine.w.econ.add(res, extra, REASON, `offline:${report.settlementId}`).toNumber();
  });
  engine.saveRequested = true;
  return granted;
}

export function offlineHasGains(report: OfflineReport): boolean {
  return ALL_RES.some((res: string) => {
    const gain = BigNum.parse(report.gains[res] ?? '0');
    return !gain.isNegative() && gain.toNumber() >= 1;
  });
}

/** 邻巢援军：熊直接离开，不损失蜂蜜 */
export function grantBearAid(engine: GameEngine, eventId: string): boolean {
  const event = engine.run.threats.active.find((item: ThreatEvent) => item.eventId === eventId);
  if (event === undefined || event.settled || event.type !== ThreatType.Bear) return false;
  event.settled = true;
  event.phase = ThreatPhase.Expired;
  engine.w.msg('info', '邻巢援军赶来，熊被吓跑了，蜂蜜分毫未损。');
  engine.saveRequested = true;
  return true;
}

/** 紧急补给是否值得提供：入冬前后蜂蜜不够过冬，或已经在挨饿 */
export function winterSupplyWanted(engine: GameEngine): boolean {
  const season = engine.run.season;
  if (!season.formal || engine.run.colony.collapsed) return false;
  if (season.starving) return true;
  const coldSoon = [SeasonId.Autumn, SeasonId.WinterPrep, SeasonId.Winter].includes(season.season as SeasonId);
  return coldSoon && engine.w.econ.num(Res.Honey) < engine.season.winterNeed();
}

export function winterSupplyAmount(engine: GameEngine): number {
  const cap = engine.w.econ.capacity(Res.Honey).toNumber();
  return Math.max(AD_REWARDS.winterSupplyMinHoney, Math.round(cap * AD_REWARDS.winterSupplyRatio));
}

export function grantWinterSupply(engine: GameEngine): number {
  const amount = winterSupplyAmount(engine);
  const accepted = engine.w.econ.addN(Res.Honey, amount, REASON, 'winter_supply');
  engine.w.msg('info', `邻巢送来了 ${Math.round(amount)} 蜂蜜的紧急补给。`);
  engine.saveRequested = true;
  return accepted;
}

export function swarmBonusPoints(points: number): number {
  return Math.max(1, Math.ceil(points * AD_REWARDS.swarmBonusRatio));
}

export function grantSwarmBonus(engine: GameEngine, extra: number): void {
  const inheritance = engine.state.meta.inheritance;
  inheritance.available += extra;
  inheritance.totalPoints += extra;
  engine.w.msg('swarm', `分蜂加成：额外获得 ${extra} 传承点。`);
  engine.saveRequested = true;
}

/** 春季补给：度过冬天后的春季，每轮四季可领一次 */
export function springSupplyWanted(engine: GameEngine): boolean {
  const season = engine.run.season;
  if (!season.formal || season.season !== SeasonId.Spring || season.wintersSurvived <= 0) return false;
  return (engine.run.stats.springSupplyCycle ?? -1) !== season.cycleIndex;
}

export function springSupplyAmount(engine: GameEngine): number {
  const cap = engine.w.econ.capacity(Res.Honey).toNumber();
  return Math.max(AD_REWARDS.springSupplyMinHoney, Math.round(cap * AD_REWARDS.springSupplyRatio));
}

export function grantSpringSupply(engine: GameEngine): number {
  if (!springSupplyWanted(engine)) return 0;
  engine.run.stats.springSupplyCycle = engine.run.season.cycleIndex;
  const amount = springSupplyAmount(engine);
  const accepted = engine.w.econ.addN(Res.Honey, amount, REASON, 'spring_supply');
  engine.w.msg('info', `春暖花开，邻巢送来 ${Math.round(amount)} 蜂蜜帮你重整旗鼓。`);
  engine.saveRequested = true;
  return accepted;
}

/** 补齐差额：只差蜂蜜、且差得不多时返回差额（向上取整），否则 0 */
export function honeyTopUp(engine: GameEngine, costs: { res: string; amount: BigNum }[]): number {
  let honeyNeed = 0;
  for (const cost of costs) {
    const have = engine.w.econ.num(cost.res);
    const need = cost.amount.toNumber();
    if (cost.res === Res.Honey) honeyNeed = need;
    else if (have + 1e-9 < need) return 0;
  }
  if (engine.w.econ.capacity(Res.Honey).toNumber() < honeyNeed) return 0;
  const short = honeyNeed - engine.w.econ.num(Res.Honey);
  if (short <= 0 || short > honeyNeed * AD_REWARDS.topUpMaxRatio) return 0;
  return Math.ceil(short - 1e-9);
}

export function grantHoneyTopUp(engine: GameEngine, amount: number): number {
  const accepted = engine.w.econ.addN(Res.Honey, amount, REASON, 'honey_topup');
  engine.saveRequested = true;
  return accepted;
}
