import { BigNum } from '../common/BigNum';
import { checksum } from '../common/Rng';
import { ALL_RES, ALL_ROLES } from './Types';
import { defaultBreedPlan, emptyKingdom } from './NewGame';
import { emptyDaily } from './DailyService';
import {
  ColonySlot, ColonyState, FlowerField, GameMessage, GameState, HiveState, LedgerEntry, MapState, MetaState, RunRealm, RunState, RunStats, SeasonState,
  ThreatState
} from './State';

/** 存档封装（需求书10.1 SaveEnvelope） */
export interface SaveEnvelope {
  schemaVersion: number;
  appVersion: string;
  configVersion: string;
  saveId: string;
  updatedAt: number;
  checksum: string;
  payload: string;
}

/** 存档传输对象：大数以规范化十进制字符串保存（需求书10.4） */
export interface RunDTO {
  regionId: string;
  regionIndex: number;
  seed: number;
  rngState: number;
  time: number;
  res: Record<string, string>;
  overflow: Record<string, string>;
  produced: Record<string, string>;
  hive: HiveState;
  upgrades: Record<string, number>;
  research: Record<string, number>;
  colony: ColonyState;
  map: MapState;
  season: SeasonState;
  threats: ThreatState;
  tasksDone: string[];
  tasksClaimed: string[];
  colonyTaskCycle: number;
  stats: RunStats;
  realm?: RunRealm;
}

export interface SaveDTO {
  meta: MetaState;
  run: RunDTO;
  activeColonyId: string;
  colonies: Array<{ id: string; name: string; run: RunDTO; lastActiveAt: number }>;
  messages: GameMessage[];
  nextMessageId: number;
  ledger: LedgerEntry[];
  nextLedgerId: number;
  lastSavedAt: number;
  lastTrustedTime: number;
  lastSettlementId: string;
}

export const SCHEMA_VERSION = 3;
export const APP_VERSION = '0.5.1';

function bigOut(r: Record<string, BigNum>): Record<string, string> {
  const o: Record<string, string> = {};
  ALL_RES.forEach((k: string) => {
    const v = r[k];
    o[k] = v === undefined ? '0' : v.clamp0().serialize();
  });
  return o;
}

function bigIn(r: Record<string, string>): Record<string, BigNum> {
  const o: Record<string, BigNum> = {};
  ALL_RES.forEach((k: string) => {
    const raw = r === undefined || r === null ? undefined : r[k];
    o[k] = raw === undefined ? BigNum.zero() : BigNum.parse(`${raw}`).clamp0();
  });
  return o;
}

function runToDTO(run: RunState): RunDTO {
  return {
    regionId: run.regionId, regionIndex: run.regionIndex, seed: run.seed, rngState: run.rngState, time: run.time,
    res: bigOut(run.res), overflow: bigOut(run.overflow), produced: bigOut(run.produced), hive: run.hive,
    upgrades: run.upgrades, research: run.research, colony: run.colony, map: run.map, season: run.season,
    threats: run.threats, tasksDone: run.tasksDone, tasksClaimed: run.tasksClaimed,
    colonyTaskCycle: run.colonyTaskCycle, stats: run.stats, ...(run.realm !== undefined ? { realm: run.realm } : {})
  };
}

function runFromDTO(r: RunDTO): RunState {
  return {
    regionId: r.regionId, regionIndex: r.regionIndex, seed: r.seed, rngState: r.rngState, time: r.time,
    res: bigIn(r.res), overflow: bigIn(r.overflow), produced: bigIn(r.produced), hive: r.hive, upgrades: r.upgrades,
    research: r.research, colony: r.colony, map: r.map, season: r.season, threats: r.threats,
    tasksDone: r.tasksDone, tasksClaimed: r.tasksClaimed, colonyTaskCycle: r.colonyTaskCycle, stats: r.stats,
    ...(r.realm !== undefined && r.realm !== null ? { realm: r.realm } : {})
  };
}

export function toDTO(s: GameState): SaveDTO {
  const d: SaveDTO = {
    meta: s.meta, run: runToDTO(s.run), activeColonyId: s.activeColonyId,
    colonies: s.colonies.map((slot: ColonySlot) => ({
      id: slot.id, name: slot.name, run: runToDTO(slot.run), lastActiveAt: slot.lastActiveAt
    })), messages: s.messages, nextMessageId: s.nextMessageId, ledger: s.ledger,
    nextLedgerId: s.nextLedgerId, lastSavedAt: s.lastSavedAt, lastTrustedTime: s.lastTrustedTime,
    lastSettlementId: s.lastSettlementId
  };
  return d;
}

