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
import { cleanHiveName, suggestHiveName } from './HiveNames';
import { StewardService } from './StewardService';
import { attachRun, ensureRealm, inheritKnowledge, pickSpot, realmMembers, refreshShares, regionOf, seedTerritoryFields, rebindRun } from './RealmService';

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
  steward: StewardService | null = null;
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
    this.kingdom.regionColonies = () => this.prog.regionColonies();
    this.events.busy = () => this.threats.raidActive();
    this.events.publish = (fieldId: string) => this.map.publishDiscovery(fieldId);
    this.w.onHatch = (role: string, count: number, star: boolean) => {
      const b = this.roster.born(role, count, star);
      if (star && b !== null && b.t !== undefined) {
        const t = starTrait(b.t);
        this.w.gainXp(20);
        this.w.msg('milestone', `明星蜂诞生！${this.w.roleDef(role).name}「${b.n}」带着「${t === null ? '' : t.name}」特性：全巢${t === null ? '' : t.desc} +${t === null ? '' : this.roster.bonusText(t, 1)}`, 'star');
        this.w.emit('hatch', 0, 0, `明星蜂「${b.n}」`, 'hive');
      }
    };
    this.w.onBee = (kind: string, index: number, ref: string) => {
      if (kind === 'guardWin') this.roster.onGuardWin(ref);
      else this.roster.onScout(kind, index);
    };
    this.w.onDeath = (role: string, n: number) => this.roster.kill(role, n);
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
    this.season.onWinterFailure = (need: number, have: number) => {
      this.restartCurrentHive(
        `入冬需要 ${Math.ceil(need)} 蜂蜜，当前只有 ${Math.floor(have)}。储备不足，蜂巢死亡，资源、人口和建设已从零开始。`,
        '越冬失败'
      );
    };
    this.w.refreshFlags();
    this.hive.recomputeAdjacency();
    this.w.attrs.recompute();
    // 旧存档：已经过了新手但第一个蜂巢还没取过名，补问一次
    const names = state.meta.colonyNames ?? {};
    if (state.meta.tutorialDone && names[state.activeColonyId] === undefined) this.w.requestName(state.activeColonyId);
  }

  /**
   * 托管运转的蜂巢：同一张王国地图上、不在经营的蜂巢在后台实时运转。
   * view 共享王国的 meta，run 就是那个蜂群的 run；消息与账本各自独立，不打扰玩家。
   */
  static background(cfg: GameConfigDef, shared: GameState, colonyId: string, run: RunState): GameEngine {
    const view: GameState = {
      meta: shared.meta, run, activeColonyId: colonyId, colonies: [], messages: [], nextMessageId: 1, ledger: [],
      nextLedgerId: 1, lastSavedAt: shared.lastSavedAt, lastTrustedTime: shared.lastTrustedTime, lastSettlementId: ''
    };
    const e = new GameEngine(cfg, view);
    e.w.background = true;
    e.w.offline = true;
    e.w.interactive = false;
    e.steward = new StewardService(e.w, e.hive, e.prog);
    return e;
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
    if (this.threats.hiveLost.length > 0) {
      this.threats.hiveLost = '';
      this.destroyHive();
      return;
    }
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
    if (this.steward !== null) this.steward.tick(this.lastSpan);
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

  /** 熊掀翻了整个蜂巢：当前蜂群全军覆没，在原地从一座空蜂巢重新开始（永久进度保留）。 */
  private destroyHive(): void {
    const old = this.run;
    const seed = hashSeed(`${this.state.meta.playerId}:bear:${old.regionId}:${old.regionIndex}:${old.time}`);
    const fresh = createRun(this.w.cfg, old.regionId, old.regionIndex, seed, 0);
    ALL_RES.forEach((res: string) => { fresh.res[res] = BigNum.zero(); });
    // 重开的蜂巢仍记得自己领过的传承点，避免重复刷分蜂奖励
    fresh.stats.legacyPaid = old.stats.legacyPaid ?? 0;
    fresh.stats.beesLost = (old.stats.beesLost ?? 0) + Object.values(old.colony.roles).reduce((n, v) => n + Math.max(0, v), 0);
    rebindRun(this.w.s, this.w.cfg, old, fresh, this.w.s.activeColonyId);
    this.w.s.run = fresh;
    this.w.rng = new Rng(fresh.rngState);
    this.hive.reindex();
    this.w.alloc = [];
    this.w.fieldEff = {};
    this.w.refreshFlags();
    this.hive.recomputeAdjacency();
    this.w.attrs.recompute();
    const meta = this.state.meta;
    meta.hivesLost = (meta.hivesLost ?? 0) + 1;
    this.w.msg('info', '蜂后在废墟里重新筑巢：先亲手采蜜、酿蜜，再孵化新的蜜蜂。王国等级、传承、图鉴和其它蜂群都还在。');
    this.saveRequested = true;
  }

  /** 蜂巢达到扩建上限却未及时分蜂：当前蜂群坠落，本蜂群从零重建。 */
  private dropOvergrownHive(): void {
    this.restartCurrentHive('蜂巢超过承重期限后坠落损毁，当前蜂群的资源、人口和建设已从零开始。', '蜂巢坠落');
  }

  /** 保留账号设置与长期记录，仅把当前蜂巢的本轮内容清零。 */
  private restartCurrentHive(message: string, eventLabel: string): void {
    const old = this.run;
    const seed = hashSeed(`${this.state.meta.playerId}:restart:${eventLabel}:${old.regionId}:${old.regionIndex}:${old.time}`);
    const fresh = createRun(this.w.cfg, old.regionId, old.regionIndex, seed, 0);
    ALL_RES.forEach((res: string) => { fresh.res[res] = BigNum.zero(); });
    rebindRun(this.w.s, this.w.cfg, old, fresh, this.w.s.activeColonyId);
    this.w.s.run = fresh;
    this.w.rng = new Rng(fresh.rngState);
    this.hive.reindex();
    this.w.alloc = [];
    this.w.fieldEff = {};
    this.w.refreshFlags();
    this.hive.recomputeAdjacency();
    this.w.attrs.recompute();
    this.w.msg('error', message);
    this.w.emit('fail', 0, 0, eventLabel, 'hive');
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
    if (p.level >= p.maxLevel) {
      p.next = p.cur;
      return p;
    }
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

  /** 种区分蜂预览；target 为空时按最容易的种区计算 */
  swarmPreview(target: string = ''): SwarmPreview {
    return this.prog.swarmPreview(target);
  }

  /** 原地分蜂预览 */
  localPreview(): SwarmPreview {
    return this.prog.localPreview();
  }

  /** 蜂群名字：同一种区有多个蜂群时带编号 */
  colonyName(id: string, regionId: string): string {
    const saved = this.w.s.meta.colonyNames?.[id];
    if (saved !== undefined && saved.length > 0) return saved;
    const region = this.w.cfg.regions.find((r) => r.id === regionId);
    return `${region === undefined ? regionId : region.name}蜂群`;
  }

  private nameNewColony(id: string, regionId: string): string {
    const meta = this.w.s.meta;
    if (meta.colonyNames === undefined) meta.colonyNames = {};
    const region = this.w.cfg.regions.find((r) => r.id === regionId);
    const base = region === undefined ? regionId : region.name;
    // 新蜂群在本种区的编号：已有的同区蜂群数 + 1（新蜂群此时还没登记）
    const n = this.prog.regionColonies(regionId);
    const name = n <= 0 ? `${base}蜂群` : `${base}${n + 1}号蜂群`;
    meta.colonyNames[id] = name;
    return name;
  }

  /**
   * 原地分蜂的新蜂巢：落在同一张王国地图上（离原蜂巢不太近、领地可以重叠），
   * 并继承原蜂巢的一些属性——内两圈的巢房布局、一半的属性等级、繁育比例、采集与守卫策略、季节进度和花田情报。
   */
  private settleDaughter(parent: RunState, child: RunState, childId: string): void {
    this.placeInRealm(child, childId, parent);
    inheritKnowledge(parent, child, 900);
    // 巢房布局：内两圈照着原蜂巢搭好
    const parentCells = new Map(parent.hive.cells.map((c) => [c.cellId, c]));
    let ring = child.hive.ringLevel;
    child.hive.cells.forEach((c) => {
      const pc = parentCells.get(c.cellId);
      if (pc === undefined || !pc.unlocked || pc.ring > 2) return;
      c.unlocked = true;
      c.building = pc.building;
      ring = Math.max(ring, c.ring);
    });
    child.hive.ringLevel = ring;
    // 属性等级：继承一半
    Object.keys(parent.upgrades).forEach((k: string) => {
      const lv = Math.floor(parent.upgrades[k] * 0.5);
      if (lv > 0) child.upgrades[k] = lv;
    });
    // 繁育计划、采集与守卫策略、分工
    child.colony.plan = { on: true, weights: { ...parent.colony.plan.weights }, reserve: parent.colony.plan.reserve, larvae: 0 };
    child.colony.forageStrategy = parent.colony.forageStrategy;
    child.colony.guardPriority = parent.colony.guardPriority;
    child.colony.houseWaxShare = parent.colony.houseWaxShare;
    // 主线目标已经完成过，不再重复发奖
    child.tasksDone = parent.tasksDone.filter((id: string) => !id.startsWith('ch_'));
    child.tasksClaimed = parent.tasksClaimed.filter((id: string) => !id.startsWith('ch_'));
    // 季节：与原蜂巢同步，同一张地图上的四季一致
    const ps = parent.season;
    child.season = {
      formal: ps.formal, season: ps.season, startedAt: ps.startedAt - parent.time, endsAt: ps.endsAt - parent.time,
      cycleIndex: ps.cycleIndex, firstWinterProtected: ps.firstWinterProtected, wintersSurvived: 0, starving: false, starveSeconds: 0
    };
  }

  /** 把新蜂巢摆到种区的王国地图上：选址、生成它领地里的花田、和其它蜂巢的领地对应起来 */
  private placeInRealm(child: RunState, childId: string, near?: RunState): void {
    const s = this.w.s;
    const cfg = this.w.cfg;
    const regionId = child.regionId;
    const region = regionOf(cfg, regionId);
    ensureRealm(s, cfg, regionId);
    const base = near?.realm ?? realmMembers(s, regionId).find((m) => m.run.realm !== undefined && !m.run.realm.daughter)?.run.realm;
    const spot = pickSpot(cfg, s, regionId, region, child.seed, base === undefined ? undefined : { x: base.x, y: base.y });
    child.realm = { x: spot.x, y: spot.y, daughter: true, r: region.maxRadius * 0.78, seed: (child.seed >>> 0) % 100000 };
    child.map.fields = [];
    child.map.scouts = [];
    delete child.map.bloom;
    seedTerritoryFields(s, cfg, regionId, childId, child.realm, child.seed ^ 0x2f1);
    attachRun(s, cfg, regionId, child, childId);
    // 新花田可能也落在其它蜂巢的领地里：给它们补上副本
    realmMembers(s, regionId).forEach((m) => attachRun(s, cfg, regionId, m.run, m.id));
  }

  /** 玩家给蜂群取名（1~8 个字）；同时从待取名队列里移除 */
  renameColony(id: string, raw: string): CmdResult {
    const name = cleanHiveName(raw);
    if (name.length === 0) return CmdResult.fail('NAME_EMPTY', '名字不能为空');
    const meta = this.w.s.meta;
    if (meta.colonyNames === undefined) meta.colonyNames = {};
    const names = meta.colonyNames;
    const taken = Object.keys(names).some((k) => k !== id && names[k] === name);
    if (taken) return CmdResult.fail('NAME_TAKEN', '已经有蜂巢叫这个名字了');
    names[id] = name;
    const slot = this.w.s.colonies.find((c) => c.id === id);
    if (slot !== undefined) slot.name = name;
    meta.namePending = (meta.namePending ?? []).filter((x) => x !== id);
    this.saveRequested = true;
    return CmdResult.ok(`蜂巢取名为「${name}」`);
  }

  /** 稍后再取名：沿用当前名字，不再追问 */
  skipName(id: string): void {
    const meta = this.w.s.meta;
    meta.namePending = (meta.namePending ?? []).filter((x) => x !== id);
    this.saveRequested = true;
  }

  /** 取名弹窗里的预设名（避开已用名字） */
  suggestName(seed: number): string {
    return suggestHiveName(seed, Object.values(this.w.s.meta.colonyNames ?? {}));
  }

  /**
   * 原地分蜂：只需要一只新蜂后。新蜂后带走当前蜂巢一半的资源和人口，在本种区附近建立新蜂群；
   * 玩家继续经营当前蜂群，新蜂巢出现在同一张王国地图上并托管运转。
   */
  swarmLocal(): CmdResult {
    const preview = this.prog.localPreview();
    if (!preview.ready) {
      return CmdResult.fail('PROG_SWARM', '原地分蜂需要一只新蜂后：先从幼虫分化新蜂后');
    }
    return this.splitColony(this.run.regionId, 'local', preview.total);
  }

  /**
   * 种区分蜂（远征副本）：出发地蜂群数量达到门槛、且蜂群发展条件全部满足后，新蜂后带领一半蜂群前往新种区。
   * 传入当前种区则按原地分蜂处理。
   */
  swarm(nextRegion: string): CmdResult {
    if (nextRegion === this.run.regionId) return this.swarmLocal();
    const region = this.w.cfg.regions.find((r) => r.id === nextRegion);
    if (region === undefined) return CmdResult.fail('PROG_REGION', '未知的种区');
    const preview = this.prog.swarmPreview(nextRegion);
    if (!preview.ready) {
      const gate = preview.conditions.find((c) => c.id === 'colonies');
      if (gate !== undefined && !gate.met) {
        return CmdResult.fail('PROG_SWARM_GATE', `去${region.name}之前，${this.w.region().name}要先有 ${gate.target} 个蜂群（现在 ${gate.current} 个）：先原地分蜂`);
      }
      return CmdResult.fail('PROG_SWARM', '分蜂条件尚未满足');
    }
    return this.splitColony(nextRegion, 'zone', preview.total);
  }

  /**
   * 分蜂事务（需求书8.3）：检查 → 快照 → 结算 → 新蜂群 → 应用天赋 → 保存。
   * 任一步失败恢复快照，禁止“资源已清除但新蜂群未建立”。
   */
  private splitColony(nextRegion: string, kind: string, points: number): CmdResult {
    const snapshot = cloneState(this.w.s);
    const parentRun = this.w.s.run;
    this.onBeforeSwarm(snapshot);
    try {
      const meta = this.w.s.meta;
      const parentId = this.w.s.activeColonyId;
      const parentName = this.colonyName(parentId, parentRun.regionId);
      if (meta.colonyNames === undefined) meta.colonyNames = {};
      meta.colonyNames[parentId] = parentName;
      this.prog.applySwarmToMeta(points, nextRegion, kind);
      // 新蜂后带走一半幼虫、成年蜂和当前库存；旧蜂群保留另一半与原有建设。
      const carriedRes: Record<string, BigNum> = {};
      const carriedOverflow: Record<string, BigNum> = {};
      ALL_RES.forEach((res: string) => {
        carriedRes[res] = parentRun.res[res].mulN(0.5);
        parentRun.res[res] = parentRun.res[res].sub(carriedRes[res]).clamp0();
        carriedOverflow[res] = parentRun.overflow[res].mulN(0.5);
        parentRun.overflow[res] = parentRun.overflow[res].sub(carriedOverflow[res]).clamp0();
      });
      const carriedRoles: Record<string, number> = {};
      const carriedInjured: Record<string, number> = {};
      ALL_ROLES.forEach((role: string) => {
        carriedRoles[role] = Math.floor(parentRun.colony.roles[role] * 0.5);
        parentRun.colony.roles[role] -= carriedRoles[role];
        carriedInjured[role] = Math.min(carriedRoles[role], Math.floor(parentRun.colony.injured[role] * 0.5));
        parentRun.colony.injured[role] -= carriedInjured[role];
      });
      // 名册：明星蜂优先跟随新蜂后，其余按名字隔一只带走一只
      const rosterSplit = this.roster.split(parentRun.colony.roster ?? [], carriedRoles);
      parentRun.colony.roster = rosterSplit.stay;
      const carriedLarvae = Math.floor(parentRun.colony.larvae * 0.5);
      parentRun.colony.larvae -= carriedLarvae;
      parentRun.colony.plan.larvae = Math.min(parentRun.colony.plan.larvae, parentRun.colony.larvae);
      const carriedBatches: LarvaBatch[] = [];
      parentRun.colony.batches.forEach((batch: LarvaBatch) => {
        const count = Math.floor(batch.count * 0.5);
        if (count <= 0) return;
        batch.count -= count;
        carriedBatches.push({
          ...batch, batchId: carriedBatches.length + 1, count,
          startAt: Math.max(0, batch.startAt - parentRun.time),
          finishAt: Math.max(0, batch.finishAt - parentRun.time)
        });
      });
      parentRun.colony.batches = parentRun.colony.batches.filter((batch: LarvaBatch) => batch.count > 0);
      parentRun.colony.youngQueens = Math.max(0, parentRun.colony.youngQueens - 1);
      // 分蜂给原蜂巢减了压：如果已经扩建到上限，重新计算承重期限
      parentRun.hive.fullAt = 0;
      parentRun.hive.fallAt = 0;
      const newId = `colony-${meta.swarmCount}`;
      this.w.refreshFlags();
      this.w.attrs.recompute();
      // “随行幼虫”天赋只在远征新种区时生效
      const startLarvae = kind === 'zone' ? Math.floor(this.w.attrs.get('start.larvae')) : 0;
      const seed = hashSeed(`${meta.playerId}:${meta.swarmCount}:${nextRegion}`);
      const generation = kind === 'zone' ? parentRun.regionIndex + 1 : parentRun.regionIndex;
      const run = createRun(this.w.cfg, nextRegion, generation, seed, startLarvae);
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
      if (kind === 'local') this.settleDaughter(parentRun, run, newId);
      else if (realmMembers(this.w.s, nextRegion).length > 0) this.placeInRealm(run, newId);
      const newName = this.nameNewColony(newId, nextRegion);
      this.w.requestName(newId);
      const now = Date.now();
      const legacy = `获得 ${points} 传承点（全巢产量永久 +${points * 2}%）`;
      if (kind === 'local') {
        // 原地分蜂：玩家留在原蜂群；新蜂巢在同一张王国地图上托管运转
        this.w.s.colonies.push({ id: newId, name: newName, run: run, lastActiveAt: now });
        refreshShares(this.w.s, nextRegion);
        this.hive.recomputeAdjacency();
        this.w.attrs.recompute();
        this.w.gainXp(40);
        this.w.msg('swarm', `原地分蜂完成！新蜂后带着一半蜂群和资源在附近建立了「${newName}」。${this.w.region().name}现在有 ${this.prog.regionColonies()} 个蜂群${points > 0 ? `，${legacy}` : ''}。它在同一张地图上托管运转，点它就能切换过去。`);
        this.w.emit('swarm', 0, 0, newName, 'any');
      } else {
        this.w.s.colonies.push({ id: parentId, name: parentName, run: parentRun, lastActiveAt: now });
        this.w.s.activeColonyId = newId;
        this.w.s.run = run;
        if (run.realm !== undefined) refreshShares(this.w.s, nextRegion);
        this.w.rng = new Rng(run.rngState);
        this.hive.reindex();
        this.w.alloc = [];
        this.w.fieldEff = {};
        this.w.refreshFlags();
        this.hive.recomputeAdjacency();
        this.w.attrs.recompute();
        this.w.gainXp(100);
        this.w.msg('swarm', `种区分蜂完成！新蜂后带领一半蜂群和资源抵达${this.w.region().name}，${legacy}。新巢成本倍率 ×${this.hive.constructionCostMul()}。`);
        this.w.emit('swarm', 0, 0, this.w.region().name, 'any');
      }
      this.saveRequested = true;
      return CmdResult.ok(points > 0 ? `获得 ${points} 传承点` : (kind === 'local' ? '原地分蜂完成' : '分蜂完成'));
    } catch (e) {
      // 回滚：恢复分蜂前状态
      const restored = cloneState(snapshot);
      this.w.s.meta = restored.meta;
      this.w.s.run = restored.run;
      this.w.s.colonies = restored.colonies;
      this.w.s.activeColonyId = restored.activeColonyId;
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
    this.w.offline = this.w.background;
    this.w.interactive = !this.w.background;
    this.w.econ.tick(0, true);
    const gains: Record<string, string> = {};
    ALL_RES.forEach((r: string) => {
      gains[r] = this.w.econ.amount(r).sub(before[r]).serialize();
    });
    const notes: string[] = [];
    if (this.seasonLog.indexOf(SeasonId.Winter) >= 0) {
      notes.push('离线期间经历了冬季，越冬储备已按当前门槛结算');
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
