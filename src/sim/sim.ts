declare const process: { argv: string[]; exit(code: number): never };
/**
 * 无界面整局模拟（需求书十八-2：无界面运行资源链、季节和至少一次分蜂）
 * 机器人按新手玩家的合理节奏游玩，输出各里程碑时间并对照设计文档第十六章验收指标。
 */
import { DEFAULT_CONFIG } from '../domain/GameConfig';
import { createInitialState } from '../domain/NewGame';
import { GameEngine } from '../domain/GameEngine';
import { Bld, Res, Role, ThreatType } from '../domain/Types';
import { HexCell } from '../domain/State';

const argHours = Number(process.argv[2] ?? '3');
const verbose = process.argv.includes('-v');
const st = createInitialState(DEFAULT_CONFIG, 'bot', 0, 12345);
const eng = new GameEngine(DEFAULT_CONFIG, st);
const w = eng.w;

const marks: Record<string, number> = {};
function mark(k: string) {
  if (marks[k] === undefined) {
    marks[k] = eng.state.meta.totalPlayTime;
    if (verbose) console.log(`[${fmt(eng.run.time)}] ${k}  ${eng.roleSummary()} honey=${w.econ.num(Res.Honey).toFixed(0)}`);
  }
}
function fmt(t: number) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function emptyCell(preferNear: boolean): HexCell | null {
  const cells = eng.run.hive.cells.filter((c) => c.unlocked && c.building === '');
  if (cells.length === 0) return null;
  cells.sort((a, b) => preferNear ? a.ring - b.ring : b.ring - a.ring);
  return cells[0];
}

function tryBuild(type: string, near = true): boolean {
  if (!eng.hive.buildingAvailable(type)) return false;
  const cost = eng.hive.buildCost(type);
  if (!w.econ.canAfford(cost)) return false;
  const c = emptyCell(near);
  if (c === null) return false;
  return eng.build(c.cellId, type).ok;
}

function tryExpand(): boolean {
  if (!w.unlocked('t_build_storage')) return false;
  const cand = eng.run.hive.cells.filter((c) => eng.hive.canExpandCell(c));
  if (cand.length === 0) return false;
  cand.sort((a, b) => a.ring - b.ring);
  if (!w.econ.canAfford(eng.hive.expandCost(cand[0]))) return false;
  return eng.expand(cand[0].cellId).ok;
}

