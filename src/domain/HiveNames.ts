/**
 * 蜂巢名字：取名弹窗里的预设名。两段组合（意象 + 称呼），可以反复“换一个”，
 * 会避开已经用过的名字。玩家也可以自己输入，最多 8 个字。
 */

const HEAD = ['金穗', '蜜语', '花溪', '晨露', '暖阳', '琥珀', '紫藤', '青禾', '星蜜', '云朵', '松风', '桃源', '月桂', '晴川',
  '甜橙', '薰衣', '麦浪', '野菊', '竹影', '槐香', '杏花', '向阳', '南风', '小满', '谷雨', '清和', '霁月', '春山', '蒲公英', '三叶'];
const TAIL = ['巢', '蜂城', '蜜庄', '蜂堡', '花巢', '蜜谷', '蜂园', '蜜屋', '王巢', '蜂寨', '蜜坊', '小筑'];

export const HIVE_NAME_MAX = 8;

/** 第 n 个预设名（n 可以是任意整数，循环取） */
export function hiveNameAt(n: number): string {
  const total = HEAD.length * TAIL.length;
  const k = ((Math.floor(n) % total) + total) % total;
  // 用与总数互质的步长打散，连续“换一个”时不会只换后缀
  const idx = (k * 37) % total;
  return HEAD[Math.floor(idx / TAIL.length)] + TAIL[idx % TAIL.length];
}

/** 从 start 开始找一个没用过的预设名 */
export function suggestHiveName(start: number, used: string[]): string {
  for (let i = 0; i < 400; i++) {
    const name = hiveNameAt(start + i);
    if (used.indexOf(name) < 0) return name;
  }
  return hiveNameAt(start);
}

/** 清理玩家输入：去掉首尾空白和换行，限制长度；不合法返回空字符串 */
export function cleanHiveName(raw: string): string {
  const text = String(raw ?? '').replace(/[\r\n\t]/g, '').trim();
  return [...text].slice(0, HIVE_NAME_MAX).join('');
}
