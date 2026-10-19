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
  /** 全部巢格扩建完成的游戏时刻；0 表示尚未达到上限。 */
  fullAt: number;
  /** 达到上限后，在 1~2 个完整四季轮回之间随机确定的掉落时刻。 */
  fallAt: number;
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
  /** 已成功培育、可以带领分蜂的新蜂后。 */
  youngQueens: number;
  queenAttempts: number;
  /** 繁育计划：按工种比例自动产卵与分化（中期解锁，离线照常运行） */
  plan: BreedPlan;
  /** 有名字的蜜蜂名册：与各工种数量保持一致（缺省兼容旧存档，首次运行时补齐） */
  roster?: NamedBee[];
  /** 新蜂后分化连续失败次数（每失败一次成功率 +10%） */
  queenFails?: number;
  /** 幸运孵化：接下来还有几只幼虫享受更高的明星蜂概率 */
  luckyHatch?: number;
}

/**
 * 有名字的蜜蜂。字段名刻意缩短以控制存档体积。
 * a/b 的含义随工种：采集蜂 运输次数/运回花蜜；侦察蜂 出航次数/发现花田；
 * 巢内工蜂 酿出蜂蜜/产出蜂蜡；守卫蜂 击退敌害/参战次数。
 */
export interface NamedBee {
  /** 全局唯一编号（同时决定名字） */
  id: number;
  /** 名字 */
  n: string;
  /** 工种 */
  r: string;
  /** 出生在第几轮四季（从 0 开始；-1 表示名册建立前就已出生） */
  c: number;
  /** 出生季节 */
  s: string;
  /** 出生种区 */
  z: string;
  /** 效率（百分比整数，约 80~125） */
  e: number;
  a: number;
  b: number;
  /** 明星蜂特性 */
  t?: string;
  /** 明星蜂等级 1~5 */
  lv?: number;
}

export interface BreedPlan {
  on: boolean;
  /** 各工种权重 0~10 */
  weights: Record<string, number>;
  /** 至少保留的蜂蜜比例（占蜂蜜容量），入秋后另外保证越冬所需 */
  reserve: number;
  /** 计划自己产下、尚未分化的幼虫；手动产下的幼虫不会被计划拿走 */
  larvae: number;
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
  /** 王国地图：这片花田被几个蜂巢的领地覆盖，恢复量按 1/n 分给每个蜂巢（重叠区产量平分） */
  share?: number;
  /** 王国地图同步用：上次同步时的存量与成长值 */
  syncStock?: number;
  syncGrowth?: number;
}

/** 王国地图上的一片花田（世界坐标，同一种区的蜂巢共用） */
export interface RealmField {
  id: string;
  x: number;
  y: number;
  flower: string;
  level: number;
  stock: number;
  growth: number;
  hidden: boolean;
  /** 哪个蜂巢的巢旁花丛（空字符串表示普通花田） */
  homeOf: string;
}

/** 一个种区的王国地图：所有蜂巢共用的花田 */
export interface RealmMap {
  fields: RealmField[];
  nextId: number;
}

/** 蜂巢在王国地图上的位置与领地 */
export interface RunRealm {
  /** 世界坐标 */
  x: number;
  y: number;
  /** 分出去的蜂巢（false 为这个种区的原始蜂巢） */
  daughter: boolean;
  /** 领地基础半径与形状种子（领地是不规则的色块） */
  r: number;
  seed: number;
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
  /** 蜜流花：新手结束后随机在花丛上开放一小会儿，点中立即获得一大口蜂蜜 */
  bloom?: HoneyBloom;
}

export interface HoneyBloom {
  /** 正在开放的花田；空字符串表示当前没有 */
  fieldId: string;
  until: number;
  nextAt: number;
  /** 已出现次数，用于确定性地挑选位置 */
  count: number;
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
  event?: SeasonEventState;
  lastEventKey?: string;
  effects?: TimedEffect[];
  payouts?: PendingPayout[];
  challenge?: TimedChallenge;
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
  /** 蜂巢保卫战中的敌人 */
  raid?: boolean;
  /** 胡蜂王 */
  boss?: boolean;
  /** 这只敌害已经咬死的蜜蜂数（每只敌害有上限） */
  killed?: number;
}

/** 蜂巢保卫战：每个四季轮回的秋天一次，三波胡蜂后出现胡蜂王 */
export interface RaidState {
  cycle: number;
  /** warn 预警 / fight 交战 / won 胜利 / lost 失利 */
  phase: string;
  wave: number;
  startedAt: number;
  /** 预警结束或交战时限 */
  endsAt: number;
  kills: number;
  playerKills: number;
}

