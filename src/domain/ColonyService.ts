import { BigNum } from '../common/BigNum';
import { Bld, Reason, Res, Role, SeasonId, ALL_ROLES } from './Types';

/** 繁育计划解锁所需成年蜂数量（或度过第一个冬天） */
export const PLAN_UNLOCK_ADULTS = 20;
import { LarvaBatch } from './State';
import { CmdResult, CostAmount, World } from './World';

/** 蜂后、幼虫队列与工种（BEE-001/002/005/008，ECO-008） */
export class ColonyService {
  private w: World;
  private injuryAcc: Record<string, number> = {};

  constructor(w: World) {
    this.w = w;
  }

  emergency(): boolean {
    const line = this.w.cfg.economy.safetyLine * (this.w.hasFlag('emergencyBoost') ? 2 : 1);
    return this.w.unlocked('t_first_forager') && this.w.adults() < line;
  }

  eggCost(): CostAmount[] {
    const e = this.w.cfg.economy;
    const costs = this.w.econ.costOf([e.eggCost], this.w.s.run.colony.eggsLaid, 1, 40);
    // 新卵按整数蜂蜜收费，让每次增长在界面和实际扣费中一致可见。
    costs.forEach((cost) => {
      const amount = cost.amount.toNumber();
      if (Number.isFinite(amount)) cost.amount = BigNum.of(Math.ceil(amount - 1e-9));
    });
    return costs;
  }

  roleCost(role: string): CostAmount[] {
    const def = this.w.roleDef(role);
    let queued = 0;
    this.w.s.run.colony.batches.forEach((b: LarvaBatch) => {
      if (b.targetRole === role) {
        queued += b.count;
      }
    });
    return this.w.econ.costOf(def.costs, this.w.role(role) + queued, this.w.attrs.get('nursery.costMul'), 20);
  }

  queenCost(): CostAmount[] {
    const sc = this.w.cfg.swarm;
    return [
      new CostAmount(Res.Honey, BigNum.of(sc.queenHoney)),
      new CostAmount(Res.Wax, BigNum.of(sc.queenWax)),
      new CostAmount(Res.Jelly, BigNum.of(sc.queenJelly))
    ];
  }

  /** 新蜂后培育成功率：基础 25%，每连续失败一次 +15%，连败 3 次后第 4 次必成 */
  queenChance(): number {
    const fails = Math.max(0, Math.floor(this.w.s.run.colony.queenFails ?? 0));
    if (fails >= 3) return 1;
    return Math.min(1, this.w.cfg.swarm.queenSuccessChance + 0.15 * fails);
  }

  /** 分蜂蜂后培育：失败返还一半资源，并提高下一次的成功率（保底）。 */
  differentiateQueen(): CmdResult {
    const colony = this.w.s.run.colony;
    if (colony.youngQueens > 0) return CmdResult.fail('QUEEN_READY', '新蜂后已经准备好，可以发起分蜂');
    const costs = this.queenCost();
    if (!this.w.econ.canAfford(costs)) {
      return CmdResult.fail('ECON_SHORT', `培育新蜂后需要${this.w.cfg.swarm.queenHoney}蜂蜜、${this.w.cfg.swarm.queenWax}蜂蜡和${this.w.cfg.swarm.queenJelly}蜂王浆`);
    }
    if (!this.w.econ.spend(costs, Reason.Hatch, 'young-queen')) {
      return CmdResult.fail('ECON_SHORT', '培育新蜂后的资源不足');
    }
    colony.queenAttempts += 1;
    const chance = this.queenChance();
    if (chance < 1 && !this.w.rng.chance(chance)) {
      colony.queenFails = (colony.queenFails ?? 0) + 1;
      this.w.econ.refund(costs, 0.5, 'young-queen-refund');
      const next = Math.round(this.queenChance() * 100);
      this.w.msg('warn', `这次蜂后没能分化成功，返还了一半育王资源。下次成功率 ${next}%${next >= 100 ? '（必定成功）' : ''}。`);
      return CmdResult.fail('QUEEN_FAILED', `没有成功，已返还一半资源 · 下次成功率 ${next}%`);
    }
    colony.queenFails = 0;
    colony.youngQueens += 1;
    this.w.msg('milestone', '新蜂后分化成功！她已经可以带领一半蜂群和资源建立新巢。');
    this.w.emit('milestone', 0, 0, '新蜂后诞生', 'hive');
    return CmdResult.ok('新蜂后分化成功');
  }

