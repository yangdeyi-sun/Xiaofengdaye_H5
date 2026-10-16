declare const process: { argv: string[]; exit(code: number): never };
/**
 * P0 自动化测试（需求书十五）：大数、六边形、存档、迁移、离线、幂等、传承、分蜂回滚。
 */
import { BigNum, formatBig } from '../common/BigNum';
import { checksum } from '../common/Rng';
import { DEFAULT_CONFIG, validateConfig } from '../domain/GameConfig';
import { createInitialState } from '../domain/NewGame';
import { GameEngine } from '../domain/GameEngine';
import { buildHive } from '../domain/HiveService';
import { decodeEnvelope, encodeEnvelope, toDTO, SaveEnvelope } from '../domain/SaveCodec';
import { Bld, Res, Role, ThreatPhase, ThreatType } from '../domain/Types';
import { Guide, INTRO_TOPICS } from '../domain/Guide';
import { softExponent } from '../domain/World';

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

// ---------- 大数 ----------
const a = BigNum.of(1234.5);
ok(Math.abs(a.add(BigNum.of(765.5)).toNumber() - 2000) < 1e-9, 'bignum add');
ok(Math.abs(a.sub(BigNum.of(234.5)).toNumber() - 1000) < 1e-9, 'bignum sub');
ok(BigNum.of(3).sub(BigNum.of(5)).isNegative(), 'bignum negative');
ok(BigNum.of(3).sub(BigNum.of(5)).clamp0().isZero(), 'bignum clamp0');
const big = BigNum.fromLog10(Math.log10(20) + 10000 * Math.log10(1.15));
ok(big.e === 608, 'bignum fromLog10 huge', `${big.serialize()}`);
ok(BigNum.parse(big.serialize()).cmp(big) === 0, 'bignum serialize roundtrip');
ok(formatBig(BigNum.of(1500)) === '1.5K', 'format K', formatBig(BigNum.of(1500)));
ok(formatBig(BigNum.of(2.5e9)) === '2.5B', 'format B', formatBig(BigNum.of(2.5e9)));
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
  rep.state.meta.settings.gameSpeed === 1, 'repair adds new settings defaults');

// ---------- 离线 ----------
const st2 = decodeEnvelope(text).state!;
const eng2 = new GameEngine(DEFAULT_CONFIG, st2);
const honeyBefore = eng2.w.econ.amount(Res.Honey);
const rpt = eng2.settleOffline(3 * 3600, 'S1', '');
ok(rpt !== null && rpt.credited === 2 * 3600 && rpt.truncated === 3600, 'offline capped 2h', rpt ? `${rpt.credited}/${rpt.truncated}` : 'null');
ok(eng2.settleOffline(3 * 3600, 'S1', '') === null, 'offline idempotent by settlementId');
ok(Object.keys(eng2.run.res).every((k) => !eng2.run.res[k].isNegative()), 'offline no negatives');
ok(eng2.w.adults() >= eng.w.adults(), 'offline no deaths');
ok(eng2.run.threats.active.filter((e) => e.type === 'bear' && e.phase === 'active').length === 0, 'offline no bear');
const r0 = eng2.settleOffline(0, 'S2', '');
ok(r0 !== null && r0.credited === 0, 'offline zero elapsed');
void honeyBefore;

// ---------- 敌害开放时机与首只守卫 ----------
const guardGate = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'guard-gate', 0, 19));
const webField = guardGate.run.map.fields[0];
webField.webbed = true;
guardGate.run.threats.enabled = true;
guardGate.run.threats.active.push({ eventId: 'early', type: ThreatType.Web, targetId: webField.fieldId,
  phase: ThreatPhase.Active, hp: 10, maxHp: 10, startedAt: 0, endsAt: 0, postponed: 0, settled: false });
guardGate.step(0.1);
ok(!guardGate.run.threats.enabled && guardGate.threats.activeList().length === 0 && !webField.webbed,
  'threats wait for first guard and old early threat retires');
