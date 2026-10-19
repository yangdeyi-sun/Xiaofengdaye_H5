/** One automatic notice at a time. Interaction suspends its remaining reading time. */
export interface Presentation {
  key: string;
  text: string;
  kind: string;
  title?: string;
  icon?: string;
  duration: number;
  /** 入队时间与有效期（毫秒）：被面板等遮挡太久的提示过期作废，不再“迟到”地弹出 */
  createdAt?: number;
  ttl?: number;
}

export class PresentationQueue {
  private pending: Presentation[] = [];
  private active: Presentation | null = null;
  private remaining = 0;
  private lastAt: number | null = null;

  get empty(): boolean { return this.active === null && this.pending.length === 0; }

  enqueue(item: Presentation): void {
    if (this.active?.key === item.key || this.pending.some((p) => p.key === item.key)) return;
    // 同类敌害提示只保留最新一条：旧的那只可能已经被打跑了
    if (item.kind === 'threat') this.pending = this.pending.filter((p) => p.kind !== 'threat');
    // 完整记录保留在图鉴「消息」里；实时队列只留几条，避免关掉面板后连弹一串旧消息
    if (this.pending.length >= 4) this.pending.shift();
    this.pending.push(item);
  }

  tick(now: number, blocked: boolean): Presentation | null {
    if (this.active !== null && this.lastAt !== null) this.remaining -= Math.max(0, now - this.lastAt);
    this.lastAt = null;
    if (this.active !== null && this.remaining <= 0) this.active = null;
    if (blocked) return null;
    if (this.active === null) {
      while (this.pending.length > 0) {
        const next = this.pending.shift() as Presentation;
        if (next.createdAt !== undefined && next.ttl !== undefined && now - next.createdAt > next.ttl) continue;
        this.active = next;
        break;
      }
      this.remaining = this.active?.duration ?? 0;
    }
    if (this.active !== null) this.lastAt = now;
    return this.active;
  }

  dismiss(): void { this.active = null; this.lastAt = null; }
  clear(): void { this.pending = []; this.dismiss(); }
}
