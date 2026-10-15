import { GameEngine } from './GameEngine';
import { ALL_ROLES, Bld, BuildingDef, Res, Role, SeasonId, TaskDef, ThreatType, UpgradeTrackDef } from './Types';
import { FlowerField, HexCell, ThreatEvent } from './State';

/**
 * 引导（替代逐步指令式新手教程）：
 * 1. 新事物介绍：玩家第一次遇到某样东西（花丛、蜂后、幼虫、某种巢房、某种敌害、四季……）时弹一次，
 *    只讲“这是什么、有什么用”，不规定下一步必须做什么；看过即记入存档 meta.introsSeen。
 * 2. 提示行：顶部一行写“新开放了什么 / 现在可以试试什么 / 需要注意什么”，点一下可定位或打开对应内容。
 * 新手阶段：从开局到建成第一个储蜜格（t_build_storage）；该阶段提示行常驻，之后只在有新内容或预警时出现。
 */

export class IntroTopic {
  id: string;
  title: string;
  what: string;
  use: string;
  /** 媒体图标名（resources/base/media/xf_*.svg） */
  icon: string;
  /** 定位目标：field / hiveIcon / fieldId:<id> / hive / queen / expand / bld:<type>；空为不定位 */
  focus: string;
  /** 定位所在视图：field / hive；空表示不切换 */
  view: string;
  cond: (e: GameEngine) => boolean;

  constructor(id: string, title: string, what: string, use: string, icon: string, focus: string, view: string,
    cond: (e: GameEngine) => boolean) {
    this.id = id;
    this.title = title;
    this.what = what;
    this.use = use;
    this.icon = icon;
    this.focus = focus;
    this.view = view;
    this.cond = cond;
  }
}

export class Hint {
  id: string;
  text: string;
  /** new 新开放 / try 可以试试 / warn 注意 / next 接下来 */
  kind: string;
  /** intro:<id> / panel:<key> / build:<bld> / focus:<target>@<view> / hub / queen / upgrade:<bld> */
  action: string;
  icon: string;

  constructor(id: string, text: string, kind: string, action: string, icon: string) {
    this.id = id;
    this.text = text;
    this.kind = kind;
    this.action = action;
    this.icon = icon;
  }
}

const LEGACY = '_legacy';

function available(e: GameEngine, b: string): boolean {
  return e.hive.buildingAvailable(b) && e.w.count(b) === 0;
}

function hasThreat(e: GameEngine, type: string): boolean {
  return e.threats.activeList().some((t: ThreatEvent) => t.type === type);
}

function discoveredOther(e: GameEngine): boolean {
  return e.run.map.fields.some((f: FlowerField) => f.discovered && !f.home);
}

function upgradeReady(e: GameEngine): string {
  const tracks = e.w.cfg.tracks;
  for (let i = 0; i < tracks.length; i++) {
    const tr: UpgradeTrackDef = tracks[i];
    if (e.w.count(tr.building) === 0) {
      continue;
    }
    // 轻量判断（不做产量预估），提示行每秒会调用多次
    if (e.hive.trackLevel(tr.id) < tr.maxLevel && e.w.econ.canAfford(e.hive.upgradeCost(tr))) {
      return tr.building;
    }
  }
  return '';
}

function expandReady(e: GameEngine): boolean {
  if (!e.w.unlocked('t_build_storage')) {
    return false;
  }
  return e.run.hive.cells.some((c: HexCell) => e.hive.canExpandCell(c) && e.w.econ.canAfford(e.hive.expandCost(c)));
}

function hasOverflow(e: GameEngine): boolean {
  const ob = e.run.overflow[Res.Honey];
  const on = e.run.overflow[Res.Nectar];
  return (ob !== undefined && ob.toNumber() >= 1) || (on !== undefined && on.toNumber() >= 1);
}

