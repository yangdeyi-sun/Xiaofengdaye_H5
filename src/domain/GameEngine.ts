import { BigNum } from '../common/BigNum';
import { Rng, hashSeed } from '../common/Rng';
import { GameConfigDef, KeyLevelDef, Res, Role, SeasonId, StatDef, ALL_RES, ALL_ROLES } from './Types';
import { GameState, LarvaBatch, OfflineReport, RunState } from './State';
import { CmdResult, CostAmount, Rates, World } from './World';
import { HiveService } from './HiveService';
import { ColonyService } from './ColonyService';
import { MapService } from './MapService';
import { ProductionService, SeasonService } from './ProductionService';
import { ThreatService } from './ThreatService';
import { DailyService } from './DailyService';
import { ProgressionService, SwarmPreview } from './ProgressionService';
import { createRun } from './NewGame';
import { RosterService, starTrait } from './RosterService';
import { KingdomService } from './KingdomService';
import { EventService } from './EventService';
import { cloneState } from './SaveCodec';

export class UpgradePreview {
  trackId: string = '';
  name: string = '';
  level: number = 0;
  maxLevel: number = 0;
  cur: number = 0;
  next: number = 0;
  unit: string = '';
  costs: CostAmount[] = [];
  honeyPerMinDelta: number = 0;
  affordable: boolean = false;
  keyNote: string = '';
}

/** 模拟内核（SimulationEngine）+ 应用用例层：UI 只通过这里发出命令 */
export class GameEngine {
  static readonly STEP: number = 0.1;
  w: World;
  hive: HiveService;
  colony: ColonyService;
  map: MapService;
  prod: ProductionService;
  season: SeasonService;
  threats: ThreatService;
  prog: ProgressionService;
  daily: DailyService;
  roster: RosterService;
  kingdom: KingdomService;
  events: EventService;
  rateView: Rates = new Rates();
  dirty: boolean = false;
  /** 关键操作后请求保存（SAVE-005） */
  saveRequested: boolean = false;
  /** 分蜂前快照钩子：由基础设施层实现持久化（需求书8.3） */
  onBeforeSwarm: (snapshot: GameState) => void = () => {
  };
  private acc: number = 0;
  private secTimer: number = 0;
  private lastSpan: number = 1;
  private seasonLog: string[] = [];

  constructor(cfg: GameConfigDef, state: GameState) {
    state.run.colony.autoLay = false;
    state.run.colony.autoHatch = false;
    this.w = new World(cfg, state);
    this.hive = new HiveService(this.w);
    this.colony = new ColonyService(this.w);
    this.map = new MapService(this.w);
    this.prod = new ProductionService(this.w);
    this.season = new SeasonService(this.w);
    this.threats = new ThreatService(this.w);
    this.threats.honeyPerSec = () => this.estimateHoneyPerMin() / 60;
    this.roster = new RosterService(this.w);
    this.kingdom = new KingdomService(this.w);
    this.events = new EventService(this.w);
    const hps = (): number => this.estimateHoneyPerMin() / 60;
    this.roster.honeyPerSec = hps;
    this.kingdom.honeyPerSec = hps;
    this.events.honeyPerSec = hps;
    this.kingdom.swarmReady = () => this.prog.swarmPreview().ready;
    this.events.busy = () => this.threats.raidActive();
    this.events.publish = (fieldId: string) => this.map.publishDiscovery(fieldId);
    this.w.onHatch = (role: string, count: number, star: boolean) => {
      const b = this.roster.born(role, count, star);
      if (star && b !== null && b.t !== undefined) {
        const t = starTrait(b.t);
        this.w.gainXp(20);
        this.w.msg('milestone', `明星蜂诞生！${this.w.roleDef(role).name}「${b.n}」带着「${t === null ? '' : t.name}」特性：全巢${t === null ? '' : t.desc} +${t === null ? '' : this.roster.bonusText(t, 1)}`);
        this.w.emit('hatch', 0, 0, `明星蜂「${b.n}」`, 'hive');
      }
    };
    this.w.onBee = (kind: string, index: number, ref: string) => {
      if (kind === 'guardWin') this.roster.onGuardWin(ref);
      else this.roster.onScout(kind, index);
    };
    this.w.starRoll = () => this.roster.rollStar();
    this.w.starBonus = (stat: string) => this.roster.bonus(stat);
    this.prog = new ProgressionService(this.w);
    this.daily = new DailyService(this.w, () => this.estimateHoneyPerMin() / 60);
    this.prog.researchBonus = () => this.kingdom.researchBonus();
    this.season.onChange = (from: string, to: string) => {
      this.map.onSeasonChange();
      this.seasonLog.push(to);
      this.w.emit('season', 0, 0, this.season.def(to).name, 'any');
    };
    this.w.refreshFlags();
    this.hive.recomputeAdjacency();
    this.w.attrs.recompute();
  }

