import { BigNum } from '../common/BigNum';
import { beeName, hashText } from './BeeNames';
import { NamedBee } from './State';
import { ALL_ROLES, Reason, Res, Role, SeasonId } from './Types';
import { CmdResult, CostAmount, Rates, World } from './World';

/** 明星蜂特性：每只明星蜂给全巢一项加成，Lv1 +10%，每升一级再 +5%（Lv5 +30%） */
export interface StarTraitDef {
  id: string;
  role: string;
  name: string;
  desc: string;
  stat: string;
  /** pct：百分比加成；add：直接加数值 */
  op: string;
  base: number;
  per: number;
}

export const STAR_TRAITS: StarTraitDef[] = [
  { id: 'lightning', role: Role.Forager, name: '闪电', desc: '采集飞行速度', stat: 'forager.speed', op: 'pct', base: 0.1, per: 0.05 },
  { id: 'bigbelly', role: Role.Forager, name: '大胃王', desc: '单次携带量', stat: 'forager.carry', op: 'pct', base: 0.1, per: 0.05 },
  { id: 'nose', role: Role.Forager, name: '灵鼻子', desc: '采集速度', stat: 'forager.collect', op: 'pct', base: 0.1, per: 0.05 },
  { id: 'farsight', role: Role.Scout, name: '千里眼', desc: '侦察范围', stat: 'scout.range', op: 'pct', base: 0.1, per: 0.05 },
  { id: 'gale', role: Role.Scout, name: '疾风', desc: '侦察飞行速度', stat: 'scout.speed', op: 'pct', base: 0.1, per: 0.05 },
  { id: 'lucky', role: Role.Scout, name: '幸运星', desc: '稀有花田发现率', stat: 'scout.rare', op: 'add', base: 0.03, per: 0.015 },
  { id: 'brewer', role: Role.House, name: '酿蜜师', desc: '加工速度', stat: 'house.brewSpeed', op: 'pct', base: 0.1, per: 0.05 },
  { id: 'mason', role: Role.House, name: '筑巢匠', desc: '筑巢（产蜡）效率', stat: 'house.waxRate', op: 'pct', base: 0.1, per: 0.05 },
  { id: 'keeper', role: Role.House, name: '小管家', desc: '储存容量', stat: 'storage.capacity', op: 'pct', base: 0.1, per: 0.05 },
  { id: 'iron', role: Role.Guard, name: '铁壁', desc: '守卫攻击效率', stat: 'guard.attack', op: 'pct', base: 0.1, per: 0.05 },
  { id: 'sentinel', role: Role.Guard, name: '哨兵', desc: '巡逻范围', stat: 'guard.range', op: 'pct', base: 0.1, per: 0.05 },
  { id: 'medic', role: Role.Guard, name: '小医官', desc: '伤员恢复速度', stat: 'guard.recovery', op: 'pct', base: 0.1, per: 0.05 }
];

export const STAR_MAX_LEVEL = 5;
/** 普通幼虫成为明星蜂的基础概率（另加蜂后室“特殊幼虫”升级的四分之一） */
export const STAR_BASE_CHANCE = 0.015;
/** 同一种特性的第二只及以后的明星蜂只按这个比例生效，鼓励收集不同特性 */
export const STAR_DUPLICATE_RATIO = 0.25;
/** 幸运孵化（广告）期间额外概率 */
export const LUCKY_BONUS = 0.25;
export const LUCKY_HATCHES = 5;

export function starTrait(id: string): StarTraitDef | null {
  const t = STAR_TRAITS.find((x: StarTraitDef) => x.id === id);
  return t === undefined ? null : t;
}

export function starBonus(t: StarTraitDef, lv: number): number {
  return t.base + t.per * (Math.max(1, Math.min(STAR_MAX_LEVEL, lv)) - 1);
}

const SEASON_WORD: Record<string, string> = {
  tutorial: '春天', spring: '春天', summer: '夏天', autumn: '秋天', winterPrep: '冬天', winter: '冬天'
};

export class StatLine {
  label: string;
  value: string;

  constructor(label: string, value: string) {
    this.label = label;
    this.value = value;
  }
}

function fmt(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return `${Math.floor(n)}`;
}