export function fromDTO(d: SaveDTO): GameState {
  const s: GameState = {
    meta: d.meta, run: runFromDTO(d.run), activeColonyId: d.activeColonyId,
    colonies: d.colonies.map((slot) => ({
      id: slot.id, name: slot.name, run: runFromDTO(slot.run), lastActiveAt: slot.lastActiveAt
    })), messages: d.messages, nextMessageId: d.nextMessageId, ledger: d.ledger,
    nextLedgerId: d.nextLedgerId, lastSavedAt: d.lastSavedAt, lastTrustedTime: d.lastTrustedTime,
    lastSettlementId: d.lastSettlementId
  };
  return s;
}

/** 深拷贝（分蜂快照、应用接续） */
export function cloneState(s: GameState): GameState {
  const payload = JSON.stringify(toDTO(s));
  return fromDTO(JSON.parse(payload) as SaveDTO);
}

export function encodeEnvelope(s: GameState, configVersion: string, now: number): string {
  const payload = JSON.stringify(toDTO(s));
  const env: SaveEnvelope = {
    schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, configVersion: configVersion,
    saveId: s.meta.playerId, updatedAt: now, checksum: checksum(payload), payload: payload
  };
  return JSON.stringify(env);
}

export class DecodeResult {
  ok: boolean = false;
  state: GameState | null = null;
  error: string = '';
  migratedFrom: number = 0;
  updatedAt: number = 0;
}

/** 解码 + 校验 + 逐级迁移 + 修复非法值（SAVE-002/009） */
export function decodeEnvelope(text: string): DecodeResult {
  const res = new DecodeResult();
  if (text === undefined || text === null || text.length < 10) {
    res.error = 'EMPTY';
    return res;
  }
  let env: SaveEnvelope;
  try {
    env = JSON.parse(text) as SaveEnvelope;
  } catch (e) {
    res.error = 'BAD_JSON';
    return res;
  }
  if (env.payload === undefined || env.checksum === undefined) {
    res.error = 'BAD_ENVELOPE';
    return res;
  }
  if (checksum(env.payload) !== env.checksum) {
    res.error = 'CHECKSUM';
    return res;
  }
  if (env.schemaVersion > SCHEMA_VERSION) {
    res.error = 'NEWER_SCHEMA';
    return res;
  }
  let dto: SaveDTO;
  try {
    dto = JSON.parse(env.payload) as SaveDTO;
  } catch (e) {
    res.error = 'BAD_PAYLOAD';
    return res;
  }
  let v = env.schemaVersion;
  res.migratedFrom = v;
  while (v < SCHEMA_VERSION) {
    dto = migrate(dto, v);
    v++;
  }
  repair(dto);
  res.state = fromDTO(dto);
  res.updatedAt = env.updatedAt;
  res.ok = true;
  return res;
}

/** 逐级迁移器：v1 → v2 增加功能解锁；v2 → v3 增加多蜂群与屏幕方向。 */
export function migrate(d: SaveDTO, from: number): SaveDTO {
  if (from === 1) {
    if (d.meta.featureUnlocks === undefined) {
      d.meta.featureUnlocks = d.run.tasksDone === undefined ? [] : d.run.tasksDone.slice();
    }
    if (d.lastSettlementId === undefined) {
      d.lastSettlementId = '';
    }
  }
  if (from === 2) {
    d.activeColonyId = 'colony-0';
    d.colonies = [];
    d.meta.settings.orientation = 'auto';
  }
  return d;
}

function num(v: number, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : def;
}

function repairDaily(m: MetaState): void {
  const fresh = emptyDaily();
  if (m.daily === undefined || m.daily === null || typeof m.daily !== 'object') { m.daily = fresh; return; }
  const d = m.daily;
  if (typeof d.day !== 'string') d.day = '';
  if (typeof d.signedDay !== 'string') d.signedDay = '';
  d.streak = Math.max(0, Math.min(7, Math.floor(num(d.streak, 0))));
  d.bonusClaimed = d.bonusClaimed === true;
  if (!Array.isArray(d.tasks)) d.tasks = [];
  d.tasks = d.tasks.filter((t) => t !== null && typeof t === 'object' && typeof t.kind === 'string').slice(0, 3);
  d.tasks.forEach((t) => {
    t.target = Math.max(1, num(t.target, 1));
    t.progress = Math.max(0, Math.min(t.target, num(t.progress, 0)));
    t.reward = Math.max(0, num(t.reward, 60));
    t.claimed = t.claimed === true;
  });
  if (d.counts === undefined || typeof d.counts !== 'object') d.counts = {};
}

