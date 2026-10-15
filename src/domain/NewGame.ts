import { BigNum } from '../common/BigNum';
import { Rng } from '../common/Rng';
import { ForageStrategy, GameConfigDef, GuardPriority, RegionDef, Res, Role, SeasonId, ALL_RES } from './Types';
import { buildHive } from './HiveService';
import {
  ColonyState, FlowerField, GameState, InheritanceState, MapState, MetaState, RunState, RunStats, SeasonState,
  SettingsState, ThreatState
} from './State';

function zeroRes(): Record<string, BigNum> {
  const r: Record<string, BigNum> = {};
  ALL_RES.forEach((k: string) => {
    r[k] = BigNum.zero();
  });
  return r;
}

function regionById(cfg: GameConfigDef, id: string): RegionDef {
  for (let i = 0; i < cfg.regions.length; i++) {
    if (cfg.regions[i].id === id) {
      return cfg.regions[i];
    }
  }
  return cfg.regions[0];
}

function flowerStock(cfg: GameConfigDef, id: string): number {
  for (let i = 0; i < cfg.flowers.length; i++) {
    if (cfg.flowers[i].id === id) {
      return cfg.flowers[i].maxStock;
    }
  }
  return 100;
}

function flowerTier(cfg: GameConfigDef, id: string): number {
  for (let i = 0; i < cfg.flowers.length; i++) {
    if (cfg.flowers[i].id === id) {
      return cfg.flowers[i].tier;
    }
  }
  return 1;
}

/** 可复现种子生成花田（MAP-008）；越远产量越高、危险越大（MAP-002） */
export function generateFields(cfg: GameConfigDef, region: RegionDef, rng: Rng): FlowerField[] {
  const out: FlowerField[] = [];
  // 两处近处花丛：开局即可手动采集，永久有效
  for (let i = 0; i < 2; i++) {
    const a = -Math.PI / 2 + (i === 0 ? -0.7 : 0.75) + rng.range(-0.15, 0.15);
    const d = region.minRadius + rng.range(0, 30);
    const id = region.flowerPool[0];
    const f: FlowerField = {
      fieldId: `f${i}`, flower: id, x: Math.cos(a) * d, y: Math.sin(a) * d, dist: d, level: 1,
      stock: flowerStock(cfg, id) * 0.8, danger: 0, discovered: true, intelExpiresAt: 1e12, danceBonusUntil: 0,
      growth: 0, home: true, hidden: false, webbed: false
    };
    out.push(f);
  }
  const n = region.fieldCount;
  const span = region.maxRadius - region.minRadius;
  for (let i = 0; i < n; i++) {
    const t = (i + rng.range(0.2, 0.8)) / n;
    const d = region.minRadius + 50 + span * Math.pow(t, 1.15);
    const a = rng.range(0, Math.PI * 2);
    const tierWant = 1 + Math.floor(t * (region.flowerPool.length + 0.5));
    const candidates = region.flowerPool.filter((fid: string) => flowerTier(cfg, fid) <= Math.max(1, tierWant - 1) + 1);
    const pool = candidates.length > 0 ? candidates : region.flowerPool;
    const pick = pool[Math.min(pool.length - 1, Math.floor(rng.next() * pool.length * (0.4 + t)))];
    const fid = pick === undefined ? region.flowerPool[0] : pick;
    const f: FlowerField = {
      fieldId: `f${i + 2}`, flower: fid, x: Math.cos(a) * d, y: Math.sin(a) * d, dist: d,
      level: flowerTier(cfg, fid), stock: flowerStock(cfg, fid) * rng.range(0.5, 0.9),
      danger: Math.min(0.8, 0.04 + 0.6 * Math.pow(d / region.maxRadius, 1.6)), discovered: false, intelExpiresAt: 0,
      danceBonusUntil: 0, growth: 0, home: false, hidden: false, webbed: false
    };
    out.push(f);
  }
  // 稀有花田：需要稀有发现率判定才能被侦察到
  for (let i = 0; i < 2; i++) {
    const d = region.minRadius + span * rng.range(0.55, 0.95);
    const a = rng.range(0, Math.PI * 2);
    const f: FlowerField = {
      fieldId: `r${i}`, flower: region.rareFlower, x: Math.cos(a) * d, y: Math.sin(a) * d, dist: d, level: 4,
      stock: flowerStock(cfg, region.rareFlower) * 0.7, danger: Math.min(0.85, 0.2 + 0.5 * d / region.maxRadius),
      discovered: false, intelExpiresAt: 0, danceBonusUntil: 0, growth: 0, home: false, hidden: true, webbed: false
    };
    out.push(f);
  }
  return out;
}

