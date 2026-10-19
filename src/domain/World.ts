import { BigNum } from '../common/BigNum';
import { Rng } from '../common/Rng';
import {
  Bld, BuildingDef, CostDef, EffectDef, FlowerDef, GameConfigDef, Reason, RegionDef, Res, ResearchDef, RoleDef,
  SeasonDef, SeasonId, StatDef, TalentDef, UpgradeTrackDef, KeyLevelDef, ALL_RES, ALL_ROLES
} from './Types';
import { FlowerField, GameMessage, GameState, HexCell, LarvaBatch, LedgerEntry } from './State';

/** 分段软上限：阈值前保持原曲线，阈值后以亚指数继续增长。 */
export function softExponent(value: number, threshold: number, power: number = 0.72): number {
  const n = Math.max(0, value);
  if (n <= threshold) {
    return n;
  }
  return threshold + Math.pow(n - threshold, power);
}

/** 一次消费/奖励的具体数额 */
export class CostAmount {
  res: string;
  amount: BigNum;

  constructor(res: string, amount: BigNum) {
    this.res = res;
    this.amount = amount;
  }
}

/** 命令结果：所有用例返回稳定错误码（需求书11.4） */
export class CmdResult {
  ok: boolean;
  code: string;
  message: string;

  constructor(ok: boolean, code: string, message: string) {
    this.ok = ok;
    this.code = code;
    this.message = message;
  }

  static ok(message: string): CmdResult {
    return new CmdResult(true, 'OK', message);
  }

  static fail(code: string, message: string): CmdResult {
    return new CmdResult(false, code, message);
  }
}

/** 渲染层一次性表现事件（Canvas 只读消费，不作为真实状态） */
export class FxEvent {
  kind: string;
  x: number;
  y: number;
  text: string;
  view: string;

  constructor(kind: string, x: number, y: number, text: string, view: string) {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.text = text;
    this.view = view;
  }
}

export class StatPart {
  layer: string;
  label: string;
  value: number;

  constructor(layer: string, label: string, value: number) {
    this.layer = layer;
    this.label = label;
    this.value = value;
  }
}

/** 统一属性聚合（需求书6.8）：基础 → 巢房 → 相邻 → 研究 → 传承 → 季节地图 → 事件 → 上下限 */
/** 吃到传承加成的产量属性 */
export const LEGACY_STATS = ['forager.carry', 'house.brewSpeed', 'house.waxRate'];
export const LEGACY_PER_POINT = 0.02;

export function legacyAura(points: number): number {
  return Math.max(0, points) * LEGACY_PER_POINT;
}

/** 日常行为折算王国经验（每次/每只） */
const XP_BY_KIND: Record<string, number> = { hatch: 2, upgrade: 3, build: 3, threat: 5, bloom: 4 };

export class AttributeService {
  private w: World;
  values: Record<string, number> = {};
  parts: Record<string, StatPart[]> = {};

  constructor(w: World) {
    this.w = w;
  }

  get(stat: string): number {
    const v = this.values[stat];
    return v === undefined ? 0 : v;
  }

