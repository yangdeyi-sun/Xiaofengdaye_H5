import { DEFAULT_CONFIG } from '../domain/GameConfig';
import { createInitialState } from '../domain/NewGame';
import { encodeEnvelope } from '../domain/SaveCodec';
import { BrowserSaveRepository } from '../platform/BrowserSaveRepository';
import { TimeService } from '../platform/TimeService';
import { setPlatform } from '../platform/Platform';
import type { AdBackend, RewardedResult } from '../platform/Platform';
import { WebPlatform } from '../platform/web/WebPlatform';
import { AdService } from '../app/ads/AdService';
import {
  grantBearAid, grantHoneyTopUp, grantOfflineDouble, grantSpringSupply, grantSwarmBonus, grantWinterSupply, honeyTopUp,
  springSupplyWanted, swarmBonusPoints
} from '../app/ads/AdRewards';
import { GameEngine } from '../domain/GameEngine';
import { GameSession } from '../app/GameSession';
import { BigNum } from '../common/BigNum';
import { Res, ThreatType } from '../domain/Types';
import { PresentationQueue } from '../app/PresentationQueue';
import { BrowserUI } from '../app/BrowserUI';
import { BrowserAudioService } from '../platform/BrowserAudioService';
import type { SoundHandle } from '../platform/Platform';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, `${value}`); }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
const web = new WebPlatform('./');
setPlatform(web);
let passed = 0;
function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
  passed++;
}

// Automatic notices retain their reading time while the player holds, drags or opens a panel.
{
  const queue = new PresentationQueue();
  const first = { key: 'a', text: 'first', kind: 'season', duration: 3000 };
  queue.enqueue(first); queue.enqueue(first);
  queue.enqueue({ key: 'b', text: 'second', kind: 'milestone', duration: 2000 });
  check(queue.tick(0, true) === null, '操作时不开始自动提示');
  check(queue.tick(1000, false)?.key === 'a', '空闲后按顺序显示提示');
  check(queue.tick(2000, true) === null, '打开面板后隐藏并暂停提示');
  check(queue.tick(60000, false)?.key === 'a', '面板停留时间不消耗阅读时间');
  check(queue.tick(61999, false)?.key === 'a', '恢复后保留剩余阅读时间');
  check(queue.tick(62000, false)?.key === 'b', '前一条结束后显示下一条，重复项不入队');
  queue.dismiss();
  check(queue.empty, '主动关闭后队列为空');
  queue.enqueue(first); queue.clear();
  check(queue.tick(70000, false) === null, '清除进度时清空旧提示');
}

class TestSound implements SoundHandle {
  volume = 0;
  paused = true;
  disposed = false;
  finish: () => void = () => {};
  constructor(readonly path: string, readonly loop: boolean) {}
  async play(): Promise<void> { this.paused = false; }
  pause(): void { this.paused = true; }
  stop(): void { this.paused = true; }
  dispose(): void { this.disposed = true; this.paused = true; }
  onFinish(callback: () => void): void { this.finish = callback; }
}

const sounds: TestSound[] = [];
const soundPlatform = Object.create(web) as WebPlatform;
Object.defineProperty(soundPlatform, 'audio', { value: {
  create(path: string, loop: boolean): SoundHandle { const sound = new TestSound(path, loop); sounds.push(sound); return sound; }
} });
setPlatform(soundPlatform);
{
  const audio = new BrowserAudioService();
  audio.setScene('privacy', '', false, ''); audio.unlock(); audio.play('ui_tap');
  check(sounds.length === 0, '隐私页保持静音');
  audio.setScene('game', '', false, '');
  check(sounds.at(-1)?.path.endsWith('bgm_game.mp3') === true, '游戏播放经营音乐');
  audio.play('collect');
  check(sounds.at(-1)?.path.endsWith('act_collect.mp3') === true, '手动采蜜播放反馈声');
  const total = sounds.length;
  audio.play('collect');
  check(sounds.length === total, '连续采蜜遵守音效冷却');
  audio.setSfx(false); audio.play('ui_error');
  check(sounds.length === total && sounds.filter((s) => !s.loop).every((s) => s.disposed), '关闭音效释放实例并停止新音效');
  audio.setScene('game', '', false, 'snow');
  check(sounds.at(-1)?.path.endsWith('bgm_winter.mp3') === true, '冬季切换冬季音乐');
  audio.pauseMusic();
  check(sounds.every((s) => s.disposed), '切后台释放所有正在播放的声音');
  audio.release();
}

