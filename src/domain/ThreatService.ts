import { BigNum } from '../common/BigNum';
import { GuardPriority, Reason, Res, RewardDef, Role, ThreatDef, ThreatPhase, ThreatType } from './Types';
import { FlowerField, ThreatEvent } from './State';
import { CmdResult, ForageAlloc, World, softExponent } from './World';

const RES_NAME: Record<string, string> = { honey: '蜂蜜', wax: '蜂蜡', jelly: '蜂王浆', nectar: '花蜜' };

/** 敌害与防御（ECO-005~009，BEE-006） */
export class ThreatService {
  private w: World;
  private guardInjAcc: number = 0;
  guardsByArea: Record<string, number> = {};
  /** 全巢每秒蜂蜜产量估算（由 GameEngine 注入），用来让击退奖励随蜂巢成长 */
  honeyPerSec: () => number = () => 0;
  /** 亲手拍打的节流（不存档） */
  private lastSwatAt: Record<string, number> = {};
  private tutorialWasDone: boolean;

  constructor(w: World) {
    this.w = w;
    this.tutorialWasDone = w.s.meta.tutorialDone;
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
    th.nextSpawnAt = this.w.s.run.time + (this.w.s.meta.tutorialDone ? 90 : 120);
    th.nextBearAt = this.w.s.run.time + 1500;
  }

  private spawn(type: string, targetId: string, quiet: boolean = false): ThreatEvent {
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
    if (!quiet) this.w.msg('threat', isBear ? '警报：一头熊正在接近蜂巢！可以选择防守、交付蜂蜜或稍后处理。' : this.spawnText(type, targetId));
    if (type === ThreatType.Web) {
      const f = this.w.field(targetId);
      if (f !== null) {
        f.webbed = true;
      }
    }
    return ev;
  }