  recompute(): void {
    const cfg = this.w.cfg;
    const run = this.w.s.run;
    const meta = this.w.s.meta;
    const researchMul = this.w.adj['evolution.center'] !== undefined ? this.w.adj['evolution.center'] : 1;
    cfg.stats.forEach((sd: StatDef) => {
      const parts: StatPart[] = [];
      let v = sd.base;
      parts.push(new StatPart('base', '基础值', sd.base));
      // 巢房等级
      cfg.tracks.forEach((t: UpgradeTrackDef) => {
        if (t.stat !== sd.id) {
          return;
        }
        const lv = run.upgrades[t.id] === undefined ? 0 : run.upgrades[t.id];
        if (lv <= 0) {
          return;
        }
        if (t.mode === 'pct') {
          const m = 1 + t.perLevel * lv;
          v = v * m;
          parts.push(new StatPart('building', `${t.name} Lv${lv}`, m));
        } else {
          v = v + t.perLevel * lv;
          parts.push(new StatPart('building+', `${t.name} Lv${lv}`, t.perLevel * lv));
        }
      });
      // 相邻布局
      const adj = this.w.adj[sd.id];
      if (adj !== undefined && adj !== 1) {
        v = v * adj;
        parts.push(new StatPart('adjacency', '相邻布局', adj));
      }
      // 当前种区研究
      let rPct = 0;
      let rAdd = 0;
      cfg.research.forEach((r: ResearchDef) => {
        const lv = run.research[r.id] === undefined ? 0 : run.research[r.id];
        if (lv <= 0) {
          return;
        }
        r.effects.forEach((e: EffectDef) => {
          if (e.stat !== sd.id) {
            return;
          }
          if (e.op === 'pct') {
            rPct += e.value * lv * researchMul;
          } else {
            rAdd += e.value * lv * researchMul;
          }
        });
      });
      if (rPct !== 0) {
        v = v * (1 + rPct);
        parts.push(new StatPart('research', '种区研究', 1 + rPct));
      }
      if (rAdd !== 0) {
        v = v + rAdd;
        parts.push(new StatPart('research+', '种区研究', rAdd));
      }
      // 蜂王传承
      if (this.w.inheritanceEnabled) {
        let tPct = 0;
        let tAdd = 0;
        cfg.talents.forEach((t: TalentDef) => {
          const lv = meta.inheritance.nodes[t.id] === undefined ? 0 : meta.inheritance.nodes[t.id];
          if (lv <= 0) {
            return;
          }
          t.effects.forEach((e: EffectDef) => {
            if (e.stat !== sd.id) {
              return;
            }
            if (e.op === 'pct') {
              tPct += e.value * lv;
            } else {
              tAdd += e.value * lv;
            }
          });
        });
        if (tPct !== 0) {
          v = v * (1 + tPct);
          parts.push(new StatPart('talent', '蜂王传承', 1 + tPct));
        }
        if (tAdd !== 0) {
          v = v + tAdd;
          parts.push(new StatPart('talent+', '蜂王传承', tAdd));
        }
        // 传承加成：每个累计传承点让全巢产量 +2%，让每一代新巢都明显比上一代起步更快
        const aura = legacyAura(meta.inheritance.totalPoints);
        if (aura > 0 && LEGACY_STATS.indexOf(sd.id) >= 0) {
          v = v * (1 + aura);
          parts.push(new StatPart('legacy', '传承加成', 1 + aura));
        }
      }
      // 明星蜂
      const star = this.w.starBonus(sd.id);
      if (star.pct !== 0) {
        v = v * (1 + star.pct);
        parts.push(new StatPart('star', '明星蜂', 1 + star.pct));
      }
      if (star.add !== 0) {
        v = v + star.add;
        parts.push(new StatPart('star+', '明星蜂', star.add));
      }
      // 季节与地图
      if (sd.id === 'forager.speed' || sd.id === 'scout.speed') {
        const region = this.w.region();
        const fly = region.flyMul * this.w.regionSeasonFly();
        if (fly !== 1) {
          v = v * fly;
          parts.push(new StatPart('season', `${region.name}气候`, fly));
        }
      }
      // 季节事件的限时效果
      const effects = run.season.effects;
      if (Array.isArray(effects)) {
        effects.forEach((fx) => {
          if (fx.stat !== sd.id || fx.until <= run.time) return;
          v = v * fx.mul;
          parts.push(new StatPart('event', fx.label, fx.mul));
        });
      }
      // 临时事件
      if (run.season.starving && (sd.id === 'forager.collect' || sd.id === 'house.brewSpeed')) {
        v = v * 0.5;
        parts.push(new StatPart('event', '储蜜不足', 0.5));
      }
      if (run.season.starving && !run.season.firstWinterProtected && run.season.starveSeconds >= 60 &&
        (sd.id === 'queen.layRate' || sd.id === 'nursery.hatchSpeed')) {
        v = v * 0.55;
        parts.push(new StatPart('event', '长期饥饿限制繁育', 0.55));
      }
      // 上下限
      const clamped = Math.min(sd.max, Math.max(sd.min, v));
      if (clamped !== v) {
        parts.push(new StatPart('clamp', '上下限', clamped));
      }
      this.values[sd.id] = clamped;
      this.parts[sd.id] = parts;
    });
  }
}