export const INTRO_TOPICS: IntroTopic[] = [
  // ---------------- 新手阶段（到第一个储蜜格为止） ----------------
  new IntroTopic('flowers', '花丛', '蜂巢旁的野花丛，是花蜜的来源。',
    '点击花丛就能采集花蜜，花蜜会被蜂巢慢慢酿成蜂蜜。', 'xf_flower_wild', 'field', 'field',
    (e: GameEngine) => true),
  new IntroTopic('honey', '蜂蜜', '由花蜜酿成，是蜂群最重要的资源。',
    '产卵、建造、升级都要用到蜂蜜；顶部会显示数量和每秒增长。', 'xf_res_honey', '', '',
    (e: GameEngine) => e.w.unlocked('t_first_nectar')),
  new IntroTopic('queen', '蜂后', '住在蜂巢中心，蜂群里唯一会产卵的蜜蜂。',
    '点花田中央的蜂箱，就能找到蜂后：消耗蜂蜜让她产卵，卵会孵成幼虫。', 'xf_nav_queen', 'hiveIcon', 'field',
    (e: GameEngine) => e.colony.canLay().ok || e.run.colony.eggsLaid > 0),
  new IntroTopic('larva', '幼虫', '刚出生的小蜜蜂，还没有决定做什么工作。',
    '先在蜂巢里建好对应的巢房，就能把幼虫培养成侦察蜂、采集蜂等不同工种。', 'xf_talent_b_hatch', 'queen', 'hive',
    (e: GameEngine) => e.run.colony.eggsLaid > 0),
  new IntroTopic('scoutRoom', '侦察蜂巢房', '侦察蜂的住所，建在蜂巢的六边形空格里。',
    '在蜂巢里点一个发光的空格（或在侧边蜂巢「建造」里选它）。建成后幼虫就能培养成侦察蜂，去寻找更远的花田。',
    'xf_building_scout', 'hive', 'hive',
    (e: GameEngine) => available(e, Bld.ScoutRoom)),
  new IntroTopic('scout', '侦察蜂', '戴护目镜的探路蜂，会在虚线圈范围内寻找新花田。',
    '找到花田后回巢跳摇摆舞，把位置告诉同伴。从现在起，按住花丛可以连续采集。', 'xf_role_scout', '', 'field',
    (e: GameEngine) => e.w.role(Role.Scout) > 0),
  new IntroTopic('newField', '新花田', '侦察蜂标记的花田。不同花种的产量、恢复速度和危险都不一样。',
    '侦察信息会过期，过期后要等侦察蜂再去看看；点击花田可以查看详情。', 'xf_flower_clover', '', 'field',
    (e: GameEngine) => discoveredOther(e)),
  new IntroTopic('foragerRoom', '采集蜂巢房', '采集蜂的住所。',
    '建成后，幼虫可以培养成采集蜂，替你往返花田运花蜜。', 'xf_building_forager', 'hive', 'hive',
    (e: GameEngine) => available(e, Bld.ForagerRoom)),
  new IntroTopic('forager', '采集蜂', '提着花粉篮的勤劳蜜蜂。',
    '会沿着航线自动往返已标记的花田；航线越粗，去那里的蜜蜂越多。', 'xf_role_forager', '', 'field',
    (e: GameEngine) => e.w.role(Role.Forager) > 0),
  new IntroTopic('auto', '自动运转', '蜂后可以自动产卵，幼虫可以按比例自动培养。',
    '点蜂箱打开蜂后页，打开「自动产卵」「自动培养」，离线时蜂巢也会继续工作。', 'xf_status_automation', 'hiveIcon',
    'field', (e: GameEngine) => e.w.unlocked('t_first_forager')),
  new IntroTopic('storage', '储蜜格', '储存蜂蜜和花蜜的仓库，冬天全靠它。',
    '建成第一个储蜜格后，正式四季开始，同时开放蜂蜡与扩建。', 'xf_building_storage', 'hive', 'hive',
    (e: GameEngine) => available(e, Bld.Storage)),
  // ---------------- 之后：每遇到新东西介绍一次 ----------------
  new IntroTopic('wax', '蜂蜡', '巢内工蜂消耗蜂蜜分泌的建筑材料。',
    '扩建蜂巢、建造高级巢房和部分升级需要蜂蜡。', 'xf_res_wax', '', '',
    (e: GameEngine) => e.w.unlocked('t_build_storage')),
  new IntroTopic('seasons', '四季', '春夏花多、秋天该储备、冬天花田几乎停产。',
    '顶部显示当前季节和换季倒计时；工具栏「生态」里能看到季节对产量的影响。', 'xf_season_spring', '', '',
    (e: GameEngine) => e.run.season.formal),
  new IntroTopic('expand', '扩建', '蜂巢外圈虚线格子可以用蜂蜡扩建。',
    '扩建后能放更多巢房，并提高人口上限；越往外成本越高。', 'xf_action_expand', 'expand', 'hive',
    (e: GameEngine) => expandReady(e)),
  new IntroTopic('upgrade', '巢房升级', '每种巢房都有几条属性可以升级。',
    '在蜂巢里点一下巢房，就能看到它的升级项；到达关键等级还会解锁新规则。', 'xf_action_upgrade', '', 'hive',
    (e: GameEngine) => e.w.unlocked('t_first_forager') && upgradeReady(e).length > 0),
  new IntroTopic('nursery', '育婴房', '照顾幼虫的巢房。', '增加孵化队列和人口上限；放在蜂后室旁边孵得更快。',
    'xf_building_nursery', 'hive', 'hive', (e: GameEngine) => available(e, Bld.Nursery)),
  new IntroTopic('brewery', '酿蜜房', '巢内工蜂工作的地方。',
    '建成后可以培养巢内工蜂，把花蜜更快地酿成蜂蜜，或分泌蜂蜡。', 'xf_building_brewery', 'hive', 'hive',
    (e: GameEngine) => available(e, Bld.Brewery)),
  new IntroTopic('house', '巢内工蜂', '系着围裙的巢内工匠。',
    '工具栏「蜂群」里可以分配酿蜜和筑巢（产蜂蜡）的比例。', 'xf_role_house', '', '',
    (e: GameEngine) => e.w.role(Role.House) > 0),
  new IntroTopic('threats', '敌害', '胡蜂、蜘蛛网和蜡螟会不时出现。',
    '它们只会让蜜蜂受伤或停工，不会毁掉蜂巢；守卫蜂可以击退它们。', 'xf_threat_danger', '', '',
    (e: GameEngine) => e.run.threats.enabled),
  new IntroTopic('wasp', '胡蜂', '在航线附近盘旋的掠食者。', '会降低那片花田的采集效率并弄伤采集蜂；派守卫蜂去花田驱赶。',
    'xf_enemy_wasp', '', 'field', (e: GameEngine) => hasThreat(e, ThreatType.Wasp)),
  new IntroTopic('web', '蜘蛛网', '结在花田上的网。', '被网住的花田效率大降；守卫蜂会去清理。', 'xf_enemy_web', '',
    'field', (e: GameEngine) => hasThreat(e, ThreatType.Web)),
  new IntroTopic('moth', '蜡螟', '偷偷钻进蜂巢的小虫。', '会啃食蜂蜡；守卫蜂在巢门值守时能更快赶走它。', 'xf_enemy_moth', '',
    'hive', (e: GameEngine) => hasThreat(e, ThreatType.Moth)),
  new IntroTopic('bear', '熊', '闻着蜜香而来的大家伙，出现得很少。',
    '可以集结守卫防守、交付一些蜂蜜让它离开，或者稍后再处理；蜂巢不会被毁。', 'xf_enemy_bear', '', 'field',
    (e: GameEngine) => hasThreat(e, ThreatType.Bear)),
  new IntroTopic('guardRoom', '守卫巢房', '守卫蜂的营房。', '建成后可以培养守卫蜂，保护花田、航线和巢门。',
    'xf_building_guard', 'hive', 'hive', (e: GameEngine) => available(e, Bld.GuardRoom)),
  new IntroTopic('guard', '守卫蜂', '戴头盔、举盾牌的卫士。', '工具栏「蜂群」里可以设置守卫优先保护的区域。',
    'xf_role_guard', '', '', (e: GameEngine) => e.w.role(Role.Guard) > 0),
  new IntroTopic('pollinate', '授粉', '让采集蜂驻守在花田里帮花授粉。',
    '点开花田可以安排驻守蜜蜂：花田会恢复更快，并成长为更高级的花种。', 'xf_talent_e_pollen', '', 'field',
    (e: GameEngine) => e.w.unlocked('t_first_expand') && e.w.role(Role.Forager) > 1),
  new IntroTopic('winter', '冬天', '花田几乎停产，蜂群靠储备的蜂蜜过冬。',
    '入冬前多建储蜜格、多存蜂蜜；第一个冬天受保护，只会降低产量。', 'xf_season_winter', '', '',
    (e: GameEngine) => e.run.season.season === SeasonId.WinterPrep || e.run.season.season === SeasonId.Winter),
  new IntroTopic('jelly', '蜂王浆', '珍贵的稀有资源。', '来自稀有花田、蜂群任务和击退熊，用于研究和特殊升级。',
    'xf_res_jelly', '', '', (e: GameEngine) => e.w.econ.num(Res.Jelly) > 0.001),
  new IntroTopic('rare', '稀有花田', '侦察蜂偶尔会发现的珍稀花种。', '产量高，采集时还有机会获得蜂王浆，但也更吸引敌害。',
    'xf_status_rare', '', 'field', (e: GameEngine) => e.run.stats.rareFound > 0),
  new IntroTopic('overflow', '溢出缓冲', '仓库满了以后多出来的资源会暂存在这里。',
    '缓冲会慢慢流失；多建储蜜格腾出空间后，在「资源」里领取。', 'xf_status_overflow', '', '',
    (e: GameEngine) => e.w.unlocked('t_build_storage') && hasOverflow(e)),
  new IntroTopic('colonyTask', '蜂群任务', '轮换出现的小目标。', '完成后在「任务」里领取蜂王浆奖励。', 'xf_nav_tasks', '', '',
    (e: GameEngine) => e.prog.colonyTask() !== null && e.w.unlocked('t_first_expand')),
  new IntroTopic('evolution', '进化腔', '研究本种区专属强化的地方。',
    '建成后可以用蜂蜜和蜂王浆进行研究；研究只在本种区有效。', 'xf_building_evolution', 'hive', 'hive',
    (e: GameEngine) => available(e, Bld.Evolution)),
  new IntroTopic('swarm', '分蜂', '老蜂后带着蜂群离巢，去新的种区重新开始。',
    '达成条件后可以分蜂：本轮进度重置，换来永久的蜂王传承点。', 'xf_nav_split', '', '',
    (e: GameEngine) => e.w.unlocked('t_survive_winter'))
];

