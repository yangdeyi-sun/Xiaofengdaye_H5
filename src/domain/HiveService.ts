import { BigNum } from '../common/BigNum';
import { Bld, BuildingDef, CostDef, KeyLevelDef, Reason, Res, UpgradeTrackDef } from './Types';
import { HexCell, HiveState } from './State';
import { CmdResult, CostAmount, World, softExponent } from './World';

const DIRS_Q: number[] = [1, 1, 0, -1, -1, 0];
const DIRS_R: number[] = [0, -1, -1, 0, 1, 1];

export function hexId(q: number, r: number): string {
  return `${q},${r}`;
}

export function hexRing(q: number, r: number): number {
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
}

/** 生成到 maxRing 的全部格子（HIVE-001：坐标、占用和邻接关系可重建） */
export function buildHive(maxRing: number): HiveState {
  const cells: HexCell[] = [];
  const center: HexCell = { cellId: hexId(0, 0), q: 0, r: 0, ring: 0, unlocked: true, building: Bld.Queen };
  cells.push(center);
  for (let k = 1; k <= maxRing; k++) {
    let q = DIRS_Q[4] * k;
    let r = DIRS_R[4] * k;
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < k; j++) {
        const cell: HexCell = { cellId: hexId(q, r), q: q, r: r, ring: k, unlocked: k <= 1, building: '' };
        cells.push(cell);
        q += DIRS_Q[i];
        r += DIRS_R[i];
      }
    }
  }
  const hive: HiveState = { ringLevel: 1, cells: cells, expansions: 0, fullAt: 0, fallAt: 0 };
  return hive;
}

/** 第 gen 代、难度 difficulty 的种区：建造、扩建、升级与研究成本倍率 */
export function costMulFor(gen: number, difficulty: number): number {
  const g = Math.max(0, Math.min(60, gen));
  return Math.round((1 + 0.6 * g) * (1 + 0.35 * Math.max(0, difficulty)) * 100) / 100;
}

export class HiveService {
  private w: World;
  private index: Map<string, HexCell> = new Map<string, HexCell>();

  constructor(w: World) {
    this.w = w;
    this.reindex();
  }

  reindex(): void {
    this.index.clear();
    this.w.s.run.hive.cells.forEach((c: HexCell) => {
      this.index.set(c.cellId, c);
    });
  }

  cell(id: string): HexCell | null {
    const c = this.index.get(id);
    return c === undefined ? null : c;
  }

  neighbors(c: HexCell): HexCell[] {
    const out: HexCell[] = [];
    for (let i = 0; i < 6; i++) {
      const n = this.index.get(hexId(c.q + DIRS_Q[i], c.r + DIRS_R[i]));
      if (n !== undefined) {
        out.push(n);
      }
    }
    return out;
  }

  /** 可扩建：未解锁、与已解锁格子相邻、在种区圈层上限内 */
  canExpandCell(c: HexCell): boolean {
    if (c.unlocked || c.ring > this.w.region().maxRing) {
      return false;
    }
    return this.neighbors(c).some((n: HexCell) => n.unlocked);
  }

  expandCost(c: HexCell): CostAmount[] {
    const e = this.w.cfg.economy;
    const ringPow = Math.pow(e.expandRingGrowth, Math.max(0, c.ring - 2));
    const v = e.expandBaseWax * ringPow * Math.pow(e.expandCellGrowth,
      softExponent(this.w.s.run.hive.expansions, 12)) *
      this.w.attrs.get('expand.costMul') * this.constructionCostMul();
    return [new CostAmount(Res.Wax, BigNum.of(Math.ceil(v)))];
  }

  buildCost(type: string): CostAmount[] {
    const def = this.w.bldDef(type);
    return this.w.econ.costOf(def.costs, this.w.count(type), this.constructionCostMul(), 4);
  }

  /** 新巢建设成本倍率：随代数缓慢上升，并按种区难度加价（难的种区传承点也更多） */
  constructionCostMul(): number {
    return costMulFor(this.w.s.run.regionIndex, this.w.region().difficulty);
  }

  isAtCapacity(): boolean {
    return this.w.s.run.hive.ringLevel >= this.w.region().maxRing;
  }

