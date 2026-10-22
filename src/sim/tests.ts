declare const process: { argv: string[]; exit(code: number): never };
/**
 * P0 自动化测试（需求书十五）：大数、六边形、存档、迁移、离线、幂等、传承、分蜂回滚。
 */
import { BigNum, formatBig } from '../common/BigNum';
import { checksum } from '../common/Rng';
import { decodeSaveCode, encodeSaveCode } from '../common/SaveCode';
import { DEFAULT_CONFIG, validateConfig } from '../domain/GameConfig';
import { createInitialState } from '../domain/NewGame';
import { GameEngine } from '../domain/GameEngine';
import { buildHive } from '../domain/HiveService';
import { decodeEnvelope, encodeEnvelope, toDTO, SaveEnvelope } from '../domain/SaveCodec';
import { Bld, Res, Role, SeasonId, ThreatPhase, ThreatType } from '../domain/Types';
import { PresentationQueue } from '../app/PresentationQueue';
import { costMulFor } from '../domain/HiveService';
import { beeName, namePoolSize } from '../domain/BeeNames';
import { STAR_TRAITS } from '../domain/RosterService';
import { legacyAura } from '../domain/World';
import { Guide, INTRO_TOPICS } from '../domain/Guide';
import { softExponent } from '../domain/World';
import { buildArtManifest } from '../scene/ArtManifest';
import { REALM_MIN_GAP, insideTerritory, realmView, syncRealm } from '../domain/RealmService';

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, extra = '') {
  if (cond) { pass++; } else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

// ---------- 配置 ----------
ok(validateConfig(DEFAULT_CONFIG).length === 0, 'config schema valid', validateConfig(DEFAULT_CONFIG).join(';'));
ok(DEFAULT_CONFIG.tutorial.length === 8 && DEFAULT_CONFIG.tutorial[7].doneTask === 't_first_scout',
  'tutorial ends with the first scout (8 steps)');
ok(DEFAULT_CONFIG.economy.overflowDecayPerMin === 0.005, 'overflow decay reduced to 0.5% per minute');
ok(softExponent(40, 20) < 40 && softExponent(20, 20) === 20, 'segmented soft cap preserves threshold and softens tail');
const upgradeHoney = DEFAULT_CONFIG.tracks.map((track) => track.costs.find((cost) => cost.res === Res.Honey)).filter(Boolean);
ok(upgradeHoney.every((cost) => cost!.base >= 45 && cost!.base <= 50 && cost!.growth === 1.25),
  'attribute upgrades start at 45-50 honey and grow by 1.25x');
ok(DEFAULT_CONFIG.tracks.some((track) => track.id === 'scout.quality'), 'scout room includes nectar quality upgrade');

// ---------- 大数 ----------
const a = BigNum.of(1234.5);
ok(Math.abs(a.add(BigNum.of(765.5)).toNumber() - 2000) < 1e-9, 'bignum add');
ok(Math.abs(a.sub(BigNum.of(234.5)).toNumber() - 1000) < 1e-9, 'bignum sub');
ok(BigNum.of(3).sub(BigNum.of(5)).isNegative(), 'bignum negative');
ok(BigNum.of(3).sub(BigNum.of(5)).clamp0().isZero(), 'bignum clamp0');
const big = BigNum.fromLog10(Math.log10(20) + 10000 * Math.log10(1.15));
ok(big.e === 608, 'bignum fromLog10 huge', `${big.serialize()}`);
ok(BigNum.parse(big.serialize()).cmp(big) === 0, 'bignum serialize roundtrip');
ok(formatBig(BigNum.of(1500)) === '1500', 'format below 10k as integer', formatBig(BigNum.of(1500)));
ok(formatBig(BigNum.of(12000)) === '1.2万', 'format 万', formatBig(BigNum.of(12000)));
ok(formatBig(BigNum.of(2.5e9)) === '25亿', 'format 亿', formatBig(BigNum.of(2.5e9)));
ok(formatBig(BigNum.of(30000)) === '3万', 'format trims trailing zero', formatBig(BigNum.of(30000)));
ok(formatBig(big).indexOf('e608') > 0, 'format sci');
ok(BigNum.of(1e20).add(BigNum.of(1)).cmp(BigNum.of(1e20)) === 0, 'bignum precision guard');
ok(BigNum.parse('abc').isZero() && BigNum.parse('NaNe5').isZero(), 'bignum parse invalid -> 0');

// ---------- 六边形 ----------
const hv = buildHive(4);
const ringCounts = [0, 0, 0, 0, 0];
hv.cells.forEach((c) => { ringCounts[c.ring]++; });
ok(ringCounts.join(',') === '1,6,12,18,24', 'hex ring counts', ringCounts.join(','));
ok(new Set(hv.cells.map((c) => c.cellId)).size === hv.cells.length, 'hex unique ids');

// ---------- 引擎 + 存档 ----------
function runFor(eng: GameEngine, sec: number) {
  let acc = 0;
  for (let t = 0; t < sec; t += 0.1) {
    eng.step(0.1);
    acc += 0.2;
    if (acc >= 1) { eng.collect('f0', 1); acc -= 1; }
    const nextBuilding = [Bld.Brewery, Bld.ForagerRoom, Bld.ScoutRoom, Bld.Storage]
      .find((type) => eng.w.count(type) === 0 && eng.hive.buildingAvailable(type));
    const free = eng.run.hive.cells.find((c) => c.unlocked && c.building === '');
    if (nextBuilding && free) eng.build(free.cellId, nextBuilding);
    const target = eng.w.role(Role.House) === 0 ? Role.House : eng.w.role(Role.Forager) === 0 ? Role.Forager : Role.Scout;
    const queued = eng.run.colony.batches.some((b) => b.targetRole === target);
    if (eng.colony.roleAvailable(target) && !queued && !nextBuilding) {
      if (eng.run.colony.larvae < 1) eng.lay();
      eng.differentiate(target, 1);
    }
  }
}

const st = createInitialState(DEFAULT_CONFIG, 'tester', 1000, 777);
const eng = new GameEngine(DEFAULT_CONFIG, st);
ok(eng.run.map.fields.filter((field) => field.home).every((field) => field.stock === 20), 'home flowers start with 20 nectar');
const balanceState = createInitialState(DEFAULT_CONFIG, 'balance', 0, 777);
const balance = new GameEngine(DEFAULT_CONFIG, balanceState);
balance.run.hive.cells.find((cell) => cell.ring === 1)!.building = Bld.Brewery;
balance.run.colony.roles[Role.Forager] = 1;
balance.run.colony.roles[Role.House] = 1;
balance.hive.recomputeAdjacency();
balance.w.attrs.recompute();
const gatherRate = balance.w.attrs.get('forager.carry') / balance.map.tripTime(balance.run.map.fields[0]);
const honeyCapacity = balance.prod.estimateHoneyRate(1e6);
ok(gatherRate / honeyCapacity >= 1.15 && gatherRate / honeyCapacity <= 1.35,
  'initial forager travel+collection is balanced near 1.25:1 against honey conversion', `${gatherRate / honeyCapacity}`);
const farField = eng.run.map.fields.find((field) => !field.home && field.dist > eng.w.attrs.get('scout.range'))!;
eng.map.publishDiscovery(farField.fieldId);
ok(!farField.discovered, 'flowers outside scout range stay locked');
runFor(eng, 1500);
ok(eng.w.role(Role.Forager) > 0, 'forager by 25min');

const text = encodeEnvelope(eng.state, DEFAULT_CONFIG.configVersion, 5000);
const dec = decodeEnvelope(text);
ok(dec.ok && dec.state !== null, 'save decode ok', dec.error);
if (dec.state) {
  ok(JSON.stringify(toDTO(dec.state)) === JSON.stringify(toDTO(eng.state)), 'save roundtrip identical');
}

// 损坏检测
const env = JSON.parse(text) as SaveEnvelope;
env.payload = env.payload.replace('"time":', '"time":1');
const bad = decodeEnvelope(JSON.stringify(env));
ok(!bad.ok && bad.error === 'CHECKSUM', 'corrupt save detected', bad.error);
ok(!decodeEnvelope('{"x":').ok, 'truncated save rejected');
ok(!decodeEnvelope('').ok, 'empty save rejected');

// 迁移 v1 -> v2
const env1 = JSON.parse(text) as SaveEnvelope;
const payload1 = JSON.parse(env1.payload);
delete payload1.meta.featureUnlocks;
delete payload1.lastSettlementId;
env1.schemaVersion = 1;
env1.payload = JSON.stringify(payload1);
env1.checksum = checksum(env1.payload);
const mig = decodeEnvelope(JSON.stringify(env1));
ok(mig.ok && mig.migratedFrom === 1, 'migrate v1 ok', mig.error);
ok(mig.state !== null && mig.state.meta.featureUnlocks.length > 0, 'migrate restores featureUnlocks');
// 更新的 schema 拒绝（保护数据）
const envN = JSON.parse(text) as SaveEnvelope;
envN.schemaVersion = 99;
ok(decodeEnvelope(JSON.stringify(envN)).error === 'NEWER_SCHEMA', 'newer schema rejected');

// 非法数值修复
const envBad = JSON.parse(text) as SaveEnvelope;
const pb = JSON.parse(envBad.payload);
pb.run.colony.larvae = -5;
pb.run.res.honey = 'NaN';
pb.run.colony.roles.forager = 'x';
delete pb.meta.settings.musicVolume;
delete pb.meta.settings.ambientVolume;
delete pb.meta.settings.effectsVolume;
delete pb.meta.settings.eventAnimations;
delete pb.meta.settings.gameSpeed;
envBad.payload = JSON.stringify(pb);
envBad.checksum = checksum(envBad.payload);
const rep = decodeEnvelope(JSON.stringify(envBad));
ok(rep.ok && rep.state !== null && rep.state.run.colony.larvae === 0 && rep.state.run.res[Res.Honey].isZero() &&
  rep.state.run.colony.roles[Role.Forager] === 0, 'repair illegal values');
ok(rep.state !== null && rep.state.meta.settings.musicVolume === 80 && rep.state.meta.settings.eventAnimations &&
  rep.state.meta.settings.gameSpeed === 1 && rep.state.meta.settings.orientation === 'portrait',
  'repair adds new settings defaults');

// v2 -> v3：旧存档补齐方向与多蜂群容器
const env2 = JSON.parse(text) as SaveEnvelope;
const payload2 = JSON.parse(env2.payload);
delete payload2.activeColonyId;
delete payload2.colonies;
delete payload2.meta.settings.orientation;
env2.schemaVersion = 2;
env2.payload = JSON.stringify(payload2);
env2.checksum = checksum(env2.payload);
const mig2 = decodeEnvelope(JSON.stringify(env2));
ok(mig2.ok && mig2.state?.activeColonyId === 'colony-0' && mig2.state.colonies.length === 0 &&
  mig2.state.meta.settings.orientation === 'portrait', 'migrate v2 adds multi-colony and portrait orientation defaults');

// 已解锁巢格之间可无损移动或交换建筑
const swapState = createInitialState(DEFAULT_CONFIG, 'swap', 0, 12);
const swapEngine = new GameEngine(DEFAULT_CONFIG, swapState);
const swapA = swapEngine.run.hive.cells.find((cell) => cell.ring === 1)!;
const swapB = swapEngine.run.hive.cells.find((cell) => cell.ring === 1 && cell.cellId !== swapA.cellId)!;
swapA.building = Bld.Storage;
swapB.building = Bld.Brewery;
ok(swapEngine.swapCells(swapA.cellId, swapB.cellId).ok && swapA.building === Bld.Brewery && swapB.building === Bld.Storage,
  'unlocked hive cells swap buildings without demolition');

// 蜂巢到达最大圈层后，在 1~2 个四季轮回之间确定掉落时刻；超时后本群从零开始。
const fullHive = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'full-hive', 0, 121));
fullHive.run.hive.ringLevel = fullHive.w.region().maxRing;
const cycleLength = DEFAULT_CONFIG.seasons.filter((season) => season.id !== 'tutorial')
  .reduce((sum, season) => sum + fullHive.w.seasonDuration(season.id), 0);