/** 修复缺失/非法字段：保证不出现负数、NaN 和缺失结构 */
export function repair(d: SaveDTO): void {
  const m = d.meta;
  const settings = m.settings;
  settings.musicVolume = Math.max(0, Math.min(100, num(settings.musicVolume, 80)));
  settings.ambientVolume = Math.max(0, Math.min(100, num(settings.ambientVolume, 65)));
  settings.effectsVolume = Math.max(0, Math.min(100, num(settings.effectsVolume, 75)));
  if (settings.eventAnimations === undefined) {
    settings.eventAnimations = true;
  }
  // v0.5.1 以前保存的是手动固定方向；新版本统一恢复为跟随设备姿态。
  settings.orientation = 'auto';
  const gameSpeed = num(settings.gameSpeed, 1);
  settings.gameSpeed = [1, 2, 4].indexOf(gameSpeed) >= 0 ? gameSpeed : 1;
  if (m.featureUnlocks === undefined) {
    m.featureUnlocks = [];
  }
  if (m.introsSeen === undefined) {
    // 旧存档：已有进度时由 Guide.syncLegacy 把已经满足的介绍标为看过，避免一次弹出一长串
    m.introsSeen = m.featureUnlocks.length > 0 ? ['_legacy'] : [];
  }
  repairDaily(m);
  const k = m.kingdom;
  if (k === undefined || k === null || typeof k !== 'object') {
    m.kingdom = emptyKingdom();
  } else {
    k.level = Math.max(1, Math.floor(num(k.level, 1)));
    k.xp = Math.max(0, num(k.xp, 0));
    k.honeyMark = Math.max(0, Math.floor(num(k.honeyMark, 0)));
    k.starEggs = Math.max(0, Math.floor(num(k.starEggs, 0)));
    k.honeyTotal = Math.max(0, num(k.honeyTotal, 0));
  }
  if (!Array.isArray(m.starCodex)) m.starCodex = [];
  if (!Array.isArray(m.popupsSeen)) m.popupsSeen = [];
  if (m.namePending !== undefined && !Array.isArray(m.namePending)) m.namePending = [];
  m.raidWins = Math.max(0, Math.floor(num(m.raidWins ?? 0, 0)));
  m.nameSeq = Math.max(0, Math.floor(num(m.nameSeq ?? 0, 0)));
  if (m.codexFlowers === undefined) {
    m.codexFlowers = [];
  }
  if (m.codexThreats === undefined) {
    m.codexThreats = [];
  }
  if (m.achievements === undefined) {
    m.achievements = [];
  }
  if (m.skins === undefined || m.skins.length === 0) {
    m.skins = ['classic'];
  }
  if (m.history === undefined) {
    m.history = [];
  }
  m.totalPlayTime = Math.max(0, num(m.totalPlayTime, 0));
  m.totalWinters = Math.max(0, num(m.totalWinters, 0));
  m.inheritance.available = Math.max(0, Math.floor(num(m.inheritance.available, 0)));
  m.inheritance.totalPoints = Math.max(m.inheritance.available, Math.floor(num(m.inheritance.totalPoints, 0)));
  if (m.inheritance.presets === undefined) {
    m.inheritance.presets = [];
  }
  if (typeof d.activeColonyId !== 'string' || d.activeColonyId.length === 0) d.activeColonyId = 'colony-0';
  if (!Array.isArray(d.colonies)) d.colonies = [];
  repairRun(d.run);
  d.colonies = d.colonies.filter((slot) => slot !== null && slot !== undefined && slot.run !== undefined);
  d.colonies.forEach((slot) => {
    slot.lastActiveAt = Math.max(0, num(slot.lastActiveAt, d.lastSavedAt));
    if (typeof slot.id !== 'string' || slot.id.length === 0) slot.id = `colony-${slot.run.regionIndex}`;
    if (typeof slot.name !== 'string' || slot.name.length === 0) slot.name = slot.run.regionId;
    repairRun(slot.run);
  });
  // 名字序号必须大于所有已用编号，保证之后的名字不重复
  let maxId = -1;
  [d.run, ...d.colonies.map((slot) => slot.run)].forEach((run) => {
    (run.colony.roster ?? []).forEach((b) => { if (b.id > maxId) maxId = b.id; });
  });
  m.nameSeq = Math.max(m.nameSeq ?? 0, maxId + 1);
  if (d.messages === undefined) d.messages = [];
  if (d.ledger === undefined) d.ledger = [];
}

