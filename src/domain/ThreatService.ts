import { BigNum } from '../common/BigNum';
import { GuardPriority, Reason, Res, RewardDef, Role, ThreatDef, ThreatPhase, ThreatType } from './Types';
import { FlowerField, ThreatEvent } from './State';
import { CmdResult, ForageAlloc, World, softExponent } from './World';

/** 敌害与防御（ECO-005~009，BEE-006） */
export class ThreatService {
  private w: World;
  private guardInjAcc: number = 0;
  guardsByArea: Record<string, number> = {};

  constructor(w: World) {
    this.w = w;
  }

  def(type: string): ThreatDef {
    for (let i = 0; i < this.w.cfg.threats.length; i++) {
      if (this.w.cfg.threats[i].id === type) {
        return this.w.cfg.threats[i];
      }
    }
    return this.w.cfg.threats[0];
  }

  activeList(): ThreatEvent[] {
    return this.w.s.run.threats.active.filter((t: ThreatEvent) =>
      t.phase === ThreatPhase.Active || t.phase === ThreatPhase.Warning || t.phase === ThreatPhase.Postponed);
  }

  enable(): void {
    const th = this.w.s.run.threats;
    if (th.enabled) {
      return;
    }
    th.enabled = true;
    th.nextSpawnAt = this.w.s.run.time + (this.w.s.meta.tutorialDone ? 45 : 120);
    th.nextBearAt = this.w.s.run.time + 1500;
  }

  private spawn(type: string, targetId: string): ThreatEvent {
    const th = this.w.s.run.threats;
    const d = this.def(type);
    const cycle = softExponent(this.w.s.run.season.cycleIndex, 6, 0.68);
    const hp = (d.hp + d.hpPerCycle * cycle) * (1 + this.w.region().difficulty * 0.15);
    const t = this.w.s.run.time;
    const isBear = type === ThreatType.Bear;
    const warn = isBear ? 60 * this.w.attrs.get('guard.warning') : 0;
    const fallbackLifetime = !isBear && d.lifetime <= 0 && this.w.role(Role.Guard) <= 0 ? 75 : 0;
    const ev: ThreatEvent = {
      eventId: `th${th.nextId}`, type: type, targetId: targetId, phase: isBear ? ThreatPhase.Warning : ThreatPhase.Active,
      hp: hp, maxHp: hp, startedAt: t,
      endsAt: isBear ? t + warn : (d.lifetime > 0 ? t + d.lifetime : (fallbackLifetime > 0 ? t + fallbackLifetime : 0)),
      postponed: 0, settled: false
    };
    th.nextId += 1;
    th.active.push(ev);
    const meta = this.w.s.meta;
    if (meta.codexThreats.indexOf(type) < 0) {
      meta.codexThreats.push(type);
    }
    this.w.msg('threat', isBear ? '警报：一头熊正在接近蜂巢！可以选择防守、交付蜂蜜或稍后处理。' : `${d.name}出现了：${d.desc}`);
    if (type === ThreatType.Web) {
      const f = this.w.field(targetId);
      if (f !== null) {
        f.webbed = true;
      }
    }
    return ev;
  }

  private pickType(): string {
    const current = this.w.s.run.season.season;
    const season = current === 'tutorial' ? 'spring' : current;
    const types = [ThreatType.Wasp, ThreatType.Web, ThreatType.Moth];
    let total = 0;
    const ws: number[] = [];
    types.forEach((t: string) => {
      let v = this.def(t).seasonWeight[season];
      v = v === undefined ? 0 : v;
      if (t === ThreatType.Moth && this.w.econ.num(Res.Wax) < 15) {
        v = 0;
      }
      if (this.w.s.run.threats.active.some((e: ThreatEvent) => e.type === t && !e.settled)) {
        v = v * 0.3;
      }
      ws.push(v);
      total += v;
    });
    if (total <= 0) {
      return '';
    }
    let r = this.w.rng.next() * total;
    for (let i = 0; i < types.length; i++) {
      r -= ws[i];
      if (r <= 0) {
        return types[i];
      }
    }
    return types[0];
  }

