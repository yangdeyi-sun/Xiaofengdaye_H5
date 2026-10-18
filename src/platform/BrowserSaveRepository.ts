import { DecodeResult, decodeEnvelope } from '../domain/SaveCodec';
import type { KeyValueStore } from './Platform';
import { platform } from './Platform';

export class LoadOutcome {
  result = new DecodeResult();
  source = 'none';
  recoveredFromBackup = false;
  mainError = '';
}

const PREFIX = 'xiaofengdaye.h5.';
const WRITER_TTL_MS = 60_000;

interface WriterRecord {
  id: string;
  updatedAt: number;
}

/**
 * 存档仓库：主档 + 备份 + 损坏副本 + 入冬前快照。
 * 底层存储由平台层提供（浏览器本地存储 / 小游戏 setStorageSync），规则与原版一致。
 */
export class BrowserSaveRepository {
  readonly available: boolean;
  private readonly ownerId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private writerClaimed = false;
  private readonly store: KeyValueStore;

  constructor(store?: KeyValueStore) {
    this.store = store ?? platform().storage;
    this.available = this.store.probe();
  }

  private key(name: string): string { return PREFIX + name; }

  claimWriter(): boolean {
    if (!this.available) return false;
    try {
      const now = Date.now();
      const raw = this.store.get(this.key('writer'));
      if (raw !== null) {
        const current = JSON.parse(raw) as WriterRecord;
        // 应用和小游戏宿主均为单实例；冷启动可接管上次退出遗留租约。浏览器仍隔离多标签页。
        const singleInstance = platform().name === 'android' || platform().name === 'douyin';
        if (current.id !== this.ownerId && now - current.updatedAt < WRITER_TTL_MS && !singleInstance) return false;
      }
      const next: WriterRecord = { id: this.ownerId, updatedAt: now };
      this.store.set(this.key('writer'), JSON.stringify(next));
      const verified = JSON.parse(this.store.get(this.key('writer')) ?? '{}') as Partial<WriterRecord>;
      this.writerClaimed = verified.id === this.ownerId;
      return this.writerClaimed;
    } catch {
      return false;
    }
  }

  ownsWriter(): boolean {
    if (!this.available) return false;
    try {
      const current = JSON.parse(this.store.get(this.key('writer')) ?? '{}') as Partial<WriterRecord>;
      return current.id === this.ownerId;
    } catch {
      return false;
    }
  }

  private touchWriter(): boolean {
    if (!this.available) return false;
    try {
      const raw = this.store.get(this.key('writer'));
      if (raw === null) {
        this.writerClaimed = false;
        return this.claimWriter();
      }
      const current = JSON.parse(raw) as WriterRecord;
      if (current.id !== this.ownerId) {
        this.writerClaimed = false;
        return Date.now() - current.updatedAt >= WRITER_TTL_MS && this.claimWriter();
      }
      current.updatedAt = Date.now();
      this.store.set(this.key('writer'), JSON.stringify(current));
      this.writerClaimed = true;
      return true;
    } catch {
      return false;
    }
  }

  releaseWriter(): void {
    if (!this.available) return;
    try {
      const current = JSON.parse(this.store.get(this.key('writer')) ?? '{}') as Partial<WriterRecord>;
      if (current.id === this.ownerId) this.store.remove(this.key('writer'));
    } catch { /* best effort during page teardown */ }
    this.writerClaimed = false;
  }

  load(): LoadOutcome {
    const outcome = new LoadOutcome();
    if (!this.available) {
      outcome.result.error = 'STORAGE_UNAVAILABLE';
      return outcome;
    }
    let main = '';
    let backup = '';
    try {
      main = this.store.get(this.key('save')) ?? '';
      backup = this.store.get(this.key('backup')) ?? '';
    } catch {
      outcome.result.error = 'STORAGE_UNAVAILABLE';
      return outcome;
    }
    if (main.length > 0) {
      const decoded = decodeEnvelope(main);
      if (decoded.ok) {
        outcome.result = decoded;
        outcome.source = 'main';
        return outcome;
      }
      outcome.mainError = decoded.error;
      try { this.store.set(this.key(`corrupt.${Date.now()}`), main); } catch { /* best effort */ }
    }
    if (backup.length > 0) {
      const decoded = decodeEnvelope(backup);
      if (decoded.ok) {
        outcome.result = decoded;
        outcome.source = 'backup';
        outcome.recoveredFromBackup = main.length > 0;
        return outcome;
      }
    }
    outcome.result.error = main.length > 0 ? outcome.mainError : 'NO_SAVE';
    return outcome;
  }

  save(text: string): boolean {
    if (!this.touchWriter()) return false;
    const verify = decodeEnvelope(text);
    if (!verify.ok) return false;
    try {
      this.store.set(this.key('temporary'), text);
      const temporary = this.store.get(this.key('temporary')) ?? '';
      if (!decodeEnvelope(temporary).ok) return false;
      const current = this.store.get(this.key('save'));
      if (current !== null) this.store.set(this.key('backup'), current);
      this.store.set(this.key('save'), temporary);
      const saved = decodeEnvelope(this.store.get(this.key('save')) ?? '').ok;
      if (saved) this.store.remove(this.key('temporary'));
      return saved;
    } catch (error) {
      console.error('保存失败', error);
      return false;
    }
  }

  saveCheckpoint(text: string): boolean {
    if (!this.touchWriter()) return false;
    if (!decodeEnvelope(text).ok) return false;
    try { this.store.set(this.key('winter'), text); return true; } catch { return false; }
  }

  loadCheckpoint(): DecodeResult {
    try {
      return decodeEnvelope(this.store.get(this.key('winter')) ?? '');
    } catch {
      const result = new DecodeResult();
      result.error = 'STORAGE_UNAVAILABLE';
      return result;
    }
  }

  /** 导入存档码前的进度，供“撤销导入”恢复 */
  saveBeforeImport(text: string): boolean {
    if (!this.touchWriter()) return false;
    try { this.store.set(this.key('before-import'), text); return true; } catch { return false; }
  }

  loadBeforeImport(): DecodeResult {
    try {
      return decodeEnvelope(this.store.get(this.key('before-import')) ?? '');
    } catch {
      const result = new DecodeResult();
      result.error = 'STORAGE_UNAVAILABLE';
      return result;
    }
  }

  clearBeforeImport(): void {
    try { this.store.remove(this.key('before-import')); } catch { /* ignore */ }
  }

  wipe(): void {
    if (!this.touchWriter()) return;
    try {
      const targets = this.store.keys().filter((key) => key.startsWith(PREFIX));
      targets.forEach((key) => this.store.remove(key));
      this.writerClaimed = false;
      this.claimWriter();
    } catch {
      /* The settings screen reports persistence failures through the next save. */
    }
  }
}
