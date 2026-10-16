import { BigNum } from '../common/BigNum';

/** 存档数据模型（需求书第十章）。run 在分蜂时重置，meta 永久保留（PROG-003/004）。 */

export interface HexCell {
  cellId: string;
  q: number;
  r: number;
  ring: number;
  unlocked: boolean;
  building: string;
}

export interface HiveState {
  ringLevel: number;
  cells: HexCell[];
  expansions: number;
}

export interface LarvaBatch {
  batchId: number;
  targetRole: string;
  count: number;
  startAt: number;
  finishAt: number;
  paid: string;
  started: boolean;
}

export interface ColonyState {
  larvae: number;
  roles: Record<string, number>;
  injured: Record<string, number>;
  batches: LarvaBatch[];
  nextBatchId: number;
  layCooldown: number;
  autoLay: boolean;
  autoHatch: boolean;
  autoRatio: Record<string, number>;
  houseWaxShare: number;
  forageStrategy: string;
  pollinators: Record<string, number>;
  guardPriority: string;
  eggsLaid: number;
  hatched: number;
  lifeDebt: number;
  collapsed: boolean;
}

export interface FlowerField {
  fieldId: string;
  flower: string;
  x: number;
  y: number;
  dist: number;
  level: number;
  stock: number;
  /** 最近采空时刻，缺省兼容旧存档；恢复等待使用游戏时间。 */
  depletedAt?: number;
  danger: number;
  discovered: boolean;
  intelExpiresAt: number;
  danceBonusUntil: number;
  growth: number;
  home: boolean;
  hidden: boolean;
  webbed: boolean;
}

/** 侦察蜂逻辑实体（BEE-003） */
export interface ScoutAgent {
  id: number;
  state: string;
  targetField: string;
  tx: number;
  ty: number;
  x: number;
  y: number;
  timer: number;
  found: boolean;
}

export interface MapState {
  fields: FlowerField[];
  scouts: ScoutAgent[];
  nextScoutId: number;
}

export interface SeasonState {
  formal: boolean;
  season: string;
  startedAt: number;
  endsAt: number;
  cycleIndex: number;
  firstWinterProtected: boolean;
  wintersSurvived: number;
  starving: boolean;
  starveSeconds: number;
}

export interface ThreatEvent {
  eventId: string;
  type: string;
  targetId: string;
  phase: string;
  hp: number;
  maxHp: number;
  startedAt: number;
  endsAt: number;
  postponed: number;
  settled: boolean;
}

export interface ThreatState {
  active: ThreatEvent[];
  nextSpawnAt: number;
  nextBearAt: number;
  nextId: number;
  cleared: number;
  enabled: boolean;
}

export interface GameMessage {
  id: number;
  time: number;
  kind: string;
  text: string;
}

export interface LedgerEntry {
  ledgerId: number;
  res: string;
  before: string;
  after: string;
  delta: string;
  reason: string;
  ref: string;
  time: number;
}

export interface RunStats {
  firstNectarAt: number;
  firstEggAt: number;
  firstScoutAt: number;
  firstDanceAt: number;
  firstForagerAt: number;
  autoLoopAt: number;
  firstExpandAt: number;
  firstStorageAt: number;
  firstWinterAt: number;
  peakPop: number;
  pollinations: number;
  rareFound: number;
  bearsRepelled: number;
  manualCollects: number;
  houseWaxMade: number;
  deliveredNectar: number;
  autoLays: number;
}

/** 本轮种区状态：分蜂时整体重建 */
export interface RunState {
  regionId: string;
  regionIndex: number;
  seed: number;
  rngState: number;
  time: number;
  res: Record<string, BigNum>;
  overflow: Record<string, BigNum>;
  produced: Record<string, BigNum>;
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

export interface TalentPreset {
  name: string;
  nodes: Record<string, number>;
}

export interface InheritanceState {
  totalPoints: number;
  available: number;
  nodes: Record<string, number>;
  presets: TalentPreset[];
  resets: number;
  unlocked: boolean;
}

export interface SettingsState {
  music: boolean;
  sfx: boolean;
  musicVolume: number;
  ambientVolume: number;
  effectsVolume: number;
  vibration: boolean;
  particles: boolean;
  reduceMotion: boolean;
  eventAnimations: boolean;
  gameSpeed: number;
  ecoMode: boolean;
  skin: string;
  continuation: boolean;
  privacyAccepted: boolean;
  privacyVersion: string;
  fontScaleSafe: boolean;
}

export interface SwarmRecord {
  regionId: string;
  points: number;
  playTime: number;
  peakPop: number;
  endedAt: number;
}

/** 永久状态：图鉴、成就、外观、传承、设置、教学（PROG-004） */
export interface MetaState {
  playerId: string;
  createdAt: number;
  totalPlayTime: number;
  swarmCount: number;
  regionsVisited: string[];
  codexFlowers: string[];
  codexThreats: string[];
  achievements: string[];
  skins: string[];
  inheritance: InheritanceState;
  settings: SettingsState;
  tutorialStep: number;
  tutorialDone: boolean;
  history: SwarmRecord[];
  totalWinters: number;
  featureUnlocks: string[];
  /** 已看过的新事物介绍（引导） */
  introsSeen: string[];
}

export interface GameState {
  meta: MetaState;
  run: RunState;
  messages: GameMessage[];
  nextMessageId: number;
  ledger: LedgerEntry[];
  nextLedgerId: number;
  lastSavedAt: number;
  lastTrustedTime: number;
  lastSettlementId: string;
}

export interface OfflineReport {
  settlementId: string;
  elapsed: number;
  credited: number;
  truncated: number;
  gains: Record<string, string>;
  seasonsPassed: string[];
  notes: string[];
  anomaly: string;
}