  roleAvailable(role: string): boolean {
    return this.w.count(this.w.roleDef(role).building) > 0;
  }

  hatchSlots(): number {
    const e = this.w.cfg.economy;
    return Math.floor(e.queenSlots + this.w.count(Bld.Nursery) * this.w.attrs.get('nursery.slots'));
  }

  hatchTime(role: string): number {
    return this.w.roleDef(role).hatchTime / this.w.attrs.get('nursery.hatchSpeed');
  }

  layInterval(): number {
    const e = this.w.cfg.economy;
    let rate = this.w.attrs.get('queen.layRate') * this.w.seasonDef().layMul;
    if (this.emergency()) {
      rate = rate * (this.w.hasFlag('emergencyBoost') ? 6 : 3);
    }
    return e.layInterval / Math.max(0.05, rate);
  }

  canLay(): CmdResult {
    const c = this.w.s.run.colony;
    if (c.layCooldown > 0) {
      return CmdResult.fail('COLONY_COOLDOWN', `蜂后休息中（${Math.ceil(c.layCooldown)}秒）`);
    }
    if (this.w.population() >= this.w.popCap()) {
      return CmdResult.fail('COLONY_CAP', '蜂群已达人口上限，扩建或升级蜂后室');
    }
    if (!this.w.econ.canAfford(this.eggCost())) {
      return CmdResult.fail('ECON_SHORT', '蜂蜜不足');
    }
    return CmdResult.ok('');
  }

  /** 手动产卵：先校验再扣除 */
  lay(): CmdResult {
    const r = this.canLay();
    if (!r.ok) {
      return r;
    }
    return this.doLay(false);
  }

  private doLay(auto: boolean): CmdResult {
    const c = this.w.s.run.colony;
    if (!this.w.econ.spend(this.eggCost(), Reason.Egg, auto ? 'auto' : 'manual')) {
      return CmdResult.fail('ECON_SHORT', '蜂蜜不足');
    }
    let n = this.w.hasFlag('queen_double') ? 2 : 1;
    n = Math.min(n, Math.max(1, this.w.popCap() - this.w.population()));
    c.larvae += n;
    c.eggsLaid += n;
    c.layCooldown = this.layInterval();
    if (auto) {
      this.w.s.run.stats.autoLays += 1;
    }
    if (this.w.s.run.stats.firstEggAt < 0) {
      this.w.s.run.stats.firstEggAt = this.w.s.run.time;
    }
    this.w.emit('egg', 0, 0, n > 1 ? `+${n} 幼虫` : '+1 幼虫', 'hive');
    return CmdResult.ok('蜂后产下了幼虫');
  }

  /** 幼虫分化入队（BEE-002）：入队时扣费，取消未开始的批次全额返还 */
  differentiate(role: string, count: number): CmdResult {
    const c = this.w.s.run.colony;
    if (ALL_ROLES.indexOf(role) < 0) {
      return CmdResult.fail('COLONY_ROLE', '未知工种');
    }
    if (!this.roleAvailable(role)) {
      return CmdResult.fail('HIVE_LOCKED', `需要先建造${this.w.bldDef(this.w.roleDef(role).building).name}`);
    }
    let done = 0;
    for (let i = 0; i < count; i++) {
      if (c.larvae <= 0) {
        break;
      }
      const cost = this.roleCost(role);
      if (!this.w.econ.spend(cost, Reason.Hatch, role)) {
        break;
      }
      const b: LarvaBatch = {
        batchId: c.nextBatchId, targetRole: role, count: 1, startAt: -1, finishAt: -1,
        paid: this.serializeCost(cost), started: false
      };
      c.nextBatchId += 1;
      c.batches.push(b);
      c.larvae -= 1;
      done++;
    }
    if (done === 0) {
      return CmdResult.fail(c.larvae <= 0 ? 'COLONY_NO_LARVA' : 'ECON_SHORT', c.larvae <= 0 ? '没有可分化的幼虫' : '蜂蜜不足');
    }
    this.startBatches();
    return CmdResult.ok(`${done} 只幼虫开始分化为${this.w.roleDef(role).name}`);
  }