function newStats(): RunStats {
  const s: RunStats = {
    firstNectarAt: -1, firstEggAt: -1, firstScoutAt: -1, firstDanceAt: -1, firstForagerAt: -1, autoLoopAt: -1,
    firstExpandAt: -1, firstStorageAt: -1, firstWinterAt: -1, peakPop: 0, pollinations: 0, rareFound: 0,
    bearsRepelled: 0, manualCollects: 0, houseWaxMade: 0, deliveredNectar: 0, autoLays: 0
  };
  return s;
}

export function createRun(cfg: GameConfigDef, regionId: string, regionIndex: number, seed: number,
  startLarvae: number): RunState {
  const region = regionById(cfg, regionId);
  const rng = new Rng(seed);
  const roles: Record<string, number> = {};
  const injured: Record<string, number> = {};
  const ratio: Record<string, number> = {};
  [Role.Scout, Role.Forager, Role.House, Role.Guard].forEach((r: string) => {
    roles[r] = 0;
    injured[r] = 0;
  });
  ratio[Role.Scout] = 1;
  ratio[Role.Forager] = 6;
  ratio[Role.House] = 3;
  ratio[Role.Guard] = 1;
  const colony: ColonyState = {
    larvae: startLarvae, roles: roles, injured: injured, batches: [], nextBatchId: 1, layCooldown: 0,
    autoLay: false, autoHatch: false, autoRatio: ratio, houseWaxShare: 0.25, forageStrategy: ForageStrategy.Balanced,
    pollinators: {}, guardPriority: GuardPriority.Balanced, eggsLaid: 0, hatched: 0, lifeDebt: 0, collapsed: false
  };
  const map: MapState = { fields: generateFields(cfg, region, rng), scouts: [], nextScoutId: 1 };
  const season: SeasonState = {
    formal: false, season: SeasonId.Tutorial, startedAt: 0, endsAt: 0, cycleIndex: 0, firstWinterProtected: true,
    wintersSurvived: 0, starving: false, starveSeconds: 0
  };
  const threats: ThreatState = { active: [], nextSpawnAt: 0, nextBearAt: 0, nextId: 1, cleared: 0, enabled: false };
  const res = zeroRes();
  res[Res.Honey] = BigNum.of(regionIndex > 0 ? 40 : 0);
  const run: RunState = {
    regionId: region.id, regionIndex: regionIndex, seed: seed, rngState: rng.state, time: 0, res: res,
    overflow: zeroRes(), produced: zeroRes(), hive: buildHive(region.maxRing), upgrades: {}, research: {},
    colony: colony, map: map, season: season, threats: threats, tasksDone: [], tasksClaimed: [],
    colonyTaskCycle: -1, stats: newStats()
  };
  return run;
}

export function createInitialState(cfg: GameConfigDef, playerId: string, now: number, seed: number): GameState {
  const inh: InheritanceState = { totalPoints: 0, available: 0, nodes: {}, presets: [], resets: 0, unlocked: false };
  const settings: SettingsState = {
    music: true, sfx: true, musicVolume: 80, ambientVolume: 65, effectsVolume: 75,
    vibration: true, particles: true, reduceMotion: false, eventAnimations: true, gameSpeed: 1,
    ecoMode: false, skin: 'classic',
    continuation: false, privacyAccepted: false, privacyVersion: '', fontScaleSafe: true
  };
  const meta: MetaState = {
    playerId: playerId, createdAt: now, totalPlayTime: 0, swarmCount: 0, regionsVisited: [cfg.regions[0].id],
    codexFlowers: [], codexThreats: [], achievements: [], skins: ['classic'], inheritance: inh, settings: settings,
    tutorialStep: 0, tutorialDone: false, history: [], totalWinters: 0, featureUnlocks: [], introsSeen: []
  };
  const gs: GameState = {
    meta: meta, run: createRun(cfg, cfg.regions[0].id, 0, seed, 0), messages: [], nextMessageId: 1, ledger: [],
    nextLedgerId: 1, lastSavedAt: now, lastTrustedTime: now, lastSettlementId: ''
  };
  return gs;
}