ok(fullHive.hive.ensureFallDeadline() && fullHive.run.hive.fallAt >= cycleLength &&
  fullHive.run.hive.fallAt <= cycleLength * 2, 'full hive receives a random fall deadline between one and two cycles');
fullHive.run.res[Res.Honey] = BigNum.of(999);
fullHive.run.colony.roles[Role.House] = 9;
fullHive.run.hive.fallAt = 0.5;
fullHive.step(1);
ok(fullHive.run.time === 0 && fullHive.w.adults() === 0 && fullHive.w.econ.num(Res.Honey) === 0,
  'overdue full hive falls and current colony restarts from zero');

// ---------- 离线 ----------
const st2 = decodeEnvelope(text).state!;
const eng2 = new GameEngine(DEFAULT_CONFIG, st2);
const honeyBefore = eng2.w.econ.amount(Res.Honey);
const rpt = eng2.settleOffline(3 * 3600, 'S1', '');
ok(rpt !== null && rpt.credited === 3 * 3600 && rpt.truncated === 0, 'three-hour absence credited in full', rpt ? `${rpt.credited}/${rpt.truncated}` : 'null');
ok(eng2.settleOffline(3 * 3600, 'S1', '') === null, 'offline idempotent by settlementId');
ok(Object.keys(eng2.run.res).every((k) => !eng2.run.res[k].isNegative()), 'offline no negatives');
ok(eng2.w.adults() >= eng.w.adults(), 'offline no deaths');
ok(eng2.run.threats.active.filter((e) => e.type === 'bear' && e.phase === 'active').length === 0, 'offline no bear');
const r0 = eng2.settleOffline(0, 'S2', '');
ok(r0 !== null && r0.credited === 0, 'offline zero elapsed');
void honeyBefore;

const overnight = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'overnight', 0, 33));
ok(overnight.w.attrs.get('global.offlineHours') === DEFAULT_CONFIG.economy.offlineBaseHours,
  'offline attribute and economy defaults agree');
const nightReport = overnight.settleOffline(8 * 3600, 'night', '');
ok(nightReport?.credited === 8 * 3600 && nightReport.truncated === 0, 'eight-hour night credited in full');
const cappedReport = overnight.settleOffline(10 * 3600, 'long-night', '');
ok(cappedReport?.credited === 8 * 3600 && cappedReport.truncated === 2 * 3600, 'base offline cap is eight hours');
overnight.run.research.r_offline = 4;
overnight.w.attrs.recompute();
const researchReport = overnight.settleOffline(13 * 3600, 'researched-night', '');
ok(researchReport?.credited === 12 * 3600 && researchReport.truncated === 3600, 'max research credits twelve hours');
overnight.w.adj['evolution.center'] = 1.1;
overnight.w.attrs.recompute();
ok(overnight.w.attrs.get('global.offlineHours') === 12, 'central evolution bonus still respects twelve-hour cap');
const overnightReload = new GameEngine(DEFAULT_CONFIG, decodeEnvelope(encodeEnvelope(overnight.state, DEFAULT_CONFIG.configVersion, 0)).state!);
ok(overnightReload.w.attrs.get('global.offlineHours') === 12, 'offline extension survives save and reload');

// ---------- 首个建筑后低频敌害；没有守卫时只造成短暂、非致命干扰 ----------
const guardGate = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'guard-gate', 0, 19));
const webField = guardGate.run.map.fields[0];
webField.webbed = true;
guardGate.run.threats.enabled = true;
guardGate.run.threats.nextSpawnAt = 1e9;
guardGate.run.threats.active.push({ eventId: 'early', type: ThreatType.Web, targetId: webField.fieldId,
  phase: ThreatPhase.Active, hp: 10, maxHp: 10, startedAt: 0, endsAt: 0, postponed: 0, settled: false });
guardGate.step(0.1);
ok(guardGate.run.threats.enabled && guardGate.threats.activeList().length === 1 && webField.webbed &&
  guardGate.threats.activeList()[0].endsAt > guardGate.run.time,
  'early threat remains visible but receives a safe expiry without guards');
guardGate.step(76);
ok(guardGate.threats.activeList().length === 0 && !webField.webbed,
  'unguarded novice threat leaves without destroying the colony');
const guardCell = guardGate.run.hive.cells.find((c) => c.unlocked && c.building === '');
if (guardCell) { guardCell.building = Bld.GuardRoom; }
guardGate.run.colony.larvae = 1;
guardGate.run.colony.autoHatch = true;
guardGate.run.res[Res.Honey] = BigNum.of(1000);
guardGate.step(0.1);
ok(guardGate.run.colony.batches.length === 0, 'legacy auto flags cannot differentiate a guard');
guardGate.differentiate(Role.Guard, 1);
ok(guardGate.run.colony.batches.some((b) => b.targetRole === Role.Guard), 'player chooses first guard manually');
guardGate.run.res[Res.Honey] = BigNum.of(1000);
ok(Math.abs(guardGate.threats.bearTribute() - 100) < 1e-6, 'novice bear only takes a little honey');

// ---------- 100 次保存与重启 ----------
let cur = eng.state;
let firstHoney = '';
let drift = false;
for (let i = 0; i < 100; i++) {
  const t = encodeEnvelope(cur, DEFAULT_CONFIG.configVersion, 6000 + i);
  const d = decodeEnvelope(t);
  if (!d.ok || d.state === null) { drift = true; break; }
  const e = new GameEngine(DEFAULT_CONFIG, d.state);
  const h = e.w.econ.amount(Res.Honey).serialize();
  if (i === 0) firstHoney = h; else if (h !== firstHoney) { drift = true; }
  cur = e.state;
}
ok(!drift, '100 save/restart cycles without resource drift');

// ---------- 双击幂等 ----------
const st3 = decodeEnvelope(text).state!;
const eng3 = new GameEngine(DEFAULT_CONFIG, st3);
eng3.run.res[Res.Honey] = BigNum.of(100000);
eng3.run.res[Res.Wax] = BigNum.of(10000);
const cell = eng3.run.hive.cells.find((c) => c.unlocked && c.building === '');
if (cell) {
  const r1 = eng3.build(cell.cellId, Bld.Storage);
  const r2 = eng3.build(cell.cellId, Bld.Storage);
  ok(r1.ok && !r2.ok && r2.code === 'HIVE_OCCUPIED', 'double build only once');
}
const larvaBefore = eng3.run.colony.larvae;
eng3.run.colony.larvae = 2;
const d1 = eng3.differentiate(Role.Forager, 5);
ok(d1.ok && eng3.run.colony.larvae === 0, 'differentiate limited by larvae');
const batch = eng3.run.colony.batches[eng3.run.colony.batches.length - 1];
const hb = eng3.w.econ.amount(Res.Honey).toNumber();
const c1 = eng3.cancelBatch(batch.batchId);
const c2 = eng3.cancelBatch(batch.batchId);
ok(c1.ok && !c2.ok && eng3.w.econ.amount(Res.Honey).toNumber() > hb, 'cancel refunds once');
void larvaBefore;