  private pickTarget(type: string): string {
    if (type === ThreatType.Moth || type === ThreatType.Bear) {
      return 'hive';
    }
    if (type === ThreatType.Wasp) {
      let best = '';
      let bees = 0;
      this.w.alloc.forEach((a: ForageAlloc) => {
        if (a.bees > bees) {
          bees = a.bees;
          best = a.fieldId;
        }
      });
      if (best.length > 0) return best;
      const fallback = this.w.s.run.map.fields.find((f: FlowerField) => f.discovered);
      return fallback === undefined ? '' : fallback.fieldId;
    }
    let known = this.w.s.run.map.fields.filter((f: FlowerField) => f.discovered && !f.webbed && !f.home);
    if (known.length === 0) known = this.w.s.run.map.fields.filter((f: FlowerField) => f.discovered && !f.webbed);
    if (known.length === 0) {
      return '';
    }
    return known[Math.floor(this.w.rng.next() * known.length)].fieldId;
  }

  private spawnTick(): void {
    const th = this.w.s.run.threats;
    const t = this.w.s.run.time;
    if (!th.enabled || this.w.offline) {
      return;
    }
    // 新手结束立即切到高频节奏，不沿用新手阶段可能还剩十几分钟的低频计时器。
    if (this.w.s.meta.tutorialDone && th.nextSpawnAt > t + 90) th.nextSpawnAt = t + 45;
    if (t >= th.nextSpawnAt) {
      const sd = this.w.seasonDef();
      const spring = this.w.cfg.seasons.find((season) => season.id === 'spring');
      const seasonThreat = sd.id === 'tutorial' ? (spring?.threatMul ?? 0.6) : sd.threatMul;
      const mul = Math.max(0.15, seasonThreat * this.w.region().threatMul);
      const cycle = Math.max(0, this.w.s.run.season.cycleIndex);
      const baseGap = this.w.s.meta.tutorialDone ? Math.max(30, 90 / (1 + cycle * 0.18)) : 420;
      th.nextSpawnAt = t + baseGap / mul * this.w.rng.range(0.75, 1.25);
      const open = th.active.filter((e: ThreatEvent) => !e.settled && e.type !== ThreatType.Bear).length;
      // 默认一次只处理一个普通敌害；已有敌害时仅 20% 概率允许追加，最多三个。
      const canOverlap = open === 0 || (open < 3 && this.w.rng.chance(0.2));
      const noviceRoll = this.w.s.meta.tutorialDone || this.w.rng.chance(0.45);
      if (canOverlap && noviceRoll) {
        const type = this.pickType();
        const target = type.length > 0 ? this.pickTarget(type) : '';
        if (type.length > 0 && target.length > 0) {
          this.spawn(type, target);
        }
      }
    }
    // 熊：低频、只在玩家在线时进入正式阶段（ECO-007）
    if (t >= th.nextBearAt && this.w.interactive) {
      th.nextBearAt = t + this.w.rng.range(1800, 2700);
      const bearOpen = th.active.some((e: ThreatEvent) => e.type === ThreatType.Bear && !e.settled);
      if (!bearOpen && this.w.s.meta.tutorialDone && this.w.role(Role.Guard) > 0 && this.w.adults() >= 30 && !this.w.isWinter()) {
        this.spawn(ThreatType.Bear, 'hive');
      }
    }
  }

  /** 守卫分配：按玩家优先级把守卫派往有威胁的区域 */
  private allocateGuards(): void {
    const guards = this.w.active(Role.Guard);
    const areas: string[] = [];
    this.activeList().forEach((e: ThreatEvent) => {
      if (e.phase !== ThreatPhase.Active) {
        return;
      }
      const a = this.def(e.type).area;
      if (areas.indexOf(a) < 0) {
        areas.push(a);
      }
    });
    const out: Record<string, number> = {};
    if (areas.length === 0 || guards <= 0) {
      this.guardsByArea = out;
      return;
    }
    const pr = this.w.s.run.colony.guardPriority;
    let wsum = 0;
    const ws: number[] = [];
    areas.forEach((a: string) => {
      const v = pr !== GuardPriority.Balanced && pr === a ? 3 : 1;
      ws.push(v);
      wsum += v;
    });
    areas.forEach((a: string, i: number) => {
      out[a] = guards * ws[i] / wsum;
    });
    this.guardsByArea = out;
  }