// UI adapters use the same guard: an automatic intro never interrupts a gesture or a panel.
{
  const session = new GameSession();
  session.eng = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'ui-guards', Date.now(), 42));
  session.engine().state.meta.settings.privacyAccepted = true;
  session.engine().state.meta.settings.privacyVersion = '2026-10-16';
  const browser = new BrowserUI({} as HTMLElement, session);
  const bp = browser as unknown as {
    pointers: Map<number, { x: number; y: number }>; introId: string; introGapUntil: number;
    panel: string; offlineReport: typeof session.pendingOffline;
    checkRuntimeEvents(): void; renderRuntimeOverlays(): string;
  };
  session.renderer = null;
  bp.introGapUntil = 0; bp.pointers.set(1, { x: 0, y: 0 });
  bp.checkRuntimeEvents(); check(bp.introId === '', '网页端按住时不弹教学');
  bp.pointers.clear(); bp.panel = 'queen';
  bp.checkRuntimeEvents(); check(bp.introId === '', '网页端面板打开时不弹教学');
  bp.panel = ''; bp.checkRuntimeEvents();
  check(bp.introId !== '', '网页端空闲后显示待看的教学');
  bp.offlineReport = { settlementId: 'test', credited: 3600, elapsed: 3600, truncated: 0,
    gains: { honey: '10' }, seasonsPassed: [], notes: [], anomaly: '' };
  const html = bp.renderRuntimeOverlays();
  check(html.includes('offline-card') && !html.includes('intro-layer'), '离线报告与教学一次只展示一个');
}
// 主动广告：补齐差额、春季补给
{
  const eng = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'ad-topup', Date.now(), 43));
  eng.run.res[Res.Honey] = BigNum.of(80);
  const costs = [{ res: Res.Honey, amount: BigNum.of(100) }];
  check(honeyTopUp(eng, costs) === 20, '只差少量蜂蜜时提供补齐差额');
  eng.run.res[Res.Honey] = BigNum.of(10);
  check(honeyTopUp(eng, costs) === 0, '差得太多时不提供补齐差额');
  eng.run.res[Res.Honey] = BigNum.of(80);
  check(honeyTopUp(eng, [{ res: Res.Honey, amount: BigNum.of(100) }, { res: Res.Wax, amount: BigNum.of(5) }]) === 0, '还缺蜂蜡时不提供补齐差额');
  grantHoneyTopUp(eng, 20);
  check(eng.w.econ.canAfford(costs.map((c) => ({ res: c.res, amount: c.amount })) as never), '补齐后正好买得起');
  check(!springSupplyWanted(eng), '没熬过冬天时不提供春季补给');
  eng.run.season.formal = true; eng.run.season.season = 'spring'; eng.run.season.wintersSurvived = 1; eng.run.season.cycleIndex = 1;
  const before = eng.w.econ.num(Res.Honey);
  check(springSupplyWanted(eng) && grantSpringSupply(eng) > 0 && eng.w.econ.num(Res.Honey) > before, '熬过冬天的春季可以领春季补给');
  check(!springSupplyWanted(eng) && grantSpringSupply(eng) === 0, '每个春天只能领一次');
}
setPlatform(web);

const repo = new BrowserSaveRepository();
check(repo.load().result.error === 'NO_SAVE', '空存档应返回 NO_SAVE');

const first = createInitialState(DEFAULT_CONFIG, 'h5-test', 1000, 42);
const firstText = encodeEnvelope(first, DEFAULT_CONFIG.configVersion, 1000);
check(repo.save(firstText), '首次保存');
check(repo.load().result.state?.meta.playerId === 'h5-test', '读取主存档');

first.meta.swarmCount = 3;
const secondText = encodeEnvelope(first, DEFAULT_CONFIG.configVersion, 2000);
check(repo.save(secondText), '二次保存');
localStorage.setItem('xiaofengdaye.h5.save', '{broken');
const recovered = repo.load();
check(recovered.recoveredFromBackup, '主档损坏时恢复备份');
check(recovered.result.state?.meta.swarmCount === 0, '备份是上一个有效版本');
check([...Array(localStorage.length).keys()].map((i) => localStorage.key(i) ?? '').some((key) => key.includes('corrupt.')), '损坏档留存');

check(repo.saveCheckpoint(secondText), '写入冬季快照');
check(repo.loadCheckpoint().state?.meta.swarmCount === 3, '读取冬季快照');
repo.wipe();
check(repo.load().result.error === 'NO_SAVE', '删除全部本地数据');
const secondRepo = new BrowserSaveRepository();
check(!secondRepo.claimWriter(), '第二标签页不能抢占活跃写入者');
repo.releaseWriter();
check(secondRepo.claimWriter(), '原标签释放后第二标签可接管');
secondRepo.releaseWriter();