// ---------- 传承与分蜂 ----------
const st4 = decodeEnvelope(text).state!;
const eng4 = new GameEngine(DEFAULT_CONFIG, st4);
const pv = eng4.swarmPreview();
const resPart = pv.sources[pv.sources.length - 1].points;
ok(resPart <= pv.total * 0.2 + 1e-9, 'resource bonus <= 20%', `${resPart}/${pv.total}`);
ok(!pv.ready && !eng4.swarm('alpine').ok, 'swarm blocked when not ready');
const queenEngine = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'queen-attempt', 0, 77));
queenEngine.run.res[Res.Jelly] = BigNum.of(500);
ok(!queenEngine.differentiateQueen().ok && queenEngine.w.econ.num(Res.Jelly) === 500, 'queen rearing needs a larva first');
queenEngine.run.colony.larvae = 1;
let queenTries = 0;
let queenChanceOk = true;
while (queenEngine.run.colony.youngQueens === 0 && queenTries < 60) {
  const expect = Math.min(1, 0.25 + 0.1 * queenTries);
  if (Math.abs(queenEngine.colony.queenChance() - expect) > 1e-9) queenChanceOk = false;
  queenTries += 1;
  queenEngine.differentiateQueen();
}
ok(queenChanceOk, 'queen chance starts at 25% and grows 10% per failure');
ok(queenTries <= 9, 'queen is guaranteed by the 9th try', `${queenTries}`);
ok(queenEngine.run.colony.youngQueens === 1 && queenEngine.run.colony.queenAttempts === queenTries &&
  queenEngine.run.colony.larvae === 0 && (queenEngine.run.colony.queenFails ?? 0) === 0 &&
  Math.abs(queenEngine.w.econ.num(Res.Jelly) - (500 - queenTries * 10 + (queenTries - 1) * 5)) < 1e-6,
  'queen rearing costs 10 jelly and a larva; failures refund half and keep the larva',
  `${queenEngine.run.colony.youngQueens}/${queenEngine.run.colony.queenAttempts}/${queenTries}/${queenEngine.w.econ.num(Res.Jelly)}/${queenEngine.run.colony.larvae}`);
queenEngine.run.res[Res.Jelly] = BigNum.of(9);
queenEngine.run.colony.larvae = 3;
ok(!queenEngine.differentiateQueen().ok && queenEngine.run.colony.larvae === 3, 'queen rearing needs 10 jelly');
eng4.state.meta.swarmCount = 50;
const eased = eng4.swarmPreview();
const easedHoney = eased.conditions.find((c) => c.id === 'honey');
ok(easedHoney !== undefined && easedHoney.target <= 12000, 'swarm honey target is capped');
ok(!eased.conditions.some((c) => c.id === 'winter' || c.id === 'pollinate'), 'repeat swarm removes season wait gates');
eng4.run.season.formal = true;
eng4.run.season.cycleIndex = 30;
const easedColony = eng4.prog.colonyTask();
ok(easedColony !== null && easedColony.target <= 5000, 'season reward target is capped');
eng4.state.meta.swarmCount = 0;
eng4.state.meta.inheritance.unlocked = true;
eng4.state.meta.inheritance.totalPoints = 10;
eng4.state.meta.inheritance.available = 10;
ok(eng4.investTalent('b_lay').ok && eng4.investTalent('b_lay').ok, 'invest talent');
ok(!eng4.investTalent('b_emerg').ok, 'talent prereq enforced');
eng4.prog.savePreset(0, 'A');
ok(eng4.resetTalents().ok && eng4.state.meta.inheritance.available === 10, 'talent reset keeps total');
ok(eng4.prog.loadPreset(0).ok && eng4.prog.talentLevel('b_lay') === 2, 'talent preset load');

// 强制满足分蜂条件并完成
const s5 = decodeEnvelope(text).state!;
const e5 = new GameEngine(DEFAULT_CONFIG, s5);
e5.run.colony.roles[Role.Forager] = 200;
e5.run.res[Res.Honey] = BigNum.of(1e6);
e5.run.res[Res.Wax] = BigNum.of(1e6);
e5.run.res[Res.Jelly] = BigNum.of(50);
e5.run.colony.youngQueens = 1;
e5.run.season.wintersSurvived = 1;
e5.run.stats.pollinations = 1;
e5.run.map.fields.forEach((f) => { f.discovered = true; });
for (const t of DEFAULT_CONFIG.tracks.slice(0, 6)) e5.run.upgrades[t.id] = 4;
const before5 = e5.state.meta.inheritance.totalPoints;
const gated = e5.swarm('rooftop');
ok(!gated.ok && gated.code === 'PROG_SWARM_GATE' && e5.run.colony.youngQueens === 1,
  'zone swarm is gated by colonies at the current location', gated.message);
ok(e5.prog.zoneColoniesNeeded(DEFAULT_CONFIG.regions.find((r) => r.id === 'rooftop')!) === 4 &&
  e5.prog.zoneColoniesNeeded(DEFAULT_CONFIG.regions.find((r) => r.id === 'rainy')!) === 2 &&
  e5.prog.zoneColoniesNeeded(DEFAULT_CONFIG.regions.find((r) => r.id === 'alpine')!) === 3, 'zone gates scale with difficulty (min 2)');
// 原地分蜂：只要新蜂后；带走一半；玩家留在原蜂群
const honeyBeforeLocal = e5.w.econ.num(Res.Honey);
const foragerBeforeLocal = e5.w.role(Role.Forager);
const activeBeforeLocal = e5.state.activeColonyId;
const localPv = e5.localPreview();
ok(localPv.ready && !localPv.sources.some((x) => x.label.startsWith('种区完成') || x.label.startsWith('难度')),
  'local swarm only needs a queen and pays eco/production points only');
const lsw = e5.swarmLocal();
ok(lsw.ok && e5.state.activeColonyId === activeBeforeLocal && e5.run.regionId === 'meadow' &&
  e5.state.colonies.length === 1 && e5.state.colonies[0].run.regionId === 'meadow' &&
  e5.w.role(Role.Forager) === foragerBeforeLocal - Math.floor(foragerBeforeLocal / 2) &&
  Math.abs(e5.w.econ.num(Res.Honey) - honeyBeforeLocal / 2) < 1e-6 && e5.run.colony.youngQueens === 0,
  'local swarm takes half the resources and bees, the player stays with the parent', lsw.message);
ok(e5.prog.regionColonies() === 2 && e5.state.meta.history.length === 1 && e5.state.meta.history[0].kind === 'local',
  'local swarm adds a colony at the same location');
ok(e5.localPreview().total === 0 || e5.localPreview().sources.some((x) => x.points < 0), 'points already paid by this colony are not paid twice');
ok(e5.state.colonies[0].name.includes('2号'), 'new colonies at the same place get a number', e5.state.colonies[0].name);
// 补齐到 4 个蜂群后才能去屋顶
for (let i = 0; i < 2; i++) {
  e5.state.colonies.push({ id: `extra-${i}`, name: 'x', run: decodeEnvelope(text).state!.run, lastActiveAt: 0 });
}
e5.run.res[Res.Honey] = BigNum.of(1e6);
e5.run.res[Res.Jelly] = BigNum.of(50);
e5.run.colony.roles[Role.Forager] = 200;
e5.run.colony.youngQueens = 1;
const adultsBeforeSwarm = e5.w.adults();
const sw = e5.swarm('rooftop');
ok(sw.ok, 'swarm executes', sw.message);
ok(e5.run.regionId === 'rooftop' && e5.run.time === 0 &&
  Math.abs(e5.w.adults() - adultsBeforeSwarm / 2) <= 2,
  'swarm carries half the adults to new region', `${adultsBeforeSwarm}/${e5.w.adults()}`);
ok(e5.state.meta.inheritance.totalPoints > before5 && e5.state.meta.swarmCount === 2, 'swarm grants points');
ok(e5.state.meta.codexFlowers.length > 0, 'swarm keeps codex');
ok(Object.keys(e5.run.upgrades).length === 0 && Object.keys(e5.run.research).length === 0, 'swarm resets upgrades');
const parentSlot = e5.state.colonies.find((slot) => slot.id === activeBeforeLocal)!;
ok(e5.state.colonies.length === 4 && parentSlot !== undefined && parentSlot.run.colony.roles[Role.Forager] === 100 &&
  Math.abs(e5.run.res[Res.Honey].toNumber() - parentSlot.run.res[Res.Honey].toNumber()) < 1e-6,
  'swarm splits adults and current resources equally while preserving original colony');
ok(e5.hive.constructionCostMul() === costMulFor(3) && costMulFor(0) === 1 && costMulFor(3) === 2.2 && e5.run.regionIndex === 1,
  'new hive cost multiplier only follows region difficulty', `${e5.hive.constructionCostMul()}`);
const multiSave = decodeEnvelope(encodeEnvelope(e5.state, DEFAULT_CONFIG.configVersion, 6000));
ok(multiSave.ok && multiSave.state?.colonies.length === 4 && multiSave.state.colonies[0].run.res[Res.Honey] instanceof BigNum &&
  multiSave.state.meta.history.length === 2 && multiSave.state.meta.colonyNames !== undefined,
  'multi-colony save roundtrip preserves BigNum resources');
const rooftopMax = Math.max(...e5.run.hive.cells.map((c) => c.ring));
ok(rooftopMax === 3, 'rooftop region rule maxRing=3', `${rooftopMax}`);

// 冬季结束只产生一条合并后的季节提示，避免“过冬成功”与“春季到了”重叠。
const seasonState = createInitialState(DEFAULT_CONFIG, 'season-popup', 0, 31);
const seasonEngine = new GameEngine(DEFAULT_CONFIG, seasonState);
seasonEngine.run.season.formal = true;
seasonEngine.run.season.season = 'winter';
seasonEngine.run.season.endsAt = 0;
seasonEngine.season.tick(0.1);
ok(seasonEngine.state.messages.filter((message) => message.kind === 'season').length === 1,
  'winter-to-spring emits one season notice');

// 大时间步/离线设备不会反复叠加新手期冬季延迟，恢复在线时间后可正常进入冬季准备。
const winterDelay = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'winter-delay', 0, 32));
winterDelay.run.season.formal = true;
winterDelay.run.season.season = 'autumn';
winterDelay.run.season.startedAt = 0;
winterDelay.run.season.endsAt = 10;
winterDelay.run.time = 100;
winterDelay.state.meta.totalPlayTime = 1200;
winterDelay.w.offline = true;
winterDelay.season.tick(90);
ok(winterDelay.run.season.endsAt === 700 && winterDelay.run.season.season === 'autumn',
  'winter novice delay uses one stable active-time deadline on large device time steps');
winterDelay.w.offline = false;
winterDelay.state.meta.totalPlayTime = 1800;
winterDelay.run.time = 700;
winterDelay.season.tick(0.1);
ok(winterDelay.run.season.season === 'winterPrep', 'winter preparation starts normally after novice protection');