let clickAcc = 0;
// 点击频率倍率：SIM_TAPS=0.5 模拟每秒只点 1 次的休闲玩家
const tapScale = Number((globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env.SIM_TAPS ?? '1') || 1;
let sec = 0;
let swarmed = 0;
const maxT = argHours * 3600;
let lastLog = 0;
let pollinated = false;

while (eng.run.time < maxT) {
  eng.step(0.1);
  const t = eng.run.time;
  const fr = w.role(Role.Forager);
  // 手动点击：开局 2 次/秒，采集蜂多了就停止（自动化后手动需求下降）
  if (fr < 4) {
    clickAcc += 0.1 * (w.unlocked('t_first_scout') ? 3 : 2) * tapScale;
    while (clickAcc >= 1) {
      eng.collect('f0', 1);
      clickAcc -= 1;
    }
  }
  if (Math.round(t * 10) % 10 !== 0) continue; // 以下决策每秒一次
  sec++;

  if (w.econ.num(Res.Nectar) > 0) mark('first_nectar');
  if (eng.run.colony.eggsLaid > 0) mark('first_egg');
  if (w.count(Bld.ScoutRoom) > 0) mark('first_scout_room');
  if (w.role(Role.Scout) > 0) mark('first_scout');
  if (eng.run.stats.firstDanceAt >= 0) mark('first_dance');
  if (fr > 0) mark('first_forager');
  if (eng.run.stats.autoLoopAt >= 0) mark('auto_loop');
  if (w.count(Bld.Storage) > 0) mark('first_storage');
  if (eng.run.hive.expansions > 0) mark('first_expand');
  if (w.count(Bld.Brewery) > 0) mark('brewery');
  if (eng.run.season.season === 'winter') mark('first_winter_start');
  if (eng.run.season.wintersSurvived > 0) mark('survived_winter');
  if (w.count(Bld.Evolution) > 0) mark('evolution');
  if (eng.run.stats.pollinations > 0) mark('pollination');
  if (w.econ.num(Res.Jelly) >= 1) mark('first_jelly');

  // 产卵（自动化前手动）
  if (!eng.run.colony.autoLay && eng.run.colony.larvae < 1) eng.lay();
  // 分化
  if (!eng.run.colony.autoHatch && eng.run.colony.larvae > 0) {
    if (w.count(Bld.ScoutRoom) > 0 && w.role(Role.Scout) < 1) eng.differentiate(Role.Scout, 1);
    else if (w.count(Bld.ForagerRoom) > 0) eng.differentiate(Role.Forager, 1);
    else if (w.count(Bld.ScoutRoom) > 0 && w.role(Role.Scout) < 2) eng.differentiate(Role.Scout, 1);
  }
  // 建造顺序
  tryBuild(Bld.ScoutRoom) || tryBuild(Bld.ForagerRoom);
  if (w.count(Bld.ForagerRoom) > 0) tryBuild(Bld.Storage);
  if (w.count(Bld.Storage) > 0) {
    tryBuild(Bld.Brewery) || tryBuild(Bld.Nursery) || tryBuild(Bld.GuardRoom) || tryBuild(Bld.Evolution, true);
    if (w.count(Bld.Storage) < 2 + Math.floor(w.adults() / 25)) tryBuild(Bld.Storage);
    if (!emptyCell(true) || eng.run.hive.expansions === 0) tryExpand();
  }
  if (w.count(Bld.Brewery) > 0) eng.setWaxShare(0.3);
  // 升级：最便宜的可负担项，保留一部分蜂蜜
  // 跟随引导的玩家：优先攒钱建关键巢房
  const keyNeeded = [Bld.Storage, Bld.Brewery, Bld.Nursery, Bld.GuardRoom, Bld.Evolution]
    .find((b) => w.count(b) === 0 && eng.hive.buildingAvailable(b));
  const savingFor = keyNeeded ? eng.hive.buildCost(keyNeeded)[0].amount.toNumber() : 0;
  if (sec % 5 === 0 && w.unlocked('t_first_forager') && w.econ.num(Res.Honey) > savingFor * 1.5) {
    let best: string | null = null;
    let bestCost = Infinity;
    for (const tr of w.cfg.tracks) {
      if (w.count(tr.building) <= 0) continue;
      const lv = eng.hive.trackLevel(tr.id);
      if (lv >= tr.maxLevel) continue;
      const cost = eng.hive.upgradeCost(tr);
      if (!w.econ.canAfford(cost)) continue;
      const h = cost[0].amount.toNumber();
      if (h < bestCost && h < w.econ.num(Res.Honey) * 0.5) { bestCost = h; best = tr.id; }
    }
    if (best) eng.upgrade(best);
    for (const r of w.cfg.research) {
      if (eng.research(r.id).ok) break;
    }
  }
  // 授粉
  if (!pollinated && w.unlocked('t_build_storage') && fr >= 6) {
    const f = eng.run.map.fields.find((x) => x.discovered && !x.home) ?? eng.run.map.fields[0];
    eng.setPollinators(f.fieldId, 3);
    pollinated = true;
  }
  // 熊：防守
  const bear = eng.threats.pendingBear();
  if (bear && bear.phase === 'warning') eng.bearChoice(bear.eventId, 'defend');
  // 分蜂
  const pv = eng.swarmPreview();
  if (pv.ready) {
    const r = eng.swarm(swarmed === 0 ? 'alpine' : 'meadow');
    if (r.ok) {
      swarmed++;
      mark(`swarm_${swarmed}`);
      pollinated = false;
      if (swarmed === 1) {
        // 传承：优先生产系
        for (let i = 0; i < 20; i++) {
          if (!eng.investTalent('p_carry').ok && !eng.investTalent('b_lay').ok && !eng.investTalent('e_range').ok) break;
        }
      }
    }
  }
  if (verbose && t - lastLog >= 600) {
    lastLog = t;
    console.log(`[${fmt(t)}] ${eng.run.regionId} season=${eng.run.season.season} adults=${w.adults()} cap=${w.popCap()} ` +
      `honey=${w.econ.num(Res.Honey).toFixed(0)}/${w.econ.capacity(Res.Honey).toNumber().toFixed(0)} ` +
      `wax=${w.econ.num(Res.Wax).toFixed(0)} jelly=${w.econ.num(Res.Jelly).toFixed(1)} ` +
      `nectar=${eng.rateView.nectarIn.toFixed(2)}/s honey=${eng.rateView.honeyIn.toFixed(2)}/s ` +
      `fields=${eng.run.map.fields.filter((f) => f.discovered).length} threats=${eng.threats.activeList().length} ` +
      `ups=${eng.hive.totalUpgradeLevels()} ${eng.roleSummary()}`);
  }
}

// ---------- 验收 ----------
interface Check { name: string; key: string; min: number; max: number; }
const checks: Check[] = [
  { name: '第一次获得资源 ≤30秒', key: 'first_nectar', min: 0, max: 30 },
  { name: '第一次产卵 ≤2分钟', key: 'first_egg', min: 0, max: 120 },
  // 0.3 新手节奏：储蜜格从约 19 分钟提前到 4~8 分钟（休闲玩家 SIM_TAPS=0.25 约 7.5 分钟）
  { name: '首个侦察蜂室 ≤1.5分钟', key: 'first_scout_room', min: 0, max: 90 },
  { name: '第一只侦察蜂 ≤2.5分钟', key: 'first_scout', min: 0, max: 150 },
  { name: '第一只采集蜂 2~6分钟', key: 'first_forager', min: 120, max: 360 },
  { name: '基础自动循环 ≤8分钟', key: 'auto_loop', min: 0, max: 480 },
  { name: '第一个储蜜格 3~9分钟', key: 'first_storage', min: 180, max: 540 },
  { name: '第一次扩建 ≤15分钟', key: 'first_expand', min: 0, max: 900 },
  { name: '首个冬季在20分钟后', key: 'first_winter_start', min: 1200, max: 1e9 },
  { name: '度过冬季', key: 'survived_winter', min: 0, max: 1e9 },
  { name: '完成首次分蜂', key: 'swarm_1', min: 0, max: 1e9 },
];
let fail = 0;
console.log('\n里程碑（游戏时间）');
for (const k of Object.keys(marks)) console.log(`  ${k.padEnd(20)} ${fmt(marks[k])}`);
console.log('\n验收');
for (const c of checks) {
  const v = marks[c.key];
  const ok = v !== undefined && v >= c.min && v <= c.max;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.name}  -> ${v === undefined ? '未达成' : fmt(v)}`);
}
// 不变量
const negatives = Object.keys(eng.run.res).filter((k) => eng.run.res[k].isNegative());
console.log(`  ${negatives.length === 0 ? 'PASS' : 'FAIL'}  资源非负`);
console.log(`  ${w.population() <= w.popCap() + 2 ? 'PASS' : 'FAIL'}  人口不超上限 (${w.population()}/${w.popCap()})`);
console.log(`  ledger=${eng.state.ledger.length} messages=${eng.state.messages.length} swarms=${swarmed} region=${eng.run.regionId}`);
if (negatives.length) fail++;
void ThreatType;
process.exit(fail > 0 ? 1 : 0);
