import { BigNum } from '../common/BigNum';
import { AchievementDef, Bld, Reason, Res, ResearchDef, RewardDef, Role, TalentDef, TaskDef, ALL_ROLES } from './Types';
import { FlowerField, SwarmRecord, TalentPreset } from './State';
import { CmdResult, CostAmount, World } from './World';

export class SwarmCondition {
  id: string;
  label: string;
  current: number;
  target: number;
  met: boolean;

  constructor(id: string, label: string, current: number, target: number) {
    this.id = id;
    this.label = label;
    this.current = current;
    this.target = target;
    this.met = current >= target;
  }
}

export class PointSource {
  label: string;
  points: number;

  constructor(label: string, points: number) {
    this.label = label;
    this.points = points;
  }
}

export class SwarmPreview {
  conditions: SwarmCondition[] = [];
  ready: boolean = false;
  sources: PointSource[] = [];
  total: number = 0;
  resets: string[] = [];
  keeps: string[] = [];
}

export class ColonyTask {
  cycle: number;
  name: string;
  current: number;
  target: number;
  reward: RewardDef[];
  claimed: boolean;

  constructor(cycle: number, name: string, current: number, target: number, reward: RewardDef[], claimed: boolean) {
    this.cycle = cycle;
    this.name = name;
    this.current = current;
    this.target = target;
    this.reward = reward;
    this.claimed = claimed;
  }
}

/** 成长：任务、图鉴、成就、种区研究、蜂王传承、分蜂（PROG-001~010） */
export class ProgressionService {
  private w: World;
  /** 新完成的任务（供 UI 表现完成演出） */
  newlyDone: string[] = [];

  constructor(w: World) {
    this.w = w;
  }

  taskDef(id: string): TaskDef | null {
    for (let i = 0; i < this.w.cfg.tasks.length; i++) {
      if (this.w.cfg.tasks[i].id === id) {
        return this.w.cfg.tasks[i];
      }
    }
    return null;
  }

  private condition(id: string): boolean {
    const w = this.w;
    const run = w.s.run;
    switch (id) {
      case 't_first_nectar':
        return run.stats.firstNectarAt >= 0;
      case 't_first_egg':
        return run.colony.eggsLaid > 0;
      case 't_build_scout':
        return w.count(Bld.ScoutRoom) > 0;
      case 't_first_scout':
        return w.role(Role.Scout) > 0;
      case 't_first_dance':
        return run.stats.firstDanceAt >= 0;
      case 't_build_forager':
        return w.count(Bld.ForagerRoom) > 0;
      case 't_first_forager':
        return w.role(Role.Forager) > 0;
      case 't_auto_loop':
        return w.role(Role.Forager) > 0 && run.stats.deliveredNectar >= 15;
      case 't_build_storage':
        return w.count(Bld.Storage) > 0;
      case 't_first_expand':
        return run.hive.expansions > 0;
      case 't_build_brewery':
        return w.count(Bld.Brewery) > 0;
      case 't_first_house':
        return w.role(Role.House) > 0;
      case 't_first_wax':
        return run.stats.houseWaxMade > 0.5;
      case 't_build_guard':
        return w.count(Bld.GuardRoom) > 0;
      case 't_first_clear':
        return run.threats.cleared > 0;
      case 't_survive_winter':
        return run.season.wintersSurvived > 0;
      case 't_pollinate':
        return run.stats.pollinations > 0;
      case 't_build_evolution':
        return w.count(Bld.Evolution) > 0;
      case 't_first_research':
        return Object.keys(run.research).some((k: string) => run.research[k] > 0);
      case 't_pop_50':
        return w.adults() >= 50;
      case 't_rare_field':
        return run.stats.rareFound > 0;
      case 't_swarm_ready':
        return this.swarmPreview().ready;
      default:
        return false;
    }
  }

