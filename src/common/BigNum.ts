/**
 * 尾数-指数大数（RES-001 / 需求书 10.4）
 * 值 = m × 10^e，1 <= |m| < 10 或 m == 0。用于全部经济数值，不依赖 JS 安全整数。
 */
export class BigNum {
  m: number = 0;
  e: number = 0;

  constructor(m: number, e: number) {
    this.m = m;
    this.e = e;
    this.normalize();
  }

  static zero(): BigNum {
    return new BigNum(0, 0);
  }

  static of(n: number): BigNum {
    if (!Number.isFinite(n) || n === 0) {
      return new BigNum(0, 0);
    }
    return new BigNum(n, 0);
  }

  /** 由 log10 值构造，用于指数价格 base × g^n，避免 double 溢出 */
  static fromLog10(l: number): BigNum {
    if (!Number.isFinite(l)) {
      return new BigNum(0, 0);
    }
    const e = Math.floor(l);
    return new BigNum(Math.pow(10, l - e), e);
  }

  static parse(s: string): BigNum {
    if (s === undefined || s === null || s.length === 0) {
      return BigNum.zero();
    }
    const idx = s.indexOf('e');
    if (idx < 0) {
      const v = Number(s);
      return Number.isFinite(v) ? BigNum.of(v) : BigNum.zero();
    }
    const m = Number(s.substring(0, idx));
    const e = Number(s.substring(idx + 1));
    if (!Number.isFinite(m) || !Number.isFinite(e)) {
      return BigNum.zero();
    }
    return new BigNum(m, Math.round(e));
  }

  private normalize(): void {
    if (!Number.isFinite(this.m) || this.m === 0) {
      this.m = 0;
      this.e = 0;
      return;
    }
    const shift = Math.floor(Math.log10(Math.abs(this.m)));
    if (shift !== 0) {
      this.m = this.m / Math.pow(10, shift);
      this.e = this.e + shift;
    }
    if (Math.abs(this.m) >= 10) {
      this.m = this.m / 10;
      this.e += 1;
    } else if (Math.abs(this.m) < 1) {
      this.m = this.m * 10;
      this.e -= 1;
    }
  }

  clone(): BigNum {
    return new BigNum(this.m, this.e);
  }

  isZero(): boolean {
    return this.m === 0;
  }

  isNegative(): boolean {
    return this.m < 0;
  }

  add(o: BigNum): BigNum {
    if (this.m === 0) {
      return o.clone();
    }
    if (o.m === 0) {
      return this.clone();
    }
    const diff = this.e - o.e;
    if (diff > 15) {
      return this.clone();
    }
    if (diff < -15) {
      return o.clone();
    }
    if (diff >= 0) {
      return new BigNum(this.m + o.m / Math.pow(10, diff), this.e);
    }
    return new BigNum(this.m / Math.pow(10, -diff) + o.m, o.e);
  }

  addN(n: number): BigNum {
    return this.add(BigNum.of(n));
  }

  neg(): BigNum {
    return new BigNum(-this.m, this.e);
  }

  sub(o: BigNum): BigNum {
    return this.add(o.neg());
  }

  subN(n: number): BigNum {
    return this.add(BigNum.of(-n));
  }

  mul(o: BigNum): BigNum {
    return new BigNum(this.m * o.m, this.e + o.e);
  }

  mulN(n: number): BigNum {
    if (!Number.isFinite(n)) {
      return BigNum.zero();
    }
    return new BigNum(this.m * n, this.e);
  }

  div(o: BigNum): BigNum {
    if (o.m === 0) {
      return BigNum.zero();
    }
    return new BigNum(this.m / o.m, this.e - o.e);
  }

  cmp(o: BigNum): number {
    if (this.m === 0 && o.m === 0) {
      return 0;
    }
    const sa = Math.sign(this.m);
    const sb = Math.sign(o.m);
    if (sa !== sb) {
      return sa > sb ? 1 : -1;
    }
    if (this.e !== o.e) {
      const r: number = this.e > o.e ? 1 : -1;
      return sa > 0 ? r : -r;
    }
    if (this.m === o.m) {
      return 0;
    }
    return this.m > o.m ? 1 : -1;
  }

  gte(o: BigNum): boolean {
    return this.cmp(o) >= 0;
  }

  lt(o: BigNum): boolean {
    return this.cmp(o) < 0;
  }

  gt(o: BigNum): boolean {
    return this.cmp(o) > 0;
  }

  min(o: BigNum): BigNum {
    return this.lt(o) ? this.clone() : o.clone();
  }

  max(o: BigNum): BigNum {
    return this.gt(o) ? this.clone() : o.clone();
  }

  clamp0(): BigNum {
    return this.m < 0 ? BigNum.zero() : this.clone();
  }

  log10(): number {
    if (this.m <= 0) {
      return 0;
    }
    return Math.log10(this.m) + this.e;
  }

  toNumber(): number {
    if (this.e > 307) {
      return this.m > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE;
    }
    if (this.e < -307) {
      return 0;
    }
    return this.m * Math.pow(10, this.e);
  }

  /** 规范化存档字符串（需求书10.4：存档不使用普通 JSON number 承载后期资源） */
  serialize(): string {
    if (this.m === 0) {
      return '0';
    }
    return `${this.m}e${this.e}`;
  }
}

const UNITS: string[] = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/** 显示层格式化：K/M/B... 超出后科学计数法 */
export function formatBig(v: BigNum, digits: number = 1): string {
  if (v.m === 0) {
    return '0';
  }
  if (v.e < 3) {
    const n = v.toNumber();
    if (Math.abs(n) < 10 && Math.abs(n - Math.round(n)) > 0.05) {
      return n.toFixed(1);
    }
    return `${Math.floor(n)}`;
  }
  const group = Math.floor(v.e / 3);
  if (group < UNITS.length) {
    const scaled = v.m * Math.pow(10, v.e - group * 3);
    return `${scaled.toFixed(scaled >= 100 ? 0 : digits)}${UNITS[group]}`;
  }
  return `${v.m.toFixed(2)}e${v.e}`;
}

export function formatNum(n: number, digits: number = 1): string {
  return formatBig(BigNum.of(n), digits);
}

/** 完整数值（无障碍：所有缩写具有完整数值查看方式） */
export function formatFull(v: BigNum): string {
  if (v.e < 15) {
    const n = Math.floor(v.toNumber());
    let s = `${Math.abs(n)}`;
    let out = '';
    while (s.length > 3) {
      out = ',' + s.substring(s.length - 3) + out;
      s = s.substring(0, s.length - 3);
    }
    return (n < 0 ? '-' : '') + s + out;
  }
  return `${v.m.toFixed(6)} × 10^${v.e}`;
}

export function formatRate(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  const a = Math.abs(n);
  if (a < 0.05) {
    return '0/s';
  }
  if (a < 10) {
    return `${sign}${a.toFixed(1)}/s`;
  }
  return `${sign}${formatNum(a)}/s`;
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) {
    return `${h}小时${m}分`;
  }
  if (m > 0) {
    return `${m}分${r < 10 ? '0' : ''}${r}秒`;
  }
  return `${r}秒`;
}