/** 蜜蜂名册：每只蜜蜂有名字、出生季节、效率和工作记录；明星蜂给全巢加成 */
export class RosterService {
  private w: World;
  /** 采集次数等按整数分配，剩下的零头留到下一秒 */
  private tripAcc: number = 0;
  /** 明星蜂缓存：属性每秒重算几十次，不能每次都遍历整本名册 */
  private starRef: NamedBee[] | null = null;
  private starLen: number = -1;
  private starList: NamedBee[] = [];
  private roleRef: NamedBee[] | null = null;
  private roleLen: number = -1;
  private roleLists: Record<string, NamedBee[]> = {};
  private shownLists: Record<string, NamedBee[]> = {};
  private traitSrc: NamedBee[] | null = null;
  private traitMap: Map<number, string> = new Map<number, string>();
  /** 工作记录攒几秒再分配，避免大蜂群每秒遍历整本名册 */
  private pendNectar: number = 0;
  private pendHoney: number = 0;
  private pendWax: number = 0;
  private pendSpan: number = 0;
  honeyPerSec: () => number = () => 0;

  constructor(w: World) {
    this.w = w;
  }

  list(): NamedBee[] {
    const c = this.w.s.run.colony;
    if (!Array.isArray(c.roster)) c.roster = [];
    return c.roster;
  }

  /** 某工种的蜜蜂（只读缓存：名册增删时自动重建，调用方不要修改返回的数组） */
  byRole(role: string): NamedBee[] {
    const roster = this.list();
    if (roster !== this.roleRef || roster.length !== this.roleLen) {
      this.roleRef = roster;
      this.roleLen = roster.length;
      const lists: Record<string, NamedBee[]> = {};
      ALL_ROLES.forEach((r: string) => { lists[r] = []; });
      roster.forEach((b: NamedBee) => { (lists[b.r] = lists[b.r] ?? []).push(b); });
      this.roleLists = lists;
      // 画面上能画出来的蜜蜂有限：明星蜂排在前面，保证它们一定出现在花田和蜂巢里
      const shown: Record<string, NamedBee[]> = {};
      Object.keys(lists).forEach((r: string) => {
        const all = lists[r];
        shown[r] = all.filter((b: NamedBee) => b.t !== undefined).concat(all.filter((b: NamedBee) => b.t === undefined));
      });
      this.shownLists = shown;
    }
    return this.roleLists[role] ?? [];
  }

  /** 画面显示顺序：明星蜂在前（渲染层按这个顺序把名字对应到画出来的蜜蜂上） */
  displayOrder(role: string): NamedBee[] {
    this.byRole(role);
    return this.shownLists[role] ?? [];
  }

  /** 明星蜂的特性；普通蜜蜂返回空字符串 */
  traitOf(id: number): string {
    const stars = this.cachedStars();
    if (stars !== this.traitSrc) {
      this.traitSrc = stars;
      this.traitMap = new Map<number, string>();
      stars.forEach((b: NamedBee) => { this.traitMap.set(b.id, b.t ?? ''); });
    }
    return this.traitMap.get(id) ?? '';
  }

  get(id: number): NamedBee | null {
    const b = this.list().find((x: NamedBee) => x.id === id);
    return b === undefined ? null : b;
  }

  stars(): NamedBee[] {
    return this.cachedStars().slice();
  }

  private cachedStars(): NamedBee[] {
    const roster = this.w.s.run.colony.roster;
    if (!Array.isArray(roster)) return [];
    if (roster !== this.starRef || roster.length !== this.starLen) {
      this.starRef = roster;
      this.starLen = roster.length;
      this.starList = roster.filter((b: NamedBee) => b.t !== undefined);
    }
    return this.starList;
  }

  /** 新起一只蜜蜂（名字全局不重复） */
  private make(role: string, legacy: boolean): NamedBee {
    const meta = this.w.s.meta;
    const seq = Math.max(0, Math.floor(meta.nameSeq ?? 0));
    meta.nameSeq = seq + 1;
    const run = this.w.s.run;
    const h = hashText(`${meta.playerId}:${seq}`);
    // 三个均匀分布相加近似正态：大多数在 90~110，少数特别能干或比较慢
    const r1 = (h & 0xff) / 255;
    const r2 = ((h >>> 8) & 0xff) / 255;
    const r3 = ((h >>> 16) & 0xff) / 255;
    const e = Math.max(75, Math.min(130, Math.round(100 + (r1 + r2 + r3 - 1.5) * 34)));
    return {
      id: seq, n: beeName(seq, hashText(meta.playerId) % 997), r: role,
      c: legacy ? -1 : run.season.cycleIndex, s: legacy ? '' : run.season.season, z: run.regionId,
      e: e, a: 0, b: 0
    };
  }

