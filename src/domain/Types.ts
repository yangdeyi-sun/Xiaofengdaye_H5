/** 领域枚举与配置结构（OPS-001 配置化，所有ID为稳定字符串） */

export enum Res {
  Nectar = 'nectar',
  Honey = 'honey',
  Wax = 'wax',
  Jelly = 'jelly'
}

export const ALL_RES: string[] = [Res.Nectar, Res.Honey, Res.Wax, Res.Jelly];

export enum Role {
  Scout = 'scout',
  Forager = 'forager',
  House = 'house',
  Guard = 'guard'
}

export const ALL_ROLES: string[] = [Role.Scout, Role.Forager, Role.House, Role.Guard];

export enum Bld {
  Queen = 'queen',
  Nursery = 'nursery',
  ScoutRoom = 'scoutRoom',
  ForagerRoom = 'foragerRoom',
  Brewery = 'brewery',
  Storage = 'storage',
  GuardRoom = 'guardRoom',
  Evolution = 'evolution'
}

export const ALL_BUILDINGS: string[] = [Bld.Queen, Bld.Nursery, Bld.ScoutRoom, Bld.ForagerRoom, Bld.Brewery,
  Bld.Storage, Bld.GuardRoom, Bld.Evolution];

export enum SeasonId {
  Tutorial = 'tutorial',
  Spring = 'spring',
  Summer = 'summer',
  Autumn = 'autumn',
  WinterPrep = 'winterPrep',
  Winter = 'winter'
}

export enum ThreatType {
  Wasp = 'wasp',
  Web = 'web',
  Moth = 'moth',
  Bear = 'bear'
}

export enum ThreatPhase {
  Warning = 'warning',
  Active = 'active',
  Postponed = 'postponed',
  Cleared = 'cleared',
  Expired = 'expired',
  Lost = 'lost'
}

export enum ForageStrategy {
  Safe = 'safe',
  Balanced = 'balanced',
  Rich = 'rich'
}

export enum GuardPriority {
  Gate = 'gate',
  Fields = 'fields',
  Routes = 'routes',
  Balanced = 'balanced'
}

/** 资源账本原因码（需求书9.4） */
export enum Reason {
  Manual = 'manual_collect',
  Forage = 'forage',
  ScoutSample = 'scout_sample',
  Process = 'process',
  Wax = 'wax_make',
  Egg = 'lay_egg',
  Hatch = 'differentiate',
  HatchRefund = 'differentiate_refund',
  Build = 'build',
  Upgrade = 'upgrade',
  Expand = 'expand',
  Research = 'research',
  Winter = 'winter_upkeep',
  Threat = 'threat_loss',
  ThreatReward = 'threat_reward',
  Offline = 'offline_settlement',
  Task = 'task_reward',
  Overflow = 'overflow',
  Swarm = 'swarm',
  Talent = 'talent',
  Rollback = 'rollback',
  Admin = 'admin_fix'
}

export interface CostDef {
  res: string;
  base: number;
  growth: number;
}

export interface StatDef {
  id: string;
  name: string;
  base: number;
  min: number;
  max: number;
  unit: string;
}

export interface KeyLevelDef {
  level: number;
  flag: string;
  desc: string;
}

/** 巢房属性升级轨道（HIVE-005~008） */
export interface UpgradeTrackDef {
  id: string;
  building: string;
  stat: string;
  name: string;
  perLevel: number;
  /** pct: 基础值 × (1 + perLevel × lv)；add: 基础值 + perLevel × lv */
  mode: string;
  maxLevel: number;
  costs: CostDef[];
  keyLevels: KeyLevelDef[];
}

export interface RoleDef {
  id: string;
  name: string;
  desc: string;
  building: string;
  costs: CostDef[];
  hatchTime: number;
}

export interface BuildingDef {
  id: string;
  name: string;
  desc: string;
  adjacency: string;
  costs: CostDef[];
  maxCount: number;
  unlockTask: string;
}

export interface FlowerDef {
  id: string;
  name: string;
  tier: number;
  yieldMul: number;
  maxStock: number;
  regen: number;
  jellyPerTrip: number;
  next: string;
  petal: string;
  center: string;
  rare: boolean;
}