  /** 任务完成检查：每个任务每个种区只完成、只发奖一次（PROG-009） */
  checkTasks(): void {
    const run = this.w.s.run;
    this.w.cfg.tasks.forEach((t: TaskDef) => {
      if (run.tasksDone.indexOf(t.id) >= 0) {
        return;
      }
      if (!this.condition(t.id)) {
        return;
      }
      run.tasksDone.push(t.id);
      if (this.w.s.meta.featureUnlocks.indexOf(t.id) < 0) {
        this.w.s.meta.featureUnlocks.push(t.id);
      }
      this.newlyDone.push(t.id);
      this.claimTask(t.id);
      this.w.msg('task', `完成目标：${t.name}`);
      this.w.emit('task', 0, 0, t.name, 'any');
    });
  }

  claimTask(id: string): CmdResult {
    const run = this.w.s.run;
    const t = this.taskDef(id);
    if (t === null || run.tasksDone.indexOf(id) < 0) {
      return CmdResult.fail('TASK_NOT_DONE', '目标尚未完成');
    }
    if (run.tasksClaimed.indexOf(id) >= 0) {
      return CmdResult.fail('TASK_CLAIMED', '奖励已领取');
    }
    run.tasksClaimed.push(id);
    t.rewards.forEach((r: RewardDef) => {
      this.w.econ.add(r.res, BigNum.of(r.amount), Reason.Task, id);
    });
    return CmdResult.ok('已领取');
  }

  /** 蜂群任务：每轮四季一个储备目标，需要手动领取 */
  colonyTask(): ColonyTask | null {
    const run = this.w.s.run;
    if (!run.season.formal) {
      return null;
    }
    const cycle = run.season.cycleIndex;
    // 四季任务保持逐轮成长，但封顶避免后期膨胀到数万资源。
    const regionMul = 1 + run.regionIndex * 0.25;
    const target = Math.round(Math.min(5000, 400 * Math.pow(1.35, cycle)) * regionMul);
    const cur = this.w.econ.num(Res.Honey);
    const reward: RewardDef[] = [{ res: Res.Jelly, amount: 1 + Math.floor(cycle / 2) }];
    return new ColonyTask(cycle, `本轮四季储存 ${target} 蜂蜜`, cur, target, reward, run.colonyTaskCycle >= cycle);
  }

  claimColonyTask(): CmdResult {
    const ct = this.colonyTask();
    if (ct === null || ct.claimed) {
      return CmdResult.fail('TASK_CLAIMED', '本轮奖励已领取');
    }
    if (ct.current < ct.target) {
      return CmdResult.fail('TASK_NOT_DONE', '储备尚未达标');
    }
    this.w.s.run.colonyTaskCycle = ct.cycle;
    ct.reward.forEach((r: RewardDef) => {
      this.w.econ.add(r.res, BigNum.of(r.amount), Reason.Task, `colony${ct.cycle}`);
    });
    return CmdResult.ok('领取成功');
  }

  checkAchievements(): void {
    const meta = this.w.s.meta;
    const run = this.w.s.run;
    this.w.cfg.achievements.forEach((a: AchievementDef) => {
      if (meta.achievements.indexOf(a.id) >= 0) {
        return;
      }
      let ok = false;
      if (a.id === 'a_first_swarm') {
        ok = meta.swarmCount > 0;
      } else if (a.id === 'a_pop_200') {
        ok = this.w.adults() >= 200;
      } else if (a.id === 'a_bear') {
        ok = run.stats.bearsRepelled > 0;
      } else if (a.id === 'a_winters_5') {
        ok = meta.totalWinters >= 5;
      } else if (a.id === 'a_regions_3') {
        ok = meta.regionsVisited.length >= 3;
      } else if (a.id === 'a_codex_flowers') {
        ok = meta.codexFlowers.length >= 8;
      }
      if (ok) {
        meta.achievements.push(a.id);
        if (a.skin.length > 0 && meta.skins.indexOf(a.skin) < 0) {
          meta.skins.push(a.skin);
        }
        this.w.msg('achievement', `成就达成：${a.name}${a.skin.length > 0 ? '（解锁蜂巢外观）' : ''}`);
      }
    });
    if (this.w.adults() > run.stats.peakPop) {
      run.stats.peakPop = this.w.adults();
    }
  }

