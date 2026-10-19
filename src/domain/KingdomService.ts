import { BigNum } from '../common/BigNum';
import { emptyKingdom } from './NewGame';
import { FlowerField, KingdomState } from './State';
import { Reason, Res, RewardDef } from './Types';
import { Rates, World } from './World';

/**
 * 王国等级：日常经营的每件事都给经验（孵化、升级、建造、击退、蜜流花、发现花田、授粉、过冬、完成目标、
 * 在线时间、累计蜂蜜里程碑），每升一级发奖励。经验曲线让下一级始终在几分钟内可以达到。
 *
 * 种区篇章：主线之后的长期目标链。每个种区 10 个篇章目标，按顺序推进：
 * 倒数第三个是分化新蜂后，倒数第二个是原地分蜂（本种区 2 个蜂群），最后一个就是“种区分蜂准备就绪”。
 */

export class KingdomReward {
  honey: number = 0;
  jelly: number = 0;
  starEgg: number = 0;
  researchCap: boolean = false;
  skin: string = '';
}

/** 王国等级奖励的外观 */
export const KINGDOM_SKINS: Record<number, string> = { 8: 'royal', 20: 'starry' };

export class ChapterDef {
  id: string;
  name: string;
  desc: string;
  metric: string;
  target: number;
  reward: RewardDef[];

  constructor(id: string, name: string, desc: string, metric: string, target: number, reward: RewardDef[]) {
    this.id = id;
    this.name = name;
    this.desc = desc;
    this.metric = metric;
    this.target = target;
    this.reward = reward;
  }
}

export class ChapterView {
  region: string = '';
  title: string = '';
  index: number = 0;
  total: number = 0;
  current: ChapterDef | null = null;
  progress: number = 0;
  done: ChapterDef[] = [];
  upcoming: ChapterDef[] = [];
}

const J = (n: number): RewardDef => ({ res: Res.Jelly, amount: n });
const H = (n: number): RewardDef => ({ res: Res.Honey, amount: n });

/** [篇章名, 种区篇章目标表]：[名称, 说明, 指标, 基础目标, 每代增加, 奖励] */
type Row = [string, string, string, number, number, RewardDef[]];