const originalNow = Date.now;
const fixedNow = 100 * 86400_000;
Date.now = () => fixedNow;
check(TimeService.offlineElapsed(fixedNow - 90_000, 30).elapsedSec === 90, '正常离线时长');
check(TimeService.offlineElapsed(fixedNow + 90_000, 30).anomaly === 'clock_back', '时间回拨检测');
check(TimeService.offlineElapsed(fixedNow - 40 * 86400_000, 30).elapsedSec === 30 * 86400, '大幅跳变封顶');
Date.now = originalNow;

/** 可编排结果的广告后端，用来验证发奖规则 */
class ScriptedAds implements AdBackend {
  queue: RewardedResult['status'][] = [];
  shown = 0;
  async showRewarded(): Promise<RewardedResult> {
    this.shown++;
    return { status: this.queue.shift() ?? 'completed', detail: 'test' };
  }
  async showInterstitial(): Promise<boolean> { return true; }
}

async function adChecks(): Promise<void> {
  const backend = new ScriptedAds();
  const ads = new AdService(backend, web.storage);
  let rewarded = 0;
  let started = 0;
  let ended = 0;
  ads.onAdStart = () => { started++; };
  ads.onAdEnd = () => { ended++; };

  const one = await ads.watch('offline_double', 1, () => { rewarded++; });
  check(one.status === 'completed' && rewarded === 1, '看完广告才发奖励');
  check(started === 1 && ended === 1, '广告期间暂停并在结束后恢复');

  backend.queue = ['skipped'];
  const skipped = await ads.watch('offline_double', 1, () => { rewarded++; });
  check(skipped.status === 'skipped' && rewarded === 1, '中途关闭不发奖励');

  backend.queue = ['unavailable'];
  const none = await ads.watch('offline_double', 1, () => { rewarded++; });
  check(none.status === 'unavailable' && rewarded === 1, '无广告不发奖励');
  check(ads.remaining('offline_double') === 3, '只有看完的广告计入每日次数');

  // 4× 需要连看两个：第一个看完给 2×，第二个看完升 4×
  const speeds: number[] = [];
  const four = await ads.watch('flower_boost', 2, (i) => { ads.applyBoost(i === 0 ? 2 : 4); speeds.push(ads.boostSpeed()); });
  check(four.completed === 2 && speeds.join(',') === '2,4', '4× 需要连看两个广告');
  check(ads.boostSpeed() === 4 && ads.boostRemainingSec() > 590, '加速持续 10 分钟');

  backend.queue = ['completed', 'skipped'];
  const partial = await ads.watch('flower_boost', 2, () => { rewarded++; });
  check(partial.status === 'partial' && partial.completed === 1, '第二个没看完时保留第一个的奖励');

  backend.queue = [];
  for (let i = 0; i < 10; i++) await ads.watch('colony_revive', 1);
  check(ads.remaining('colony_revive') === 0 && !ads.check('colony_revive').ok, '每日次数上限');
  const blocked = await ads.watch('colony_revive', 1);
  check(blocked.status === 'blocked' && backend.shown === 8, '达到上限后不再请求广告');

  const reloaded = new AdService(backend, web.storage);
  check(reloaded.remaining('colony_revive') === 0 && reloaded.boostSpeed() === 4, '广告记录跨重启保留');
}

function rewardChecks(): void {
  const state = createInitialState(DEFAULT_CONFIG, 'reward-test', 1000, 7);
  const engine = new GameEngine(DEFAULT_CONFIG, state);
  const honey0 = engine.w.econ.num(Res.Honey);
  const granted = grantOfflineDouble(engine, {
    settlementId: 't', elapsed: 600, credited: 600, truncated: 0,
    gains: { [Res.Honey]: '50', [Res.Nectar]: '-5' }, seasonsPassed: [], notes: [], anomaly: ''
  });
  check(Math.abs(engine.w.econ.num(Res.Honey) - honey0 - 50) < 1e-6 && granted[Res.Nectar] === undefined, '离线翻倍只补发正收益');

  const honey1 = engine.w.econ.num(Res.Honey);
  grantWinterSupply(engine);
  check(engine.w.econ.num(Res.Honey) > honey1, '紧急补给增加蜂蜜');
  check(engine.w.econ.num(Res.Honey) <= engine.w.econ.capacity(Res.Honey).toNumber() + 1e-6, '补给不超过仓库容量');

  engine.run.threats.active.push({
    eventId: 'bear-1', type: ThreatType.Bear, targetId: 'hive', phase: 'warning', hp: 10, maxHp: 10,
    startedAt: 0, endsAt: 60, postponed: 0, settled: false
  });
  const honey2 = engine.w.econ.num(Res.Honey);
  check(grantBearAid(engine, 'bear-1') && engine.threats.pendingBear() === null, '援军赶走熊');
  check(engine.w.econ.num(Res.Honey) === honey2 && !grantBearAid(engine, 'bear-1'), '援军不扣蜂蜜且不能重复领取');

  const points0 = engine.state.meta.inheritance.available;
  grantSwarmBonus(engine, swarmBonusPoints(5));
  check(engine.state.meta.inheritance.available === points0 + 3, '分蜂加成 +50%（向上取整）');
}