  /** 出现提示只说在哪里、怎么办；详细介绍由首次遇到时的图鉴弹窗负责，避免每次重复整段说明 */
  private spawnText(type: string, targetId: string): string {
    const f = this.w.field(targetId);
    const where = f === null ? '花田' : (f.home ? '蜂巢旁的花丛' : this.w.flower(f.flower).name);
    const tip = (this.w.s.run.threats.swats ?? 0) < 3;
    if (type === ThreatType.Wasp) return `胡蜂盯上了去${where}的航线${tip ? ' · 点胡蜂可以亲手驱赶' : ''}`;
    if (type === ThreatType.Web) return `${where}结了一张蜘蛛网${tip ? ' · 点蛛网可以亲手清理' : ''}`;
    if (type === ThreatType.Moth) return `蜡螟钻进了储蜜格${tip ? ' · 进蜂巢点它赶走' : ''}`;
    return `${this.def(type).name}出现了`;
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
    // 新手结束时切到正式节奏，不沿用新手阶段可能还剩十几分钟的低频计时器。
    // 只在“刚结束新手”那一刻收紧一次：旧实现每帧都把计时器压到 45 秒内，导致正式期实际约 50 秒一只敌害。
    if (this.w.s.meta.tutorialDone && !this.tutorialWasDone) {
      this.tutorialWasDone = true;
      if (th.nextSpawnAt > t + 150) th.nextSpawnAt = t + 90;
    }
    // 保卫战期间暂停普通敌害
    const raid = th.raid;
    if (raid !== undefined && (raid.phase === 'warn' || raid.phase === 'fight')) {
      if (th.nextSpawnAt < t + 60) th.nextSpawnAt = t + 60;
    }
    if (t >= th.nextSpawnAt) {
      const sd = this.w.seasonDef();
      const spring = this.w.cfg.seasons.find((season) => season.id === 'spring');
      const seasonThreat = sd.id === 'tutorial' ? (spring?.threatMul ?? 0.6) : sd.threatMul;
      const mul = Math.max(0.15, seasonThreat * this.w.region().threatMul);
      const cycle = Math.max(0, this.w.s.run.season.cycleIndex);
      // 2026-10-19：原先新手后约 50 秒一只、奖励固定，玩家反馈“太频繁、打了也没意思”。
      // 现在约 2~5 分钟一只（夏季最多、冬季很少），随轮回只缓慢加快；奖励按全巢产量折算。
      const baseGap = this.w.s.meta.tutorialDone ? Math.max(110, 200 / (1 + cycle * 0.1)) : 420;
      th.nextSpawnAt = t + Math.max(80, baseGap / mul) * this.w.rng.range(0.8, 1.2);
      const open = th.active.filter((e: ThreatEvent) => !e.settled && e.type !== ThreatType.Bear).length;
      // 默认一次只处理一个普通敌害；已有敌害时仅 10% 概率允许追加，最多两个。
      const canOverlap = open === 0 || (open < 2 && this.w.rng.chance(0.1));
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

  // ---------------- 蜂巢保卫战 ----------------
  /** 保卫战进行中（预警或交战） */
  raidActive(): boolean {
    const r = this.w.s.run.threats.raid;
    return r !== undefined && (r.phase === 'warn' || r.phase === 'fight');
  }

  /** 保卫战敌人：前两波普通胡蜂，第三波胡蜂王带一只护卫 */
  private spawnWave(wave: number): void {
    const run = this.w.s.run;
    const fields = run.map.fields.filter((f: FlowerField) => f.discovered)
      .sort((a: FlowerField, b: FlowerField) => this.beesAt(b.fieldId) - this.beesAt(a.fieldId) || a.dist - b.dist);
    if (fields.length === 0) return;
    const n = wave === 1 ? 2 : (wave === 2 ? 3 : 2);
    for (let i = 0; i < n; i++) {
      const f = fields[i % fields.length];
      const e = this.spawn(ThreatType.Wasp, f.fieldId, true);
      e.raid = true;
      e.endsAt = 0;
      if (wave === 3 && i === 0) {
        e.boss = true;
        e.hp *= 5;
        e.maxHp *= 5;
      }
    }
  }

  private beesAt(fieldId: string): number {
    const a = this.w.alloc.find((x: ForageAlloc) => x.fieldId === fieldId);
    return a === undefined ? 0 : a.bees;
  }

  private raidEnemies(): ThreatEvent[] {
    return this.w.s.run.threats.active.filter((e: ThreatEvent) => e.raid === true && !e.settled);
  }

  private raidTick(): void {
    const w = this.w;
    const run = w.s.run;
    const th = run.threats;
    const s = run.season;
    const t = run.time;
    const cur = th.raid;
    // 玩家离开（离线结算）时正在进行的保卫战：胡蜂窝撤走，不算输也不扣蜂蜜
    if (w.offline && cur !== undefined && (cur.phase === 'warn' || cur.phase === 'fight')) {
      this.raidEnemies().forEach((e: ThreatEvent) => { e.settled = true; e.phase = ThreatPhase.Expired; });
      cur.phase = 'skipped';
      w.msg('info', '你不在的时候，胡蜂窝撤走了；保卫战下个秋天再来');
      return;
    }
    if (!th.enabled || w.offline || !w.s.meta.tutorialDone) return;
    const r = th.raid;
    // 每个四季轮回（度过第一个冬天之后）的秋天一次
    if ((r === undefined || r.cycle !== s.cycleIndex) && s.formal && s.season === 'autumn' && s.cycleIndex >= 1 &&
      t - s.startedAt >= 20 && s.endsAt - t > 120 && w.interactive) {
      th.raid = { cycle: s.cycleIndex, phase: 'warn', wave: 0, startedAt: t, endsAt: t + 30, kills: 0, playerKills: 0 };
      w.msg('threat', '胡蜂窝来袭！30 秒后第一波到达 · 点胡蜂亲手迎战');
      return;
    }
    if (r === undefined) return;
    if (r.phase === 'warn' && t >= r.endsAt && w.interactive) {
      r.phase = 'fight';
      r.wave = 1;
      r.endsAt = t + 180;
      this.spawnWave(1);
      w.msg('info', '保卫战开始：第 1 波胡蜂来了！');
      return;
    }
    if (r.phase !== 'fight') return;
    const left = this.raidEnemies();
    if (left.length === 0) {
      if (r.wave < 3) {
        r.wave += 1;
        this.spawnWave(r.wave);
        w.msg('info', r.wave === 3 ? '胡蜂王亲自来了！把它打跑就赢了' : `第 ${r.wave} 波胡蜂来了！`);
      } else {
        this.raidWon(r.cycle);
      }
      return;
    }
    if (t >= r.endsAt) {
      left.forEach((e: ThreatEvent) => {
        e.settled = true;
        e.phase = ThreatPhase.Expired;
      });
      r.phase = 'lost';
      const loss = w.econ.amount(Res.Honey).mulN(0.05).toNumber();
      w.econ.drain(Res.Honey, loss, Reason.Threat, 'raid');
      w.msg('warn', `保卫战没能守住，胡蜂抢走了 ${Math.round(loss)} 蜂蜜。下个秋天再来！`);
    }
  }

  private raidWon(cycle: number): void {
    const w = this.w;
    const th = w.s.run.threats;
    const r = th.raid;
    if (r === undefined) return;
    r.phase = 'won';
    const jelly = 2 + Math.floor(cycle / 2);
    const honey = Math.round(Math.max(200, this.honeyPerSec() * 120));
    w.econ.add(Res.Jelly, BigNum.of(jelly), Reason.ThreatReward, 'raid');
    w.econ.addN(Res.Honey, honey, Reason.ThreatReward, 'raid');
    const meta = w.s.meta;
    meta.raidWins = (meta.raidWins ?? 0) + 1;
    w.s.run.stats.raidWins = (w.s.run.stats.raidWins ?? 0) + 1;
    let skin = '';
    if (meta.skins.indexOf('warbanner') < 0) {
      meta.skins.push('warbanner');
      skin = '，解锁蜂巢外观「战旗」';
    }
    w.gainXp(30);
    w.msg('milestone', `保卫战胜利！胡蜂窝被打跑了：+${jelly} 蜂王浆、+${honey} 蜂蜜${skin}`);
    w.emit('task', 0, 0, '保卫战胜利', 'any');
  }

  /** 界面：保卫战状态 */
  raidView(): { phase: string; wave: number; remaining: number; left: number; boss: boolean } | null {
    const r = this.w.s.run.threats.raid;
    if (r === undefined || (r.phase !== 'warn' && r.phase !== 'fight')) return null;
    const left = this.raidEnemies();
    return {
      phase: r.phase, wave: r.wave, remaining: Math.max(0, r.endsAt - this.w.s.run.time), left: left.length,
      boss: left.some((e: ThreatEvent) => e.boss === true)
    };
  }

  tick(dt: number): void {
    this.raidTick();
    this.spawnTick();
    this.allocateGuards();
    const t = this.w.s.run.time;
    if (this.w.role(Role.Guard) <= 0) {
      // 兼容旧存档中的无限期蛛网/蜡螟：尚无守卫时，敌害会在短暂干扰后自行离开。
      this.activeList().forEach((event: ThreatEvent) => {
        if (event.phase === ThreatPhase.Active && event.endsAt <= 0 && event.raid !== true) event.endsAt = t + 75;
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
  /** 击退奖励：蜂蜜按“约 N 秒全巢产量”折算，保证中后期也有分量；亲手击退再加 50% */
  rewardFor(type: string, byPlayer: boolean): RewardDef[] {
    const d = this.def(type);
    const cycle = Math.max(0, this.w.s.run.season.cycleIndex);
    const hps = Math.max(0, this.honeyPerSec());
    const secs: Record<string, number> = { wasp: 30, web: 25, moth: 20, bear: 90 };
    const k = byPlayer ? 1.5 : 1;
    const out: RewardDef[] = [];
    d.reward.forEach((r: RewardDef) => {
      let amt = r.amount;
      if (r.res === Res.Honey) {
        const base = type === ThreatType.Bear ? r.amount * (1 + cycle * 0.3) : r.amount * (1 + cycle * 0.25);
        amt = Math.max(base, hps * (secs[type] ?? 30));
      } else if (r.res === Res.Wax) {
        amt = r.amount * (1 + cycle * 0.5);
      } else if (type === ThreatType.Bear && r.res === Res.Jelly) {
        amt = r.amount;
      }
      out.push({ res: r.res, amount: Math.round(amt * (r.res === Res.Jelly ? 1 : k)) });
    });
    if (type === ThreatType.Moth && !out.some((r: RewardDef) => r.res === Res.Honey)) {
      out.push({ res: Res.Honey, amount: Math.round(Math.max(15 * (1 + cycle * 0.25), hps * secs.moth) * k) });
    }
    return out;
  }

  /** 玩家亲手拍打敌害：每次造成约 1/6 血量，补刀击退可多拿奖励 */
  swat(eventId: string): CmdResult {
    const e = this.w.s.run.threats.active.find((x: ThreatEvent) => x.eventId === eventId);
    if (e === undefined || e.settled || e.phase !== ThreatPhase.Active) {
      return CmdResult.fail('THREAT_NONE', '它已经离开了');
    }
    const t = this.w.s.run.time;
    const last = this.lastSwatAt[eventId];
    if (last !== undefined && t - last < 0.12) {
      return CmdResult.fail('THREAT_COOLDOWN', '');
    }
    this.lastSwatAt[eventId] = t;
    const isBear = e.type === ThreatType.Bear;
    const dmg = Math.max(1, e.maxHp * (isBear ? 0.05 : (e.boss === true ? 0.04 : 0.17)));
    e.hp -= dmg;
    const th = this.w.s.run.threats;
    th.swats = (th.swats ?? 0) + 1;
    if (e.hp <= 0) {
      const gain = this.settle(e, true, true);
      delete this.lastSwatAt[eventId];
      return CmdResult.ok(`亲手击退！${gain}`);
    }
    return CmdResult.ok(`-${Math.ceil(dmg)}`);
  }

  private settle(e: ThreatEvent, won: boolean, byPlayer: boolean = false): string {
    if (e.settled) {
      return '';
    }
    e.settled = true;
    const th = this.w.s.run.threats;
    if (th.nextSpawnAt < this.w.s.run.time + 40) th.nextSpawnAt = this.w.s.run.time + 40;
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
      this.w.dailyBump('threat', 1);
      const rewards = this.rewardFor(e.type, byPlayer);
      if (e.raid === true) {
        // 保卫战：小兵奖励减半（胜利另有大奖），胡蜂王三倍
        rewards.forEach((r: RewardDef) => { if (r.res === Res.Honey) r.amount = Math.round(r.amount * (e.boss === true ? 3 : 0.5)); });
        const raid = th.raid;
        if (raid !== undefined) {
          raid.kills += 1;
          if (byPlayer) raid.playerKills += 1;
        }
      }
      // 连胜：连续击退（中途没有敌害自己溜走）每满 5 次额外 1 蜂王浆
      th.streak = (th.streak ?? 0) + 1;
      const streakBonus = th.streak % 5 === 0;
      if (streakBonus) rewards.push({ res: Res.Jelly, amount: 1 });
      const parts: string[] = [];
      rewards.forEach((r: RewardDef) => {
        if (r.amount <= 0) return;
        this.w.econ.add(r.res, BigNum.of(r.amount), Reason.ThreatReward, e.eventId);
        parts.push(`+${r.amount >= 10000 ? `${(r.amount / 10000).toFixed(1)}万` : r.amount} ${RES_NAME[r.res] ?? ''}`);
      });
      if (e.type === ThreatType.Bear) {
        this.w.s.run.stats.bearsRepelled += 1;
      }
      if (!byPlayer) this.w.onBee('guardWin', 0, e.eventId);
      const gain = parts.join(' ');
      const name = e.boss === true ? '胡蜂王' : d.name;
      this.w.msg('victory', `${byPlayer ? '亲手' : '守卫蜂'}击退了${name}：${gain}`);
      // 亲手击退时奖励数字已经飘在敌害身上，这里只播胜利特效
      this.w.emit('victory', 0, 0, byPlayer ? `击退${name}` : `击退${name} ${gain}`, e.type === ThreatType.Moth ? 'hive' : 'field');
      if (streakBonus) this.w.msg('milestone', `连续击退 ${th.streak} 次！额外奖励 1 蜂王浆`);
      return gain;
    }
    if (e.type !== ThreatType.Bear && e.raid !== true) th.streak = 0;
    if (e.type === ThreatType.Bear) {
      // 熊造成阶段性损失，封顶 15% 蜂蜜，不摧毁蜂巢
      e.phase = ThreatPhase.Lost;
      const loss = this.w.econ.amount(Res.Honey).mulN(0.15);
      this.w.econ.drain(Res.Honey, loss.toNumber(), Reason.Threat, e.eventId);
      this.w.msg('warn', `熊抢走了一部分蜂蜜（${Math.round(loss.toNumber())}），蜂巢完好无损。`);
      return '';
    }
    e.phase = ThreatPhase.Expired;
    this.w.msg('info', `${d.name}离开了，连胜中断`);
    return '';
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