const CHAPTERS: Record<string, [string, Row[]]> = {
  meadow: ['草甸新生', [
    ['炊烟初起', '蜂群成年蜂达到 {n} 只', 'pop', 30, 10, [H(150)]],
    ['花田地图', '发现 {n} 片花田', 'fields', 6, 1, [J(1)]],
    ['护航的翅膀', '击退敌害 {n} 次', 'clears', 8, 4, [H(300)]],
    ['草甸花语', '授粉让花田成长 {n} 次', 'pollinate', 3, 1, [J(1)]],
    ['工坊林立', '巢房升级总等级达到 {n}', 'upgrades', 30, 10, [H(500)]],
    ['熬过寒冬', '度过 {n} 个冬季', 'winters', 1, 0, [J(2)]],
    ['进化之门', '研究总等级达到 {n}', 'research', 4, 2, [J(2)]],
    ['新蜂后诞生', '从幼虫分化出 {n} 只可以带队的新蜂后', 'queen', 1, 0, [J(2)]],
    ['开枝散叶', '原地分蜂，让本种区拥有 {n} 个蜂群', 'colonies', 2, 0, [J(2)]],
    ['启程', '种区分蜂条件全部达成', 'swarm', 1, 0, [J(3)]]
  ]],
  alpine: ['雪线之上', [
    ['山风中的家', '蜂群成年蜂达到 {n} 只', 'pop', 30, 10, [H(200)]],
    ['寻找高山花', '发现 {n} 片花田', 'fields', 6, 1, [J(1)]],
    ['冬储', '储存 {n} 蜂蜜', 'honey', 1500, 1000, [H(400)]],
    ['雪莲盛开', '发现本区的稀有花：雪莲', 'rare', 1, 0, [J(2)]],
    ['山岭工坊', '巢房升级总等级达到 {n}', 'upgrades', 30, 10, [H(600)]],
    ['巡山守卫', '击退敌害 {n} 次', 'clears', 10, 4, [J(1)]],
    ['雪线之上', '度过 {n} 个冬季', 'winters', 3, 0, [J(3)]],
    ['新蜂后诞生', '从幼虫分化出 {n} 只可以带队的新蜂后', 'queen', 1, 0, [J(2)]],
    ['开枝散叶', '原地分蜂，让本种区拥有 {n} 个蜂群', 'colonies', 2, 0, [J(2)]],
    ['启程', '种区分蜂条件全部达成', 'swarm', 1, 0, [J(3)]]
  ]],
  rainy: ['雨中蜜语', [
    ['湿地安家', '蜂群成年蜂达到 {n} 只', 'pop', 30, 10, [H(200)]],
    ['水边花丛', '发现 {n} 片花田', 'fields', 8, 1, [J(1)]],
    ['雨后新绿', '授粉让花田成长 {n} 次', 'pollinate', 3, 1, [H(400)]],
    ['睡莲浮现', '发现本区的稀有花：睡莲', 'rare', 1, 0, [J(2)]],
    ['熬过寒冬', '度过 {n} 个冬季', 'winters', 1, 0, [J(2)]],
    ['湿地大家族', '蜂群成年蜂达到 {n} 只', 'pop', 80, 15, [J(2)]],
    ['蜂巢保卫战', '赢得 {n} 场蜂巢保卫战', 'raid', 1, 0, [J(2)]],
    ['新蜂后诞生', '从幼虫分化出 {n} 只可以带队的新蜂后', 'queen', 1, 0, [J(2)]],
    ['开枝散叶', '原地分蜂，让本种区拥有 {n} 个蜂群', 'colonies', 2, 0, [J(2)]],
    ['启程', '种区分蜂条件全部达成', 'swarm', 1, 0, [J(3)]]
  ]],
  drought: ['荒原守望', [
    ['沙地扎根', '蜂群成年蜂达到 {n} 只', 'pop', 30, 10, [H(200)]],
    ['绿洲探险', '发现 {n} 片花田', 'fields', 5, 1, [J(1)]],
    ['驱赶胡蜂', '击退敌害 {n} 次', 'clears', 15, 5, [H(500)]],
    ['仙人掌开花', '发现本区的稀有花：仙人掌花', 'rare', 1, 0, [J(2)]],
    ['荒原工坊', '巢房升级总等级达到 {n}', 'upgrades', 30, 10, [H(700)]],
    ['蜂巢保卫战', '赢得 {n} 场蜂巢保卫战', 'raid', 1, 0, [J(2)]],
    ['荒原守望', '度过 {n} 个冬季', 'winters', 3, 0, [J(3)]],
    ['新蜂后诞生', '从幼虫分化出 {n} 只可以带队的新蜂后', 'queen', 1, 0, [J(2)]],
    ['开枝散叶', '原地分蜂，让本种区拥有 {n} 个蜂群', 'colonies', 2, 0, [J(2)]],
    ['启程', '种区分蜂条件全部达成', 'swarm', 1, 0, [J(3)]]
  ]],
  rooftop: ['屋顶蜂农', [
    ['天台安家', '蜂群成年蜂达到 {n} 只', 'pop', 30, 10, [H(250)]],
    ['花盆地图', '发现 {n} 片花田', 'fields', 8, 1, [J(1)]],
    ['城市巡逻', '击退敌害 {n} 次', 'clears', 12, 4, [H(500)]],
    ['屋顶月季', '发现本区的稀有花：屋顶月季', 'rare', 1, 0, [J(2)]],
    ['小而精', '巢房升级总等级达到 {n}', 'upgrades', 35, 10, [H(800)]],
    ['明星云集', '拥有 {n} 只明星蜂', 'stars', 2, 0, [J(2)]],
    ['屋顶蜂农', '击退敌害 {n} 次', 'clears', 30, 6, [J(3)]],
    ['新蜂后诞生', '从幼虫分化出 {n} 只可以带队的新蜂后', 'queen', 1, 0, [J(2)]],
    ['开枝散叶', '原地分蜂，让本种区拥有 {n} 个蜂群', 'colonies', 2, 0, [J(2)]],
    ['启程', '种区分蜂条件全部达成', 'swarm', 1, 0, [J(3)]]
  ]]
};

