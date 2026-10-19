import { Reason, Res, Role } from './Types';
import { DailyState, DailyTask } from './State';
import { CmdResult, World } from './World';

/**
 * 每日签到与每日目标。
 * 日期由平台层按玩家本地时间传入（YYYY-MM-DD），领域层只做纯计算；
 * 进度由各系统在事件发生时调用 World.dailyBump 累加，因此分蜂、换种区都不会丢失当天进度。
 */

export const DAILY_KINDS = ['collect', 'honey', 'hatch', 'upgrade', 'build', 'threat', 'bloom'] as const;

const KIND_TEXT: Record<string, string> = {
  collect: '手动采集花蜜 {n} 次',
  honey: '酿出 {n} 蜂蜜',
  hatch: '孵化出 {n} 只蜜蜂',
  upgrade: '完成 {n} 次升级或研究',
  build: '建造或扩建 {n} 次',
  threat: '击退 {n} 次敌害',
  bloom: '采到 {n} 朵蜜流花'
};

/** 签到 7 天一轮：第 7 天给蜂王浆，其余给蜂蜜（随天数递增） */
export const SIGN_JELLY_DAY = 7;
export const SIGN_JELLY = 3;
/** 3 个每日目标全部完成的额外奖励 */
export const DAILY_BONUS_JELLY = 2;

/** 仓库满时的说明：超出部分进入溢出缓冲，腾出空间后可在「资源」里领取 */
export function fullNote(got: number, amount: number): string {
  return got + 0.5 < amount ? '（仓库已满，多出的存入溢出缓冲）' : '';
}

export function emptyDaily(): DailyState {
  return { day: '', tasks: [], bonusClaimed: false, signedDay: '', streak: 0, counts: {} };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 'YYYY-MM-DD' 的前一天 */
export function previousDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (m === null) return '';
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 86400000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export class DailyService {
  private w: World;
  private honeyRate: () => number;

  constructor(w: World, honeyRate: () => number) {
    this.w = w;
    this.honeyRate = honeyRate;
  }

  get state(): DailyState {
    return this.w.s.meta.daily;
  }

  /** 约 2 分钟的蜂蜜产量，作为奖励与目标的基准（至少 60） */
  honeyUnit(): number {
    const rate = Math.max(0, this.honeyRate());
    return Math.max(60, Math.round(rate * 120 / 10) * 10);
  }

  /** 跨天时重新生成当天的 3 个目标；同一天重复调用不改变任何东西 */
  ensure(day: string): boolean {
    const d = this.state;
    if (day.length === 0 || d.day === day) return false;
    d.day = day;
    d.bonusClaimed = false;
    d.tasks = this.pickTasks(day);
    return true;
  }

  private eligible(kind: string): boolean {
    const w = this.w;
    if (kind === 'threat') return w.s.run.threats.enabled;
    if (kind === 'bloom') return w.s.meta.tutorialDone;
    if (kind === 'upgrade') return w.s.meta.tutorialDone;
    if (kind === 'hatch') return w.s.run.colony.eggsLaid > 0;
    return true;
  }

  private pickTasks(day: string): DailyTask[] {
    const pool = DAILY_KINDS.filter((k) => this.eligible(k));
    const seed = hash(`${this.w.s.meta.playerId}|${day}`);
    // 采集或酿蜜至少一条，保证新玩家也能完成
    const chosen: string[] = [seed % 2 === 0 ? 'collect' : 'honey'];
    const rest = pool.filter((k) => k !== chosen[0]);
    let s = seed;
    while (chosen.length < 3 && rest.length > 0) {
      s = Math.imul(s ^ (s >>> 15), 2246822519) >>> 0;
      chosen.push(rest.splice(s % rest.length, 1)[0]);
    }
    const unit = this.honeyUnit();
    return chosen.map((kind) => {
      let target = 1;
      if (kind === 'collect') target = 60;
      else if (kind === 'honey') target = Math.max(300, unit * 5);
      else if (kind === 'hatch') target = 3;
      else if (kind === 'upgrade') target = 2;
      else if (kind === 'bloom') target = 2;
      return { kind: kind, target: target, progress: 0, claimed: false, reward: unit };
    });
  }

  taskText(t: DailyTask): string {
    const n = t.kind === 'honey' ? Math.round(t.target) : t.target;
    return (KIND_TEXT[t.kind] ?? t.kind).replace('{n}', `${n}`);
  }

  canSign(): boolean {
    const d = this.state;
    return d.day.length > 0 && d.signedDay !== d.day;
  }

  /** 今天签到会是连续第几天（1~7） */
  nextStreak(): number {
    const d = this.state;
    if (d.signedDay === d.day) return d.streak;
    return d.signedDay === previousDay(d.day) ? (d.streak % SIGN_JELLY_DAY) + 1 : 1;
  }

  signReward(streak: number): { res: string; amount: number } {
    if (streak === SIGN_JELLY_DAY) return { res: Res.Jelly, amount: SIGN_JELLY };
    return { res: Res.Honey, amount: Math.round(this.honeyUnit() * (1 + 0.25 * (streak - 1)) / 10) * 10 };
  }

  sign(): CmdResult {
    const d = this.state;
    if (!this.canSign()) return CmdResult.fail('DAILY_SIGNED', '今天已经签到过了');
    const streak = this.nextStreak();
    const reward = this.signReward(streak);
    d.streak = streak;
    d.signedDay = d.day;
    const got = this.w.econ.addN(reward.res, reward.amount, Reason.Daily, `sign:${d.day}`);
    return CmdResult.ok(`签到第 ${streak} 天：获得 ${reward.amount} ${reward.res === Res.Jelly ? '蜂王浆' : '蜂蜜'}${fullNote(got, reward.amount)}`);
  }

  claim(index: number): CmdResult {
    const t = this.state.tasks[index];
    if (t === undefined) return CmdResult.fail('DAILY_TASK', '目标不存在');
    if (t.claimed) return CmdResult.fail('DAILY_CLAIMED', '已经领取过了');
    if (t.progress < t.target) return CmdResult.fail('DAILY_PROGRESS', '还没有完成');
    t.claimed = true;
    const got = this.w.econ.addN(Res.Honey, t.reward, Reason.Daily, `daily:${this.state.day}:${index}`);
    return CmdResult.ok(`每日目标完成：获得 ${Math.round(t.reward)} 蜂蜜${fullNote(got, t.reward)}`);
  }

  bonusReady(): boolean {
    const d = this.state;
    return !d.bonusClaimed && d.tasks.length > 0 && d.tasks.every((t) => t.claimed);
  }

  claimBonus(): CmdResult {
    if (!this.bonusReady()) return CmdResult.fail('DAILY_BONUS', '先完成并领取今天的 3 个目标');
    this.state.bonusClaimed = true;
    this.w.econ.addN(Res.Jelly, DAILY_BONUS_JELLY, Reason.Daily, `daily-bonus:${this.state.day}`);
    return CmdResult.ok(`今日目标全部完成：获得 ${DAILY_BONUS_JELLY} 蜂王浆`);
  }

  /** 可以领取的数量（签到 + 已完成未领取的目标 + 全勤奖励），用于角标 */
  claimable(): number {
    const d = this.state;
    return (this.canSign() ? 1 : 0) + d.tasks.filter((t) => !t.claimed && t.progress >= t.target).length +
      (this.bonusReady() ? 1 : 0);
  }
}
