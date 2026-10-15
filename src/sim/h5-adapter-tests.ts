import { DEFAULT_CONFIG } from '../domain/GameConfig';
import { createInitialState } from '../domain/NewGame';
import { encodeEnvelope } from '../domain/SaveCodec';
import { BrowserSaveRepository } from '../platform/BrowserSaveRepository';
import { TimeService } from '../platform/TimeService';

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

console.log(`${passed} browser adapter checks passed`);