const guardCell = guardGate.run.hive.cells.find((c) => c.unlocked && c.building === '');
if (guardCell) { guardCell.building = Bld.GuardRoom; }
guardGate.run.colony.larvae = 1;
guardGate.run.colony.autoHatch = true;
guardGate.run.res[Res.Honey] = BigNum.of(1000);
guardGate.step(0.1);
ok(guardGate.run.colony.batches.length === 0, 'legacy auto flags cannot differentiate a guard');
guardGate.differentiate(Role.Guard, 1);
ok(guardGate.run.colony.batches.some((b) => b.targetRole === Role.Guard), 'player chooses first guard manually');
guardGate.run.res[Res.Honey] = BigNum.of(1e9);
ok(guardGate.threats.bearTribute() <= 600, 'bear tribute is capped in first cycle');

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
e5.run.res[Res.Jelly] = BigNum.of(50);
e5.run.season.wintersSurvived = 1;
e5.run.stats.pollinations = 1;
e5.run.map.fields.forEach((f) => { f.discovered = true; });
for (const t of DEFAULT_CONFIG.tracks.slice(0, 6)) e5.run.upgrades[t.id] = 4;
const before5 = e5.state.meta.inheritance.totalPoints;
const sw = e5.swarm('rooftop');
ok(sw.ok, 'swarm executes', sw.message);
ok(e5.run.regionId === 'rooftop' && e5.run.time === 0 && e5.w.adults() === 0, 'swarm creates new region');
ok(e5.state.meta.inheritance.totalPoints > before5 && e5.state.meta.swarmCount === 1, 'swarm grants points');
ok(e5.state.meta.codexFlowers.length > 0, 'swarm keeps codex');
ok(Object.keys(e5.run.upgrades).length === 0 && Object.keys(e5.run.research).length === 0, 'swarm resets upgrades');
const rooftopMax = Math.max(...e5.run.hive.cells.map((c) => c.ring));
ok(rooftopMax === 3, 'rooftop region rule maxRing=3', `${rooftopMax}`);

// ---------- 首冬保护 ----------
const s6 = decodeEnvelope(text).state!;
const e6 = new GameEngine(DEFAULT_CONFIG, s6);
e6.run.res[Res.Honey] = BigNum.zero();
e6.run.res[Res.Nectar] = BigNum.zero();
e6.run.colony.roles[Role.Forager] = 300;
e6.run.map.fields.forEach((f) => { f.stock = 0; });
e6.season.startFormal();
e6.run.season.season = 'winter';
e6.run.season.endsAt = e6.run.time + 100;
const adults6 = e6.w.adults();
let starvedSeen = false;
for (let i = 0; i < 600; i++) { e6.step(0.1); starvedSeen = starvedSeen || e6.run.season.starving; }
ok(starvedSeen && e6.w.adults() === adults6, 'first winter: starving but no deaths/injury loss');
ok(e6.w.injured(Role.Forager) === 0, 'first winter protected: no injuries');

// ---------- 后续冬季链式衰败 ----------
const decline = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'decline', 0, 27));
decline.run.colony.roles[Role.House] = 10;
decline.run.colony.hatched = 10;
decline.run.tasksDone.push('t_first_house');
decline.run.tasksClaimed.push('t_first_house');
decline.season.startFormal();
decline.run.season.season = 'winter';
decline.run.season.endsAt = decline.run.time + 300;
decline.run.season.firstWinterProtected = false;
decline.run.res[Res.Honey] = BigNum.zero();
decline.run.res[Res.Nectar] = BigNum.zero();
for (let i = 0; i < 2000; i++) { decline.step(0.1); }
ok(decline.run.season.starveSeconds >= 190 && decline.w.injured(Role.House) > 0,
  'later winter applies warning and injury stages');
ok(decline.w.adults() < 10 && decline.w.adults() > 0, 'long starvation causes gradual, non-instant losses');


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
ok(gd.pendingIntro()?.id === 'honey', 'guide: honey intro after first nectar', gd.pendingIntro()?.id);
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
  ok(field.stock === 0 && flowers.w.econ.num(Res.Nectar) <= initialStock + 1e-6,
    'manual harvest is bounded by actual flower stock');
  const nectar = flowers.w.econ.num(Res.Nectar);
  ok(!flowers.collect(field.fieldId, 1).ok && flowers.w.econ.num(Res.Nectar) === nectar,
    'empty flowers cannot create nectar');
  const remaining = flowers.map.recoveryRemaining(field);
  ok(remaining > 0 && remaining <= DEFAULT_CONFIG.economy.flowerRecoverSec + 1e-6, 'flower recovery wait is short (about 3s)');
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