  /** 首次达到上限时确定掉落期限，并只提醒一次。 */
  ensureFallDeadline(): boolean {
    const hive = this.w.s.run.hive;
    if (!this.isAtCapacity() || hive.fallAt > 0) return false;
    const cycle = this.w.cfg.seasons
      .filter((season) => season.id !== 'tutorial')
      .reduce((sum, season) => sum + this.w.seasonDuration(season.id), 0);
    hive.fullAt = this.w.s.run.time;
    hive.fallAt = hive.fullAt + Math.max(60, cycle) * this.w.rng.range(1, 2);
    this.w.msg('warn', '蜂巢已经扩建到上限！请在两个四季轮回内完成分蜂；最早一个轮回后可能掉落。');
    this.w.emit('milestone', 0, 0, '蜂巢达到上限', 'hive');
    return true;
  }

  fallRemaining(): number {
    const fallAt = this.w.s.run.hive.fallAt;
    return fallAt > 0 ? Math.max(0, fallAt - this.w.s.run.time) : 0;
  }

  buildingAvailable(type: string): boolean {
    const def = this.w.bldDef(type);
    if (type === Bld.Queen) {
      return false;
    }
    return this.w.unlocked(def.unlockTask) && this.w.count(type) < def.maxCount;
  }

  build(cellId: string, type: string): CmdResult {
    const c = this.cell(cellId);
    if (c === null || !c.unlocked) {
      return CmdResult.fail('HIVE_CELL', '这个格子还没有扩建');
    }
    if (c.building.length > 0) {
      return CmdResult.fail('HIVE_OCCUPIED', '格子已被占用');
    }
    const def = this.w.bldDef(type);
    if (!this.buildingAvailable(type)) {
      return CmdResult.fail('HIVE_LOCKED', `${def.name}尚未解锁或已达上限`);
    }
    const cost = this.buildCost(type);
    if (!this.w.econ.spend(cost, Reason.Build, `${type}@${cellId}`)) {
      return CmdResult.fail('ECON_SHORT', '资源不足');
    }
    c.building = type;
    this.recomputeAdjacency();
    this.w.msg('build', `建成${def.name}`);
    this.w.emit('build', c.q, c.r, def.name, 'hive');
    this.w.dailyBump('build', 1);
    return CmdResult.ok(`建成${def.name}`);
  }

  expand(cellId: string): CmdResult {
    const c = this.cell(cellId);
    if (c === null) {
      return CmdResult.fail('HIVE_CELL', '格子不存在');
    }
    if (!this.w.unlocked('t_build_storage')) {
      return CmdResult.fail('HIVE_LOCKED', '建成储蜜格后才能扩建');
    }
    if (!this.canExpandCell(c)) {
      return CmdResult.fail('HIVE_EXPAND', c.ring > this.w.region().maxRing ? '已达本种区蜂巢上限' : '只能扩建与蜂巢相邻的格子');
    }
    const cost = this.expandCost(c);
    if (!this.w.econ.spend(cost, Reason.Expand, cellId)) {
      return CmdResult.fail('ECON_SHORT', '蜂蜡不足');
    }
    c.unlocked = true;
    this.w.s.run.hive.expansions += 1;
    if (c.ring > this.w.s.run.hive.ringLevel) {
      this.w.s.run.hive.ringLevel = c.ring;
    }
    if (this.w.s.run.stats.firstExpandAt < 0) {
      this.w.s.run.stats.firstExpandAt = this.w.s.run.time;
    }
    this.recomputeAdjacency();
    this.w.emit('expand', c.q, c.r, '扩建', 'hive');
    this.w.dailyBump('build', 1);
    this.ensureFallDeadline();
    return CmdResult.ok('扩建成功');
  }

  /** 拆除不返还资源；蜂后室不可拆 */
  demolish(cellId: string): CmdResult {
    const c = this.cell(cellId);
    if (c === null || c.building.length === 0 || c.building === Bld.Queen) {
      return CmdResult.fail('HIVE_CELL', '无法拆除');
    }
    const type = c.building;
    if (this.w.count(type) <= 1 && (type === Bld.ScoutRoom || type === Bld.ForagerRoom || type === Bld.Brewery ||
      type === Bld.GuardRoom || type === Bld.Evolution)) {
      return CmdResult.fail('HIVE_REQUIRED', '这是该工种唯一的巢房，不能拆除');
    }
    c.building = '';
    this.recomputeAdjacency();
    return CmdResult.ok('已拆除');
  }