  // ---------------- 当前种区研究（PROG-001） ----------------
  researchDef(id: string): ResearchDef | null {
    for (let i = 0; i < this.w.cfg.research.length; i++) {
      if (this.w.cfg.research[i].id === id) {
        return this.w.cfg.research[i];
      }
    }
    return null;
  }

  researchLevel(id: string): number {
    const v = this.w.s.run.research[id];
    return v === undefined ? 0 : v;
  }

  researchCost(r: ResearchDef): CostAmount[] {
    return this.w.econ.costOf(r.costs, this.researchLevel(r.id), 1);
  }

  research(id: string): CmdResult {
    const r = this.researchDef(id);
    if (r === null) {
      return CmdResult.fail('PROG_UNKNOWN', '未知研究');
    }
    if (this.w.count(Bld.Evolution) <= 0) {
      return CmdResult.fail('HIVE_LOCKED', '需要先建造进化腔');
    }
    const lv = this.researchLevel(id);
    if (lv >= r.maxLevel) {
      return CmdResult.fail('PROG_MAX', '已达最高等级');
    }
    if (!this.w.econ.spend(this.researchCost(r), Reason.Research, id)) {
      return CmdResult.fail('ECON_SHORT', '资源不足');
    }
    this.w.s.run.research[id] = lv + 1;
    this.w.attrs.recompute();
    this.w.emit('upgrade', 0, 0, `${r.name} Lv${lv + 1}`, 'hive');
    return CmdResult.ok(`${r.name}完成 Lv${lv + 1}`);
  }

  // ---------------- 蜂王传承（PROG-006/007） ----------------
  talentDef(id: string): TalentDef | null {
    for (let i = 0; i < this.w.cfg.talents.length; i++) {
      if (this.w.cfg.talents[i].id === id) {
        return this.w.cfg.talents[i];
      }
    }
    return null;
  }

  talentLevel(id: string): number {
    const v = this.w.s.meta.inheritance.nodes[id];
    return v === undefined ? 0 : v;
  }

  branchPoints(branch: string): number {
    let n = 0;
    this.w.cfg.talents.forEach((t: TalentDef) => {
      if (t.branch === branch) {
        n += this.talentLevel(t.id) * t.costPerLevel;
      }
    });
    return n;
  }

  talentLockReason(t: TalentDef): string {
    if (this.branchPoints(t.branch) < t.branchPointsRequired) {
      return `本系投入 ${t.branchPointsRequired} 点后开放`;
    }
    if (t.requires.length > 0 && this.talentLevel(t.requires) <= 0) {
      const req = this.talentDef(t.requires);
      return `需要先学习「${req === null ? t.requires : req.name}」`;
    }
    return '';
  }

  investTalent(id: string): CmdResult {
    const inh = this.w.s.meta.inheritance;
    const t = this.talentDef(id);
    if (t === null) {
      return CmdResult.fail('PROG_UNKNOWN', '未知天赋');
    }
    if (!inh.unlocked) {
      return CmdResult.fail('PROG_LOCKED', '第一次分蜂后开放蜂王传承');
    }
    const lv = this.talentLevel(id);
    if (lv >= t.maxLevel) {
      return CmdResult.fail('PROG_MAX', '已满级');
    }
    const lock = this.talentLockReason(t);
    if (lock.length > 0) {
      return CmdResult.fail('PROG_PREREQ', lock);
    }
    if (inh.available < t.costPerLevel) {
      return CmdResult.fail('PROG_POINTS', '传承点不足');
    }
    inh.available -= t.costPerLevel;
    inh.nodes[id] = lv + 1;
    this.w.refreshFlags();
    this.w.attrs.recompute();
    return CmdResult.ok(`${t.name} Lv${lv + 1}`);
  }

  resetCost(): number {
    return this.w.s.meta.inheritance.resets === 0 ? 0 : 3;
  }