// ---------- 越冬阶梯与储备失败 ----------
const s6 = decodeEnvelope(text).state!;
const e6 = new GameEngine(DEFAULT_CONFIG, s6);
ok(e6.season.winterNeed() === 100, 'first winter requires 100 honey');
e6.run.colony.roles[Role.Forager] = 3;
e6.run.hive.cells.find((cell) => cell.unlocked && cell.building === '')!.building = Bld.Storage;
e6.run.season.formal = true;
e6.run.season.season = SeasonId.WinterPrep;
e6.run.season.endsAt = e6.run.time;
e6.run.res[Res.Honey] = BigNum.of(99);
e6.step(0.1);
ok(e6.w.adults() === 0 && e6.w.count(Bld.Storage) === 0 && e6.w.econ.num(Res.Honey) === 0,
  'insufficient winter reserve restarts resources, population and buildings from zero');
ok(e6.state.messages.some((message) => message.text.includes('蜂巢死亡')),
  'winter failure records a clear hive death message');

const winterSuccess = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'winter-success', 0, 27));
winterSuccess.run.season.formal = true;
winterSuccess.run.season.season = SeasonId.WinterPrep;
winterSuccess.run.season.endsAt = winterSuccess.run.time;
winterSuccess.run.res[Res.Honey] = BigNum.of(100);
winterSuccess.step(0.1);
ok(winterSuccess.run.season.season === SeasonId.Winter && winterSuccess.w.econ.num(Res.Honey) === 0,
  'successful winter entry consumes the full fixed reserve once');
winterSuccess.run.season.wintersSurvived = 1;
ok(winterSuccess.season.winterNeed() === 300, 'second winter requires 300 honey');
winterSuccess.run.season.wintersSurvived = 2;
ok(winterSuccess.season.winterNeed() === 400, 'later winters increase by 100 honey');
winterSuccess.run.season.wintersSurvived = 50;
ok(winterSuccess.season.winterNeed() === 2500, 'winter reserve requirement is capped at 2500 honey');


// ---------- 引导：新事物介绍 + 提示行 ----------
const g0 = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'g', 0, 7));
const gd = new Guide(g0);
ok(gd.inTutorial(), 'guide: new game is in tutorial phase');
ok(gd.pendingIntro()?.id === 'flowers', 'guide: first intro is flowers', gd.pendingIntro()?.id);
gd.markSeen('flowers');
ok(gd.pendingIntro() === null, 'guide: nothing else before first nectar', gd.pendingIntro()?.id);
ok(gd.hints(2).some((h) => h.id === 'tap'), 'guide: hint suggests collecting');
g0.collect('f0', 1);
for (let i = 0; i < 30; i++) { g0.step(0.1); }
ok(gd.pendingIntro() === null && gd.hints(2).some((hint) => hint.id === 'brewery' && hint.text.includes('第 2/8 步')),
  'guide: tutorial advances with one contextual numbered goal instead of another popup', gd.pendingIntro()?.id);
ok(new Set(INTRO_TOPICS.map((t) => t.id)).size === INTRO_TOPICS.length, 'guide: unique topic ids');
const encG = encodeEnvelope(g0.state, DEFAULT_CONFIG.configVersion, 1);
const decG = decodeEnvelope(encG).state!;
ok(decG.meta.introsSeen.indexOf('flowers') >= 0, 'guide: introsSeen persists in save');
// 旧存档（无 introsSeen 且已有进度）：已满足的介绍不会一次弹出
const legacyEnv = JSON.parse(encodeEnvelope(s6, DEFAULT_CONFIG.configVersion, 1));
const legacyPayload = JSON.parse(legacyEnv.payload);
delete legacyPayload.meta.introsSeen;
legacyEnv.payload = JSON.stringify(legacyPayload);
legacyEnv.checksum = checksum(legacyEnv.payload);
const legacyState = decodeEnvelope(JSON.stringify(legacyEnv)).state;
ok(legacyState !== null, 'guide: legacy save decodes');
if (legacyState !== null) {
  const lg = new Guide(new GameEngine(DEFAULT_CONFIG, legacyState));
  const first = lg.pendingIntro();
  ok(first === null || !['flowers', 'honey', 'queen', 'scout'].includes(first.id), 'guide: legacy save skips old intros', first?.id);
}

// ---------- 主动繁育、花源瓶颈与引导交接 ----------
{
  const manual = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'manual', 0, 11));
  const cell = manual.run.hive.cells.find((c) => c.unlocked && c.building === '')!;
  cell.building = Bld.ForagerRoom;
  manual.run.tasksDone.push('t_first_forager'); // 低人口紧急状态也不能自行繁育
  manual.run.res[Res.Honey] = BigNum.of(390);
  manual.run.colony.larvae = 1;
  manual.setAuto(true, true);
  manual.run.colony.autoLay = true; manual.run.colony.autoHatch = true;
  for (let i = 0; i < 300; i++) manual.step(0.1);
  ok(manual.run.colony.eggsLaid === 0 && manual.run.colony.batches.length === 0,
    'manual breeding: auto switches and emergency state do not spend honey');
  const cost0 = manual.colony.eggCost()[0].amount.toNumber();
  ok(manual.lay().ok, 'manual egg hatching succeeds');
  const cost1 = manual.colony.eggCost()[0].amount.toNumber();
  ok(cost1 >= cost0 + 1 && Number.isInteger(cost1), 'next egg has a visibly higher integer cost before any adult is born');
  manual.run.colony.roles[Role.Forager] = 9;
  ok(manual.colony.eggCost()[0].amount.toNumber() === cost1, 'egg cost depends on cumulative eggs, not adult population');
  manual.run.colony.roles[Role.Forager] = 0;
  manual.differentiate(Role.Forager, 1);
  manual.settleOffline(120, 'manual-offline', '');
  ok(manual.run.colony.eggsLaid === 1 && manual.w.role(Role.Forager) === 1,
    'offline finishes a manually started batch without breeding additional bees');
  const savedManual = decodeEnvelope(encodeEnvelope(manual.state, DEFAULT_CONFIG.configVersion, 1)).state!;
  ok(!savedManual.run.colony.autoLay && !savedManual.run.colony.autoHatch, 'save restores manual breeding');

  const flowers = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'flowers', 0, 12));
  const field = flowers.run.map.fields[0];
  const initialStock = field.stock;
  for (let i = 0; i < 100 && field.stock > 0; i++) flowers.collect(field.fieldId, 10);
  // 连击最多 +50%，仍以花丛实际存量为基础
  ok(field.stock === 0 && flowers.w.econ.num(Res.Nectar) <= initialStock * 1.5 + 1e-6,
    'manual harvest is bounded by actual flower stock');
  const nectar = flowers.w.econ.num(Res.Nectar);
  ok(!flowers.collect(field.fieldId, 1).ok && flowers.w.econ.num(Res.Nectar) === nectar,
    'empty flowers cannot create nectar');
  const remaining = flowers.map.recoveryRemaining(field);
  ok(remaining > 0 && remaining <= DEFAULT_CONFIG.economy.flowerRecoverSec + 1e-6, 'flower recovery wait matches the configured interval');
  for (let i = 0; i < 10; i++) flowers.step(0.1);
  ok(field.stock === 0 && flowers.map.recoveryRemaining(field) < remaining,
    'empty flowers wait through a visible recovery interval');
  const decoded = decodeEnvelope(encodeEnvelope(flowers.state, DEFAULT_CONFIG.configVersion, 1)).state!;
  const restored = new GameEngine(DEFAULT_CONFIG, decoded);
  ok(Math.abs(restored.map.recoveryRemaining(restored.run.map.fields[0]) - flowers.map.recoveryRemaining(field)) < 1e-6,
    'flower countdown persists through reload');
  const scoutCell = flowers.run.hive.cells.find((c) => c.unlocked && c.building === '')!;
  scoutCell.building = Bld.ScoutRoom;
  flowers.run.res[Res.Honey] = BigNum.of(390);
  const oldMax = flowers.map.maxStock(field);
  ok(flowers.upgrade('scout.stock').ok && flowers.map.maxStock(field) > oldMax, 'scout upgrade increases flower stock');
  const oldWait = flowers.map.recoveryRemaining(field);
  ok(flowers.upgrade('scout.regrowth').ok && flowers.map.recoveryRemaining(field) < oldWait,
    'scout upgrade shortens an active flower recovery countdown');
  for (let i = 0; i < 100; i++) flowers.step(0.1);
  ok(field.stock > 0, 'flowers reopen after recovery');

  const chain = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'chain', 0, 15));
  const baseCapacity = chain.prod.baseConvertCapacity() + chain.prod.brewCapacity();
  ok(!chain.hive.buildingAvailable(Bld.ForagerRoom) && !chain.hive.buildingAvailable(Bld.ScoutRoom),
    'collecting and scouting rooms are initially gated');
  runFor(chain, 900);
  ok(chain.w.count(Bld.Brewery) > 0 && chain.prod.baseConvertCapacity() + chain.prod.brewCapacity() > baseCapacity * 3,
    'brewery materially improves conversion immediately');
  ok(chain.run.stats.firstForagerAt >= 0 && chain.run.stats.firstScoutAt > chain.run.stats.firstForagerAt,
    'full opening reaches forager before scout');
  ok(chain.state.meta.tutorialDone && chain.w.count(Bld.Storage) > 0,
    'tutorial and subsequent storage unlock work without automatic breeding');
  const guide = new Guide(chain);
  ok(guide.pendingIntro()?.id === 'handover', 'handover popup takes priority at tutorial completion');
  guide.markSeen('handover');
  ok(guide.pendingIntro()?.id !== 'handover', 'handover is shown only once');
  const legacyGuide = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'legacy-guide', 0, 16));
  legacyGuide.state.meta.tutorialStep = 6; // 旧版“储蜜格”步骤
  legacyGuide.run.tasksDone.push('t_first_nectar');
  legacyGuide.prog.tutorialTick();
  ok(legacyGuide.state.meta.tutorialStep === 1 && !legacyGuide.state.meta.tutorialDone,
    'old tutorial step is recalculated from actual tasks');
  legacyGuide.run.hive.cells.find((c) => c.unlocked && c.building === '')!.building = Bld.ScoutRoom;
  legacyGuide.run.colony.roles[Role.Scout] = 1;
  legacyGuide.prog.tutorialTick();
  ok(legacyGuide.state.meta.tutorialDone && legacyGuide.w.count(Bld.Storage) === 0,
    'first completed scout ends tutorial before storage is built');
  console.log(`Opening: brewery built, forager ${chain.run.stats.firstForagerAt.toFixed(1)}s, scout ${chain.run.stats.firstScoutAt.toFixed(1)}s`);
}