  /** 孵化完成时登记新蜜蜂；star 为 true 时这只是明星蜂，返回它 */
  born(role: string, count: number, star: boolean): NamedBee | null {
    const list = this.list();
    let last: NamedBee | null = null;
    for (let i = 0; i < count; i++) {
      const b = this.make(role, false);
      if (star && i === count - 1) this.makeStar(b);
      list.push(b);
      this.starLen = -1;
      this.roleLen = -1;
      last = b;
    }
    return last;
  }

  private makeStar(b: NamedBee): void {
    const meta = this.w.s.meta;
    if (!Array.isArray(meta.starCodex)) meta.starCodex = [];
    const codex = meta.starCodex;
    const pool = STAR_TRAITS.filter((t: StarTraitDef) => t.role === b.r);
    const fresh = pool.filter((t: StarTraitDef) => codex.indexOf(t.id) < 0);
    const h = hashText(`star:${b.id}:${b.n}`);
    const from = fresh.length > 0 && (h % 10) < 7 ? fresh : pool;
    const t = from[h % from.length];
    b.t = t.id;
    b.lv = 1;
    b.e = Math.min(140, b.e + 15);
    if (codex.indexOf(t.id) < 0) codex.push(t.id);
  }

  /** 名册与各工种数量对齐：少了补新蜜蜂（如流浪蜂群加入），多了按年龄从老到少移除（饥饿、寿命） */
  sync(): void {
    const list = this.list();
    const colony = this.w.s.run.colony;
    const legacy = list.length === 0 && this.w.adults() > 0 && this.w.s.run.time > 5;
    ALL_ROLES.forEach((role: string) => {
      const want = Math.max(0, Math.floor(colony.roles[role] ?? 0));
      let have = this.byRole(role).length;
      if (have === want) return;
      this.starLen = -1;
      this.roleLen = -1;
      while (have < want) {
        list.push(this.make(role, legacy));
        have++;
      }
      if (have > want) {
        let drop = have - want;
        // 先移除普通蜜蜂，按出生先后；明星蜂只有在没有普通蜜蜂时才会离开
        for (let pass = 0; pass < 2 && drop > 0; pass++) {
          for (let i = 0; i < list.length && drop > 0; i++) {
            const b = list[i];
            if (b.r !== role || (pass === 0 && b.t !== undefined)) continue;
            list.splice(i, 1);
            i--;
            drop--;
          }
        }
      }
    });
  }

  private weights(bees: NamedBee[]): number[] {
    const out: number[] = [];
    let sum = 0;
    bees.forEach((b: NamedBee) => {
      sum += b.e;
      out.push(sum);
    });
    return out;
  }

  private pick(bees: NamedBee[], cum: number[], r: number): NamedBee {
    const target = r * cum[cum.length - 1];
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return bees[lo];
  }

  /** 每秒按效率把全巢的运输、酿蜜、产蜡记到具体的蜜蜂身上 */
  attribute(span: number, rates: Rates): void {
    this.pendNectar += Math.max(0, rates.nectarIn * span);
    this.pendHoney += Math.max(0, rates.honeyIn * span);
    this.pendWax += Math.max(0, rates.waxIn * span);
    this.pendSpan += span;
    // 小蜂群每秒结算，大蜂群（或离线大步长）攒到 5 秒以上再一起分，表现一样但省很多计算
    const size = this.list().length;
    if (size > 200 && this.pendSpan < Math.max(5, size / 400)) return;
    const nectarTotal = this.pendNectar;
    const honeyTotal = this.pendHoney;
    const waxTotal = this.pendWax;
    this.pendNectar = 0;
    this.pendHoney = 0;
    this.pendWax = 0;
    this.pendSpan = 0;
    const run = this.w.s.run;
    const foragers = this.byRole(Role.Forager);
    if (foragers.length > 0 && nectarTotal > 0) {
      const carry = Math.max(1, this.w.attrs.get('forager.carry'));
      const nectar = nectarTotal;
      this.tripAcc += nectar / carry;
      const trips = Math.floor(this.tripAcc);
      this.tripAcc -= trips;
      if (trips > 0) {
        const each = nectar / Math.max(1, trips + this.tripAcc);
        if (trips <= 240) {
          const cum = this.weights(foragers);
          for (let i = 0; i < trips; i++) {
            const b = this.pick(foragers, cum, this.noise(run.time, i));
            b.a += 1;
            b.b = Math.round(b.b + each);
          }
        } else {
          let total = 0;
          foragers.forEach((b: NamedBee) => { total += b.e; });
          foragers.forEach((b: NamedBee) => {
            const n = Math.round(trips * b.e / total);
            b.a += n;
            b.b = Math.round(b.b + each * n);
          });
        }
      }
    }
    const house = this.byRole(Role.House);
    if (house.length > 0 && (honeyTotal > 0 || waxTotal > 0)) {
      let total = 0;
      house.forEach((b: NamedBee) => { total += b.e; });
      const honey = honeyTotal;
      const wax = waxTotal;
      house.forEach((b: NamedBee) => {
        b.a = Math.round((b.a + honey * b.e / total) * 10) / 10;
        b.b = Math.round((b.b + wax * b.e / total) * 10) / 10;
      });
    }
  }