/** 资源经济（EconomyService）：唯一允许修改资源的入口，生成账本（需求书9.4） */
export class EconomyService {
  private w: World;
  private pending: Record<string, number> = {};
  private pendingRef: Record<string, string> = {};
  private flushTimer: number = 0;
  static readonly AGGREGATED: string[] = [Reason.Forage, Reason.Process, Reason.Wax, Reason.Manual, Reason.Winter,
    Reason.ScoutSample, Reason.Threat, Reason.Overflow];

  constructor(w: World) {
    this.w = w;
  }

  amount(res: string): BigNum {
    const v = this.w.s.run.res[res];
    return v === undefined ? BigNum.zero() : v;
  }

  num(res: string): number {
    return this.amount(res).toNumber();
  }

  capacity(res: string): BigNum {
    const e = this.w.cfg.economy;
    const storages = this.w.count(Bld.Storage);
    const capMul = this.w.attrs.get('storage.capacity') * this.w.storageAdjMul();
    let base = 0;
    if (res === Res.Honey) {
      base = e.capHoney + storages * e.storageHoney;
    } else if (res === Res.Nectar) {
      base = e.capNectar + storages * e.storageNectar;
    } else if (res === Res.Wax) {
      base = e.capWax + storages * e.storageWax;
    } else {
      base = e.capJelly + storages * 10;
    }
    let mul = capMul;
    if (this.w.mothActive) {
      mul = mul * 0.9;
    }
    return BigNum.of(base * mul);
  }

  bufferCap(res: string): BigNum {
    return this.capacity(res).mulN(this.w.cfg.economy.overflowRatio * this.w.attrs.get('storage.buffer'));
  }

  fillRatio(res: string): number {
    const cap = this.capacity(res);
    if (cap.isZero()) {
      return 0;
    }
    return Math.min(1, this.amount(res).div(cap).toNumber());
  }

  /** 增加资源；超过容量进入溢出缓冲（RES-007），缓冲满后才丢弃 */
  add(res: string, amount: BigNum, reason: string, ref: string): BigNum {
    if (amount.isZero() || amount.isNegative()) {
      return BigNum.zero();
    }
    const run = this.w.s.run;
    const before = this.amount(res);
    const cap = this.capacity(res);
    let accepted = amount.clone();
    if (before.add(amount).gt(cap)) {
      accepted = cap.sub(before).clamp0();
      const excess = amount.sub(accepted);
      const ob = run.overflow[res] === undefined ? BigNum.zero() : run.overflow[res];
      const room = this.bufferCap(res).sub(ob).clamp0();
      const toBuf = excess.min(room);
      run.overflow[res] = ob.add(toBuf);
    }
    run.res[res] = before.add(accepted);
    const prod = run.produced[res] === undefined ? BigNum.zero() : run.produced[res];
    run.produced[res] = prod.add(amount);
    this.record(res, before, run.res[res], accepted, reason, ref);
    return accepted;
  }

  addN(res: string, n: number, reason: string, ref: string): number {
    if (!(n > 0) || !Number.isFinite(n)) {
      return 0;
    }
    return this.add(res, BigNum.of(n), reason, ref).toNumber();
  }