export class KingdomService {
  private w: World;
  private playAcc: number = 0;
  honeyPerSec: () => number = () => 0;
  /** 分蜂条件是否满足（由 GameEngine 注入，避免循环依赖） */
  swarmReady: () => boolean = () => false;
  /** 本种区的蜂群数量（由 GameEngine 注入） */
  regionColonies: () => number = () => 1;

  constructor(w: World) {
    this.w = w;
  }

  state(): KingdomState {
    const meta = this.w.s.meta;
    if (meta.kingdom === undefined || meta.kingdom === null) meta.kingdom = emptyKingdom();
    return meta.kingdom;
  }

  /** 升到下一级需要的经验：前期约两三分钟一级，后期也在十分钟左右 */
  need(level: number): number {
    return Math.round(50 + 3 * Math.pow(Math.max(0, level - 1), 1.15));
  }

  rewardFor(level: number): KingdomReward {
    const r = new KingdomReward();
    r.honey = Math.max(50, Math.round(this.honeyPerSec() * 60));
    if (level % 3 === 0) r.jelly += 1;
    if (level % 5 === 0) r.jelly += 2;
    if (level === 3 || level === 7 || level % 10 === 0) r.starEgg = 1;
    if (level % 10 === 0) r.researchCap = true;
    r.skin = KINGDOM_SKINS[level] ?? '';
    return r;
  }

  rewardText(r: KingdomReward): string {
    const parts: string[] = [`${r.honey} 蜂蜜`];
    if (r.jelly > 0) parts.push(`${r.jelly} 蜂王浆`);
    if (r.starEgg > 0) parts.push('明星蜂卵（下次孵化必出明星蜂）');
    if (r.researchCap) parts.push('全部研究上限 +1');
    if (r.skin.length > 0) parts.push('新蜂巢外观');
    return parts.join('、');
  }

  /** 研究等级上限加成：王国每 10 级 +1 */
  researchBonus(): number {
    return Math.floor(this.state().level / 10);
  }

  /** 每秒一次：在线时间经验、累计蜂蜜里程碑、升级发奖 */
  tick(span: number, rates: Rates): void {
    const k = this.state();
    if (!this.w.offline && this.w.s.meta.tutorialDone) {
      this.playAcc += span;
      if (this.playAcc >= 10) {
        const n = Math.floor(this.playAcc / 10);
        this.playAcc -= n * 10;
        // 在线时间经验随等级略增，避免后期升级越来越慢
        k.xp += n * (1 + Math.floor(k.level / 15));
      }
    }
    k.honeyTotal = (k.honeyTotal ?? 0) + Math.max(0, rates.honeyIn * span);
    if (k.honeyTotal >= 10) {
      const mark = Math.floor(Math.log10(k.honeyTotal) * 4);
      if (mark > k.honeyMark) {
        k.xp += 10 * (mark - Math.max(4, k.honeyMark));
        k.honeyMark = mark;
      }
    }
    let guard = 0;
    while (k.xp >= this.need(k.level) && guard < 50) {
      guard++;
      k.xp -= this.need(k.level);
      k.level += 1;
      this.grant(k.level);
    }
  }

  private grant(level: number): void {
    const r = this.rewardFor(level);
    const k = this.state();
    this.w.econ.addN(Res.Honey, r.honey, Reason.Task, `kingdom${level}`);
    if (r.jelly > 0) this.w.econ.add(Res.Jelly, BigNum.of(r.jelly), Reason.Task, `kingdom${level}`);
    k.starEggs += r.starEgg;
    const meta = this.w.s.meta;
    if (r.skin.length > 0 && meta.skins.indexOf(r.skin) < 0) meta.skins.push(r.skin);
    this.w.msg('milestone', `王国升到 Lv${level}！获得 ${this.rewardText(r)}`);
    this.w.emit('task', 0, 0, `王国 Lv${level}`, 'any');
  }