function repairRun(r: RunDTO): void {
  r.time = Math.max(0, num(r.time, 0));
  r.hive.fullAt = Math.max(0, num(r.hive.fullAt, 0));
  r.hive.fallAt = Math.max(r.hive.fullAt, num(r.hive.fallAt, 0));
  const c = r.colony;
  c.autoLay = false;
  c.autoHatch = false;
  c.eggsLaid = Math.max(0, Math.floor(num(c.eggsLaid, 0)));
  c.larvae = Math.max(0, Math.floor(num(c.larvae, 0)));
  ALL_ROLES.forEach((k: string) => {
    c.roles[k] = Math.max(0, Math.floor(num(c.roles[k], 0)));
    c.injured[k] = Math.min(c.roles[k], Math.max(0, Math.floor(num(c.injured[k], 0))));
  });
  if (c.pollinators === undefined) {
    c.pollinators = {};
  }
  if (c.batches === undefined) {
    c.batches = [];
  }
  if (c.collapsed === undefined) {
    c.collapsed = false;
  }
  c.youngQueens = Math.max(0, Math.floor(num(c.youngQueens, 0)));
  const plan = defaultBreedPlan();
  if (c.plan === undefined || c.plan === null || typeof c.plan !== 'object') c.plan = plan;
  c.plan.on = c.plan.on === true;
  if (c.plan.weights === undefined || typeof c.plan.weights !== 'object') c.plan.weights = plan.weights;
  ALL_ROLES.forEach((k: string) => {
    c.plan.weights[k] = Math.max(0, Math.min(10, Math.round(num(c.plan.weights[k], plan.weights[k]))));
  });
  c.plan.reserve = Math.max(0, Math.min(0.9, num(c.plan.reserve, plan.reserve)));
  c.plan.larvae = Math.max(0, Math.min(c.larvae, Math.floor(num(c.plan.larvae, 0))));
  c.queenAttempts = Math.max(0, Math.floor(num(c.queenAttempts, 0)));
  c.queenFails = Math.max(0, Math.min(60, Math.floor(num(c.queenFails ?? 0, 0))));
  c.luckyHatch = Math.max(0, Math.floor(num(c.luckyHatch ?? 0, 0)));
  if (!Array.isArray(c.roster)) c.roster = [];
  c.roster = c.roster.filter((b) => b !== null && typeof b === 'object' && typeof b.n === 'string' &&
    ALL_ROLES.indexOf(b.r) >= 0 && Number.isFinite(b.id));
  c.roster.forEach((b) => {
    b.e = Math.max(50, Math.min(150, Math.round(num(b.e, 100))));
    b.a = Math.max(0, num(b.a, 0));
    b.b = Math.max(0, num(b.b, 0));
    b.c = Math.floor(num(b.c, -1));
    if (typeof b.s !== 'string') b.s = '';
    if (typeof b.z !== 'string') b.z = r.regionId;
    if (b.t !== undefined) b.lv = Math.max(1, Math.min(5, Math.floor(num(b.lv ?? 1, 1))));
  });
  const validSeasons = ['tutorial', 'spring', 'summer', 'autumn', 'winterPrep', 'winter'];
  if (!r.season || validSeasons.indexOf(r.season.season) < 0) {
    r.season = {
      formal: false, season: 'tutorial', startedAt: r.time, endsAt: r.time, cycleIndex: 0,
      firstWinterProtected: true, wintersSurvived: 0, starving: false, starveSeconds: 0
    };
  } else {
    r.season.startedAt = Math.max(0, num(r.season.startedAt, r.time));
    r.season.endsAt = Math.max(r.season.startedAt, num(r.season.endsAt, r.time));
    r.season.cycleIndex = Math.max(0, Math.floor(num(r.season.cycleIndex, 0)));
    r.season.wintersSurvived = Math.max(0, Math.floor(num(r.season.wintersSurvived, 0)));
    r.season.starveSeconds = Math.max(0, num(r.season.starveSeconds, 0));
  }
  if (r.season.effects !== undefined && !Array.isArray(r.season.effects)) r.season.effects = [];
  if (r.season.payouts !== undefined && !Array.isArray(r.season.payouts)) r.season.payouts = [];
  if (r.season.event !== undefined && (r.season.event === null || typeof r.season.event.id !== 'string')) delete r.season.event;
  const st = r.stats;
  if (st.houseWaxMade === undefined) {
    st.houseWaxMade = 0;
  }
  if (st.deliveredNectar === undefined) {
    st.deliveredNectar = 0;
  }
  if (st.autoLays === undefined) {
    st.autoLays = 0;
  }
  const bloom = r.map.bloom;
  if (bloom !== undefined && (bloom === null || typeof bloom.fieldId !== 'string')) delete r.map.bloom;
  else if (bloom !== undefined) {
    bloom.until = num(bloom.until, 0);
    bloom.nextAt = num(bloom.nextAt, r.time + 45);
    bloom.count = Math.max(0, Math.floor(num(bloom.count, 0)));
  }
  r.map.fields.forEach((f: FlowerField) => {
    f.stock = Math.max(0, num(f.stock, 0));
    if (f.depletedAt !== undefined) f.depletedAt = Math.max(0, num(f.depletedAt, 0));
    f.growth = Math.max(0, num(f.growth, 0));
  });
}