  cancel(batchId: number): CmdResult {
    const c = this.w.s.run.colony;
    const idx = c.batches.findIndex((b: LarvaBatch) => b.batchId === batchId);
    if (idx < 0) {
      return CmdResult.fail('COLONY_BATCH', '批次不存在或已完成');
    }
    const b = c.batches[idx];
    c.batches.splice(idx, 1);
    const ratio = b.started ? 0.5 : 1;
    this.w.econ.refund(this.parseCost(b.paid), ratio, `cancel#${b.batchId}`);
    c.larvae += b.count;
    this.startBatches();
    return CmdResult.ok(b.started ? '已取消，返还一半蜂蜜' : '已取消，全额返还');
  }

  private serializeCost(cost: CostAmount[]): string {
    return cost.map((x: CostAmount) => `${x.res}:${x.amount.serialize()}`).join(';');
  }

  private parseCost(s: string): CostAmount[] {
    const out: CostAmount[] = [];
    if (s.length === 0) {
      return out;
    }
    s.split(';').forEach((p: string) => {
      const i = p.indexOf(':');
      if (i > 0) {
        out.push(new CostAmount(p.substring(0, i), BigNum.parse(p.substring(i + 1))));
      }
    });
    return out;
  }

  private startBatches(): void {
    const c = this.w.s.run.colony;
    let running = c.batches.filter((b: LarvaBatch) => b.started).length;
    const slots = this.hatchSlots();
    for (let i = 0; i < c.batches.length && running < slots; i++) {
      const b = c.batches[i];
      if (!b.started) {
        b.started = true;
        b.startAt = this.w.s.run.time;
        b.finishAt = this.w.s.run.time + this.hatchTime(b.targetRole);
        running++;
      }
    }
  }

  /** 保留旧命令兼容存档/调用方；繁育只能手动发起。 */
  setAuto(_lay: boolean, _hatch: boolean): void {
    this.w.s.run.colony.autoLay = false;
    this.w.s.run.colony.autoHatch = false;
  }

  setRatio(_role: string, _v: number): void {}

  // ---------------- 繁育计划 ----------------
  /** 中期解锁：度过第一个冬天，或成年蜂达到 20 只 */
  planUnlocked(): boolean {
    return this.w.unlocked('t_survive_winter') || this.w.adults() >= PLAN_UNLOCK_ADULTS;
  }

  planUnlockText(): string {
    return `蜂群达到 ${PLAN_UNLOCK_ADULTS} 只或度过第一个冬天后解锁（当前 ${this.w.adults()} 只）`;
  }

  setPlan(on: boolean): CmdResult {
    if (on && !this.planUnlocked()) return CmdResult.fail('PLAN_LOCKED', this.planUnlockText());
    this.w.s.run.colony.plan.on = on;
    return CmdResult.ok(on ? '繁育计划已开启：蜂后会按比例自动产卵和分化' : '繁育计划已暂停，繁育改回手动');
  }

  setPlanWeight(role: string, v: number): void {
    if (ALL_ROLES.indexOf(role) < 0) return;
    this.w.s.run.colony.plan.weights[role] = Math.max(0, Math.min(10, Math.round(v)));
  }

  setPlanReserve(v: number): void {
    this.w.s.run.colony.plan.reserve = Math.max(0, Math.min(0.9, v));
  }