  /** 在两个已解锁巢格之间交换建筑；空格也可作为目标，用于无损调整布局。 */
  swapCells(fromId: string, toId: string): CmdResult {
    const from = this.cell(fromId);
    const to = this.cell(toId);
    if (from === null || to === null || !from.unlocked || !to.unlocked) {
      return CmdResult.fail('HIVE_CELL', '只能在已经扩建好的格子之间换位');
    }
    if (from.cellId === to.cellId) return CmdResult.fail('HIVE_CELL', '请选择另一个格子');
    const building = from.building;
    from.building = to.building;
    to.building = building;
    this.recomputeAdjacency();
    this.w.emit('build', to.q, to.r, '布局已调整', 'hive');
    return CmdResult.ok(to.building.length > 0 && from.building.length > 0 ? '两个巢房已换位' : '巢房已移动');
  }

  trackLevel(id: string): number {
    const v = this.w.s.run.upgrades[id];
    return v === undefined ? 0 : v;
  }

  upgradeCost(t: UpgradeTrackDef): CostAmount[] {
    return this.w.econ.costOf(t.costs, this.trackLevel(t.id), this.constructionCostMul(), 10);
  }

  upgrade(trackId: string): CmdResult {
    const t = this.w.track(trackId);
    if (t === null) {
      return CmdResult.fail('HIVE_TRACK', '未知升级');
    }
    if (this.w.count(t.building) <= 0) {
      return CmdResult.fail('HIVE_LOCKED', `需要先建造${this.w.bldDef(t.building).name}`);
    }
    const lv = this.trackLevel(t.id);
    if (lv >= t.maxLevel) {
      return CmdResult.fail('HIVE_MAX', '已达最高等级');
    }
    const needWax = t.costs.some((c: CostDef) => c.res === Res.Wax);
    if (needWax && !this.w.unlocked('t_build_storage')) {
      return CmdResult.fail('HIVE_LOCKED', '需要先解锁蜂蜡');
    }
    if (!this.w.econ.spend(this.upgradeCost(t), Reason.Upgrade, t.id)) {
      return CmdResult.fail('ECON_SHORT', '资源不足');
    }
    this.w.s.run.upgrades[t.id] = lv + 1;
    this.w.refreshFlags();
    this.w.attrs.recompute();
    t.keyLevels.forEach((k: KeyLevelDef) => {
      if (k.level === lv + 1) {
        this.w.msg('key', `关键升级：${k.desc}`);
      }
    });
    this.w.emit('upgrade', 0, 0, `${t.name} Lv${lv + 1}`, 'hive');
    this.w.dailyBump('upgrade', 1);
    return CmdResult.ok(`${t.name}升到 ${lv + 1} 级`);
  }

  totalUpgradeLevels(): number {
    let n = 0;
    Object.keys(this.w.s.run.upgrades).forEach((k: string) => {
      n += this.w.s.run.upgrades[k];
    });
    return n;
  }

  /** 相邻加成（HIVE-003），结果写入 World.adj 供属性聚合使用 */
  recomputeAdjacency(): void {
    const adj: Record<string, number> = {};
    let nurseryNearQueen = 0;
    let brewStorePairs = 0;
    let storePairs = 0;
    let outerStorage = 0;
    let guardOuter = false;
    let evoCenter = false;
    const maxRing = this.w.s.run.hive.ringLevel;
    this.w.s.run.hive.cells.forEach((c: HexCell) => {
      if (!c.unlocked || c.building.length === 0) {
        return;
      }
      const ns = this.neighbors(c);
      if (c.building === Bld.Nursery && ns.some((n: HexCell) => n.building === Bld.Queen)) {
        nurseryNearQueen++;
      }
      if (c.building === Bld.Brewery) {
        brewStorePairs += Math.min(2, ns.filter((n: HexCell) => n.building === Bld.Storage).length);
      }
      if (c.building === Bld.Storage) {
        storePairs += ns.filter((n: HexCell) => n.building === Bld.Storage).length;
        if (c.ring === maxRing && maxRing >= 2) {
          outerStorage++;
        }
      }
      if (c.building === Bld.GuardRoom && c.ring === maxRing && maxRing >= 2) {
        guardOuter = true;
      }
      if (c.building === Bld.Evolution && c.ring <= 1) {
        evoCenter = true;
      }
    });
    adj['nursery.hatchSpeed'] = 1 + 0.2 * nurseryNearQueen;
    adj['house.brewSpeed'] = 1 + 0.1 * Math.min(8, brewStorePairs);
    adj['guard.range'] = guardOuter ? 1.25 : 1;
    adj['evolution.center'] = evoCenter ? 1.1 : 1;
    let storeMul = 1 + 0.06 * Math.min(10, storePairs / 2);
    if (this.w.hasFlag('outerStorage')) {
      storeMul += 0.05 * outerStorage;
    }
    this.w.adj = adj;
    this.w.storageAdj = storeMul;
    this.w.attrs.recompute();
  }

