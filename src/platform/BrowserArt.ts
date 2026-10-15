import type { ArtSource } from '../scene/Sprites';

export class BrowserArt implements ArtSource {
  private cache = new Map<string, ImageBitmap>();
  private pending = new Set<string>();

  constructor(private readonly base = './') {}

  image(path: string): ImageBitmap | null {
    const cached = this.cache.get(path);
    if (cached !== undefined) return cached;
    if (!this.pending.has(path)) {
      this.pending.add(path);
      fetch(this.base + path)
        .then((response) => {
          if (!response.ok) throw new Error(`${response.status} ${path}`);
          return response.blob();
        })
        .then((blob) => createImageBitmap(blob))
        .then((bitmap) => { this.cache.set(path, bitmap); })
        .catch((error: unknown) => { console.warn('美术资源加载失败', error); })
        .finally(() => { this.pending.delete(path); });
    }
    return null;
  }
}
