import { Rng, hashSeed } from '../common/Rng';
import { generateFields } from './NewGame';
import { FlowerField, GameState, RealmField, RealmMap, RunRealm, RunState } from './State';
import { GameConfigDef, RegionDef } from './Types';

/**
 * 王国地图：同一种区的蜂巢在同一张地图上。
 *
 * - 每个蜂巢有自己的位置和一块不规则的领地；只采自己领地里的花田。
 * - 花田共用：重叠区的花田两边的蜂巢都能采，恢复量按 1/n 分给每个蜂巢（产量平分）。
 * - 蜂巢之间不能靠得太近（最小距离），领地可以重叠。
 *
 * 实现：每个蜂巢的 run.map.fields 仍是“以自己蜂箱为原点”的花田副本（原有采集、侦察、绘制逻辑都不用改），
 * 世界里的真实花田保存在 meta.realms[种区]；每帧把各副本的存量、授粉成长差值合并回世界花田，再同步给所有副本。
 */

/** 一个种区里的蜂群（当前经营的 + 其它） */
export interface RealmMember {
  id: string;
  run: RunState;
  active: boolean;
}

export class RealmHiveView {
  id: string = '';
  name: string = '';
  /** 相对当前蜂巢的坐标 */
  x: number = 0;
  y: number = 0;
  daughter: boolean = false;
  active: boolean = false;
  adults: number = 0;
  /** 领地轮廓（相对当前蜂巢坐标） */
  outline: number[][] = [];
}

export class RealmView {
  hives: RealmHiveView[] = [];
  /** 不在当前蜂巢领地里的花田（相对坐标，只画出来，不能采） */
  foreign: Array<{ x: number; y: number; flower: string; stock: number; level: number }> = [];
}

/** 蜂巢之间的最小距离（占种区花田半径的比例） */
export const REALM_MIN_GAP = 0.42;

export function regionOf(cfg: GameConfigDef, id: string): RegionDef {
  return cfg.regions.find((r: RegionDef) => r.id === id) ?? cfg.regions[0];
}

export function realmMembers(s: GameState, regionId: string): RealmMember[] {
  const out: RealmMember[] = [];
  if (s.run.regionId === regionId) out.push({ id: s.activeColonyId, run: s.run, active: true });
  s.colonies.forEach((slot) => { if (slot.run.regionId === regionId) out.push({ id: slot.id, run: slot.run, active: false }); });
  return out;
}

export function realmPos(run: RunState): { x: number; y: number } {
  return run.realm === undefined ? { x: 0, y: 0 } : { x: run.realm.x, y: run.realm.y };
}

/** 领地半径（随角度起伏，形成不规则的色块） */
export function territoryRadius(realm: RunRealm, angle: number): number {
  const a = (realm.seed % 628) / 100;
  const b = (Math.floor(realm.seed / 7) % 628) / 100;
  return realm.r * (1 + 0.14 * Math.sin(3 * angle + a) + 0.08 * Math.sin(5 * angle + b) + 0.05 * Math.sin(2 * angle + a + b));
}

export function insideTerritory(realm: RunRealm, x: number, y: number): boolean {
  const dx = x - realm.x;
  const dy = y - realm.y;
  return Math.hypot(dx, dy) <= territoryRadius(realm, Math.atan2(dy, dx));
}

export function territoryOutline(realm: RunRealm, ox: number, oy: number, steps: number = 48): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i < steps; i++) {
    const a = i / steps * Math.PI * 2;
    const r = territoryRadius(realm, a);
    pts.push([realm.x + Math.cos(a) * r - ox, realm.y + Math.sin(a) * r - oy]);
  }
  return pts;
}

/** 给还没有领地数据的蜂巢补上：原始蜂巢在世界原点，覆盖整个种区花田半径 */
function ensureRunRealm(run: RunState, region: RegionDef, daughter: boolean, x: number, y: number): RunRealm {
  if (run.realm === undefined) {
    run.realm = { x, y, daughter, r: region.maxRadius * (daughter ? 0.78 : 1.08), seed: (run.seed >>> 0) % 100000 };
  }
  return run.realm;
}