  /** 内部消耗（加工、越冬），不足时只扣可用部分，返回实际扣除量，保证不为负 */
  drain(res: string, n: number, reason: string, ref: string): number {
    if (!(n > 0) || !Number.isFinite(n)) {
      return 0;
    }
    const before = this.amount(res);
    const take = Math.min(n, before.toNumber());
    if (take <= 0) {
      return 0;
    }
    const after = before.subN(take).clamp0();
    this.w.s.run.res[res] = after;
    this.record(res, before, after, BigNum.of(-take), reason, ref);
    return take;
  }

  costOf(defs: CostDef[], owned: number, mul: number, threshold: number = 12): CostAmount[] {
    const out: CostAmount[] = [];
    const n = softExponent(owned, threshold);
    defs.forEach((d: CostDef) => {
      const l = Math.log10(d.base) + n * Math.log10(d.growth) + Math.log10(Math.max(mul, 1e-9));
      out.push(new CostAmount(d.res, BigNum.fromLog10(l)));
    });
    return out;
  }

  canAfford(costs: CostAmount[]): boolean {
    for (let i = 0; i < costs.length; i++) {
      if (this.amount(costs[i].res).lt(costs[i].amount)) {
        return false;
      }
    }
    return true;
  }

  shortage(costs: CostAmount[]): CostAmount[] {
    const out: CostAmount[] = [];
    costs.forEach((c: CostAmount) => {
      const have = this.amount(c.res);
      if (have.lt(c.amount)) {
        out.push(new CostAmount(c.res, c.amount.sub(have)));
      }
    });
    return out;
  }

  /** 先校验再扣除（RES-004），全部成功或全部不扣 */
  spend(costs: CostAmount[], reason: string, ref: string): boolean {
    if (!this.canAfford(costs)) {
      return false;
    }
    costs.forEach((c: CostAmount) => {
      const before = this.amount(c.res);
      const after = before.sub(c.amount).clamp0();
      this.w.s.run.res[c.res] = after;
      this.record(c.res, before, after, c.amount.neg(), reason, ref);
    });
    return true;
  }

  refund(costs: CostAmount[], ratio: number, ref: string): void {
    costs.forEach((c: CostAmount) => {
      const before = this.amount(c.res);
      const amt = c.amount.mulN(ratio);
      const after = before.add(amt);
      this.w.s.run.res[c.res] = after;
      this.record(c.res, before, after, amt, Reason.HatchRefund, ref);
    });
  }

  /** 领取溢出缓冲（服务卡片/主界面的低频操作） */
  claimOverflow(): number {
    let moved = 0;
    ALL_RES.forEach((r: string) => {
      const ob = this.w.s.run.overflow[r];
      if (ob === undefined || ob.isZero()) {
        return;
      }
      const room = this.capacity(r).sub(this.amount(r)).clamp0();
      const take = ob.min(room);
      if (take.isZero()) {
        return;
      }
      const before = this.amount(r);
      this.w.s.run.res[r] = before.add(take);
      this.w.s.run.overflow[r] = ob.sub(take);
      this.record(r, before, this.w.s.run.res[r], take, Reason.Overflow, 'claim');
      moved += take.toNumber();
    });
    return moved;
  }

  decayOverflow(dt: number): void {
    const k = this.w.cfg.economy.overflowDecayPerMin / 60 * dt;
    ALL_RES.forEach((r: string) => {
      const ob = this.w.s.run.overflow[r];
      if (ob !== undefined && !ob.isZero()) {
        this.w.s.run.overflow[r] = ob.mulN(Math.max(0, 1 - k));
      }
    });
  }

  private record(res: string, before: BigNum, after: BigNum, delta: BigNum, reason: string, ref: string): void {
    if (EconomyService.AGGREGATED.indexOf(reason) >= 0) {
      const key = `${res}|${reason}`;
      const cur = this.pending[key] === undefined ? 0 : this.pending[key];
      this.pending[key] = cur + delta.toNumber();
      this.pendingRef[key] = ref;
      return;
    }
    this.pushLedger(res, before, after, delta, reason, ref);
  }