  tick(dt: number): void {
    this.spawnTick();
    this.allocateGuards();
    const t = this.w.s.run.time;
    if (this.w.role(Role.Guard) <= 0) {
      // 兼容旧存档中的无限期蛛网/蜡螟：尚无守卫时，敌害会在短暂干扰后自行离开。
      this.activeList().forEach((event: ThreatEvent) => {
        if (event.phase === ThreatPhase.Active && event.endsAt <= 0) event.endsAt = t + 75;
      });
    }
    const atk = this.w.attrs.get('guard.attack') * this.w.attrs.get('guard.range');
    const eff: Record<string, number> = {};
    let moth = false;
    const byArea: Record<string, number> = {};
    this.activeList().forEach((e: ThreatEvent) => {
      if (e.phase === ThreatPhase.Active) {
        const a = this.def(e.type).area;
        byArea[a] = (byArea[a] === undefined ? 0 : byArea[a]) + 1;
      }
    });
    this.w.s.run.threats.active.forEach((e: ThreatEvent) => {
      if (e.settled) {
        return;
      }
      const d = this.def(e.type);
      if (e.phase === ThreatPhase.Postponed) {
        if (t >= e.endsAt && this.w.interactive && !this.w.offline) {
          e.phase = ThreatPhase.Warning;
          e.endsAt = t + 30;
          this.w.msg('threat', '熊又回来了！');
        }
        return;
      }
      if (e.phase === ThreatPhase.Warning) {
        // 离线期间只预告，不进入正式阶段
        if (t >= e.endsAt && this.w.interactive && !this.w.offline) {
          e.phase = ThreatPhase.Active;
          e.endsAt = t + d.lifetime;
          this.w.msg('threat', '熊开始袭击蜂巢！守卫蜂正在集结。');
        }
        return;
      }
      // Active
      const area = d.area;
      const guards = this.guardsByArea[area] === undefined ? 0 : this.guardsByArea[area];
      const n = byArea[area] === undefined ? 1 : byArea[area];
      const dmg = guards / n * atk * dt;
      e.hp -= dmg;
      if (guards > 0 && e.type === ThreatType.Wasp && !this.w.offline) {
        this.guardInjAcc += guards / n * 0.002 * dt;
      }
      if (e.type === ThreatType.Wasp) {
        eff[e.targetId] = Math.min(eff[e.targetId] === undefined ? 1 : eff[e.targetId], 0.5);
      } else if (e.type === ThreatType.Web) {
        eff[e.targetId] = Math.min(eff[e.targetId] === undefined ? 1 : eff[e.targetId], 0.4);
      } else if (e.type === ThreatType.Moth) {
        moth = true;
        const wax = this.w.econ.num(Res.Wax);
        // 损失封顶：只蛀食超过 30 的部分
        if (wax > 30) {
          this.w.econ.drain(Res.Wax, Math.min(0.05 * dt, wax - 30), Reason.Threat, e.eventId);
        }
      }
      if (e.hp <= 0) {
        this.settle(e, true);
      } else if (e.endsAt > 0 && t >= e.endsAt) {
        this.settle(e, false);
      }
    });
    if (this.guardInjAcc >= 1) {
      const k = Math.floor(this.guardInjAcc);
      this.guardInjAcc -= k;
      const cap = Math.floor(this.w.role(Role.Guard) * this.w.cfg.economy.injuryCapRatio);
      this.w.s.run.colony.injured[Role.Guard] = Math.min(cap, this.w.injured(Role.Guard) + k);
    }
    this.w.fieldEff = eff;
    this.w.mothActive = moth;
    // 胡蜂袭击运输路线：采集蜂受伤（离线不发生）
    if (!this.w.offline) {
      this.activeList().forEach((e: ThreatEvent) => {
        if (e.type === ThreatType.Wasp && e.phase === ThreatPhase.Active && this.w.rng.chance(0.06 * dt)) {
          const a = this.w.alloc.find((x: ForageAlloc) => x.fieldId === e.targetId);
          if (a !== undefined && a.bees >= 1) {
            this.w.s.run.colony.injured[Role.Forager] = Math.min(
              Math.floor(this.w.role(Role.Forager) * this.w.cfg.economy.injuryCapRatio),
              this.w.injured(Role.Forager) + 1);
          }
        }
      });
    }
    // 清理已结算记录，保留最近 10 条
    const th = this.w.s.run.threats;
    if (th.active.length > 14) {
      th.active = th.active.filter((e: ThreatEvent) => !e.settled).concat(
        th.active.filter((e: ThreatEvent) => e.settled).slice(-10));
    }
  }

