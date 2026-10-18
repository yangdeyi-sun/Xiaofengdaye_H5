import { BigNum } from '../common/BigNum';
import { Rng, hashSeed } from '../common/Rng';
import { GameConfigDef, KeyLevelDef, Res, Role, SeasonId, StatDef, ALL_RES, ALL_ROLES } from './Types';
import { GameState, OfflineReport, RunState } from './State';
import { CmdResult, CostAmount, Rates, World } from './World';
import { HiveService } from './HiveService';
import { ColonyService } from './ColonyService';
import { MapService } from './MapService';
import { ProductionService, SeasonService } from './ProductionService';
import { ThreatService } from './ThreatService';
import { ProgressionService, SwarmPreview } from './ProgressionService';
import { createRun } from './NewGame';
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
  rateView: Rates = new Rates();
  dirty: boolean = false;
  /** 关键操作后请求保存（SAVE-005） */
  saveRequested: boolean = false;
  /** 分蜂前快照钩子：由基础设施层实现持久化（需求书8.3） */
  onBeforeSwarm: (snapshot: GameState) => void = () => {
  };
  private acc: number = 0;
  private secTimer: number = 0;
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
    this.prog = new ProgressionService(this.w);
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
    this.w.attrs.recompute();
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
    if (this.w.unlocked('t_build_storage') && this.w.count('storage') > 0 && !this.run.season.formal) {
      this.season.startFormal();
    }
    // 第一只守卫蜂孵化后才开放敌害，玩家首次遇敌时一定已经具备反制手段。
    if (this.w.role('guard') > 0 && !this.run.threats.enabled) {
      this.threats.enable();
    }
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
      // 分蜂不再销毁原蜂群：保存完整运行态，之后可从侧边栏切回；离开期间按离线经营补算。
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
      this.w.s.run = run;
      this.w.rng = new Rng(run.rngState);
      this.hive.reindex();
      this.w.alloc = [];
      this.w.fieldEff = {};
      this.w.refreshFlags();
      this.hive.recomputeAdjacency();
      this.w.attrs.recompute();
      this.w.msg('swarm', `分蜂完成！获得 ${points} 传承点，蜂群抵达${this.w.region().name}。原蜂群仍会经营，可在侧边栏“蜂群切换”中返回。`);
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