  private pushLedger(res: string, before: BigNum, after: BigNum, delta: BigNum, reason: string, ref: string): void {
    const s = this.w.s;
    const e: LedgerEntry = {
      ledgerId: s.nextLedgerId,
      res: res,
      before: before.serialize(),
      after: after.serialize(),
      delta: delta.serialize(),
      reason: reason,
      ref: ref,
      time: Math.round(s.run.time * 10) / 10
    };
    s.nextLedgerId += 1;
    s.ledger.push(e);
    if (s.ledger.length > 300) {
      s.ledger.splice(0, s.ledger.length - 300);
    }
  }

  /** 高频生产按 10 秒聚合成账本条目，避免账本爆炸 */
  tick(dt: number, force: boolean): void {
    this.flushTimer += dt;
    if (!force && this.flushTimer < 10) {
      return;
    }
    this.flushTimer = 0;
    Object.keys(this.pending).forEach((key: string) => {
      const v = this.pending[key];
      if (Math.abs(v) < 1e-9) {
        return;
      }
      const res = key.substring(0, key.indexOf('|'));
      const reason = key.substring(key.indexOf('|') + 1);
      const after = this.amount(res);
      this.pushLedger(res, after.subN(v), after, BigNum.of(v), reason, this.pendingRef[key]);
    });
    this.pending = {};
  }
}

/** 运行期派生数据：仅供渲染/界面读取，不写入存档 */
export class ForageAlloc {
  fieldId: string;
  bees: number;
  tripTime: number;
  rate: number;

  constructor(fieldId: string, bees: number, tripTime: number, rate: number) {
    this.fieldId = fieldId;
    this.bees = bees;
    this.tripTime = tripTime;
    this.rate = rate;
  }
}

export class Rates {
  nectarIn: number = 0;
  manualIn: number = 0;
  honeyIn: number = 0;
  nectarUse: number = 0;
  waxIn: number = 0;
  honeyUse: number = 0;
  upkeep: number = 0;
  jellyIn: number = 0;
}

/**
 * World：领域上下文。持有状态、配置、随机数、经济与属性服务，以及跨服务共享的派生数据。
 * 不依赖 ArkUI、Canvas、AGC（需求书9.2）。
 */
export class World {
  cfg: GameConfigDef;
  s: GameState;
  rng: Rng;
  attrs: AttributeService;
  econ: EconomyService;
  /** 离线聚合结算模式（SAVE-006）：不触发重大事件 */
  offline: boolean = false;
  /** 托管运转：同一张王国地图上、不在经营的蜂巢（不发每日进度、不发王国升级奖励、不弹提示） */
  background: boolean = false;
  /** 孵化完成的回调（蜜蜂名册登记新成员），由 GameEngine 注入 */
  onHatch: (role: string, count: number, star: boolean) => void = () => {};
  /** 具体某只蜜蜂的工作记录（侦察出航、发现花田、守卫击退），由 GameEngine 注入 */
  onBee: (kind: string, index: number, ref: string) => void = () => {};
  /** 敌害咬死蜜蜂：扣减工种并从名册移除，返回名字（由 GameEngine 注入 RosterService.kill） */
  onDeath: (role: string, n: number) => string[] = (role: string, n: number) => {
    const have = this.role(role);
    const k = Math.max(0, Math.min(have, Math.floor(n)));
    this.s.run.colony.roles[role] = have - k;
    this.s.run.colony.injured[role] = Math.min(this.injured(role), have - k);
    return [];
  };
  /** 孵化时判定是否额外诞生一只明星蜂，由 GameEngine 注入 */
  starRoll: () => boolean = () => false;
  /** 明星蜂加成，由 GameEngine 注入 */
  starBonus: (stat: string) => { pct: number; add: number } = () => ({ pct: 0, add: 0 });

