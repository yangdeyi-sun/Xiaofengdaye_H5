/** 可保存与恢复的伪随机序列（需求书10.5：随机状态写入存档） mulberry32 */
export class Rng {
  state: number = 1;

  constructor(seed: number) {
    this.state = (seed >>> 0) === 0 ? 0x9e3779b9 : (seed >>> 0);
  }

  next(): number {
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  int(a: number, bInclusive: number): number {
    return Math.floor(this.range(a, bInclusive + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** 由字符串得到稳定种子 */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** FNV-1a 校验和（SAVE-003 存档校验） */
export function checksum(s: string): string {
  const h = hashSeed(s).toString(16);
  let out = h;
  while (out.length < 8) {
    out = '0' + out;
  }
  return out;
}