export class Guide {
  eng: GameEngine;
  private cacheTime: number = -1;
  private cacheMax: number = 0;
  private cache: Hint[] = [];

  constructor(eng: GameEngine) {
    this.eng = eng;
  }

  /** 强制教学仅保留采蜜、产卵、建造侦察蜂巢房三步。 */
  inTutorial(): boolean {
    return !this.eng.state.meta.tutorialDone;
  }

  seen(id: string): boolean {
    return this.eng.state.meta.introsSeen.indexOf(id) >= 0;
  }

  markSeen(id: string): void {
    const s = this.eng.state.meta.introsSeen;
    if (s.indexOf(id) < 0) {
      s.push(id);
    }
  }

  topic(id: string): IntroTopic | null {
    const t = INTRO_TOPICS.find((x: IntroTopic) => x.id === id);
    return t === undefined ? null : t;
  }

  /** 旧存档首次进入：已经满足的话题直接视为看过，避免一次弹出一长串 */
  syncLegacy(): void {
    const s = this.eng.state.meta.introsSeen;
    const i = s.indexOf(LEGACY);
    if (i < 0) {
      return;
    }
    s.splice(i, 1);
    INTRO_TOPICS.forEach((t: IntroTopic) => {
      if (s.indexOf(t.id) < 0 && t.cond(this.eng)) {
        s.push(t.id);
      }
    });
  }