  /** 计划保留的蜂蜜：容量比例与（入秋后）越冬所需取大者 */
  planReserveHoney(): number {
    const plan = this.w.s.run.colony.plan;
    let keep = plan.reserve * this.w.econ.capacity(Res.Honey).toNumber();
    const s = this.w.s.run.season;
    if (s.formal && (s.season === SeasonId.Autumn || s.season === SeasonId.WinterPrep || s.season === SeasonId.Winter)) {
      const sd = this.w.cfg.seasons.find((d) => d.id === SeasonId.Winter);
      if (sd !== undefined) keep = Math.max(keep, this.w.adults() * sd.upkeep * sd.duration * this.w.attrs.get('storage.winterLoss'));
    }
    return keep;
  }

  /** 按比例当前最缺的工种；没有可培养的工种时返回空 */
  planNextRole(): string {
    const c = this.w.s.run.colony;
    const roles = ALL_ROLES.filter((r: string) => this.roleAvailable(r) && (c.plan.weights[r] ?? 0) > 0);
    if (roles.length === 0) return '';
    let total = 0;
    let wsum = 0;
    const have: Record<string, number> = {};
    roles.forEach((r: string) => {
      const queued = c.batches.filter((b: LarvaBatch) => b.targetRole === r).reduce((n, b) => n + b.count, 0);
      have[r] = this.w.role(r) + queued;
      total += have[r];
      wsum += c.plan.weights[r];
    });
    let best = '';
    let bestGap = -1e9;
    roles.forEach((r: string) => {
      const gap = (total + 1) * c.plan.weights[r] / wsum - have[r];
      if (gap > bestGap) {
        bestGap = gap;
        best = r;
      }
    });
    return best;
  }

  /** 计划状态说明（界面展示） */
  planStatus(): string {
    const c = this.w.s.run.colony;
    if (!this.planUnlocked()) return this.planUnlockText();
    if (!c.plan.on) return '未开启：繁育仍由你手动进行';
    const next = this.planNextRole();
    if (next.length === 0) return '没有可培养的工种：把至少一个已建巢房的工种比例调到 1 以上';
    if (this.w.population() >= this.w.popCap()) return '已达人口上限：扩建或升级蜂后室后继续';
    const honey = this.w.econ.num(Res.Honey);
    const need = this.planReserveHoney() + this.eggCost()[0].amount.toNumber() + this.roleCost(next)[0].amount.toNumber();
    if (honey < need) return `攒蜂蜜中：保留 ${Math.ceil(this.planReserveHoney())}，下一只${this.w.roleDef(next).name}还差 ${Math.ceil(need - honey)}`;
    return `运行中：下一只培养${this.w.roleDef(next).name}`;
  }

  /** 每 tick 尝试一次：先分化计划自己的幼虫，再产卵；手动操作随时可以插队 */
  private planTick(): void {
    const c = this.w.s.run.colony;
    if (!c.plan.on) return;
    if (!this.planUnlocked()) { c.plan.on = false; return; }
    c.plan.larvae = Math.min(c.plan.larvae, c.larvae);
    const role = this.planNextRole();
    if (role.length === 0) return;
    const reserve = this.planReserveHoney();
    // 不提前堆积排队：只有空闲孵化位时才分化下一只
    const waiting = c.batches.some((b: LarvaBatch) => !b.started);
    if (c.plan.larvae > 0 && !waiting) {
      const cost = this.roleCost(role);
      if (this.w.econ.num(Res.Honey) - cost[0].amount.toNumber() >= reserve && this.w.econ.canAfford(cost)) {
        const r = this.differentiate(role, 1);
        if (r.ok) c.plan.larvae = Math.max(0, c.plan.larvae - 1);
      }
      return;
    }
    if (c.plan.larvae > 0 || c.layCooldown > 0 || waiting) return;
    const egg = this.eggCost()[0].amount.toNumber();
    const next = this.roleCost(role)[0].amount.toNumber();
    if (this.w.econ.num(Res.Honey) - egg - next < reserve) return;
    if (!this.canLay().ok) return;
    const before = c.larvae;
    if (this.doLay(true).ok) c.plan.larvae += c.larvae - before;
  }

  setWaxShare(v: number): void {
    this.w.s.run.colony.houseWaxShare = Math.max(0, Math.min(1, v));
  }