export interface ThreatState {
  active: ThreatEvent[];
  nextSpawnAt: number;
  nextBearAt: number;
  nextId: number;
  cleared: number;
  enabled: boolean;
  /** 连续击退次数（有敌害自行离开时归零），每 5 次额外奖励 */
  streak?: number;
  /** 玩家亲手拍打敌害的累计次数（用于逐步收起操作提示） */
  swats?: number;
  raid?: RaidState;
}

export interface GameMessage {
  id: number;
  time: number;
  kind: string;
  text: string;
  /** 提示类别：同一类别的自动弹窗只在第一次出现时弹（缺省时界面按文字推断） */
  topic?: string;
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
  /** 已领取春季补给的四季轮次（-1 表示还没领过） */
  springSupplyCycle?: number;
  /** 本种区赢得的蜂巢保卫战次数 */
  raidWins?: number;
  /** 这个蜂群历次分蜂已经领过的传承点（防止同一个蜂群反复分蜂重复领取） */
  legacyPaid?: number;
  /** 被敌害咬死的蜜蜂数量 */
  beesLost?: number;
  /** 熊袭击次数与结局 */
  bearsCome?: number;
}

/** 季节事件：每个季节开头出现一个可以选择的小事件 */
export interface SeasonEventState {
  id: string;
  /** 所属“轮次:季节”，防止同一季重复出现 */
  key: string;
  until: number;
  resolved: boolean;
  choice?: string;
}

/** 限时效果（季节事件带来的增益或减益） */
export interface TimedEffect {
  id: string;
  label: string;
  stat: string;
  mul: number;
  until: number;
}

/** 延迟发放（如派采集蜂去远处花海，过一会儿才回来） */
export interface PendingPayout {
  kind: string;
  at: number;
  res: string;
  amount: number;
  text: string;
}

/** 限时挑战（蜂后的心愿：规定时间内手动采集若干次） */
export interface TimedChallenge {
  kind: string;
  until: number;
  start: number;
  target: number;
  reward: number;
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
  /** 王国地图上的位置与领地（同一种区有多个蜂巢时才有） */
  realm?: RunRealm;
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
  /** 默认跟随设备姿态；保留旧值只用于兼容历史存档。 */
  orientation: 'auto' | 'landscape' | 'portrait';
}

/** 非当前蜂群的完整运行快照；再次切换时按离线时长补算经营进度。 */
export interface ColonySlot {
  id: string;
  name: string;
  run: RunState;
  lastActiveAt: number;
}

export interface SwarmRecord {
  regionId: string;
  points: number;
  playTime: number;
  peakPop: number;
  endedAt: number;
  /** local 原地分蜂 / zone 种区分蜂（缺省按种区分蜂处理，兼容旧存档） */
  kind?: string;
  /** 新蜂群落脚的种区 */
  toRegion?: string;
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
  /** 每日签到与每日目标（按玩家本地日期） */
  daily: DailyState;
  /** 王国等级 */
  kingdom?: KingdomState;
  /** 已经起过名的蜜蜂数量（决定下一个名字，保证不重名） */
  nameSeq?: number;
  /** 收集过的明星蜂特性 */
  starCodex?: string[];
  /** 蜂巢保卫战胜利次数 */
  raidWins?: number;
  /** 蜂群名字（按蜂群编号），同一种区有多个蜂群时用来区分 */
  colonyNames?: Record<string, string>;
  /** 被熊毁掉的蜂巢次数 */
  hivesLost?: number;
  /** 各种区的王国地图（同一张图上有多个蜂巢时创建） */
  realms?: Record<string, RealmMap>;
  /** 等待玩家取名的蜂群编号（新手交接时的第一个蜂巢、每次分蜂出来的新蜂巢） */
  namePending?: string[];
  /** 已经自动弹过的提示类别（之后同类只进消息记录，不再弹出） */
  popupsSeen?: string[];
}

export interface KingdomState {
  level: number;
  xp: number;
  /** 已结算的累计蜂蜜里程碑（log10 的四分之一档） */
  honeyMark: number;
  /** 王国奖励的“明星蜂卵”：下一次孵化必出明星蜂 */
  starEggs: number;
  /** 累计蜂蜜产量（跨种区），用于里程碑 */
  honeyTotal: number;
}

export interface DailyTask {
  kind: string;
  target: number;
  progress: number;
  claimed: boolean;
  /** 领取时获得的蜂蜜 */
  reward: number;
}

export interface DailyState {
  /** 当前目标所属日期 YYYY-MM-DD */
  day: string;
  tasks: DailyTask[];
  bonusClaimed: boolean;
  /** 最近一次签到日期 */
  signedDay: string;
  /** 连续签到天数（1~7 循环） */
  streak: number;
  /** 预留：累计计数 */
  counts: Record<string, number>;
}

export interface GameState {
  meta: MetaState;
  run: RunState;
  activeColonyId: string;
  colonies: ColonySlot[];
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