  get state(): GameState {
    return this.w.s;
  }

  get run(): RunState {
    return this.w.s.run;
  }

  /** 推进真实时间：固定步长累积，单帧最多 30 步防止卡顿螺旋 */
  advance(realDt: number): void {
    this.acc += Math.min(realDt, 3);
    let steps = 0;
    while (this.acc >= GameEngine.STEP && steps < 30) {
      this.step(GameEngine.STEP);
      this.acc -= GameEngine.STEP;
      steps++;
    }
  }

  step(dt: number): void {
    const s = this.w.s;
    s.run.time += dt;
    if (!this.w.offline) {
      s.meta.totalPlayTime += dt;
    }
    this.season.tick(dt);
    this.colony.tick(dt);
    this.map.tick(dt);
    this.prod.tick(dt);
    this.threats.tick(dt);
    this.w.econ.decayOverflow(dt);
    this.w.econ.tick(dt, false);
    s.run.rngState = this.w.rng.state;
    this.secTimer += dt;
    if (this.secTimer >= 1 || dt >= 1) {
      const span = Math.max(dt, this.secTimer);
      this.secTimer = 0;
      this.publishRates(span);
      this.lastSpan = span;
      this.periodic();
    }
    this.dirty = true;
  }

  private publishRates(span: number): void {
    const r = this.w.rates;
    const v = new Rates();
    v.nectarIn = r.nectarIn / span;
    v.manualIn = r.manualIn / span;
    v.honeyIn = r.honeyIn / span;
    v.nectarUse = r.nectarUse / span;
    v.waxIn = r.waxIn / span;
    v.honeyUse = r.honeyUse / span;
    v.upkeep = r.upkeep / span;
    v.jellyIn = r.jellyIn / span;
    this.rateView = v;
    this.w.rates = new Rates();
  }

  /** 每秒执行的低频系统（时间片轮询） */
  private periodic(): void {
    this.roster.sync();
    this.roster.attribute(this.lastSpan, this.rateView);
    this.kingdom.tick(this.lastSpan, this.rateView);
    this.events.tick();
    this.w.attrs.recompute();
    if (this.kingdom.checkChapters().length > 0) this.saveRequested = true;
    this.prog.checkTasks();
    this.prog.newlyDone.forEach((id: string) => {
      this.onTaskDone(id);
    });
    if (this.prog.newlyDone.length > 0) {
      this.saveRequested = true;
    }
    this.prog.newlyDone = [];
    this.prog.checkAchievements();
    this.prog.tutorialTick();
    this.hive.ensureFallDeadline();
    if (this.run.hive.fallAt > 0 && this.run.time >= this.run.hive.fallAt) {
      this.dropOvergrownHive();
      return;
    }
    if (this.w.unlocked('t_build_storage') && this.w.count('storage') > 0 && !this.run.season.formal) {
      this.season.startFormal();
    }
    // 玩家建成第一个功能建筑后开放低频、非致命敌害；新手结束后由敌害服务提高频率。
    const hasFirstBuilding = this.run.hive.cells.some((cell) => cell.building.length > 0 && cell.building !== 'queen');
    if (hasFirstBuilding && !this.run.threats.enabled) {
      this.threats.enable();
    }
  }

