import { BigNum } from '../common/BigNum';
import { Bld, Reason, Res, Role, ALL_ROLES } from './Types';
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

  /** 分蜂蜂后培育：每次消耗固定储备，独立进行 25% 成功判定。 */
  differentiateQueen(): CmdResult {
    const colony = this.w.s.run.colony;
    if (colony.youngQueens > 0) return CmdResult.fail('QUEEN_READY', '新蜂后已经准备好，可以发起分蜂');
    const costs = this.queenCost();
    if (!this.w.econ.canAfford(costs)) {
      return CmdResult.fail('ECON_SHORT', '培育新蜂后需要1000蜂蜜、400蜂蜡和5蜂王浆');
    }
    if (!this.w.econ.spend(costs, Reason.Hatch, 'young-queen')) {
      return CmdResult.fail('ECON_SHORT', '培育新蜂后的资源不足');
    }
    colony.queenAttempts += 1;
    if (!this.w.rng.chance(this.w.cfg.swarm.queenSuccessChance)) {
      this.w.msg('warn', '本次蜂后分化没有成功，投入的育王资源已经消耗。');
      return CmdResult.fail('QUEEN_FAILED', '蜂后分化失败（成功率25%）');
    }
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

  setWaxShare(v: number): void {
    this.w.s.run.colony.houseWaxShare = Math.max(0, Math.min(1, v));
  }

  tick(dt: number): void {
    const c = this.w.s.run.colony;
    const run = this.w.s.run;
    if (c.layCooldown > 0) {
      c.layCooldown = Math.max(0, c.layCooldown - dt);
    }
    // 旧存档的自动繁育开关也不会触发产卵或分化。
    c.autoLay = false;
    c.autoHatch = false;
    // 孵化推进
    let finished = false;
    for (let i = c.batches.length - 1; i >= 0; i--) {
      const b = c.batches[i];
      if (b.started && run.time >= b.finishAt) {
        c.batches.splice(i, 1);
        c.roles[b.targetRole] = this.w.role(b.targetRole) + b.count;
        c.collapsed = false;
        c.hatched += b.count;
        if (this.w.rng.chance(this.w.attrs.get('queen.special'))) {
          c.roles[b.targetRole] = this.w.role(b.targetRole) + 1;
          this.w.msg('special', `特殊变异！一只优秀的${this.w.roleDef(b.targetRole).name}诞生了`);
        }
        this.w.emit('hatch', 0, 0, this.w.roleDef(b.targetRole).name, 'hive');
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
    const layRate = 0;
    return deathRate > layRate;
  }
}
