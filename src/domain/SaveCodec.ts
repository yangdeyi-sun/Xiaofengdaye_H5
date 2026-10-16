import { BigNum } from '../common/BigNum';
import { checksum } from '../common/Rng';
import { ALL_RES, ALL_ROLES } from './Types';
import {
  ColonyState, FlowerField, GameMessage, GameState, HiveState, LedgerEntry, MapState, MetaState, RunState, RunStats, SeasonState,
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
}

export interface SaveDTO {
  meta: MetaState;
  run: RunDTO;
  messages: GameMessage[];
  nextMessageId: number;
  ledger: LedgerEntry[];
  nextLedgerId: number;
  lastSavedAt: number;
  lastTrustedTime: number;
  lastSettlementId: string;
}

export const SCHEMA_VERSION = 2;
export const APP_VERSION = '0.4.0';

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

export function toDTO(s: GameState): SaveDTO {
  const run = s.run;
  const r: RunDTO = {
    regionId: run.regionId, regionIndex: run.regionIndex, seed: run.seed, rngState: run.rngState, time: run.time,
    res: bigOut(run.res), overflow: bigOut(run.overflow), produced: bigOut(run.produced), hive: run.hive,
    upgrades: run.upgrades, research: run.research, colony: run.colony, map: run.map, season: run.season,
    threats: run.threats, tasksDone: run.tasksDone, tasksClaimed: run.tasksClaimed,
    colonyTaskCycle: run.colonyTaskCycle, stats: run.stats
  };
  const d: SaveDTO = {
    meta: s.meta, run: r, messages: s.messages, nextMessageId: s.nextMessageId, ledger: s.ledger,
    nextLedgerId: s.nextLedgerId, lastSavedAt: s.lastSavedAt, lastTrustedTime: s.lastTrustedTime,
    lastSettlementId: s.lastSettlementId
  };
  return d;
}

export function fromDTO(d: SaveDTO): GameState {
  const r = d.run;
  const run: RunState = {
    regionId: r.regionId, regionIndex: r.regionIndex, seed: r.seed, rngState: r.rngState, time: r.time,
    res: bigIn(r.res), overflow: bigIn(r.overflow), produced: bigIn(r.produced), hive: r.hive, upgrades: r.upgrades,
    research: r.research, colony: r.colony, map: r.map, season: r.season, threats: r.threats,
    tasksDone: r.tasksDone, tasksClaimed: r.tasksClaimed, colonyTaskCycle: r.colonyTaskCycle, stats: r.stats
  };
  const s: GameState = {
    meta: d.meta, run: run, messages: d.messages, nextMessageId: d.nextMessageId, ledger: d.ledger,
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

/** 逐级迁移器：v1 → v2 增加功能解锁、离线结算ID与统计字段 */
export function migrate(d: SaveDTO, from: number): SaveDTO {
  if (from === 1) {
    if (d.meta.featureUnlocks === undefined) {
      d.meta.featureUnlocks = d.run.tasksDone === undefined ? [] : d.run.tasksDone.slice();
    }
    if (d.lastSettlementId === undefined) {
      d.lastSettlementId = '';
    }
  }
  return d;
}

function num(v: number, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : def;
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
  const gameSpeed = num(settings.gameSpeed, 1);
  settings.gameSpeed = [1, 2, 4].indexOf(gameSpeed) >= 0 ? gameSpeed : 1;
  if (m.featureUnlocks === undefined) {
    m.featureUnlocks = [];
  }
  if (m.introsSeen === undefined) {
    // 旧存档：已有进度时由 Guide.syncLegacy 把已经满足的介绍标为看过，避免一次弹出一长串
    m.introsSeen = m.featureUnlocks.length > 0 ? ['_legacy'] : [];
  }
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
  const r = d.run;
  r.time = Math.max(0, num(r.time, 0));
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
  r.map.fields.forEach((f: FlowerField) => {
    f.stock = Math.max(0, num(f.stock, 0));
    if (f.depletedAt !== undefined) f.depletedAt = Math.max(0, num(f.depletedAt, 0));
    f.growth = Math.max(0, num(f.growth, 0));
  });
  if (d.messages === undefined) {
    d.messages = [];
  }
  if (d.ledger === undefined) {
    d.ledger = [];
  }
}
