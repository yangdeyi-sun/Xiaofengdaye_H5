import { Bld, Res, ALL_ROLES } from './Types';
import { HexCell } from './State';
import { World } from './World';
import { HiveService } from './HiveService';
import { ProgressionService } from './ProgressionService';

/**
 * 托管：不在经营的蜂巢（同一张王国地图上的其它蜂巢）自动运转，玩家不用逐个手动操作。
 * - 繁育计划常开，按原蜂巢传下来的比例自动产卵、分化；
 * - 缺关键巢房时自动建造，仓库快满时加储蜜格，蜂蜜富余时升级最便宜的属性；
 * - 蜂蜡够了且没有空格时扩建一格。
 * 玩家切换过去后恢复手动经营（繁育计划保持开启，可以自己关）。
 */
const KEY_BUILDINGS = [Bld.Brewery, Bld.ForagerRoom, Bld.ScoutRoom, Bld.Storage, Bld.Nursery, Bld.GuardRoom];

export class StewardService {
  private w: World;
  private hive: HiveService;
  private prog: ProgressionService;
  private acc: number = 0;

  constructor(w: World, hive: HiveService, prog: ProgressionService) {
    this.w = w;
    this.hive = hive;
    this.prog = prog;
  }

  tick(span: number): void {
    this.acc += span;
    if (this.acc < 15) return;
    this.acc = 0;
    const w = this.w;
    const colony = w.s.run.colony;
    if (!colony.plan.on) colony.plan.on = true;
    if (ALL_ROLES.every((r: string) => (colony.plan.weights[r] ?? 0) === 0)) colony.plan.weights.forager = 6;
    // 1. 关键巢房
    for (const b of KEY_BUILDINGS) {
      if (w.count(b) > 0 || !this.hive.buildingAvailable(b)) continue;
      if (this.tryBuild(b)) return;
    }
    // 2. 仓库快满：多一个储蜜格
    if (w.econ.fillRatio(Res.Honey) > 0.85 && this.hive.buildingAvailable(Bld.Storage) && this.tryBuild(Bld.Storage)) return;
    // 3. 育婴房随人口增加
    if (w.count(Bld.Nursery) < Math.floor(w.adults() / 20) && this.hive.buildingAvailable(Bld.Nursery) && this.tryBuild(Bld.Nursery)) return;
    // 4. 没有空格就扩建
    if (!this.emptyCell() && w.unlocked('t_build_storage')) {
      const cand = w.s.run.hive.cells.filter((c: HexCell) => this.hive.canExpandCell(c)).sort((a, b) => a.ring - b.ring)[0];
      if (cand !== undefined && w.econ.canAfford(this.hive.expandCost(cand)) && this.hive.expand(cand.cellId).ok) return;
    }
    // 5. 蜂蜜富余：升级最便宜的属性，保留四成
    const honey = w.econ.num(Res.Honey);
    let best = '';
    let bestCost = Infinity;
    w.cfg.tracks.forEach((t) => {
      if (w.count(t.building) <= 0 || this.hive.trackLevel(t.id) >= t.maxLevel) return;
      const cost = this.hive.upgradeCost(t);
      if (!w.econ.canAfford(cost)) return;
      const h = cost[0].amount.toNumber();
      if (h < bestCost && h < honey * 0.6) { bestCost = h; best = t.id; }
    });
    if (best.length > 0) this.hive.upgrade(best);
    void this.prog;
  }

  private emptyCell(): HexCell | null {
    const cells = this.w.s.run.hive.cells.filter((c: HexCell) => c.unlocked && c.building === '');
    cells.sort((a, b) => a.ring - b.ring);
    return cells[0] ?? null;
  }

  private tryBuild(type: string): boolean {
    const cell = this.emptyCell();
    if (cell === null || !this.w.econ.canAfford(this.hive.buildCost(type))) return false;
    return this.hive.build(cell.cellId, type).ok;
  }
}
