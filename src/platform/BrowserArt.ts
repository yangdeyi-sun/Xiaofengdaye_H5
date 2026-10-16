import type { ArtSource } from '../scene/Sprites';
import { platform } from './Platform';

const RETRY_MS = 15_000;

/** 美术资源按需异步加载；加载方式由平台层决定（浏览器 fetch + createImageBitmap / 小游戏 createImage）。 */
export class BrowserArt implements ArtSource {
  private cache = new Map<string, ImageBitmap>();
  private pending = new Set<string>();
  /** 加载失败的资源暂停重试一段时间，避免每帧重复请求（远程 CDN 抖动时仍会自动恢复） */
  private failedAt = new Map<string, number>();

  image(path: string): ImageBitmap | null {
    const cached = this.cache.get(path);
    if (cached !== undefined) return cached;
    const failed = this.failedAt.get(path);
    if (!this.pending.has(path) && (failed === undefined || Date.now() - failed > RETRY_MS)) {
      this.pending.add(path);
      platform().images.load(path)
        .then((bitmap) => { this.cache.set(path, bitmap); this.failedAt.delete(path); })
        .catch((error: unknown) => { this.failedAt.set(path, Date.now()); console.warn('美术资源加载失败', path, error); })
        .finally(() => { this.pending.delete(path); });
    }
    return null;
  }
}