function copyDanger(region: RegionDef, d: number, rare: boolean): number {
  return rare ? Math.min(0.85, 0.2 + 0.5 * d / region.maxRadius) : Math.min(0.8, 0.04 + 0.6 * Math.pow(d / region.maxRadius, 1.6));
}

/**
 * 确保种区有王国地图：第一次需要时，以原始蜂巢的花田为世界花田建立。
 * 旧存档里同一种区已经有多个各自独立地图的蜂巢时，把它们摆到不重叠的位置，花田并入世界。
 */
export function ensureRealm(s: GameState, cfg: GameConfigDef, regionId: string): RealmMap {
  const meta = s.meta;
  if (meta.realms === undefined) meta.realms = {};
  const region = regionOf(cfg, regionId);
  let realm = meta.realms[regionId];
  if (realm !== undefined) return realm;
  realm = { fields: [], nextId: 1 };
  meta.realms[regionId] = realm;
  const members = realmMembers(s, regionId);
  // 原始蜂巢：编号最小（最早建立）的那个
  members.sort((a, b) => colonyOrder(a.id) - colonyOrder(b.id));
  members.forEach((m, i) => {
    let pos = { x: 0, y: 0 };
    if (i > 0) pos = pickSpot(cfg, s, regionId, region, hashSeed(`${m.id}:legacy`));
    const rr = ensureRunRealm(m.run, region, i > 0, pos.x, pos.y);
    const prefix = i === 0 ? '' : `m${i}_`;
    m.run.map.fields.forEach((f: FlowerField) => {
      const id = prefix + f.fieldId;
      realm!.fields.push({
        id, x: f.x + rr.x, y: f.y + rr.y, flower: f.flower, level: f.level, stock: f.stock, growth: f.growth,
        hidden: f.hidden, homeOf: f.home ? m.id : ''
      });
      if (prefix.length > 0) {
        const pollinators = m.run.colony.pollinators;
        if (pollinators[f.fieldId] !== undefined) { pollinators[id] = pollinators[f.fieldId]; delete pollinators[f.fieldId]; }
        f.fieldId = id;
      }
    });
  });
  members.forEach((m) => attachRun(s, cfg, regionId, m.run, m.id));
  return realm;
}