  /** 下一条待介绍的新事物（按配置顺序，条件满足且未看过） */
  pendingIntro(): IntroTopic | null {
    this.syncLegacy();
    for (let i = 0; i < INTRO_TOPICS.length; i++) {
      const t = INTRO_TOPICS[i];
      if (!this.seen(t.id) && t.cond(this.eng)) {
        return t;
      }
    }
    return null;
  }

  /** 顶部提示行：最多 max 条，按“注意 > 新开放 > 可以试试 > 接下来”排序 */
  hints(max: number): Hint[] {
    // 同一帧内多处界面读取时复用结果
    if (this.cacheTime === this.eng.run.time && this.cacheMax >= max) {
      return this.cache.slice(0, max);
    }
    const out = this.computeHints(Math.max(max, 5));
    this.cacheTime = this.eng.run.time;
    this.cacheMax = Math.max(max, 5);
    this.cache = out;
    return out.slice(0, max);
  }

  private computeHints(max: number): Hint[] {
    const e = this.eng;
    const w = e.w;
    const out: Hint[] = [];
    const add = (h: Hint): void => {
      if (out.length < max && out.every((x: Hint) => x.id !== h.id)) {
        out.push(h);
      }
    };
    // 注意
    const bear = e.threats.pendingBear();
    if (bear !== null && bear.phase !== 'postponed') {
      add(new Hint('bear', '熊来了！选择防守、交付蜂蜜或稍后处理', 'warn', 'panel:eco', 'xf_enemy_bear'));
    }
    if (e.run.season.starving) {
      add(new Hint('starving', '储蜜不足，蜂群效率减半：多采集或减少筑巢', 'warn', 'panel:resources', 'xf_status_insufficient'));
    }
    if (e.run.season.formal && (e.run.season.season === SeasonId.Autumn || e.run.season.season === SeasonId.WinterPrep)) {
      const need = e.season.winterNeed();
      const have = w.econ.num(Res.Honey);
      if (have < need) {
        add(new Hint('winterNeed', `冬天快到了：过冬还差 ${Math.ceil(need - have)} 蜂蜜`, 'warn', 'panel:eco',
          'xf_season_winter_prep'));
      }
    }
    const threats = e.threats.activeList().filter((t: ThreatEvent) => t.type !== ThreatType.Bear && t.phase === 'active');
    if (threats.length > 0 && w.role(Role.Guard) === 0) {
      add(new Hint('noGuard', w.count(Bld.GuardRoom) > 0 ? '敌害出现：培养守卫蜂来击退' : '敌害出现：守卫巢房开放后可以防御',
        'warn', w.count(Bld.GuardRoom) > 0 ? 'queen' : 'panel:eco', 'xf_threat_danger'));
    }
    // 新开放的巢房（可建且还没建过）
    const opts: BuildingDef[] = e.hive.buildingOptions();
    for (let i = 0; i < opts.length; i++) {
      const b = opts[i];
      if (w.count(b.id) === 0 && e.hive.buildingAvailable(b.id)) {
        const cost = e.hive.buildCost(b.id);
        const short = e.reasonsForShortage(cost);
        if (b.id === Bld.ScoutRoom && cost.length > 0) {
          const need = Math.ceil(cost[0].amount.toNumber());
          const have = Math.min(need, Math.floor(w.econ.num(Res.Honey)));
          add(new Hint(`new_${b.id}`, short.length === 0 ? `蜂蜜 ${have}/${need}：点这里放置侦察蜂巢房` :
            `建侦察蜂巢房：蜂蜜 ${have}/${need} · 点击花丛补花蜜，蜂巢会自动酿造`, 'new',
            short.length === 0 ? `build:${b.id}` : 'focus:field@field',
            BLD_ICON[b.id] === undefined ? 'xf_action_build' : BLD_ICON[b.id]));
        } else {
          add(new Hint(`new_${b.id}`, short.length === 0 ? `可以建造：${b.name}` : `${b.name}已开放（${short}）`, 'new',
            `build:${b.id}`, BLD_ICON[b.id] === undefined ? 'xf_action_build' : BLD_ICON[b.id]));
        }
      }
    }
    // 可以试试
    if (!w.unlocked('t_first_nectar')) {
      add(new Hint('collect', '点一下花丛，采集第一份花蜜', 'try', 'focus:field@field', 'xf_flower_wild'));
    }
    if (w.unlocked('t_first_nectar') && e.run.colony.eggsLaid === 0 && !e.colony.canLay().ok) {
      const eggCost = e.colony.eggCost();
      if (eggCost.length > 0) {
        const need = Math.ceil(eggCost[0].amount.toNumber());
        const have = Math.min(need, Math.floor(w.econ.num(Res.Honey)));
        add(new Hint('eggNeed', `首次产卵：蜂蜜 ${have}/${need} · 继续采花，花蜜会自动酿成蜂蜜`, 'next',
          'focus:field@field', 'xf_nav_queen'));
      }
    }
    if (!e.run.colony.autoLay && e.run.colony.larvae === 0 && e.colony.canLay().ok) {
      add(new Hint('lay', '蜂蜜够了：点这里直接让蜂后产卵', 'try', 'queen', 'xf_nav_queen'));
    }
    if (!e.run.colony.autoHatch && e.run.colony.larvae > 0) {
      const roles = ALL_ROLES.filter((r: string) =>
        e.colony.roleAvailable(r) && w.econ.canAfford(e.colony.roleCost(r)));
      if (roles.length > 0) {
        add(new Hint('hatch', `有 ${e.run.colony.larvae} 只幼虫可以培养成${w.roleDef(roles[0]).name}`, 'try', 'queen',
          'xf_talent_b_hatch'));
      }
    }
    if (w.unlocked('t_first_forager') && !e.run.colony.autoLay) {
      add(new Hint('auto', '可以打开自动产卵，让蜂巢自己运转', 'try', 'queen', 'xf_status_automation'));
    }
    if (e.swarmPreview().ready) {
      add(new Hint('swarm', '分蜂条件已达成，可以前往新的种区', 'new', 'panel:swarm', 'xf_nav_split'));
    }
    const ct = e.prog.colonyTask();
    if (ct !== null && !ct.claimed && ct.current >= ct.target) {
      add(new Hint('colonyTask', '蜂群任务完成了，去领取蜂王浆', 'new', 'panel:tasks', 'xf_nav_tasks'));
    }
    const up = upgradeReady(e);
    if (up.length > 0 && w.unlocked('t_first_forager')) {
      add(new Hint(`up_${up}`, `${w.bldDef(up).name}有可以升级的属性`, 'try', `upgrade:${up}`, 'xf_action_upgrade'));
    }
    if (expandReady(e)) {
      add(new Hint('expand', '蜂蜡够了，可以扩建蜂巢外圈', 'try', 'focus:expand@hive', 'xf_action_expand'));
    }
    if (w.econ.fillRatio(Res.Honey) >= 0.95 && w.unlocked('t_auto_loop')) {
      add(new Hint('full', '蜂蜜仓快满了：再建一个储蜜格或升级容量', 'try', `build:${Bld.Storage}`, 'xf_status_full'));
    }
    // 接下来（新手阶段始终给出下一个目标，作为方向而不是指令）
    if (out.length < max && this.inTutorial()) {
      const next = w.cfg.tasks.find((t: TaskDef) => t.kind === 'main' && !w.taskDone(t.id));
      if (next !== undefined) {
        add(new Hint(`next_${next.id}`, `接下来可以：${next.desc}`, 'next', 'panel:tasks', 'xf_nav_tasks'));
      }
    }
    return out;
  }
}

export const BLD_ICON: Record<string, string> = {
  'queen': 'xf_building_queen',
  'nursery': 'xf_building_nursery',
  'scoutRoom': 'xf_building_scout',
  'foragerRoom': 'xf_building_forager',
  'brewery': 'xf_building_brewery',
  'storage': 'xf_building_storage',
  'guardRoom': 'xf_building_guard',
  'evolution': 'xf_building_evolution'
};