// ---------------- 繁育计划 ----------------
{
  const plan = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'plan', 0, 21));
  ok(!plan.run.colony.plan.on && !plan.colony.planUnlocked(), 'breeding plan starts off and locked');
  ok(!plan.setBreedPlan(true).ok, 'breeding plan cannot start before it unlocks');
  const freeCell = () => plan.run.hive.cells.find((c) => c.unlocked && c.building === '')!;
  plan.run.tasksDone.push('t_first_nectar', 't_first_house', 't_first_forager', 't_first_scout', 't_survive_winter');
  [Bld.Brewery, Bld.ForagerRoom, Bld.ScoutRoom].forEach((b) => { freeCell().building = b; });
  plan.run.colony.larvae = 1;
  ok(plan.colony.planUnlocked() && plan.setBreedPlan(true).ok, 'breeding plan unlocks mid-game');
  plan.run.res[Res.Honey] = BigNum.of(380);
  for (let i = 0; i < 1200; i++) { plan.step(0.5); plan.run.res[Res.Nectar] = BigNum.of(200); }
  ok(plan.w.adults() >= 5 && plan.w.role(Role.Forager) > plan.w.role(Role.Scout), 'breeding plan raises bees by ratio', plan.roleSummary());
  ok(plan.run.colony.larvae >= 1, 'breeding plan leaves manually laid larvae alone');
  ok(plan.w.econ.num(Res.Honey) + 1 >= plan.colony.planReserveHoney() * 0.9, 'breeding plan keeps the honey reserve');
  const adults = plan.w.adults();
  plan.settleOffline(1800, 'plan-offline', '');
  ok(plan.w.adults() > adults || plan.w.population() >= plan.w.popCap(), 'breeding plan keeps breeding offline');
  const saved = decodeEnvelope(encodeEnvelope(plan.state, DEFAULT_CONFIG.configVersion, 1)).state!;
  ok(saved.run.colony.plan.on && saved.run.colony.plan.weights[Role.Forager] === 6, 'breeding plan survives save and load');
}

// ---------------- 手动采集：连击与蜜流花 ----------------
{
  const tap = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'tap', 0, 22));
  const field = tap.run.map.fields[0];
  field.stock = 1000;
  tap.collect(field.fieldId, 1);
  const single = tap.w.econ.num(Res.Nectar);
  for (let i = 0; i < 30; i++) { tap.step(0.3); field.stock = 50; tap.collect(field.fieldId, 1); }
  ok(tap.map.comboMultiplier() > 1.2, 'steady manual collecting builds a combo bonus', `${tap.map.comboMultiplier()}`);
  for (let i = 0; i < 10; i++) tap.step(0.5);
  ok(tap.map.comboMultiplier() === 1, 'combo resets after a pause');
  ok(single > 0, 'first tap still collects nectar');
  tap.state.meta.tutorialDone = true;
  for (let i = 0; i < 1400 && tap.map.activeBloom() === null; i++) tap.step(0.1);
  const bloom = tap.map.activeBloom();
  ok(bloom !== null, 'a honey bloom opens after the tutorial');
  if (bloom !== null) {
    const honey = tap.w.econ.num(Res.Honey);
    const r = tap.collect(bloom.fieldId, 1);
    ok(r.ok && tap.w.econ.num(Res.Honey) >= honey + 19 && tap.map.activeBloom() === null, 'tapping a honey bloom grants honey once', r.message);
  }
  const reloaded = decodeEnvelope(encodeEnvelope(tap.state, DEFAULT_CONFIG.configVersion, 1)).state!;
  ok(reloaded.run.map.bloom !== undefined && reloaded.run.map.bloom.nextAt > 0, 'honey bloom timer survives save and load');
}

// ---------------- 每日签到与目标 ----------------
{
  const dly = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'daily', 0, 23));
  dly.ensureDay('2026-10-18');
  ok(dly.daily.state.tasks.length === 3, 'three daily goals are generated');
  const honey0 = dly.w.econ.num(Res.Honey);
  ok(dly.dailySign().ok && dly.w.econ.num(Res.Honey) > honey0, 'daily sign-in grants honey');
  ok(!dly.dailySign().ok, 'cannot sign in twice on the same day');
  dly.ensureDay('2026-10-19');
  ok(dly.daily.nextStreak() === 2 && dly.dailySign().ok && dly.daily.state.streak === 2, 'consecutive sign-ins build a streak');
  dly.ensureDay('2026-10-21');
  ok(dly.daily.nextStreak() === 1, 'a missed day restarts the streak');
  const goals = dly.daily.state.tasks;
  goals.forEach((t) => { dly.w.dailyBump(t.kind, t.target * 2); });
  ok(goals.every((t) => t.progress === t.target), 'daily progress is capped at the target');
  ok(!dly.dailyBonus().ok, 'daily bonus needs all goals claimed first');
  goals.forEach((_t, i) => dly.dailyClaim(i));
  const jelly = dly.w.econ.num(Res.Jelly);
  ok(dly.dailyBonus().ok && dly.w.econ.num(Res.Jelly) >= jelly + 2 && !dly.dailyBonus().ok, 'daily bonus pays jelly once');
  const days = decodeEnvelope(encodeEnvelope(dly.state, DEFAULT_CONFIG.configVersion, 1)).state!;
  ok(days.meta.daily.day === '2026-10-21' && days.meta.daily.bonusClaimed, 'daily state survives save and load');
  const manual = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'daily2', 0, 24));
  manual.ensureDay('2026-10-18');
  manual.daily.state.tasks[0] = { kind: 'collect', target: 5, progress: 0, claimed: false, reward: 60 };
  for (let i = 0; i < 5; i++) manual.collect(manual.run.map.fields[0].fieldId, 1);
  ok(manual.daily.state.tasks[0].progress === 5, 'manual collecting counts toward daily goals');
}

// ---------------- 存档码 ----------------
{
  const src = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'code', 0, 25));
  for (let i = 0; i < 400; i++) src.step(0.5);
  src.state.messages.push({ id: 9999, kind: 'info', text: '中文与表情🐝也要原样保留', at: 1 } as never);
  const env = encodeEnvelope(src.state, DEFAULT_CONFIG.configVersion, 1);
  const code = encodeSaveCode(env);
  ok(code.startsWith('XFDY1-') && code.length < env.length, 'save code is shorter than the raw save', `${code.length}/${env.length}`);
  ok(decodeSaveCode(code) === env, 'save code round-trips exactly');
  ok(decodeSaveCode(`  请保存：${code}  `) === env, 'save code tolerates surrounding text');
  ok(decodeSaveCode('XFDY1-AAAA') !== env && !decodeEnvelope(decodeSaveCode('XFDY1-AAAA') ?? '').ok, 'damaged save code is rejected');
  ok(decodeSaveCode('hello') === null, 'random text is not a save code');
}

// ---------- 2026-10-19 敌害节奏、奖励、亲手驱赶与提示队列 ----------
{
  const ts = createInitialState(DEFAULT_CONFIG, 'threat-tap', 0, 31);
  ts.meta.tutorialDone = true;
  const te = new GameEngine(DEFAULT_CONFIG, ts);
  te.run.threats.enabled = true;
  te.run.threats.nextSpawnAt = te.run.time + 400;
  te.step(0.1);
  ok(te.run.threats.nextSpawnAt > te.run.time + 300, 'formal-phase spawn timer is no longer clamped to under a minute every tick');
  const f = te.run.map.fields[0];
  f.webbed = true;
  te.run.threats.nextSpawnAt = 1e9;
  te.run.threats.active.push({ eventId: 'tap1', type: ThreatType.Web, targetId: f.fieldId,
    phase: ThreatPhase.Active, hp: 30, maxHp: 30, startedAt: 0, endsAt: 0, postponed: 0, settled: false });
  const probe = { eventId: 'combo-probe', type: ThreatType.Wasp, targetId: f.fieldId,
    phase: ThreatPhase.Active, hp: 1000, maxHp: 1000, startedAt: 0, endsAt: 0, postponed: 0, settled: false };
  te.run.threats.active.push(probe);
  for (let i = 0; i < 4; i++) { te.run.time += 0.2; te.swatThreat(probe.eventId); }
  const beforeCritical = probe.hp;
  ok(!te.swatThreat(probe.eventId).ok, 'throttled taps do not advance combo');
  te.run.time += 0.2;
  const criticalHit = te.swatThreat(probe.eventId);
  ok(criticalHit.message.includes('暴击') && Math.abs(beforeCritical - probe.hp - te.threats.swatDamage() * 2) < 1e-9, 'fifth consecutive hit deals double damage');
  te.run.time += 1.6;
  const beforeReset = probe.hp;
  const resetHit = te.swatThreat(probe.eventId);
  ok(!resetHit.message.includes('连击') && Math.abs(beforeReset - probe.hp - te.threats.swatDamage()) < 1e-9, 'combo expires after 1.5 seconds');
  te.run.threats.active = te.run.threats.active.filter((t) => t !== probe);
  const honey0 = te.w.econ.num(Res.Honey);
  let taps = 0;
  let last = '';
  while (taps < 80 && te.threats.activeList().length > 0) { te.step(0.2); last = te.swatThreat('tap1').message; taps++; }
  let expectedTaps = 0;
  while ((expectedTaps + Math.floor(expectedTaps / 5)) * te.threats.swatDamage() < 30) expectedTaps++;
  ok(te.threats.activeList().length === 0 && !f.webbed && taps === expectedTaps, 'combo critical damage reduces taps needed to clear a web', `${taps} taps`);
  ok(last.startsWith('亲手击退') && te.w.econ.num(Res.Honey) > honey0, 'hand clear pays honey', last);
  ok((te.run.threats.streak ?? 0) === 1 && (te.run.threats.swats ?? 0) >= taps, 'streak and swat counters advance');
  te.threats.honeyPerSec = () => 100;
  const big = te.threats.rewardFor(ThreatType.Wasp, false).find((r) => r.res === Res.Honey)?.amount ?? 0;
  const mine = te.threats.rewardFor(ThreatType.Wasp, true).find((r) => r.res === Res.Honey)?.amount ?? 0;
  ok(big >= 2000 && mine > big, 'threat reward scales with hive production and hand kills earn more', `${big}/${mine}`);
  te.run.threats.streak = 4;
  const jelly0 = te.w.econ.num(Res.Jelly);
  te.run.threats.active.push({ eventId: 'tap2', type: ThreatType.Wasp, targetId: f.fieldId,
    phase: ThreatPhase.Active, hp: 1, maxHp: 40, startedAt: te.run.time, endsAt: te.run.time + 150, postponed: 0, settled: false });
  te.step(0.2); te.swatThreat('tap2');
  ok(te.w.econ.num(Res.Jelly) >= jelly0 + 1 - 1e-9, 'every fifth consecutive clear grants royal jelly');
  ok(te.swatThreat('tap2').ok === false, 'a cleared threat cannot be paid twice');
}
{
  const q = new PresentationQueue();
  q.enqueue({ key: 'a', text: 'old', kind: 'threat', duration: 1000, createdAt: 0, ttl: 5000 });
  ok(q.tick(60000, false) === null, 'stale notices expire instead of popping up late');
  q.enqueue({ key: 'b', text: 'w1', kind: 'threat', duration: 1000, createdAt: 60000, ttl: 5000 });
  q.enqueue({ key: 'c', text: 'w2', kind: 'threat', duration: 1000, createdAt: 60000, ttl: 5000 });
  ok(q.tick(60001, false)?.text === 'w2' && q.tick(61500, false) === null, 'only the newest threat notice is kept');
}