function colonyOrder(id: string): number {
  const n = Number(id.replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 999;
}

/** 新蜂巢选址：离已有蜂巢不太近也不太远（领地可以重叠），尽量远离所有已有蜂巢 */
export function pickSpot(cfg: GameConfigDef, s: GameState, regionId: string, region: RegionDef, seed: number,
  parent?: { x: number; y: number }): { x: number; y: number } {
  const others = realmMembers(s, regionId).filter((m) => m.run.realm !== undefined).map((m) => realmPos(m.run));
  if (others.length === 0) others.push({ x: 0, y: 0 });
  const base = parent ?? others[0];
  const rng = new Rng(seed);
  const minGap = region.maxRadius * REALM_MIN_GAP;
  let best = { x: base.x + minGap * 1.3, y: base.y };
  let bestScore = -1e9;
  const phase = rng.range(0, Math.PI * 2);
  for (let i = 0; i < 36; i++) {
    const a = phase + i / 36 * Math.PI * 2;
    for (const k of [1.15, 1.35, 1.6]) {
      const d = minGap * k;
      const x = base.x + Math.cos(a) * d;
      const y = base.y + Math.sin(a) * d * 0.85;
      const nearest = Math.min(...others.map((o) => Math.hypot(o.x - x, o.y - y)));
      if (nearest < minGap) continue;
      // 偏好：离最近的蜂巢刚好在 1.3 倍最小距离附近（领地重叠一部分），再远离世界中心一点
      const score = -Math.abs(nearest - minGap * 1.3) + rng.range(0, 30);
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  void cfg;
  return best;
}

/** 在新蜂巢周围生成它自己的花田（领地里、不挤进其它蜂巢的巢旁区域），加入世界花田 */
export function seedTerritoryFields(s: GameState, cfg: GameConfigDef, regionId: string, colonyId: string, rr: RunRealm, seed: number): void {
  const realm = ensureRealm(s, cfg, regionId);
  const region = regionOf(cfg, regionId);
  const rng = new Rng(seed);
  const local = generateFields(cfg, region, rng);
  const others = realmMembers(s, regionId).filter((m) => m.id !== colonyId && m.run.realm !== undefined).map((m) => realmPos(m.run));
  const keepOut = region.maxRadius * 0.3;
  const tag = `d${realm.nextId}`;
  realm.nextId += 1;
  local.forEach((f: FlowerField) => {
    const x = f.x + rr.x;
    const y = f.y + rr.y;
    if (!f.home) {
      if (!insideTerritory(rr, x, y)) return;
      if (others.some((o) => Math.hypot(o.x - x, o.y - y) < keepOut)) return;
      // 只保留大约 6 成，避免和原有花田挤成一团
      if (!f.hidden && rng.next() < 0.4) return;
    }
    realm.fields.push({
      id: `${tag}_${f.fieldId}`, x, y, flower: f.flower, level: f.level, stock: f.stock, growth: f.growth, hidden: f.hidden,
      homeOf: f.home ? colonyId : ''
    });
  });
}

/** 让一个蜂巢的花田副本与它领地里的世界花田对应（只增加，不删除已有副本） */
export function attachRun(s: GameState, cfg: GameConfigDef, regionId: string, run: RunState, colonyId: string): void {
  const realm = s.meta.realms?.[regionId];
  if (realm === undefined || run.realm === undefined) return;
  const region = regionOf(cfg, regionId);
  const rr = run.realm;
  const have = new Set(run.map.fields.map((f: FlowerField) => f.fieldId));
  realm.fields.forEach((wf: RealmField) => {
    if (have.has(wf.id)) return;
    const own = wf.homeOf === colonyId;
    if (wf.homeOf.length > 0 && !own) return;
    if (!own && !insideTerritory(rr, wf.x, wf.y)) return;
    const x = wf.x - rr.x;
    const y = wf.y - rr.y;
    const d = Math.hypot(x, y);
    run.map.fields.push({
      fieldId: wf.id, flower: wf.flower, x, y, dist: d, level: wf.level, stock: wf.stock, growth: wf.growth,
      danger: own ? 0 : copyDanger(region, d, wf.hidden), discovered: own, intelExpiresAt: own ? 1e12 : 0, danceBonusUntil: 0,
      home: own, hidden: wf.hidden, webbed: false, syncStock: wf.stock, syncGrowth: wf.growth
    });
  });
  refreshShares(s, regionId);
}

/** 每片世界花田被几个蜂巢覆盖，恢复量按份额分给每个副本 */
export function refreshShares(s: GameState, regionId: string): void {
  const count = new Map<string, number>();
  const members = realmMembers(s, regionId);
  members.forEach((m) => m.run.map.fields.forEach((f: FlowerField) => count.set(f.fieldId, (count.get(f.fieldId) ?? 0) + 1)));
  members.forEach((m) => m.run.map.fields.forEach((f: FlowerField) => {
    const n = count.get(f.fieldId) ?? 1;
    f.share = n > 1 ? 1 / n : undefined;
    if (f.share === undefined) delete f.share;
  }));
}

/**
 * 每帧同步：把各蜂巢副本的存量、成长变化合并到世界花田，再写回所有副本。
 * 授粉让花田升级时，以升级后的花种为准。
 */
export function syncRealm(s: GameState, regionId: string): void {
  const realm = s.meta.realms?.[regionId];
  if (realm === undefined) return;
  const members = realmMembers(s, regionId);
  if (members.length === 0) return;
  const byId = new Map<string, RealmField>();
  realm.fields.forEach((f: RealmField) => byId.set(f.id, f));
  const copies = new Map<string, FlowerField[]>();
  members.forEach((m) => m.run.map.fields.forEach((f: FlowerField) => {
    if (!byId.has(f.fieldId)) return;
    const list = copies.get(f.fieldId);
    if (list === undefined) copies.set(f.fieldId, [f]);
    else list.push(f);
  }));
  copies.forEach((list: FlowerField[], id: string) => {
    const wf = byId.get(id)!;
    let dStock = 0;
    let dGrowth = 0;
    list.forEach((c: FlowerField) => {
      dStock += c.stock - (c.syncStock ?? c.stock);
      dGrowth += c.growth - (c.syncGrowth ?? c.growth);
      // 上次同步后所有副本都与世界一致；花种或等级变了，说明这个蜂巢的授粉让花田升级了
      if (c.flower !== wf.flower || c.level !== wf.level) {
        wf.flower = c.flower;
        wf.level = c.level;
        wf.growth = 0;
        dGrowth = 0;
      }
    });
    wf.stock = Math.max(0, wf.stock + dStock);
    wf.growth = Math.max(0, wf.growth + dGrowth);
    list.forEach((c: FlowerField) => {
      c.stock = wf.stock;
      c.syncStock = wf.stock;
      c.growth = wf.growth;
      c.syncGrowth = wf.growth;
      c.flower = wf.flower;
      c.level = wf.level;
    });
  });
}

/** 界面：当前蜂巢看到的王国地图（其它蜂巢的位置、领地、领地外的花田） */
export function realmView(s: GameState, cfg: GameConfigDef): RealmView | null {
  const regionId = s.run.regionId;
  const realm = s.meta.realms?.[regionId];
  if (realm === undefined || s.run.realm === undefined) return null;
  const me = realmPos(s.run);
  const v = new RealmView();
  realmMembers(s, regionId).forEach((m) => {
    if (m.run.realm === undefined) return;
    const h = new RealmHiveView();
    h.id = m.id;
    h.name = s.meta.colonyNames?.[m.id] ?? `${regionOf(cfg, regionId).name}蜂群`;
    h.x = m.run.realm.x - me.x;
    h.y = m.run.realm.y - me.y;
    h.daughter = m.run.realm.daughter;
    h.active = m.active;
    h.adults = Object.values(m.run.colony.roles).reduce((n, x) => n + Math.max(0, x), 0);
    h.outline = territoryOutline(m.run.realm, me.x, me.y);
    v.hives.push(h);
  });
  const mine = new Set(s.run.map.fields.map((f: FlowerField) => f.fieldId));
  realm.fields.forEach((wf: RealmField) => {
    if (mine.has(wf.id) || wf.hidden) return;
    v.foreign.push({ x: wf.x - me.x, y: wf.y - me.y, flower: wf.flower, stock: wf.stock, level: wf.level });
  });
  return v;
}

/** 王国地图的范围（相对当前蜂巢），用于放宽镜头可拖动范围 */
export function realmExtent(s: GameState): number {
  const regionId = s.run.regionId;
  if (s.meta.realms?.[regionId] === undefined || s.run.realm === undefined) return 0;
  const me = realmPos(s.run);
  let ext = 0;
  realmMembers(s, regionId).forEach((m) => {
    if (m.run.realm === undefined) return;
    ext = Math.max(ext, Math.hypot(m.run.realm.x - me.x, m.run.realm.y - me.y) + m.run.realm.r * 0.6);
  });
  return ext;
}

/** 蜂巢原地重开（被熊毁掉、坠落、消耗传承重启）：保留它在王国地图上的位置和领地，花田重新对应世界花田 */
export function rebindRun(s: GameState, cfg: GameConfigDef, old: RunState, fresh: RunState, colonyId: string): void {
  if (old.realm === undefined || s.meta.realms?.[old.regionId] === undefined) return;
  fresh.realm = { ...old.realm };
  fresh.map.fields = [];
  fresh.map.scouts = [];
  delete fresh.map.bloom;
  attachRun(s, cfg, old.regionId, fresh, colonyId);
}

/** 新蜂巢从世界花田里继承原蜂巢已经探明的花田情报（只传一段时间，之后要靠自己的侦察蜂） */
export function inheritKnowledge(parent: RunState, child: RunState, intelSec: number): void {
  const known = new Set(parent.map.fields.filter((f: FlowerField) => f.discovered).map((f: FlowerField) => f.fieldId));
  child.map.fields.forEach((f: FlowerField) => {
    if (f.home || !known.has(f.fieldId)) return;
    f.discovered = true;
    f.intelExpiresAt = child.time + intelSec;
  });
}