  /** 蜂巢达到扩建上限却未及时分蜂：当前蜂群坠落，本蜂群从零重建。 */
  private dropOvergrownHive(): void {
    const old = this.run;
    const seed = hashSeed(`${this.state.meta.playerId}:fall:${old.regionId}:${old.regionIndex}:${old.time}`);
    const fresh = createRun(this.w.cfg, old.regionId, old.regionIndex, seed, 0);
    ALL_RES.forEach((res: string) => { fresh.res[res] = BigNum.zero(); });
    this.w.s.run = fresh;
    this.w.rng = new Rng(fresh.rngState);
    this.hive.reindex();
    this.w.alloc = [];
    this.w.fieldEff = {};
    this.w.refreshFlags();
    this.hive.recomputeAdjacency();
    this.w.attrs.recompute();
    this.w.msg('error', '蜂巢超过承重期限后坠落损毁，当前蜂群的资源、人口和建设已从零开始。');
    this.w.emit('fail', 0, 0, '蜂巢坠落', 'hive');
    this.saveRequested = true;
  }

  private onTaskDone(id: string): void {
    const run = this.run;
    if (id === 't_first_scout' && run.stats.firstScoutAt < 0) {
      run.stats.firstScoutAt = run.time;
    }
    if (id === 't_first_forager') {
      if (run.stats.firstForagerAt < 0) {
        run.stats.firstForagerAt = run.time;
      }

    }
    if (id === 't_auto_loop' && run.stats.autoLoopAt < 0) {
      run.stats.autoLoopAt = run.time;
      this.w.msg('milestone', '采酿产线接通！采集和酿蜜会持续工作，孵化与分化由你决定。');
      this.w.emit('milestone', 0, 0, '蜂巢开始自行运转', 'any');
    }
    if (id === 't_build_storage' && run.stats.firstStorageAt < 0) {
      run.stats.firstStorageAt = run.time;
    }
  }

  // ======================= 用例命令 =======================
  private done(r: CmdResult): CmdResult {
    if (r.ok) {
      this.saveRequested = true;
      this.w.attrs.recompute();
    }
    return r;
  }

  collect(fieldId: string, times: number): CmdResult {
    return this.map.manualCollect(fieldId, Math.max(1, Math.min(10, Math.floor(times))));
  }

  lay(): CmdResult {
    return this.done(this.colony.lay());
  }

  differentiate(role: string, count: number): CmdResult {
    return this.done(this.colony.differentiate(role, Math.max(1, Math.min(50, Math.floor(count)))));
  }

  differentiateQueen(): CmdResult {
    return this.done(this.colony.differentiateQueen());
  }

  cancelBatch(id: number): CmdResult {
    return this.done(this.colony.cancel(id));
  }

  build(cellId: string, type: string): CmdResult {
    return this.done(this.hive.build(cellId, type));
  }

  expand(cellId: string): CmdResult {
    return this.done(this.hive.expand(cellId));
  }

  demolish(cellId: string): CmdResult {
    return this.done(this.hive.demolish(cellId));
  }

  swapCells(fromId: string, toId: string): CmdResult {
    return this.done(this.hive.swapCells(fromId, toId));
  }

  upgrade(trackId: string): CmdResult {
    return this.done(this.hive.upgrade(trackId));
  }

  research(id: string): CmdResult {
    return this.done(this.prog.research(id));
  }

  investTalent(id: string): CmdResult {
    return this.done(this.prog.investTalent(id));
  }

  resetTalents(): CmdResult {
    return this.done(this.prog.resetTalents());
  }

  setAuto(lay: boolean, hatch: boolean): void {
    this.colony.setAuto(lay, hatch);
    this.saveRequested = true;
  }

  /** 平台层每秒传入玩家本地日期；跨天时刷新每日目标 */
  ensureDay(day: string): void {
    if (this.daily.ensure(day)) this.saveRequested = true;
  }

  dailySign(): CmdResult {
    return this.done(this.daily.sign());
  }

  dailyClaim(index: number): CmdResult {
    return this.done(this.daily.claim(index));
  }

  dailyBonus(): CmdResult {
    return this.done(this.daily.claimBonus());
  }

  setBreedPlan(on: boolean): CmdResult {
    const r = this.colony.setPlan(on);
    if (r.ok) this.saveRequested = true;
    return r;
  }

  setPlanWeight(role: string, v: number): void {
    this.colony.setPlanWeight(role, v);
    this.saveRequested = true;
  }

  setPlanReserve(v: number): void {
    this.colony.setPlanReserve(v);
    this.saveRequested = true;
  }