  // ---------------- 种区篇章 ----------------
  chapterDefs(regionId: string): ChapterDef[] {
    const entry = CHAPTERS[regionId] ?? CHAPTERS.meadow;
    const g = Math.max(0, this.w.s.run.regionIndex);
    return entry[1].map((row: Row, i: number) => {
      const target = row[3] + row[4] * g;
      const reward = row[5].map((x: RewardDef) => ({
        res: x.res, amount: x.res === Res.Honey ? Math.round(x.amount * (1 + g * 0.6)) : x.amount
      }));
      return new ChapterDef(`ch_${regionId}_${i}`, row[0], row[1].replace('{n}', `${target}`), row[2], target, reward);
    });
  }

  chapterTitle(regionId: string): string {
    return (CHAPTERS[regionId] ?? CHAPTERS.meadow)[0];
  }

  metric(m: string): number {
    const w = this.w;
    const run = w.s.run;
    switch (m) {
      case 'pop': return w.adults();
      case 'fields': return run.map.fields.filter((f: FlowerField) => f.discovered && !f.home).length;
      case 'clears': return run.threats.cleared;
      case 'pollinate': return run.stats.pollinations;
      case 'upgrades': return Object.keys(run.upgrades).reduce((n: number, key: string) => n + run.upgrades[key], 0);
      case 'research': return Object.keys(run.research).reduce((n: number, key: string) => n + run.research[key], 0);
      case 'winters': return run.season.wintersSurvived;
      case 'stars': return (run.colony.roster ?? []).filter((b) => b.t !== undefined).length;
      case 'queen': return run.colony.youngQueens;
      case 'honey': return Math.floor(w.econ.num(Res.Honey));
      case 'raid': return run.stats.raidWins ?? 0;
      case 'rare': {
        const rare = w.region().rareFlower;
        return run.map.fields.some((f: FlowerField) => f.discovered && f.flower === rare) ? 1 : 0;
      }
      case 'swarm': return this.swarmReady() ? 1 : 0;
      case 'colonies': return this.regionColonies();
      default: return 0;
    }
  }

  chapter(): ChapterView {
    const run = this.w.s.run;
    const defs = this.chapterDefs(run.regionId);
    const v = new ChapterView();
    v.region = this.w.region().name;
    v.title = this.chapterTitle(run.regionId);
    v.total = defs.length;
    defs.forEach((d: ChapterDef) => {
      if (run.tasksDone.indexOf(d.id) >= 0) v.done.push(d);
      else if (v.current === null) v.current = d;
      else v.upcoming.push(d);
    });
    v.index = v.done.length;
    if (v.current !== null) v.progress = Math.min(v.current.target, this.metric(v.current.metric));
    return v;
  }

  /** 篇章按顺序推进：只检查当前一个，达成即发奖并进入下一个 */
  checkChapters(): string[] {
    const out: string[] = [];
    if (!this.w.s.meta.tutorialDone) return out;
    const run = this.w.s.run;
    let guard = 0;
    while (guard < 10) {
      guard++;
      const v = this.chapter();
      const cur = v.current;
      if (cur === null || this.metric(cur.metric) < cur.target) break;
      run.tasksDone.push(cur.id);
      run.tasksClaimed.push(cur.id);
      cur.reward.forEach((r: RewardDef) => this.w.econ.add(r.res, BigNum.of(r.amount), Reason.Task, cur.id));
      this.w.gainXp(15);
      const reward = cur.reward.map((r: RewardDef) => `${r.amount} ${r.res === Res.Jelly ? '蜂王浆' : '蜂蜜'}`).join('、');
      this.w.msg('task', `篇章「${v.title}」${v.index + 1}/${v.total} 完成：${cur.name}，获得 ${reward}`);
      this.w.emit('task', 0, 0, cur.name, 'any');
      out.push(cur.id);
    }
    return out;
  }
}