// ---------- 2026-10-19 后期循环：名册、明星蜂、王国、篇章、季节事件、保卫战、传承加成 ----------
{
  // 名字：名字池够大，前 3000 只蜜蜂不重名
  const names = new Set<string>();
  for (let i = 0; i < 3000; i++) names.add(beeName(i, 123));
  ok(namePoolSize() > 1000 && names.size === 3000, 'bee names are unique across thousands of bees', `${namePoolSize()}`);

  const rs = createInitialState(DEFAULT_CONFIG, 'roster', 0, 41);
  rs.meta.tutorialDone = true;
  const re = new GameEngine(DEFAULT_CONFIG, rs);
  re.run.colony.roles[Role.Forager] = 6;
  re.run.colony.roles[Role.House] = 3;
  re.step(1.05);
  ok(re.roster.byRole(Role.Forager).length === 6 && re.roster.byRole(Role.House).length === 3, 'roster follows role counts');
  ok(new Set(re.roster.list().map((b) => b.n)).size === re.roster.list().length, 'every bee in the roster has a different name');
  re.run.colony.roles[Role.Forager] = 4;
  re.step(1.05);
  ok(re.roster.byRole(Role.Forager).length === 4, 'roster drops bees when the colony shrinks');
  // 孵化：记录出生季节；明星蜂卵必出明星蜂，并给全巢加成
  re.run.season.cycleIndex = 2;
  re.run.season.season = 'summer';
  const carryBefore = re.w.attrs.get('forager.carry');
  re.kingdom.state().starEggs = 1;
  const cell = re.run.hive.cells.find((c) => c.unlocked && c.building === '');
  if (cell) cell.building = Bld.ForagerRoom;
  re.run.colony.larvae = 1;
  re.run.res[Res.Honey] = BigNum.of(1e6);
  re.differentiate(Role.Forager, 1);
  for (let i = 0; i < 400 && re.roster.stars().length === 0; i++) re.step(0.5);
  const star = re.roster.stars()[0];
  ok(star !== undefined && star.c === 2 && star.s === 'summer' && STAR_TRAITS.some((t) => t.id === star.t && t.role === Role.Forager),
    'a star egg hatches a named star bee with its birth season', star === undefined ? 'none' : `${star.n}/${star.t}/${star.c}/${star.s}`);
  ok(re.roster.birthText(star!).includes('第 3 轮夏天'), 'birth text shows the cycle and season', re.roster.birthText(star!));
  const starStat = STAR_TRAITS.find((t) => t.id === star!.t)!.stat;
  ok(re.roster.bonus(starStat).pct >= 0.1 && re.w.attrs.parts[starStat].some((p) => p.layer === 'star'), 'star bee bonus reaches the colony attributes', `${carryBefore}`);
  re.run.res[Res.Jelly] = BigNum.of(50);
  const up = re.roster.upgradeStar(star!.id);
  ok(up.ok && star!.lv === 2 && Math.abs(re.roster.bonus(starStat).pct - 0.15) < 1e-9, 'star bees level up with honey and royal jelly', up.message);
  // 明星蜂美术：画面按显示顺序把名字对应到蜜蜂上，明星蜂排在最前，一定能在画面上看到
  ok(re.roster.traitOf(star!.id) === star!.t && re.roster.traitOf(re.roster.byRole(Role.Forager).find((b) => b.t === undefined)!.id) === '',
    'trait lookup tells star bees from normal bees');
  ok(re.roster.displayOrder(Role.Forager)[0].id === star!.id && re.roster.displayOrder(Role.Forager).length === re.roster.byRole(Role.Forager).length,
    'star bees are drawn first so they always appear on screen');
  // 工作记录：采集蜂运输次数随产量增长
  const fr = re.roster.byRole(Role.Forager);
  const rates = new (re.rateView.constructor as new () => typeof re.rateView)();
  rates.nectarIn = 300;
  re.roster.attribute(1, rates);
  ok(fr.reduce((n, b) => n + b.a, 0) >= 10, 'forager trips are credited to named bees');
  // 存档往返保留名册与王国
  const back = decodeEnvelope(encodeEnvelope(re.state, DEFAULT_CONFIG.configVersion, 1)).state!;
  ok((back.run.colony.roster ?? []).length === re.roster.list().length && back.meta.kingdom!.starEggs === 0 &&
    (back.meta.nameSeq ?? 0) >= re.roster.list().length, 'roster, star and kingdom survive save and load');
}
{
  // 传承加成：每点 +2%
  const ls = createInitialState(DEFAULT_CONFIG, 'legacy', 0, 43);
  const le = new GameEngine(DEFAULT_CONFIG, ls);
  const base = le.w.attrs.get('house.brewSpeed');
  le.state.meta.inheritance.totalPoints = 10;
  le.w.attrs.recompute();
  ok(Math.abs(le.w.attrs.get('house.brewSpeed') / base - (1 + legacyAura(10))) < 1e-9 && legacyAura(10) === 0.2,
    'each inheritance point permanently adds 2% production');
  // 王国：经验升级、发奖、研究上限
  le.state.meta.tutorialDone = true;
  const honey0 = le.w.econ.num(Res.Honey);
  le.w.gainXp(le.kingdom.need(1) + le.kingdom.need(2) + 1);
  le.step(1.05);
  ok(le.kingdom.state().level >= 3 && le.w.econ.num(Res.Honey) > honey0, 'kingdom xp levels up and pays rewards');
  ok(le.kingdom.need(30) > le.kingdom.need(5) && le.kingdom.need(30) < 300, 'kingdom levels stay reachable later on', `${le.kingdom.need(5)}/${le.kingdom.need(30)}`);
  le.kingdom.state().level = 10;
  const r0 = DEFAULT_CONFIG.research.find((r) => r.id === 'r_flight')!;
  const off = DEFAULT_CONFIG.research.find((r) => r.id === 'r_offline')!;
  ok(le.prog.researchMax(r0) === r0.maxLevel + 1 && le.prog.researchMax(off) === off.maxLevel, 'every 10 kingdom levels raise research caps (except offline)');
  // 篇章：按顺序推进，只发一次奖
  le.state.meta.kingdom!.level = 1;
  const before = le.kingdom.chapter().index;
  le.run.colony.roles[Role.Forager] = 40;
  le.step(1.05);
  le.step(1.05);
  const after = le.kingdom.chapter();
  ok(before === 0 && after.index === 1 && after.current !== null && after.current.metric === 'fields', 'chapters advance one goal at a time in order', `${before}->${after.index}`);
  ok(le.run.tasksDone.filter((id) => id.startsWith('ch_')).length === 1, 'a chapter goal is rewarded once');
}
{
  // 季节事件：春夏秋开头出现；广告选项必须看完广告；效果与延迟发放
  const es = createInitialState(DEFAULT_CONFIG, 'events', 0, 47);
  es.meta.tutorialDone = true;
  const ee = new GameEngine(DEFAULT_CONFIG, es);
  const cellF = ee.run.hive.cells.find((c) => c.unlocked && c.building === '');
  if (cellF) cellF.building = Bld.ForagerRoom;
  ee.run.colony.roles[Role.Forager] = 10;
  ee.run.season.formal = true;
  ee.run.season.season = 'summer';
  ee.run.season.startedAt = ee.run.time;
  ee.run.season.endsAt = ee.run.time + 300;
  for (let i = 0; i < 40 && ee.events.view() === null; i++) ee.step(1);
  const view = ee.events.view();
  ok(view !== null && view.options.length >= 2 && view.options.some((o) => o.ad), 'a season event appears with choices and an ad option', view?.id ?? 'none');
  const adOpt = view!.options.find((o) => o.ad)!;
  ok(!ee.events.choose(adOpt.id).ok, 'ad-only choices need a finished ad');
  ee.run.season.event = { id: 'farbloom', key: 'k1', until: ee.run.time + 100, resolved: false };
  ee.w.econ.add(Res.Honey, BigNum.of(10), 'test', 't');
  const h0 = ee.w.econ.num(Res.Honey);
  ok(ee.events.choose('send').ok && ee.events.effects().some((fx) => fx.stat === 'forager.carry'), 'sending foragers away halves carrying for a minute');
  for (let i = 0; i < 65; i++) ee.step(1);
  ok(ee.w.econ.num(Res.Honey) > h0 + 50 && ee.events.effects().length === 0, 'far bloom honey arrives later and the effect expires');
  ok(ee.events.view() === null, 'a resolved event does not come back the same season');
}
{
  // 保卫战：第一个冬天后的秋天开始，三波后胜利；离开时撤退不扣蜂蜜
  const rs2 = createInitialState(DEFAULT_CONFIG, 'raid', 0, 53);
  rs2.meta.tutorialDone = true;
  const ra = new GameEngine(DEFAULT_CONFIG, rs2);
  ra.run.threats.enabled = true;
  ra.run.threats.nextSpawnAt = 1e9;
  ra.run.threats.nextBearAt = 1e9;
  ra.run.season.formal = true;
  ra.run.season.cycleIndex = 1;
  ra.run.season.season = 'autumn';
  ra.run.season.startedAt = ra.run.time;
  ra.run.season.endsAt = ra.run.time + 400;
  // 拍打伤害等于守卫攻击：给足攻击力，专心测保卫战流程
  ra.run.upgrades['guard.attack'] = 25;
  ra.run.upgrades['guard.range'] = 20;
  ra.w.attrs.recompute();
  for (let i = 0; i < 30 && !ra.threats.raidActive(); i++) ra.step(1);
  ok(ra.threats.raidActive() && ra.run.threats.raid?.phase === 'warn', 'the hive defense raid starts in autumn after the first winter');
  for (let i = 0; i < 40 && ra.run.threats.raid?.phase === 'warn'; i++) ra.step(1);
  let guard = 0;
  while (ra.run.threats.raid?.phase === 'fight' && guard < 400) {
    guard++;
    ra.threats.activeList().filter((t) => t.raid === true).forEach((t) => ra.swatThreat(t.eventId));
    ra.step(0.2);
  }
  ok(ra.run.threats.raid?.phase === 'won' && (ra.state.meta.raidWins ?? 0) === 1 && ra.state.meta.skins.includes('warbanner'),
    'clearing three waves and the wasp king wins the raid', ra.run.threats.raid?.phase);
  const bossSeen = ra.run.threats.active.some((t) => t.boss === true);
  ok(bossSeen, 'the third wave brings the wasp king');
  ra.run.season.cycleIndex = 2;
  ra.run.threats.raid = { cycle: 2, phase: 'fight', wave: 1, startedAt: ra.run.time, endsAt: ra.run.time + 100, kills: 0, playerKills: 0 };
  const honeyBefore = ra.w.econ.num(Res.Honey);
  ra.settleOffline(600, 'raid-off', '');
  ok(ra.run.threats.raid?.phase === 'skipped' && ra.w.econ.num(Res.Honey) >= honeyBefore, 'leaving during a raid does not lose honey');
}
{
  // 分蜂：明星蜂优先跟随新蜂后，两边名册与数量一致
  const ss = createInitialState(DEFAULT_CONFIG, 'split', 0, 59);
  const se = new GameEngine(DEFAULT_CONFIG, ss);
  se.run.colony.roles[Role.Forager] = 20;
  se.step(1.05);
  const roster = se.roster.list();
  roster[0].t = 'lightning'; roster[0].lv = 1;
  roster[5].t = 'bigbelly'; roster[5].lv = 2;
  const split = se.roster.split(roster, { forager: 10, scout: 0, house: 0, guard: 0 });
  ok(split.go.length === 10 && split.stay.length === 10 && split.go.filter((b) => b.t !== undefined).length === 2,
    'swarm takes half the bees and all star bees go with the new queen');
}