  /** 重置不会丢失已获得总点数（PROG-007） */
  resetTalents(): CmdResult {
    const inh = this.w.s.meta.inheritance;
    const cost = this.resetCost();
    if (cost > 0) {
      const c: CostAmount[] = [new CostAmount(Res.Jelly, BigNum.of(cost))];
      if (!this.w.econ.spend(c, Reason.Talent, 'reset')) {
        return CmdResult.fail('ECON_SHORT', `重置需要 ${cost} 蜂王浆`);
      }
    }
    inh.nodes = {};
    inh.available = inh.totalPoints;
    inh.resets += 1;
    this.w.refreshFlags();
    this.w.attrs.recompute();
    return CmdResult.ok('传承点已全部返还');
  }

  savePreset(slot: number, name: string): CmdResult {
    const inh = this.w.s.meta.inheritance;
    if (slot < 0 || slot > 2) {
      return CmdResult.fail('PROG_SLOT', '无效的预设');
    }
    const nodes: Record<string, number> = {};
    Object.keys(inh.nodes).forEach((k: string) => {
      nodes[k] = inh.nodes[k];
    });
    const p: TalentPreset = { name: name, nodes: nodes };
    while (inh.presets.length <= slot) {
      const empty: TalentPreset = { name: '', nodes: {} };
      inh.presets.push(empty);
    }
    inh.presets[slot] = p;
    return CmdResult.ok(`已保存到预设 ${slot + 1}`);
  }

  /** 载入预设：按前置顺序重新投入，点数不足时停在可负担处 */
  loadPreset(slot: number): CmdResult {
    const inh = this.w.s.meta.inheritance;
    const p = inh.presets[slot];
    if (p === undefined || Object.keys(p.nodes).length === 0) {
      return CmdResult.fail('PROG_SLOT', '预设为空');
    }
    inh.nodes = {};
    inh.available = inh.totalPoints;
    let progress = true;
    let guard = 0;
    while (progress && guard < 200) {
      guard++;
      progress = false;
      this.w.cfg.talents.forEach((t: TalentDef) => {
        const want = p.nodes[t.id] === undefined ? 0 : p.nodes[t.id];
        if (this.talentLevel(t.id) < want && this.talentLockReason(t).length === 0 && inh.available >= t.costPerLevel) {
          inh.available -= t.costPerLevel;
          inh.nodes[t.id] = this.talentLevel(t.id) + 1;
          progress = true;
        }
      });
    }
    this.w.refreshFlags();
    this.w.attrs.recompute();
    return CmdResult.ok(`已载入预设 ${slot + 1}`);
  }