  /** 与游戏随机数无关的确定性噪声，避免记账改变游戏进程 */
  private noise(t: number, i: number): number {
    return (hashText(`${Math.floor(t * 10)}:${i}`) % 100000) / 100000;
  }

  /** 侦察蜂出航 / 发现花田：按侦察实体序号对应到名册里的侦察蜂 */
  onScout(kind: string, agentIndex: number): void {
    const scouts = this.byRole(Role.Scout);
    if (scouts.length === 0) return;
    const b = scouts[Math.abs(agentIndex) % scouts.length];
    if (kind === 'flight') b.a += 1;
    else if (kind === 'find') b.b += 1;
  }

  /** 守卫击退敌害：几只守卫记一次参战，其中一只记一次击退 */
  onGuardWin(ref: string): void {
    const guards = this.byRole(Role.Guard);
    if (guards.length === 0) return;
    const cum = this.weights(guards);
    const t = this.w.s.run.time;
    const n = Math.min(guards.length, 5);
    const seen = new Set<number>();
    for (let i = 0; i < n * 2 && seen.size < n; i++) {
      const b = this.pick(guards, cum, (hashText(`${ref}:${t}:${i}`) % 100000) / 100000);
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      b.b += 1;
      if (seen.size === 1) b.a += 1;
    }
  }

  /** 这只蜜蜂是否在受伤休养（受伤只按数量记录，这里按名字散列分到具体的蜜蜂身上，比例与实际一致） */
  isInjured(b: NamedBee): boolean {
    const n = this.w.injured(b.r);
    if (n <= 0) return false;
    const total = Math.max(1, this.byRole(b.r).length);
    return (hashText(`hurt${b.id}`) % 1000) < 1000 * n / total;
  }

  // ---------------- 明星蜂 ----------------
  /** 当前孵化一只幼虫成为明星蜂的概率 */
  starChance(): number {
    const c = this.w.s.run.colony;
    let p = STAR_BASE_CHANCE + this.w.attrs.get('queen.special') * 0.25;
    if ((c.luckyHatch ?? 0) > 0) p += LUCKY_BONUS;
    return Math.min(0.6, p);
  }

  /** 孵化完成时判定是否额外诞生一只明星蜂（王国奖励的明星蜂卵必出） */
  rollStar(): boolean {
    const c = this.w.s.run.colony;
    const k = this.w.s.meta.kingdom;
    if (k !== undefined && k.starEggs > 0) {
      k.starEggs -= 1;
      return true;
    }
    const chance = this.starChance();
    if ((c.luckyHatch ?? 0) > 0) c.luckyHatch = Math.max(0, (c.luckyHatch ?? 0) - 1);
    return this.w.rng.chance(chance);
  }

  /** 明星蜂对属性的加成（AttributeService 读取） */
  bonus(stat: string): { pct: number; add: number } {
    let pct = 0;
    let add = 0;
    const roster = this.w.s.run.colony.roster;
    if (!Array.isArray(roster)) return { pct, add };
    // 每种特性：等级最高的那只全额生效，其余同特性的按 25% 叠加
    const byTrait: Record<string, number[]> = {};
    this.cachedStars().forEach((b: NamedBee) => {
      if (b.t === undefined) return;
      const t = starTrait(b.t);
      if (t === null || t.stat !== stat) return;
      (byTrait[t.id] = byTrait[t.id] ?? []).push(starBonus(t, b.lv ?? 1));
    });
    Object.keys(byTrait).forEach((id: string) => {
      const t = starTrait(id);
      if (t === null) return;
      const vals = byTrait[id].sort((x: number, y: number) => y - x);
      let v = 0;
      vals.forEach((x: number, i: number) => { v += i === 0 ? x : x * STAR_DUPLICATE_RATIO; });
      if (t.op === 'pct') pct += v;
      else add += v;
    });
    return { pct, add };
  }