  tick(dt: number): void {
    const c = this.w.s.run.colony;
    const run = this.w.s.run;
    if (c.layCooldown > 0) {
      c.layCooldown = Math.max(0, c.layCooldown - dt);
    }
    // 旧存档的自动繁育开关不再生效；自动繁育统一由“繁育计划”负责。
    c.autoLay = false;
    c.autoHatch = false;
    this.planTick();
    // 孵化推进
    let finished = false;
    for (let i = c.batches.length - 1; i >= 0; i--) {
      const b = c.batches[i];
      if (b.started && run.time >= b.finishAt) {
        c.batches.splice(i, 1);
        c.roles[b.targetRole] = this.w.role(b.targetRole) + b.count;
        c.collapsed = false;
        c.hatched += b.count;
        this.w.onHatch(b.targetRole, b.count, false);
        // 特殊变异：额外诞生一只有特性的明星蜂（名册登记时决定特性）
        if (this.w.starRoll()) {
          c.roles[b.targetRole] = this.w.role(b.targetRole) + 1;
          this.w.onHatch(b.targetRole, 1, true);
        }
        this.w.emit('hatch', 0, 0, this.w.roleDef(b.targetRole).name, 'hive');
        this.w.dailyBump('hatch', b.count);
        finished = true;
      }
    }
    if (finished || c.batches.some((b: LarvaBatch) => !b.started)) {
      this.startBatches();
    }
    this.recoverInjured(dt);
    this.lifespanTick(dt);
  }

  /** 受伤蜜蜂恢复（ECO-006：普通威胁优先造成受伤而非死亡） */
  private recoverInjured(dt: number): void {
    const c = this.w.s.run.colony;
    const k = 0.02 * this.w.attrs.get('guard.recovery') * dt;
    ALL_ROLES.forEach((r: string) => {
      const inj = this.w.injured(r);
      if (inj <= 0) {
        return;
      }
      const acc = (this.injuryAcc[r] === undefined ? 0 : this.injuryAcc[r]) + Math.max(inj * k, dt / 30);
      const heal = Math.floor(acc);
      this.injuryAcc[r] = acc - heal;
      if (heal > 0) {
        c.injured[r] = Math.max(0, inj - heal);
      }
    });
  }

  /** 让一部分蜜蜂受伤（不超过上限） */
  injure(role: string, n: number): number {
    const c = this.w.s.run.colony;
    const cap = Math.floor(this.w.role(role) * this.w.cfg.economy.injuryCapRatio);
    const cur = this.w.injured(role);
    const add = Math.max(0, Math.min(Math.floor(n), cap - cur));
    if (add > 0) {
      c.injured[role] = cur + add;
    }
    return add;
  }

  /** 生态模式寿命：默认关闭；开启时按工作周期老化，需玩家手动补员 */
  private lifespanTick(dt: number): void {
    if (!this.w.s.meta.settings.ecoMode || this.w.offline) {
      return;
    }
    const c = this.w.s.run.colony;
    const adults = this.w.adults();
    if (adults <= this.w.cfg.economy.safetyLine * 2) {
      return;
    }
    c.lifeDebt += adults / this.w.cfg.economy.lifespan * dt;
    while (c.lifeDebt >= 1) {
      c.lifeDebt -= 1;
      let best = '';
      let bestN = 0;
      ALL_ROLES.forEach((r: string) => {
        const n = this.w.role(r) - this.w.injured(r);
        if (n > bestN && (r !== Role.Scout || n > 1)) {
          bestN = n;
          best = r;
        }
      });
      if (best.length > 0) {
        c.roles[best] = this.w.role(best) - 1;
      }
    }
  }

  /** 生态模式预警：寿命消耗快于补员 */
  lifespanWarning(): boolean {
    if (!this.w.s.meta.settings.ecoMode) {
      return false;
    }
    const deathRate = this.w.adults() / this.w.cfg.economy.lifespan;
    const layRate = this.w.s.run.colony.plan.on ? 1 / Math.max(1, this.layInterval()) : 0;
    return deathRate > layRate;
  }
}