export interface SeasonDef {
  id: string;
  name: string;
  duration: number;
  nectarMul: number;
  layMul: number;
  threatMul: number;
  brewMul: number;
  upkeep: number;
  next: string;
}

export interface ThreatDef {
  id: string;
  name: string;
  desc: string;
  hp: number;
  hpPerCycle: number;
  lifetime: number;
  area: string;
  reward: RewardDef[];
  seasonWeight: Record<string, number>;
}

export interface RegionDef {
  id: string;
  name: string;
  desc: string;
  rule: string;
  difficulty: number;
  seasonMul: Record<string, number>;
  nectarMul: number;
  regenMul: number;
  flyMul: number;
  threatMul: number;
  fieldCount: number;
  minRadius: number;
  maxRadius: number;
  flowerPool: string[];
  rareFlower: string;
  maxRing: number;
  flyBySeason: Record<string, number>;
  ground: string;
  groundAlt: string;
}

export interface EffectDef {
  stat: string;
  /** pct：百分比乘区；add：加法 */
  op: string;
  value: number;
}

export interface ResearchDef {
  id: string;
  name: string;
  desc: string;
  maxLevel: number;
  costs: CostDef[];
  effects: EffectDef[];
}

export interface TalentDef {
  id: string;
  branch: string;
  name: string;
  desc: string;
  maxLevel: number;
  costPerLevel: number;
  branchPointsRequired: number;
  requires: string;
  effects: EffectDef[];
  ruleFlag: string;
}

export interface RewardDef {
  res: string;
  amount: number;
}

export interface TaskDef {
  id: string;
  name: string;
  desc: string;
  kind: string;
  rewards: RewardDef[];
}

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  skin: string;
}

export interface SkinDef {
  id: string;
  name: string;
  cellFill: string;
  cellStroke: string;
  bg: string;
}

export interface TutorialStepDef {
  id: string;
  title: string;
  text: string;
  focus: string;
  doneTask: string;
}

export interface EconomyDef {
  manualYield: number;
  baseConvertRate: number;
  perBeeConvert: number;
  baseConvertRatio: number;
  houseBrewRate: number;
  houseConvertRatio: number;
  waxHoneyPerSec: number;
  waxRatio: number;
  queenWaxTrickle: number;
  eggCost: CostDef;
  layInterval: number;
  queenSlots: number;
  nurserySlots: number;
  popBase: number;
  popPerNursery: number;
  popPerRing: number;
  capHoney: number;
  capNectar: number;
  capWax: number;
  capJelly: number;
  storageHoney: number;
  storageNectar: number;
  storageWax: number;
  overflowRatio: number;
  overflowDecayPerMin: number;
  safetyLine: number;
  injuryCapRatio: number;
  lifespan: number;
  scoutSample: number;
  holdCollectPerSec: number;
  expandBaseWax: number;
  expandRingGrowth: number;
  expandCellGrowth: number;
  offlineBaseHours: number;
  offlineStep: number;
  maxOfflineDays: number;
}

export interface SwarmDef {
  popBase: number;
  popPerSwarm: number;
  upgradeLevels: number;
  honeyBase: number;
  honeyGrowth: number;
  honeyCap: number;
  jelly: number;
  minFields: number;
  minWinters: number;
  minPollinations: number;
  basePoints: number;
  resourceBonusCap: number;
}

export interface GameConfigDef {
  configVersion: string;
  schemaVersion: number;
  economy: EconomyDef;
  stats: StatDef[];
  roles: RoleDef[];
  buildings: BuildingDef[];
  tracks: UpgradeTrackDef[];
  flowers: FlowerDef[];
  seasons: SeasonDef[];
  threats: ThreatDef[];
  regions: RegionDef[];
  research: ResearchDef[];
  talents: TalentDef[];
  tasks: TaskDef[];
  achievements: AchievementDef[];
  skins: SkinDef[];
  tutorial: TutorialStepDef[];
  swarm: SwarmDef;
}