  // ---------------- 分蜂（PROG-002~005） ----------------
  swarmPreview(): SwarmPreview {
    const w = this.w;
    const run = w.s.run;
    const meta = w.s.meta;
    const sc = w.cfg.swarm;
    const p = new SwarmPreview();
    const n = meta.swarmCount;
    const honeyTarget = Math.min(sc.honeyCap, sc.honeyBase * Math.pow(sc.honeyGrowth, n));
    let upgrades = 0;
    Object.keys(run.upgrades).forEach((k: string) => {
      upgrades += run.upgrades[k];
    });
    const discovered = run.map.fields.filter((f: FlowerField) => f.discovered && !f.home).length;
    p.conditions.push(new SwarmCondition('pop', '蜂群数量', w.adults(), sc.popBase + sc.popPerSwarm * n));
    p.conditions.push(new SwarmCondition('upgrades', '巢房升级总等级', upgrades, sc.upgradeLevels + n * 4));
    p.conditions.push(new SwarmCondition('honey', '蜂蜜储备', Math.floor(w.econ.num(Res.Honey)), Math.round(honeyTarget)));
    p.conditions.push(new SwarmCondition('jelly', '蜂王浆储备', Math.floor(w.econ.num(Res.Jelly)), sc.jelly));
    p.conditions.push(new SwarmCondition('fields', '已发现花田', discovered, sc.minFields));
    if (sc.minWinters > 0) {
      p.conditions.push(new SwarmCondition('winter', '度过冬季', run.season.wintersSurvived, sc.minWinters));
    }
    if (sc.minPollinations > 0) {
      p.conditions.push(new SwarmCondition('pollinate', '授粉成长花田', run.stats.pollinations, sc.minPollinations));
    }
    p.ready = p.conditions.every((c: SwarmCondition) => c.met);
    // 传承点：主要来自完成种区目标（设计文档10.6）
    const region = w.region();
    p.sources.push(new PointSource('种区完成基础奖励', sc.basePoints));
    let eco = 0;
    eco += Math.min(3, run.season.wintersSurvived) * 2;
    eco += run.stats.rareFound > 0 ? 2 : 0;
    eco += discovered >= run.map.fields.length - 2 ? 2 : 0;
    eco += run.threats.cleared >= 10 ? 2 : 0;
    eco += run.stats.pollinations >= 3 ? 2 : 0;
    p.sources.push(new PointSource('生态目标奖励', eco));
    p.sources.push(new PointSource(`难度奖励（${region.name}）`, region.difficulty * 2));
    const produced = run.produced[Res.Honey] === undefined ? BigNum.zero() : run.produced[Res.Honey];
    const logBonus = Math.max(0, Math.floor(produced.log10()) - 2);
    p.sources.push(new PointSource('累计产量（对数）', logBonus));
    let subtotal = 0;
    p.sources.forEach((s: PointSource) => {
      subtotal += s.points;
    });
    // 剩余资源折算：最高占本次结算 20%（PROG-005）
    const raw = Math.floor(Math.pow(Math.max(0, w.econ.num(Res.Honey)), 0.25) / 4);
    const capRes = Math.floor(subtotal * sc.resourceBonusCap / (1 - sc.resourceBonusCap));
    p.sources.push(new PointSource('剩余资源折算（上限20%）', Math.min(raw, capRes)));
    let total = 0;
    p.sources.forEach((s: PointSource) => {
      total += s.points;
    });
    p.total = total;
    p.resets = ['普通资源库存（花蜜、蜂蜜、蜂蜡、蜂王浆）', '当前蜂群与幼虫', '巢房建筑与属性等级', '当前种区研究',
      '花田探索与季节状态'];
    p.keeps = ['蜂王传承点与天赋', '花种与敌害图鉴', '成就、蜂巢外观与历史记录', '已完成的教学与已解锁的功能', '设置与服务卡片'];
    return p;
  }

  /** 写入分蜂结算到 meta（创建新种区由 Engine 完成） */
  applySwarmToMeta(points: number, nextRegion: string): void {
    const meta = this.w.s.meta;
    const run = this.w.s.run;
    const rec: SwarmRecord = {
      regionId: run.regionId, points: points, playTime: Math.round(run.time), peakPop: run.stats.peakPop,
      endedAt: Math.round(meta.totalPlayTime)
    };
    meta.history.push(rec);
    meta.swarmCount += 1;
    meta.inheritance.totalPoints += points;
    meta.inheritance.available += points;
    meta.inheritance.unlocked = true;
    if (meta.regionsVisited.indexOf(nextRegion) < 0) {
      meta.regionsVisited.push(nextRegion);
    }
  }

  /** 新手引导推进：每次只引入一个新概念 */
  tutorialTick(): void {
    const meta = this.w.s.meta;
    if (meta.tutorialDone) {
      return;
    }
    const steps = this.w.cfg.tutorial;
    // 从实际完成任务重算，兼容旧版本步骤顺序。
    meta.tutorialStep = 0;
    while (meta.tutorialStep < steps.length && this.w.unlocked(steps[meta.tutorialStep].doneTask)) {
      meta.tutorialStep += 1;
    }
    if (this.w.count(Bld.ScoutRoom) > 0 && this.w.role(Role.Scout) > 0) {
      meta.tutorialStep = steps.length;
      meta.tutorialDone = true;
      this.w.msg('milestone', '接下来，这个蜜蜂王国就交由你把握它的发展了！');
    }
  }

  totalRole(): number {
    let n = 0;
    ALL_ROLES.forEach((r: string) => {
      n += this.w.role(r);
    });
    return n;
  }
}