  /** 请玩家给某个蜂群取名（新手交接时的第一个蜂巢、每次分蜂出来的新蜂巢） */
  requestName(id: string): void {
    const meta = this.s.meta;
    if (!Array.isArray(meta.namePending)) meta.namePending = [];
    if (meta.namePending.indexOf(id) < 0) meta.namePending.push(id);
  }

  /** 王国经验 */
  gainXp(n: number): void {
    if (n <= 0 || !Number.isFinite(n)) return;
    const k = this.s.meta.kingdom;
    if (k === undefined) return;
    k.xp += n;
  }

  /** 每日目标进度：各系统在事件发生时调用；同时折算王国经验 */
  dailyBump(kind: string, n: number): void {
    if (this.background) return;
    const xp = XP_BY_KIND[kind];
    if (xp !== undefined && n > 0) this.gainXp(xp * n);
    const d = this.s.meta.daily;
    if (d === undefined || n <= 0) return;
    d.tasks.forEach((t) => {
      if (t.kind === kind && !t.claimed) t.progress = Math.min(t.target, t.progress + n);
    });
  }

  /** 手动采集连击（不存档）：1.5 秒内连续采集累加 */
  comboCount: number = 0;
  comboAt: number = -10;
  /** 玩家在线可交互（ECO-007：熊等重大事件仅在线进入正式阶段） */
  interactive: boolean = true;
  inheritanceEnabled: boolean = true;
  adj: Record<string, number> = {};
  storageAdj: number = 1;
  mothActive: boolean = false;
  fieldEff: Record<string, number> = {};
  alloc: ForageAlloc[] = [];
  forageIdle: number = 0;
  rates: Rates = new Rates();
  fx: FxEvent[] = [];
  ruleFlags: Set<string> = new Set<string>();
  private regionCache: RegionDef | null = null;

  constructor(cfg: GameConfigDef, s: GameState) {
    this.cfg = cfg;
    this.s = s;
    this.rng = new Rng(s.run.rngState);
    this.attrs = new AttributeService(this);
    this.econ = new EconomyService(this);
  }

  region(): RegionDef {
    if (this.regionCache !== null && this.regionCache.id === this.s.run.regionId) {
      return this.regionCache;
    }
    let r = this.cfg.regions[0];
    this.cfg.regions.forEach((x: RegionDef) => {
      if (x.id === this.s.run.regionId) {
        r = x;
      }
    });
    this.regionCache = r;
    return r;
  }

  regionSeasonFly(): number {
    const v = this.region().flyBySeason[this.s.run.season.season];
    return v === undefined ? 1 : v;
  }

  seasonDef(): SeasonDef {
    const id = this.s.run.season.season;
    for (let i = 0; i < this.cfg.seasons.length; i++) {
      if (this.cfg.seasons[i].id === id) {
        return this.cfg.seasons[i];
      }
    }
    return this.cfg.seasons[0];
  }

  seasonDuration(id: string): number {
    const def = this.cfg.seasons.find((season: SeasonDef) => season.id === id) ?? this.cfg.seasons[0];
    const mul = this.region().seasonMul[id];
    return def.duration * (mul === undefined ? 1 : mul);
  }

  isWinter(): boolean {
    return this.s.run.season.season === SeasonId.Winter;
  }

  flower(id: string): FlowerDef {
    for (let i = 0; i < this.cfg.flowers.length; i++) {
      if (this.cfg.flowers[i].id === id) {
        return this.cfg.flowers[i];
      }
    }
    return this.cfg.flowers[0];
  }

  roleDef(id: string): RoleDef {
    for (let i = 0; i < this.cfg.roles.length; i++) {
      if (this.cfg.roles[i].id === id) {
        return this.cfg.roles[i];
      }
    }
    return this.cfg.roles[0];
  }

  bldDef(id: string): BuildingDef {
    for (let i = 0; i < this.cfg.buildings.length; i++) {
      if (this.cfg.buildings[i].id === id) {
        return this.cfg.buildings[i];
      }
    }
    return this.cfg.buildings[0];
  }