  /** 单个格子的加成说明（UI 显示加成来源和最终效果） */
  describeCell(c: HexCell): string[] {
    const out: string[] = [];
    if (!c.unlocked || c.building.length === 0) {
      return out;
    }
    const ns = this.neighbors(c);
    if (c.building === Bld.Nursery) {
      out.push(ns.some((n: HexCell) => n.building === Bld.Queen) ? '紧邻蜂后室：孵化速度 +20%' : '未紧邻蜂后室（移到中心旁可 +20% 孵化）');
    }
    if (c.building === Bld.Brewery) {
      const k = Math.min(2, ns.filter((n: HexCell) => n.building === Bld.Storage).length);
      out.push(k > 0 ? `相邻 ${k} 个储蜜格：加工速度 +${k * 10}%` : '未相邻储蜜格（相邻可提高加工）');
    }
    if (c.building === Bld.Storage) {
      const k = ns.filter((n: HexCell) => n.building === Bld.Storage).length;
      out.push(k > 0 ? `与 ${k} 个储蜜格相邻：共同提高总容量` : '储蜜格彼此相邻可提高总容量');
    }
    if (c.building === Bld.GuardRoom) {
      out.push(c.ring === this.w.s.run.hive.ringLevel && c.ring >= 2 ? '位于最外圈：巡逻范围 +25%' : '移到最外圈可提高巡逻范围');
    }
    if (c.building === Bld.Evolution) {
      out.push(c.ring <= 1 ? '靠近中心功能区：研究效果 +10%' : '靠近中心可提高研究效果');
    }
    return out;
  }

  /** 放置预览：把 type 放在这个空格能拿到的相邻加成（短标签，没有加成返回空） */
  previewAdjacency(c: HexCell, type: string): string {
    if (!c.unlocked || c.building.length > 0) return '';
    const ns = this.neighbors(c);
    const count = (b: string): number => ns.filter((n: HexCell) => n.building === b).length;
    const maxRing = this.w.s.run.hive.ringLevel;
    if (type === Bld.Nursery) return count(Bld.Queen) > 0 ? '孵化+20%' : '';
    if (type === Bld.Brewery) {
      const k = Math.min(2, count(Bld.Storage));
      return k > 0 ? `加工+${k * 10}%` : '';
    }
    if (type === Bld.Storage) {
      const parts: string[] = [];
      if (count(Bld.Brewery) > 0) parts.push(`加工+${Math.min(2, count(Bld.Brewery)) * 10}%`);
      if (count(Bld.Storage) > 0) parts.push('容量↑');
      return parts.join(' ');
    }
    if (type === Bld.GuardRoom) return c.ring === maxRing && c.ring >= 2 ? '巡逻+25%' : '';
    if (type === Bld.Evolution) return c.ring <= 1 ? '研究+10%' : '';
    return '';
  }

  /** 巢格长按说明：这是什么、现在的状态和相邻加成 */
  explainCell(c: HexCell): string[] {
    if (!c.unlocked) {
      if (this.canExpandCell(c)) return ['可扩建的格子', `消耗 ${Math.ceil(this.expandCost(c)[0].amount.toNumber())} 蜂蜡扩建，扩建后可以放巢房，还会提高人口上限。`];
      if (!this.w.unlocked('t_build_storage')) return ['未开放的格子', '建成第一个储蜜格后才能用蜂蜡扩建。'];
      return ['还不能扩建', c.ring > this.w.region().maxRing ? '已经到本种区的蜂巢上限。' : '只能扩建紧挨着现有蜂巢的格子，先扩建里面一圈。'];
    }
    if (c.building.length === 0) return ['空格', '可以放一个新的巢房。放置时，格子上的绿色字是放在这里能拿到的相邻加成。'];
    const def = this.w.bldDef(c.building);
    const out = [def.name, def.desc];
    if (def.adjacency.length > 0 && def.adjacency !== '无') out.push(`布局：${def.adjacency}`);
    return out.concat(this.describeCell(c));
  }

  buildingOptions(): BuildingDef[] {
    return this.w.cfg.buildings.filter((b: BuildingDef) => b.id !== Bld.Queen && this.w.unlocked(b.unlockTask));
  }
}