  setRatio(role: string, v: number): void {
    this.colony.setRatio(role, v);
  }

  setWaxShare(v: number): void {
    this.colony.setWaxShare(v);
  }

  setStrategy(s: string): void {
    this.run.colony.forageStrategy = s;
  }

  setGuardPriority(p: string): void {
    this.run.colony.guardPriority = p;
  }

  setPollinators(fieldId: string, n: number): CmdResult {
    return this.done(this.map.setPollinators(fieldId, n));
  }

  bearChoice(eventId: string, choice: string): CmdResult {
    return this.done(this.threats.bearChoice(eventId, choice));
  }

  /** 玩家点击敌害：亲手驱赶 */
  swatThreat(eventId: string): CmdResult {
    const r = this.threats.swat(eventId);
    if (r.ok && r.message.startsWith('亲手击退')) this.saveRequested = true;
    return r;
  }

  claimOverflow(): CmdResult {
    const n = this.w.econ.claimOverflow();
    return n > 0 ? this.done(CmdResult.ok(`收回 ${Math.round(n)} 溢出资源`)) : CmdResult.fail('ECON_FULL', '仓库仍然已满');
  }

  claimColonyTask(): CmdResult {
    return this.done(this.prog.claimColonyTask());
  }

  // ======================= 查询 =======================
  estimateHoneyPerMin(): number {
    const nectar = this.map.estimateNectarRate();
    return this.prod.estimateHoneyRate(nectar) * 60;
  }

  previewUpgrade(trackId: string): UpgradePreview {
    const p = new UpgradePreview();
    const t = this.w.track(trackId);
    if (t === null) {
      return p;
    }
    const sd = this.w.cfg.stats.find((x: StatDef) => x.id === t.stat);
    p.trackId = t.id;
    p.name = t.name;
    p.level = this.hive.trackLevel(t.id);
    p.maxLevel = t.maxLevel;
    p.unit = sd === undefined ? '' : sd.unit;
    p.cur = this.w.attrs.get(t.stat);
    p.costs = this.hive.upgradeCost(t);
    p.affordable = this.w.econ.canAfford(p.costs);
    const before = this.estimateHoneyPerMin();
    this.run.upgrades[t.id] = p.level + 1;
    this.w.attrs.recompute();
    p.next = this.w.attrs.get(t.stat);
    const after = this.estimateHoneyPerMin();
    this.run.upgrades[t.id] = p.level;
    if (p.level === 0) {
      const tmp: Record<string, number> = {};
      Object.keys(this.run.upgrades).forEach((k: string) => {
        if (k !== t.id) {
          tmp[k] = this.run.upgrades[k];
        }
      });
      this.run.upgrades = tmp;
    }
    this.w.attrs.recompute();
    p.honeyPerMinDelta = after - before;
    t.keyLevels.forEach((k: KeyLevelDef) => {
      if (k.level > p.level && p.keyNote.length === 0) {
        p.keyNote = `Lv${k.level}：${k.desc}`;
      }
    });
    return p;
  }

  swarmPreview(): SwarmPreview {
    return this.prog.swarmPreview();
  }

