/** One automatic notice at a time. Interaction suspends its remaining reading time. */
export interface Presentation {
  key: string;
  text: string;
  kind: string;
  title?: string;
  icon?: string;
  duration: number;
}

export class PresentationQueue {
  private pending: Presentation[] = [];
  private active: Presentation | null = null;
  private remaining = 0;
  private lastAt: number | null = null;

  get empty(): boolean { return this.active === null && this.pending.length === 0; }

  enqueue(item: Presentation): void {
    if (this.active?.key === item.key || this.pending.some((p) => p.key === item.key)) return;
    // Full message history remains in the codex; keep the live queue bounded after long sessions.
    if (this.pending.length >= 64) this.pending.shift();
    this.pending.push(item);
  }

  tick(now: number, blocked: boolean): Presentation | null {
    if (this.active !== null && this.lastAt !== null) this.remaining -= Math.max(0, now - this.lastAt);
    this.lastAt = null;
    if (this.active !== null && this.remaining <= 0) this.active = null;
    if (blocked) return null;
    if (this.active === null) {
      this.active = this.pending.shift() ?? null;
      this.remaining = this.active?.duration ?? 0;
    }
    if (this.active !== null) this.lastAt = now;
    return this.active;
  }

  dismiss(): void { this.active = null; this.lastAt = null; }
  clear(): void { this.pending = []; this.dismiss(); }
}
