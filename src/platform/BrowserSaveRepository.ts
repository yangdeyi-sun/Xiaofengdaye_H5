import { DecodeResult, decodeEnvelope } from '../domain/SaveCodec';

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

export class BrowserSaveRepository {
  readonly available: boolean;
  private readonly ownerId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private writerClaimed = false;

  constructor() {
    try {
      localStorage.setItem(this.key('probe'), '1');
      localStorage.removeItem(this.key('probe'));
      this.available = true;
    } catch {
      this.available = false;
    }
  }

  private key(name: string): string { return PREFIX + name; }

  claimWriter(): boolean {
    if (!this.available) return false;
    try {
      const now = Date.now();
      const raw = localStorage.getItem(this.key('writer'));
      if (raw !== null) {
        const current = JSON.parse(raw) as WriterRecord;
        if (current.id !== this.ownerId && now - current.updatedAt < WRITER_TTL_MS) return false;
      }
      const next: WriterRecord = { id: this.ownerId, updatedAt: now };
      localStorage.setItem(this.key('writer'), JSON.stringify(next));
      const verified = JSON.parse(localStorage.getItem(this.key('writer')) ?? '{}') as Partial<WriterRecord>;
      this.writerClaimed = verified.id === this.ownerId;
      return this.writerClaimed;
    } catch {
      return false;
    }
  }

  ownsWriter(): boolean {
    if (!this.available) return false;
    try {
      const current = JSON.parse(localStorage.getItem(this.key('writer')) ?? '{}') as Partial<WriterRecord>;
      return current.id === this.ownerId;
    } catch {
      return false;
    }
  }

  private touchWriter(): boolean {
    if (!this.available) return false;
    try {
      const raw = localStorage.getItem(this.key('writer'));
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
      localStorage.setItem(this.key('writer'), JSON.stringify(current));
      this.writerClaimed = true;
      return true;
    } catch {
      return false;
    }
  }

  releaseWriter(): void {
    if (!this.available) return;
    try {
      const current = JSON.parse(localStorage.getItem(this.key('writer')) ?? '{}') as Partial<WriterRecord>;
      if (current.id === this.ownerId) localStorage.removeItem(this.key('writer'));
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
      main = localStorage.getItem(this.key('save')) ?? '';
      backup = localStorage.getItem(this.key('backup')) ?? '';
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
      try { localStorage.setItem(this.key(`corrupt.${Date.now()}`), main); } catch { /* best effort */ }
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
      localStorage.setItem(this.key('temporary'), text);
      const temporary = localStorage.getItem(this.key('temporary')) ?? '';
      if (!decodeEnvelope(temporary).ok) return false;
      const current = localStorage.getItem(this.key('save'));
      if (current !== null) localStorage.setItem(this.key('backup'), current);
      localStorage.setItem(this.key('save'), temporary);
      const saved = decodeEnvelope(localStorage.getItem(this.key('save')) ?? '').ok;
      if (saved) localStorage.removeItem(this.key('temporary'));
      return saved;
    } catch (error) {
      console.error('保存失败', error);
      return false;
    }
  }

  saveCheckpoint(text: string): boolean {
    if (!this.touchWriter()) return false;
    if (!decodeEnvelope(text).ok) return false;
    try { localStorage.setItem(this.key('winter'), text); return true; } catch { return false; }
  }

  loadCheckpoint(): DecodeResult {
    try {
      return decodeEnvelope(localStorage.getItem(this.key('winter')) ?? '');
    } catch {
      const result = new DecodeResult();
      result.error = 'STORAGE_UNAVAILABLE';
      return result;
    }
  }

  wipe(): void {
    if (!this.touchWriter()) return;
    try {
      const targets: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key !== null && key.startsWith(PREFIX)) targets.push(key);
      }
      targets.forEach((key) => localStorage.removeItem(key));
      this.writerClaimed = false;
      this.claimWriter();
    } catch {
      /* The settings screen reports persistence failures through the next save. */
    }
  }
}