  /** 一次性结算（ECO-009：settled 标记防止重复结算） */
  private settle(e: ThreatEvent, won: boolean): void {
    if (e.settled) {
      return;
    }
    e.settled = true;
    const d = this.def(e.type);
    if (e.type === ThreatType.Web) {
      const f = this.w.field(e.targetId);
      if (f !== null) {
        f.webbed = false;
      }
    }
    if (won) {
      e.phase = ThreatPhase.Cleared;
      this.w.s.run.threats.cleared += 1;
      d.reward.forEach((r: RewardDef) => {
        const amt = e.type === ThreatType.Bear ? r.amount * (1 + this.w.s.run.season.cycleIndex * 0.3) : r.amount;
        this.w.econ.add(r.res, BigNum.of(amt), Reason.ThreatReward, e.eventId);
      });
      if (e.type === ThreatType.Bear) {
        this.w.s.run.stats.bearsRepelled += 1;
      }
      this.w.msg('victory', `守卫蜂击退了${d.name}！`);
      this.w.emit('victory', 0, 0, `击退${d.name}`, e.type === ThreatType.Moth || e.type === ThreatType.Bear ? 'hive' : 'field');
      return;
    }
    if (e.type === ThreatType.Bear) {
      // 熊造成阶段性损失，封顶 15% 蜂蜜，不摧毁蜂巢
      e.phase = ThreatPhase.Lost;
      const loss = this.w.econ.amount(Res.Honey).mulN(0.15);
      this.w.econ.drain(Res.Honey, loss.toNumber(), Reason.Threat, e.eventId);
      this.w.msg('warn', `熊抢走了一部分蜂蜜（${Math.round(loss.toNumber())}），蜂巢完好无损。`);
      return;
    }
    e.phase = ThreatPhase.Expired;
    this.w.msg('info', `${d.name}离开了`);
  }

  /** 熊事件玩家选择：防守 / 提前交付部分蜂蜜 / 稍后处理 */
  bearTribute(): number {
    const raw = this.w.econ.amount(Res.Honey).mulN(0.08).toNumber();
    const cap = 600 + softExponent(this.w.s.run.season.cycleIndex, 6, 0.68) * 100;
    return Math.min(raw, cap);
  }

  bearChoice(eventId: string, choice: string): CmdResult {
    const e = this.w.s.run.threats.active.find((x: ThreatEvent) => x.eventId === eventId);
    if (e === undefined || e.settled || e.type !== ThreatType.Bear) {
      return CmdResult.fail('THREAT_NONE', '事件已结束');
    }
    if (choice === 'tribute') {
      const pay = BigNum.of(this.bearTribute());
      this.w.econ.drain(Res.Honey, pay.toNumber(), Reason.Threat, e.eventId);
      e.settled = true;
      e.phase = ThreatPhase.Expired;
      this.w.msg('info', `交付了 ${Math.round(pay.toNumber())} 蜂蜜，熊心满意足地离开了`);
      return CmdResult.ok('熊离开了');
    }
    if (choice === 'later') {
      if (e.postponed >= 2) {
        return CmdResult.fail('THREAT_POSTPONE', '已经推迟过两次了');
      }
      e.postponed += 1;
      e.phase = ThreatPhase.Postponed;
      e.endsAt = this.w.s.run.time + 600;
      return CmdResult.ok('熊暂时离开，10 分钟后回来');
    }
    // defend：立即进入正式阶段
    if (e.phase !== ThreatPhase.Active) {
      e.phase = ThreatPhase.Active;
      e.endsAt = this.w.s.run.time + this.def(e.type).lifetime;
    }
    this.w.s.run.colony.guardPriority = GuardPriority.Gate;
    return CmdResult.ok('守卫蜂集结到巢门');
  }

  pendingBear(): ThreatEvent | null {
    const e = this.w.s.run.threats.active.find((x: ThreatEvent) => x.type === ThreatType.Bear && !x.settled);
    return e === undefined ? null : e;
  }
}