{
  // 敌害致死：新手阶段只受伤；新手结束后会咬死蜜蜂，强度随轮回上升，守卫能减少伤亡
  const mkWasp = (seedName: string, tutorialDone: boolean, cycle: number, guards: number): GameEngine => {
    const st = createInitialState(DEFAULT_CONFIG, seedName, 0, 61);
    st.meta.tutorialDone = tutorialDone;
    const en = new GameEngine(DEFAULT_CONFIG, st);
    const cells = en.run.hive.cells.filter((c) => c.unlocked && c.building === '');
    cells[0].building = Bld.ForagerRoom;
    if (guards > 0) cells[1].building = Bld.GuardRoom;
    en.hive.reindex();
    en.run.colony.roles[Role.Forager] = 40;
    en.run.colony.roles[Role.Guard] = guards;
    en.run.season.cycleIndex = cycle;
    en.run.threats.enabled = true;
    en.run.threats.nextSpawnAt = 1e9;
    en.run.threats.nextBearAt = 1e9;
    const f = en.run.map.fields[0];
    // 打不死的胡蜂，专门观察致死速度
    en.run.threats.active.push({ eventId: 'w1', type: ThreatType.Wasp, targetId: f.fieldId, phase: ThreatPhase.Active,
      hp: 1e9, maxHp: 1e9, startedAt: 0, endsAt: 1e9, postponed: 0, settled: false });
    en.w.attrs.recompute();
    return en;
  };
  const novice = mkWasp('lethal-novice', false, 0, 0);
  for (let i = 0; i < 300; i++) novice.step(0.5);
  ok(novice.w.role(Role.Forager) === 40 && (novice.run.stats.beesLost ?? 0) === 0, 'before the tutorial ends threats never kill bees');
  const early = mkWasp('lethal-early', true, 0, 0);
  for (let i = 0; i < 300; i++) early.step(0.5);
  const earlyLost = 40 - early.w.role(Role.Forager);
  ok(earlyLost >= 1 && earlyLost <= 2 && (early.run.stats.beesLost ?? 0) === earlyLost && early.run.threats.active[0].killed === earlyLost,
    'after the tutorial a wasp kills foragers (capped per wasp)', `${earlyLost}`);
  ok(early.roster.list().filter((b) => b.r === Role.Forager).length === early.w.role(Role.Forager) &&
    early.state.messages.some((m) => m.kind === 'loss' && m.text.includes('被胡蜂咬死了')), 'dead bees leave the roster by name');
  const late = mkWasp('lethal-late', true, 4, 0);
  for (let i = 0; i < 180; i++) late.step(0.5);
  const lateLost = 40 - late.w.role(Role.Forager);
  const earlyQuick = mkWasp('lethal-early2', true, 0, 0);
  for (let i = 0; i < 180; i++) earlyQuick.step(0.5);
  ok(late.threats.power() > 2 && lateLost > 40 - earlyQuick.w.role(Role.Forager) && late.threats.killCap(late.run.threats.active[0]) > 1,
    'threats grow deadlier every four-season cycle', `${lateLost}/${40 - earlyQuick.w.role(Role.Forager)}`);
  const guarded = mkWasp('lethal-guarded', true, 4, 30);
  for (let i = 0; i < 180; i++) guarded.step(0.5);
  ok(40 - guarded.w.role(Role.Forager) < lateLost && guarded.threats.defenseView().mitig < 0.3,
    'guards cut the losses', `${40 - guarded.w.role(Role.Forager)}/${lateLost}`);
  const off = mkWasp('lethal-offline', true, 4, 0);
  off.settleOffline(1800, 'lethal-off', '');
  ok(off.w.role(Role.Forager) === 40, 'no bees die during offline settlement');
}
{
  // 熊：采集蜂巢房建成后才出没，约 30% 判定概率；赶不走 25% 毁巢、75% 上缴蜂蜜；击退有奖励
  const mkBear = (seedNum: number, forager: boolean): GameEngine => {
    const st = createInitialState(DEFAULT_CONFIG, `bear-${seedNum}`, 0, seedNum);
    st.meta.tutorialDone = true;
    const en = new GameEngine(DEFAULT_CONFIG, st);
    const cell = en.run.hive.cells.find((c) => c.unlocked && c.building === '')!;
    if (forager) cell.building = Bld.ForagerRoom;
    else cell.building = Bld.Brewery;
    en.hive.reindex();
    en.run.threats.enabled = true;
    en.run.threats.nextSpawnAt = 1e9;
    en.run.res[Res.Honey] = BigNum.of(1000);
    en.run.colony.roles[Role.House] = 10;
    en.w.attrs.recompute();
    return en;
  };
  const noRoom = mkBear(201, false);
  for (let i = 0; i < 4000; i++) noRoom.step(1);
  ok((noRoom.run.stats.bearsCome ?? 0) === 0 && noRoom.threats.pendingBear() === null, 'no bear before the first forager room');
  let checks = 0;
  let bears = 0;
  for (let k = 0; k < 40; k++) {
    const en = mkBear(300 + k, true);
    for (let i = 0; i < 3 * 3600; i += 5) {
      en.step(5);
      const bear = en.threats.pendingBear();
      if (bear !== null) { bear.settled = true; bear.phase = ThreatPhase.Expired; }
    }
    checks += Math.floor(3 * 3600 / 450);
    bears += en.run.stats.bearsCome ?? 0;
  }
  const rate = bears / checks;
  ok(rate > 0.15 && rate < 0.45, 'bears show up at random about 30% of checks after the forager room', `${bears}/${checks}`);
  let destroyed = 0;
  let paid = 0;
  for (let k = 0; k < 60; k++) {
    const en = mkBear(500 + k, true);
    en.run.threats.active.push({ eventId: 'b1', type: ThreatType.Bear, targetId: 'hive', phase: ThreatPhase.Active,
      hp: 1e9, maxHp: 1e9, startedAt: 0, endsAt: 1, postponed: 0, settled: false });
    en.step(1.05);
    if (en.w.adults() === 0 && en.w.econ.num(Res.Honey) === 0 && (en.state.meta.hivesLost ?? 0) === 1) destroyed++;
    else if (Math.abs(en.w.econ.num(Res.Honey) - 800) < 50) paid++;
  }
  ok(destroyed > 5 && destroyed < 28 && destroyed + paid === 60, 'an unrepelled bear wrecks the hive 25% of the time, otherwise bees pay honey', `${destroyed}/${paid}`);
  const novice = mkBear(700, true);
  novice.state.meta.tutorialDone = false;
  novice.run.threats.active.push({ eventId: 'b2', type: ThreatType.Bear, targetId: 'hive', phase: ThreatPhase.Active,
    hp: 1e9, maxHp: 1e9, startedAt: 0, endsAt: 1, postponed: 0, settled: false });
  novice.step(1.05);
  ok(novice.w.adults() === 10 && Math.abs(novice.w.econ.num(Res.Honey) - 900) < 50, 'a novice bear never wrecks the hive');
  const swat = mkBear(800, true);
  swat.run.threats.nextBearAt = 1e9;
  swat.run.threats.active.push({ eventId: 'b3', type: ThreatType.Bear, targetId: 'hive', phase: ThreatPhase.Warning,
    hp: 260, maxHp: 260, startedAt: 0, endsAt: 60, postponed: 0, settled: false });
  ok(!swat.bearChoice('b3', 'tribute').ok && swat.bearChoice('b3', 'defend').ok && swat.threats.pendingBear()?.phase === 'active',
    'bear choices: only defend (or the ad) remain');
  let taps = 0;
  const hp0 = swat.threats.pendingBear()!.hp;
  swat.swatThreat('b3');
  taps++;
  ok(Math.abs(hp0 - swat.threats.pendingBear()!.hp - swat.threats.guardAttack()) < 1e-9, 'a swat deals exactly one guard attack');
  swat.step(0.13);
  swat.run.upgrades['guard.attack'] = 10;
  swat.w.attrs.recompute();
  while (swat.threats.pendingBear() !== null && taps < 400) { taps++; swat.swatThreat('b3'); swat.step(0.13); }
  ok(swat.threats.pendingBear() === null && swat.run.stats.bearsRepelled === 1 && taps > 40, 'swatting drives the bear away, guard upgrades make swats stronger', `${taps}`);
}
{
  // 冬季也有季节事件；保卫战第 3 轮起 4 波
  const ws = createInitialState(DEFAULT_CONFIG, 'winter-ev', 0, 71);
  ws.meta.tutorialDone = true;
  const we = new GameEngine(DEFAULT_CONFIG, ws);
  we.run.season.formal = true;
  we.run.season.season = 'winter';
  we.run.season.startedAt = we.run.time;
  we.run.season.endsAt = we.run.time + 240;
  we.run.res[Res.Honey] = BigNum.of(1000);
  for (let i = 0; i < 30 && we.events.view() === null; i++) we.step(1);
  const wv = we.events.view();
  ok(wv !== null && (wv.id === 'cold' || wv.id === 'sunny'), 'winter has a season event too', wv?.id ?? 'none');
  we.run.season.event = { id: 'cold', key: 'kc', until: we.run.time + 100, resolved: false };
  const loss0 = we.w.attrs.get('storage.winterLoss');
  ok(we.events.choose('huddle').ok && we.w.attrs.get('storage.winterLoss') < loss0, 'huddling lowers winter upkeep');
  ok(we.threats.raidWaves(1) === 3 && we.threats.raidWaves(3) === 4, 'raids have 3 waves early and 4 later');
}
{
  // 冬季将至和冬季没有熊；入冬时还在的熊回去冬眠
  const hs = createInitialState(DEFAULT_CONFIG, 'hibernate', 0, 91);
  hs.meta.tutorialDone = true;
  const he = new GameEngine(DEFAULT_CONFIG, hs);
  he.run.season.formal = true;
  he.run.season.season = 'winterPrep';
  he.run.season.startedAt = 0; he.run.season.endsAt = 1e9;
  ok(!he.threats.bearSeasonOk(), 'no bear can come before or during winter');
  he.run.threats.active.push({ eventId: 'hb', type: ThreatType.Bear, targetId: 'hive', phase: ThreatPhase.Active,
    hp: 300, maxHp: 300, startedAt: 0, endsAt: 1e9, postponed: 0, settled: false });
  const honeyH = he.w.econ.num(Res.Honey);
  he.step(0.1);
  ok(he.threats.pendingBear() === null && he.w.adults() === 0 && he.w.econ.num(Res.Honey) >= honeyH, 'a bear still around at winter leaves without a fight');
  he.run.season.season = 'autumn'; he.run.season.endsAt = he.run.time + 100;
  ok(!he.threats.bearSeasonOk(), 'no bear in the last minutes of autumn');
  // 向日葵、油菜花容量
  ok(DEFAULT_CONFIG.flowers.find((f) => f.id === 'sunflower')!.maxStock <= 100 && DEFAULT_CONFIG.flowers.find((f) => f.id === 'rapeseed')!.maxStock <= 110,
    'sunflower and rapeseed capacity are moderate');
}
{
  // 王国地图：原地分蜂的新蜂巢落在同一张地图上，领地、共用花田、托管运转、继承属性、取名
  const ks = createInitialState(DEFAULT_CONFIG, 'realm', 0, 97);
  ks.meta.tutorialDone = true;
  const ke = new GameEngine(DEFAULT_CONFIG, ks);
  const cells = ke.run.hive.cells.filter((c) => c.unlocked && c.building === '');
  cells[0].building = Bld.ForagerRoom; cells[1].building = Bld.Brewery; cells[2].building = Bld.ScoutRoom;
  ke.hive.reindex();
  ke.run.upgrades['forager.carry'] = 6;
  ke.run.colony.roles[Role.Forager] = 30; ke.run.colony.roles[Role.House] = 10;
  ke.run.map.fields.forEach((f, i) => { if (i < 8) { f.discovered = true; f.intelExpiresAt = 1e9; } });
  ke.run.season.formal = true; ke.run.season.season = 'summer'; ke.run.season.startedAt = 0; ke.run.season.endsAt = 300;
  ke.run.colony.youngQueens = 1;
  ke.run.res[Res.Honey] = BigNum.of(2000);
  const parentFields = ke.run.map.fields.length;
  ok(ke.swarmLocal().ok, 'local swarm with a queen');
  const parent = ke.run;
  const slot = ke.state.colonies[0];
  const child = slot.run;
  const region = DEFAULT_CONFIG.regions.find((r) => r.id === parent.regionId)!;
  const realm = ke.state.meta.realms?.[parent.regionId];
  ok(realm !== undefined && parent.realm !== undefined && !parent.realm.daughter && child.realm !== undefined && child.realm.daughter,
    'both hives sit on one kingdom map, the original and the daughter are told apart');
  const gap = Math.hypot(child.realm!.x - parent.realm!.x, child.realm!.y - parent.realm!.y);
  ok(gap >= region.maxRadius * REALM_MIN_GAP - 1e-6 && gap < parent.realm!.r + child.realm!.r, 'the new hive keeps a minimum distance but territories overlap', `${Math.round(gap)}`);
  ok(realm!.fields.length > parentFields && child.map.fields.filter((f) => f.home).length === 2, 'the daughter gets its own fields around it');
  ok(child.map.fields.filter((f) => !f.home).every((f) => insideTerritory(child.realm!, f.x + child.realm!.x, f.y + child.realm!.y)),
    'a hive only holds fields inside its own territory');
  const shared = child.map.fields.filter((f) => parent.map.fields.some((p) => p.fieldId === f.fieldId));
  ok(shared.length > 0 && shared.every((f) => f.share === 0.5), 'overlapping fields are shared and their regrowth is split', `${shared.length}`);
  ok(child.upgrades['forager.carry'] === 3 && child.colony.plan.on && child.season.formal && child.season.season === 'summer' &&
    child.hive.cells.some((c) => c.building === Bld.ForagerRoom), 'the daughter inherits layout, half the upgrades, the breeding plan and the season');
  ok((ke.state.meta.namePending ?? []).includes(slot.id), 'every new hive asks for a name');
  ok(ke.renameColony(slot.id, '  花溪蜜庄  ').ok && ke.state.meta.colonyNames?.[slot.id] === '花溪蜜庄' && !(ke.state.meta.namePending ?? []).includes(slot.id),
    'naming a hive stores the name');
  ok(!ke.renameColony(slot.id, '   ').ok, 'empty names are rejected');
  // 托管运转 + 同步：共用花田两边存量一致
  const bg = GameEngine.background(DEFAULT_CONFIG, ke.state, slot.id, child);
  const t0 = child.time;
  for (let i = 0; i < 300; i++) { ke.step(0.1); bg.step(0.1); syncRealm(ke.state, parent.regionId); }
  ok(child.time > t0 + 29 && bg.w.background && shared.every((f) => Math.abs(f.stock - parent.map.fields.find((p) => p.fieldId === f.fieldId)!.stock) < 1e-6),
    'the background hive runs in real time and shared fields stay in sync');
  ok(realmView(ke.state, DEFAULT_CONFIG)!.hives.length === 2, 'the map view shows both hives');
  // 被熊毁巢重开：保留位置和领地
  const pos = { ...parent.realm! };
  ke.threats.hiveLost = 'bear';
  ke.step(0.1);
  ok(ke.run !== parent && ke.run.realm !== undefined && ke.run.realm.x === pos.x && ke.run.map.fields.length > 2,
    'a wrecked hive restarts at the same spot on the kingdom map');
}
{
  // 每款皮肤（经典除外）都有自己的建筑图集
  const art = buildArtManifest();
  const missing = DEFAULT_CONFIG.skins.filter((skin) => skin.id !== 'classic' && !art.has(`atlas_skin_${skin.id}`)).map((skin) => skin.id);
  ok(missing.length === 0, `every hive skin has building art (missing: ${missing.join(',')})`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