rewardChecks();

// 单实例 Android 进程崩溃后可以接管遗留租约，浏览器多标签隔离仍由前面的检查保障。
const androidPlatform = Object.create(web) as WebPlatform;
Object.defineProperty(androidPlatform, 'name', { value: 'android' });
setPlatform(androidPlatform);
const restartedAndroidRepo = new BrowserSaveRepository();
check(restartedAndroidRepo.claimWriter(), 'Android单实例重启可接管旧进程写入租约');
restartedAndroidRepo.releaseWriter();
const douyinPlatform = Object.create(web) as WebPlatform;
Object.defineProperty(douyinPlatform, 'name', { value: 'douyin' });
setPlatform(douyinPlatform);
const oldMiniRepo = new BrowserSaveRepository();
const newMiniRepo = new BrowserSaveRepository();
check(oldMiniRepo.claimWriter() && newMiniRepo.claimWriter(), '小游戏冷启动可接管上次退出遗留的写入租约');
newMiniRepo.releaseWriter();
setPlatform(web);

// 冷启动已有离线报告，停留首页再进入时不能把此前收入覆盖；首页期间后台收入不能重复累加。
{
  const session = new GameSession();
  session.eng = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'away-report', Date.now(), 8));
  session.eng.run.res[Res.Honey] = BigNum.of(50);
  const report = {
    settlementId: 'cold', elapsed: 10000, credited: 7200, truncated: 2800,
    gains: { honey: '20' }, seasonsPassed: [], notes: [], anomaly: ''
  };
  session.pendingOffline = report;
  session.beginAway();
  (session as unknown as { awaySince: number }).awaySince -= 45000;
  session.eng.run.res[Res.Honey] = BigNum.of(55);
  session.endAway();
  check(Math.abs(BigNum.parse(session.pendingOffline!.gains[Res.Honey]).toNumber() - 25) < 1e-6,
    '首页收益汇总保留此前已结算的离线收入');
  check(session.pendingOffline!.truncated === 2800 && session.pendingOffline!.credited >= 7245,
    '合并报告保留离线上限截断和实际经营时间');
  session.pendingOffline = null;
  session.beginAway();
  (session as unknown as { awaySince: number }).awaySince -= 60000;
  session.eng.run.res[Res.Honey] = BigNum.of(65);
  session.pendingOffline = { ...report, gains: { honey: '10' }, elapsed: 60, credited: 60, truncated: 0 };
  session.endAway();
  check(Math.abs(BigNum.parse(session.pendingOffline!.gains[Res.Honey]).toNumber() - 10) < 1e-6,
    '首页期间后台结算的收入只计一次');
}

async function placeholderChecks(): Promise<void> {
  const r = await web.ads.showRewarded('offline_double');
  check(r.status === 'completed' && r.detail.startsWith('placeholder'), '未接入广告 SDK 时占位直接发奖');
  const svc = new AdService(web.ads, new (class { private m = new Map<string, string>(); probe(): boolean { return true; }
    get(k: string): string | null { return this.m.get(k) ?? null; } set(k: string, v: string): void { this.m.set(k, v); }
    remove(k: string): void { this.m.delete(k); } keys(): string[] { return [...this.m.keys()]; } })());
  const w = await svc.watch('bear_aid', 1);
  check(w.placeholder && w.completed === 1, '占位广告会被标记出来，界面据此提示');
}

// 未处理的 Promise 拒绝会让 Node 以非零状态退出，测试失败同样会被发现
void adChecks().then(placeholderChecks).then(() => console.log(`${passed} browser adapter checks passed`));
