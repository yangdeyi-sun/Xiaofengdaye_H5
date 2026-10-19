/**
 * 蜜蜂名字：叠字（豆豆、啾啾）+ 两字组合（蜜豆、糖团）+ 小字辈（小豆豆）。
 * 用一个与名字池大小互质的步长遍历名字池，看起来随机但在名字池用完前绝不重复；
 * 用完一轮后加“二世、三世……”，保证同一份存档里每只蜜蜂的名字都不一样。
 */

const DOUBLE = ['豆', '糖', '团', '球', '啾', '嘟', '咪', '圆', '甜', '暖', '朵', '泡', '柚', '莓', '芽', '叮', '乐', '酥',
  '绒', '波', '云', '露', '樱', '杏', '枣', '果', '桃', '栗', '麦', '布', '米', '星', '花', '蜜', '贝', '铃', '咕', '喵',
  '糯', '饼'];
const FIRST = ['小', '阿', '蜜', '糖', '豆', '团', '花', '星', '米', '果', '桃', '栗', '麦', '布', '嘟', '啾', '圆', '软',
  '甜', '暖', '晴', '朵', '奶', '柚', '橙', '莓', '芽', '叮', '乐', '酥', '绒', '波', '云', '露', '樱', '杏', '枣', '芝',
  '可', '悠'];
const SECOND = ['豆', '糖', '团', '球', '宝', '仔', '包', '丸', '圆', '果', '桃', '花', '芽', '朵', '星', '米', '泡', '卷',
  '绒', '酥', '饼', '糕', '糯', '蕾', '铃', '贝', '啾', '嘟', '咕', '喵'];
const LITTLE = ['豆', '糖', '团', '啾', '嘟', '咪', '圆', '朵', '莓', '芽', '叮', '酥', '绒', '云', '露', '樱', '桃', '栗',
  '星', '蜜', '贝', '铃', '咕', '糯', '布', '米', '果', '泡', '甜', '暖'];
const ERA = ['', '二世', '三世', '四世', '五世', '六世', '七世', '八世', '九世', '十世'];

function buildPool(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (n: string): void => {
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  };
  DOUBLE.forEach((c) => push(c + c));
  FIRST.forEach((a) => SECOND.forEach((b) => { if (a !== b) push(a + b); }));
  LITTLE.forEach((c) => push(`小${c}${c}`));
  return out;
}

const POOL = buildPool();

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** 选一个与池大小互质、足够大的步长，让相邻序号的名字看起来毫无关联 */
function pickStride(n: number): number {
  let s = Math.floor(n * 0.618) | 1;
  while (gcd(s, n) !== 1) s += 2;
  return s;
}

const STRIDE = pickStride(POOL.length);

export function namePoolSize(): number {
  return POOL.length;
}

/** 第 seq 只蜜蜂的名字；offset 让不同玩家的名字顺序不同 */
export function beeName(seq: number, offset: number): string {
  const n = POOL.length;
  const round = Math.floor(seq / n);
  const idx = ((seq % n) * STRIDE + Math.abs(offset)) % n;
  const era = round < ERA.length ? ERA[round] : `${round + 1}世`;
  return POOL[idx] + era;
}

export function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