  /**
   * 分蜂事务（需求书8.3）：检查 → 快照 → 结算 → 新种区 → 应用天赋 → 保存。
   * 任一步失败恢复快照，禁止“资源已清除但新种区未建立”。
   */
  swarm(nextRegion: string): CmdResult {
    const preview = this.prog.swarmPreview();
    if (!preview.ready) {
      return CmdResult.fail('PROG_SWARM', '分蜂条件尚未满足');
    }
    const snapshot = cloneState(this.w.s);
    const snapshotRun = this.w.s.run;
    this.onBeforeSwarm(snapshot);
    try {
      const points = preview.total;
      this.prog.applySwarmToMeta(points, nextRegion);
      const meta = this.w.s.meta;
      // 新蜂后带走一半幼虫、成年蜂和当前库存；旧蜂群保留另一半与原有建设。
      const carriedRes: Record<string, BigNum> = {};
      const carriedOverflow: Record<string, BigNum> = {};
      ALL_RES.forEach((res: string) => {
        carriedRes[res] = snapshotRun.res[res].mulN(0.5);
        snapshotRun.res[res] = snapshotRun.res[res].sub(carriedRes[res]).clamp0();
        carriedOverflow[res] = snapshotRun.overflow[res].mulN(0.5);
        snapshotRun.overflow[res] = snapshotRun.overflow[res].sub(carriedOverflow[res]).clamp0();
      });
      const carriedRoles: Record<string, number> = {};
      const carriedInjured: Record<string, number> = {};
      ALL_ROLES.forEach((role: string) => {
        carriedRoles[role] = Math.floor(snapshotRun.colony.roles[role] * 0.5);
        snapshotRun.colony.roles[role] -= carriedRoles[role];
        carriedInjured[role] = Math.min(carriedRoles[role], Math.floor(snapshotRun.colony.injured[role] * 0.5));
        snapshotRun.colony.injured[role] -= carriedInjured[role];
      });
      // 名册：明星蜂优先跟随新蜂后，其余按名字隔一只带走一只
      const rosterSplit = this.roster.split(snapshotRun.colony.roster ?? [], carriedRoles);
      snapshotRun.colony.roster = rosterSplit.stay;
      const carriedLarvae = Math.floor(snapshotRun.colony.larvae * 0.5);
      snapshotRun.colony.larvae -= carriedLarvae;
      const carriedBatches: LarvaBatch[] = [];
      snapshotRun.colony.batches.forEach((batch: LarvaBatch) => {
        const count = Math.floor(batch.count * 0.5);
        if (count <= 0) return;
        batch.count -= count;
        carriedBatches.push({
          ...batch, batchId: carriedBatches.length + 1, count,
          startAt: Math.max(0, batch.startAt - snapshotRun.time),
          finishAt: Math.max(0, batch.finishAt - snapshotRun.time)
        });
      });
      snapshotRun.colony.youngQueens = Math.max(0, snapshotRun.colony.youngQueens - 1);
      this.w.s.colonies.push({
        id: this.w.s.activeColonyId,
        name: `${this.w.region().name}蜂群`,
        run: snapshotRun,
        lastActiveAt: Date.now()
      });
      this.w.s.activeColonyId = `colony-${meta.swarmCount}`;
      this.w.refreshFlags();
      this.w.attrs.recompute();
      const startLarvae = Math.floor(this.w.attrs.get('start.larvae'));
      const seed = hashSeed(`${meta.playerId}:${meta.swarmCount}:${nextRegion}`);
      const run = createRun(this.w.cfg, nextRegion, snapshotRun.regionIndex + 1, seed, startLarvae);
      ALL_RES.forEach((res: string) => {
        run.res[res] = carriedRes[res];
        run.overflow[res] = carriedOverflow[res];
      });
      ALL_ROLES.forEach((role: string) => {
        run.colony.roles[role] = carriedRoles[role];
        run.colony.injured[role] = carriedInjured[role];
      });
      run.colony.larvae += carriedLarvae;
      run.colony.roster = rosterSplit.go;
      run.colony.batches = carriedBatches;
      run.colony.nextBatchId = carriedBatches.length + 1;
      run.colony.hatched = Object.values(carriedRoles).reduce((sum, value) => sum + value, 0);
      run.stats.peakPop = run.colony.hatched;
      this.w.s.run = run;
      this.w.rng = new Rng(run.rngState);
      this.hive.reindex();
      this.w.alloc = [];
      this.w.fieldEff = {};
      this.w.refreshFlags();
      this.hive.recomputeAdjacency();
      this.w.attrs.recompute();
      this.w.gainXp(100);
      this.w.msg('swarm', `分蜂完成！新蜂后带领一半蜂群和资源抵达${this.w.region().name}，获得 ${points} 传承点（全巢产量永久 +${points * 2}%）。新巢成本倍率 ×${this.hive.constructionCostMul()}。`);
      this.w.emit('swarm', 0, 0, this.w.region().name, 'any');
      this.saveRequested = true;
      return CmdResult.ok(`获得 ${points} 传承点`);
    } catch (e) {
      // 回滚：恢复分蜂前状态
      const restored = cloneState(snapshot);
      this.w.s.meta = restored.meta;
      this.w.s.run = restored.run;
      this.w.rng = new Rng(restored.run.rngState);
      this.hive.reindex();
      this.w.refreshFlags();
      this.hive.recomputeAdjacency();
      this.w.msg('error', '分蜂失败，已恢复分蜂前状态');
      return CmdResult.fail('PROG_SWARM_FAIL', '分蜂过程中出现错误，进度已恢复');
    }
  }