  track(id: string): UpgradeTrackDef | null {
    for (let i = 0; i < this.cfg.tracks.length; i++) {
      if (this.cfg.tracks[i].id === id) {
        return this.cfg.tracks[i];
      }
    }
    return null;
  }

  field(id: string): FlowerField | null {
    const fs = this.s.run.map.fields;
    for (let i = 0; i < fs.length; i++) {
      if (fs[i].fieldId === id) {
        return fs[i];
      }
    }
    return null;
  }

  count(bld: string): number {
    let n = 0;
    this.s.run.hive.cells.forEach((c: HexCell) => {
      if (c.unlocked && c.building === bld) {
        n++;
      }
    });
    return n;
  }

  role(id: string): number {
    const v = this.s.run.colony.roles[id];
    return v === undefined ? 0 : v;
  }

  injured(id: string): number {
    const v = this.s.run.colony.injured[id];
    return v === undefined ? 0 : v;
  }

  active(id: string): number {
    return Math.max(0, this.role(id) - this.injured(id));
  }

  adults(): number {
    let n = 0;
    ALL_ROLES.forEach((r: string) => {
      n += this.role(r);
    });
    return n;
  }

  inHatch(): number {
    let n = 0;
    this.s.run.colony.batches.forEach((b: LarvaBatch) => {
      n += b.count;
    });
    return n;
  }

  population(): number {
    return this.adults() + this.s.run.colony.larvae + this.inHatch();
  }

  popCap(): number {
    const e = this.cfg.economy;
    return Math.floor(this.attrs.get('queen.popCap') + this.count(Bld.Nursery) * e.popPerNursery +
      this.s.run.hive.ringLevel * e.popPerRing);
  }

  storageAdjMul(): number {
    return this.storageAdj;
  }

  taskDone(id: string): boolean {
    return this.s.run.tasksDone.indexOf(id) >= 0;
  }

  /** 功能解锁：本轮完成或历史已解锁（分蜂保留已解锁的基础功能） */
  unlocked(taskId: string): boolean {
    if (taskId.length === 0) {
      return true;
    }
    return this.taskDone(taskId) || this.s.meta.featureUnlocks.indexOf(taskId) >= 0;
  }

  hasFlag(flag: string): boolean {
    return this.ruleFlags.has(flag);
  }

  msg(kind: string, text: string, topic: string = ''): void {
    const s = this.s;
    const m: GameMessage = { id: s.nextMessageId, time: Math.round(s.run.time), kind: kind, text: text };
    if (topic.length > 0) m.topic = topic;
    s.messages.push(m);
    s.nextMessageId += 1;
    if (s.messages.length > 60) {
      s.messages.splice(0, s.messages.length - 60);
    }
  }

  emit(kind: string, x: number, y: number, text: string, view: string): void {
    if (this.offline) {
      return;
    }
    this.fx.push(new FxEvent(kind, x, y, text, view));
    if (this.fx.length > 80) {
      this.fx.splice(0, this.fx.length - 80);
    }
  }

  /** 关键等级规则节点与传承规则节点 */
  refreshFlags(): void {
    const flags: Set<string> = new Set<string>();
    const run = this.s.run;
    this.cfg.tracks.forEach((t: UpgradeTrackDef) => {
      const lv = run.upgrades[t.id] === undefined ? 0 : run.upgrades[t.id];
      t.keyLevels.forEach((k: KeyLevelDef) => {
        if (lv >= k.level) {
          flags.add(k.flag);
        }
      });
    });
    if (this.inheritanceEnabled) {
      this.cfg.talents.forEach((t: TalentDef) => {
        const lv = this.s.meta.inheritance.nodes[t.id];
        if (t.ruleFlag.length > 0 && lv !== undefined && lv > 0) {
          flags.add(t.ruleFlag);
        }
      });
    }
    this.ruleFlags = flags;
  }
}
