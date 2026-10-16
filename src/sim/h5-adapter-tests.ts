import { DEFAULT_CONFIG } from '../domain/GameConfig';
import { createInitialState } from '../domain/NewGame';
import { encodeEnvelope } from '../domain/SaveCodec';
import { BrowserSaveRepository } from '../platform/BrowserSaveRepository';
import { TimeService } from '../platform/TimeService';
import { setPlatform } from '../platform/Platform';
import type { AdBackend, RewardedResult } from '../platform/Platform';
import { WebPlatform } from '../platform/web/WebPlatform';
import { AdService } from '../app/ads/AdService';
import { grantBearAid, grantOfflineDouble, grantSwarmBonus, grantWinterSupply, swarmBonusPoints } from '../app/ads/AdRewards';
import { GameEngine } from '../domain/GameEngine';
import { Res, ThreatType } from '../domain/Types';

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