  // ======================= 离线聚合结算（SAVE-006~009） =======================
  settleOffline(elapsedSec: number, settlementId: string, anomaly: string): OfflineReport | null {
    const s = this.w.s;
    if (settlementId.length > 0 && s.lastSettlementId === settlementId) {
      return null;
    }
    s.lastSettlementId = settlementId;
    const capSec = this.w.attrs.get('global.offlineHours') * 3600;
    const elapsed = Math.max(0, elapsedSec);
    const credited = Math.min(elapsed, capSec);
    // 离开期间蜂巢照常运转（采集、酿蜜、孵化中的幼虫），按离线收益上限结算
    const effective = credited;
    const before: Record<string, BigNum> = {};
    ALL_RES.forEach((r: string) => {
      before[r] = this.w.econ.amount(r);
    });
    const adultsBefore = this.w.adults();
    this.seasonLog = [];
    this.w.offline = true;
    this.w.interactive = false;
    const stepLen = this.w.cfg.economy.offlineStep;
    let left = effective;
    while (left > 0) {
      const dt = Math.min(stepLen, left);
      this.step(dt);
      left -= dt;
    }
    this.w.offline = false;
    this.w.interactive = true;
    this.w.econ.tick(0, true);
    const gains: Record<string, string> = {};
    ALL_RES.forEach((r: string) => {
      gains[r] = this.w.econ.amount(r).sub(before[r]).serialize();
    });
    const notes: string[] = [];
    if (this.seasonLog.indexOf(SeasonId.Winter) >= 0) {
      notes.push('离线期间经历了冬季，蜂群依靠储备度过（离线不会造成蜜蜂死亡）');
    }
    const ob = s.run.overflow[Res.Honey];
    if (ob !== undefined && ob.gt(BigNum.of(1))) {
      notes.push('储蜜格已满，部分蜂蜜存入溢出缓冲，可在主界面领取');
    }
    if (this.w.adults() > adultsBefore) {
      notes.push(`蜂群增加了 ${this.w.adults() - adultsBefore} 只`);
    }
    if (this.w.role(Role.Forager) === 0) {
      notes.push('还没有采集蜂：离开期间只把存下的花蜜酿成了蜂蜜，培养采集蜂后离线也能持续采蜜');
    }
    const report: OfflineReport = {
      settlementId: settlementId, elapsed: elapsed, credited: effective, truncated: Math.max(0, elapsed - credited),
      gains: gains, seasonsPassed: this.seasonLog.slice(), notes: notes, anomaly: anomaly
    };
    this.seasonLog = [];
    this.saveRequested = true;
    return report;
  }

  /** 调试/测试辅助：人口统计 */
  roleSummary(): string {
    return ALL_ROLES.map((r: string) => `${r}:${this.w.role(r)}`).join(' ') + ` larvae:${this.run.colony.larvae}`;
  }

  reasonsForShortage(costs: CostAmount[]): string {
    const sh = this.w.econ.shortage(costs);
    if (sh.length === 0) {
      return '';
    }
    return sh.map((c: CostAmount) => `${RES_NAMES[c.res]}还差 ${Math.ceil(c.amount.toNumber())}`).join('，');
  }
}

export const RES_NAMES: Record<string, string> = {
  'nectar': '花蜜',
  'honey': '蜂蜜',
  'wax': '蜂蜡',
  'jelly': '蜂王浆'
};

export function costText(costs: CostAmount[]): string {
  return costs.map((c: CostAmount) => `${formatCostNum(c.amount)} ${RES_NAMES[c.res]}`).join(' + ');
}

function formatCostNum(v: BigNum): string {
  const n = v.toNumber();
  if (n < 1e4) {
    return `${Math.ceil(n)}`;
  }
  if (n < 1e6) {
    return `${(n / 1e3).toFixed(1)}K`;
  }
  if (n < 1e9) {
    return `${(n / 1e6).toFixed(2)}M`;
  }
  return `${v.m.toFixed(2)}e${v.e}`;
}