  upgradeCost(b: NamedBee): CostAmount[] {
    const lv = b.lv ?? 1;
    const honey = Math.max(200 * lv, Math.round(this.honeyPerSec() * 45 * lv));
    return [new CostAmount(Res.Honey, BigNum.of(honey)), new CostAmount(Res.Jelly, BigNum.of(lv))];
  }

  upgradeStar(id: number): CmdResult {
    const b = this.get(id);
    if (b === null || b.t === undefined) return CmdResult.fail('BEE_NONE', '只有明星蜂可以升级');
    const lv = b.lv ?? 1;
    if (lv >= STAR_MAX_LEVEL) return CmdResult.fail('BEE_MAX', '已经满级了');
    const cost = this.upgradeCost(b);
    if (!this.w.econ.spend(cost, Reason.Talent, `star:${b.id}`)) return CmdResult.fail('ECON_SHORT', '蜂蜜或蜂王浆不足');
    b.lv = lv + 1;
    this.w.attrs.recompute();
    const t = starTrait(b.t);
    return CmdResult.ok(`「${b.n}」升到 Lv${b.lv}${t === null ? '' : `：全巢${t.desc} +${this.bonusText(t, b.lv)}`}`);
  }

  bonusText(t: StarTraitDef, lv: number): string {
    const v = starBonus(t, lv);
    return t.op === 'pct' ? `${Math.round(v * 100)}%` : `${Math.round(v * 1000) / 10}%`;
  }

  // ---------------- 分蜂 ----------------
  /** 分蜂时把名册分成两半：明星蜂优先跟随新蜂后，其余按名册顺序隔一只带走一只 */
  split(roster: NamedBee[], carried: Record<string, number>): { go: NamedBee[]; stay: NamedBee[] } {
    const go: NamedBee[] = [];
    const stay: NamedBee[] = [];
    ALL_ROLES.forEach((role: string) => {
      const bees = roster.filter((b: NamedBee) => b.r === role);
      let need = Math.max(0, Math.floor(carried[role] ?? 0));
      const stars = bees.filter((b: NamedBee) => b.t !== undefined);
      const plain = bees.filter((b: NamedBee) => b.t === undefined);
      stars.forEach((b: NamedBee) => {
        if (need > 0) { go.push(b); need--; } else stay.push(b);
      });
      plain.forEach((b: NamedBee, i: number) => {
        if (need > 0 && (i % 2 === 0 || plain.length - i <= need)) { go.push(b); need--; } else stay.push(b);
      });
    });
    return { go, stay };
  }

  // ---------------- 展示 ----------------
  birthText(b: NamedBee): string {
    if (b.c < 0) return '名册建立前就已出生的老成员';
    return `第 ${b.c + 1} 轮${SEASON_WORD[b.s] ?? '春天'}出生`;
  }

  roleWord(role: string): string {
    if (role === Role.Forager) return '采集效率';
    if (role === Role.Scout) return '侦察效率';
    if (role === Role.House) return '酿造效率';
    return '战斗效率';
  }

  /** 按工种显示不同的工作记录 */
  statLines(b: NamedBee): StatLine[] {
    const out: StatLine[] = [new StatLine(this.roleWord(b.r), `${b.e}%${b.e >= 115 ? ' · 优秀' : (b.e <= 85 ? ' · 慢性子' : '')}`)];
    if (b.r === Role.Forager) {
      out.push(new StatLine('运输次数', `${fmt(b.a)} 次`));
      out.push(new StatLine('运回花蜜', fmt(b.b)));
      out.push(new StatLine('平均每趟', b.a > 0 ? `${(b.b / b.a).toFixed(1)} 花蜜` : '还没出过勤'));
    } else if (b.r === Role.Scout) {
      out.push(new StatLine('侦察出航', `${fmt(b.a)} 次`));
      out.push(new StatLine('发现花田', `${fmt(b.b)} 片`));
    } else if (b.r === Role.House) {
      out.push(new StatLine('酿出蜂蜜', fmt(b.a)));
      out.push(new StatLine('产出蜂蜡', fmt(b.b)));
    } else {
      out.push(new StatLine('击退敌害', `${fmt(b.a)} 次`));
      out.push(new StatLine('参与战斗', `${fmt(b.b)} 次`));
    }
    return out;
  }

  /** 名册统计：用于图鉴与蜂群面板 */
  topBy(role: string, n: number): NamedBee[] {
    return this.byRole(role).slice().sort((x: NamedBee, y: NamedBee) => y.a - x.a || y.e - x.e).slice(0, n);
  }

  seasonWord(season: string): string {
    return SEASON_WORD[season] ?? (season === SeasonId.Tutorial ? '春天' : '');
  }
}
