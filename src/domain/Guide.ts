import { GameEngine } from './GameEngine';
import { Bld, Res, Role, SeasonId, ThreatType, UpgradeTrackDef } from './Types';
import { FlowerField, HexCell, ThreatEvent } from './State';

/**
 * 引导（替代逐步指令式新手教程）：
 * 1. 新事物介绍：玩家第一次遇到某样东西（花丛、蜂后、幼虫、某种巢房、某种敌害、四季……）时弹一次，
 *    只讲“这是什么、有什么用”，不规定下一步必须做什么；看过即记入存档 meta.introsSeen。
 * 2. 提示行：顶部一行写“新开放了什么 / 现在可以试试什么 / 需要注意什么”，点一下可定位或打开对应内容。
 * 新手阶段：从开局到分化第一只侦察蜂（t_first_scout）；该阶段提示行常驻，之后只在有新内容或预警时出现。
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
  new IntroTopic('handover', '这个王国，交给你了',
    '蜂后轻轻落在你面前，把整座蜂巢托付给你。\n从今天起，每一只幼虫的未来、每一滴蜂蜜的去处、每一片花田的得失，都由你来决定。\n花会谢，冬会来，敌害也在暗处窥伺——它们能否熬过寒冬、开枝散叶，全看你了。',
    '“我会守护好这个蜂巢。”',
    'xf_nav_queen', '', '', (e: GameEngine) => e.state.meta.tutorialDone),
  new IntroTopic('colonySwitch', '每个蜂群都在继续经营',
    '分蜂不会清除原蜂群；原群保留现有建设和一半人口资源，新蜂后带走另一半建立新巢。原地分蜂后你留在原蜂群，远征种区后你跟着新蜂后走。',
    '打开侧边栏的“蜂群切换”，可以随时回到原蜂群；切换时会自动结算它离开期间的经营收益。',
    'xf_nav_swarm', 'panel:colonies', '', (e: GameEngine) => e.state.meta.swarmCount > 0 && e.state.colonies.length > 0),
  new IntroTopic('flowerRecovery', '花丛也需要休息', '每片花丛的花蜜有限，采空后会暂时停止供应。',
    '等待恢复倒计时结束，或采集另一片花丛。侦察蜂能寻找更多花源；侦察房的花源储量和恢复效率升级能缓解原料短缺。',
    'xf_flower_wild', 'field', 'field', (e: GameEngine) => e.run.map.fields.some((f: FlowerField) => f.depletedAt !== undefined)),
  // ---------------- 新手阶段（到第一只侦察蜂为止） ----------------
  new IntroTopic('flowers', '花丛', '蜂巢旁的野花丛，是花蜜的来源。',
    '先点花丛采蜜两次，熟悉采蜜后，按住花丛就能连续采集。花蜜会被蜂巢慢慢酿成蜂蜜。', 'xf_flower_wild', 'field', 'field',
    (e: GameEngine) => true),
  new IntroTopic('honey', '蜂蜜', '由花蜜酿成，是蜂群最重要的资源。',
    '产卵、建造、升级都要用到蜂蜜；顶部会显示数量和每秒增长。', 'xf_res_honey', '', '',
    (e: GameEngine) => e.w.unlocked('t_first_nectar')),
  new IntroTopic('queen', '蜂后', '住在蜂巢中心，蜂群里唯一会产卵的蜜蜂。',
    '点花田中央的蜂箱进入蜂巢，就能找到蜂后：点击孵化消耗蜂蜜获得幼虫，再亲自选择工种分化。累计孵化越多，新卵越贵。', 'xf_nav_queen', 'hiveIcon', 'field',
    (e: GameEngine) => e.w.count(Bld.Brewery) > 0 || e.run.colony.eggsLaid > 0),
  new IntroTopic('larva', '幼虫', '刚出生的小蜜蜂，还没有决定做什么工作。',
    '先在蜂巢里建好对应的巢房，就能把幼虫培养成侦察蜂、采集蜂等不同工种。', 'xf_talent_b_hatch', 'queen', 'hive',
    (e: GameEngine) => e.run.colony.eggsLaid > 0),
  new IntroTopic('scoutRoom', '侦察蜂巢房', '侦察蜂的住所，建在蜂巢的六边形空格里。',
    '在蜂巢里点一个发光的空格（或在右侧功能栏「建造」里选它）。建成后幼虫就能培养成侦察蜂，去寻找更远的花田。',
    'xf_building_scout', 'hive', 'hive',
    (e: GameEngine) => available(e, Bld.ScoutRoom)),
  new IntroTopic('scout', '侦察蜂', '戴护目镜的探路蜂，会在虚线圈范围内寻找新花田。',
    '找到花田后回巢跳摇摆舞，把位置告诉同伴。', 'xf_role_scout', '', 'field',
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
  new IntroTopic('storage', '储蜜格', '储存蜂蜜和花蜜的仓库，冬天全靠它。',
    '建成第一个储蜜格后，正式四季开始，同时开放蜂蜡与扩建。', 'xf_building_storage', 'hive', 'hive',
    (e: GameEngine) => available(e, Bld.Storage)),
  // ---------------- 之后：每遇到新东西介绍一次 ----------------
  new IntroTopic('wax', '蜂蜡', '巢内工蜂消耗蜂蜜分泌的建筑材料。',
    '扩建蜂巢、建造高级巢房和部分升级需要蜂蜡。', 'xf_res_wax', '', '',
    (e: GameEngine) => e.w.unlocked('t_build_storage')),
  new IntroTopic('seasons', '四季', '春夏花多、秋天该储备、冬天花田几乎停产。',
    '顶部显示当前季节和换季倒计时；右侧功能栏「生态」里能看到季节对产量的影响。', 'xf_season_spring', '', '',
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
    '建成后立即加快酿蜜；手动分化巢内工蜂能进一步提高加工速度，储蜜格建成后还可以分工产蜡。', 'xf_building_brewery', 'hive', 'hive',
    (e: GameEngine) => available(e, Bld.Brewery)),
  new IntroTopic('house', '巢内工蜂', '系着围裙的巢内工匠。',
    '右侧功能栏「蜂群」里可以分配酿蜜和筑巢（产蜂蜡）的比例。', 'xf_role_house', '', '',
    (e: GameEngine) => e.w.role(Role.House) > 0),
  new IntroTopic('threats', '敌害', '胡蜂、蜘蛛网和蜡螟会不时出现。新手阶段它们只会让蜜蜂受伤；新手结束后会咬死蜜蜂，而且每个四季轮回都更强。',
    '直接点敌害就能亲手驱赶（按住连续拍打），守卫蜂也会自动出击；守卫越多、攻击效率越高，伤亡越少。击退能拿到蜂蜜，连续击退 5 次再送 1 蜂王浆。', 'xf_threat_danger', '', '',
    (e: GameEngine) => e.run.threats.enabled),
  new IntroTopic('wasp', '胡蜂', '在航线附近盘旋的掠食者。', '会降低那片花田的采集效率，弄伤甚至咬死采集蜂；点胡蜂亲手驱赶，守卫蜂也会赶来帮忙。',
    'xf_enemy_wasp', '', 'field', (e: GameEngine) => hasThreat(e, ThreatType.Wasp)),
  new IntroTopic('web', '蜘蛛网', '结在花田上的网。', '被网住的花田效率大降，撞进网里的采集蜂可能会死；点蛛网亲手清理，守卫蜂也会去清理。', 'xf_enemy_web', '',
    'field', (e: GameEngine) => hasThreat(e, ThreatType.Web)),
  new IntroTopic('moth', '蜡螟', '偷偷钻进蜂巢的小虫。', '会啃食蜂蜡、毁掉幼虫；进蜂巢点储蜜格上的蜡螟赶走它，守卫蜂在巢门值守时也能更快赶走它。', 'xf_enemy_moth', '',
    'hive', (e: GameEngine) => hasThreat(e, ThreatType.Moth)),
  new IntroTopic('bear', '熊', '闻着蜜香而来的大家伙：建成采集蜂巢房以后，它随时可能出现（冬天冬眠）。',
    '点熊拍打、让守卫蜂迎战，把它赶走能拿到蜂王浆。赶不走的话，25% 会把整个蜂巢掀翻（这个蜂群从零开始），其余时候蜜蜂只好上缴蜂蜜。', 'xf_enemy_bear', '', 'field',
    (e: GameEngine) => hasThreat(e, ThreatType.Bear)),
  new IntroTopic('guardRoom', '守卫巢房', '守卫蜂的营房。', '建成后可以培养守卫蜂，保护花田、航线和巢门。',
    'xf_building_guard', 'hive', 'hive', (e: GameEngine) => available(e, Bld.GuardRoom)),
  new IntroTopic('guard', '守卫蜂', '戴头盔、举盾牌的卫士。', '右侧功能栏「蜂群」里可以设置守卫优先保护的区域。',
    'xf_role_guard', '', '', (e: GameEngine) => e.w.role(Role.Guard) > 0),
  new IntroTopic('pollinate', '授粉', '让采集蜂驻守在花田里帮花授粉。',
    '点开花田可以安排驻守蜜蜂：花田会恢复更快，并成长为更高级的花种。', 'xf_talent_e_pollen', '', 'field',
    (e: GameEngine) => e.w.unlocked('t_first_expand') && e.w.role(Role.Forager) > 1),
  new IntroTopic('winter', '冬天', '花田几乎停产，蜂群靠储备的蜂蜜过冬。',
    '入冬前多建储蜜格、多存蜂蜜；第一个冬天受保护，只会降低产量。', 'xf_season_winter', '', '',
    (e: GameEngine) => e.run.season.season === SeasonId.WinterPrep || e.run.season.season === SeasonId.Winter),
  new IntroTopic('jelly', '蜂王浆', '珍贵的稀有资源。', '来自稀有花田、蜂群任务、每日签到、连续击退敌害和击退熊，用于研究和特殊升级。',
    'xf_res_jelly', '', '', (e: GameEngine) => e.w.econ.num(Res.Jelly) > 0.001),
  new IntroTopic('rare', '稀有花田', '侦察蜂偶尔会发现的珍稀花种。', '产量高，采集时还有机会获得蜂王浆，但也更吸引敌害。',
    'xf_status_rare', '', 'field', (e: GameEngine) => e.run.stats.rareFound > 0),
  new IntroTopic('overflow', '溢出缓冲', '仓库满了以后多出来的资源会暂存在这里。',
    '缓冲会慢慢流失；多建储蜜格腾出空间后，在「资源」里领取。', 'xf_status_overflow', '', '',
    (e: GameEngine) => e.w.unlocked('t_build_storage') && hasOverflow(e)),
  new IntroTopic('colonyTask', '蜂群任务', '轮换出现的小目标。', '完成后在「任务」里领取蜂王浆奖励。', 'xf_nav_tasks', '', '',
    (e: GameEngine) => e.prog.colonyTask() !== null && e.w.unlocked('t_first_expand')),
  new IntroTopic('breedPlan', '繁育计划', '蜂群壮大后，蜂后可以按你定好的比例自动繁育。',
    '在蜂后详情里开启并调整各工种比例和保留蜂蜜；离线时也会照常繁育，手动孵化随时可以插队。', 'xf_status_automation', 'panel:queen', '',
    (e: GameEngine) => e.state.meta.tutorialDone && e.colony.planUnlocked()),
  new IntroTopic('beeRoster', '每只蜜蜂都有名字', '蜂群里的每只蜜蜂都有一个独一无二的名字，记着它在第几轮的哪个季节出生、效率高低和干了多少活。',
    '点地图上飞来飞去的采集蜂或侦察蜂，镜头会跟着它飞；进蜂巢点工蜂和守卫也能看到它是谁。完整名单在「蜂群」→「蜂群名册」。', 'xf_nav_comb', '', 'field',
    (e: GameEngine) => e.state.meta.tutorialDone && e.w.role(Role.Forager) >= 3),
  new IntroTopic('kingdom', '王国等级', '你经营蜂巢的每件事都会积累王国经验：孵化、升级、建造、击退敌害、发现花田、过冬、完成目标……',
    '顶部的 Lv 小标显示等级和进度。每升一级都有奖励，部分等级送明星蜂卵和新外观，每 10 级全部研究上限 +1。', 'xf_building_queen', 'panel:tasks', '',
    (e: GameEngine) => e.state.meta.tutorialDone && e.kingdom.state().level >= 2),
  new IntroTopic('chapter', '种区篇章', '每个种区都有一串按顺序推进的篇章目标，一共 10 个：分化新蜂后、原地分蜂开枝散叶，最后一个就是远征新种区。',
    '在「任务」最上面能看到当前篇章和进度，完成就自动发奖。每个种区还有一个专属成就和蜂巢外观。', 'xf_nav_split', 'panel:tasks', '',
    (e: GameEngine) => e.state.meta.tutorialDone && e.w.unlocked('t_first_expand')),
  new IntroTopic('seasonEvent', '季节事件', '每个季节开头会发生一件小事：流浪蜂群、远处花海、暴雨、养蜂人、寒潮……',
    '空闲时会自动弹出，选完立刻见效；点「稍后再说」可以先放着，顶部事件条还能再点开。季节结束前不选，它会自然过去。', 'xf_card_season', '', '',
    (e: GameEngine) => e.events.active() !== null),
  new IntroTopic('raid', '蜂巢保卫战', '秋天，胡蜂窝派来一波又一波胡蜂，最后胡蜂王会亲自出马。',
    '点顶部的保卫战条跳到战场，直接点胡蜂拍打（按住连拍），守卫蜂也会出击。前两个秋天 3 波、之后 4 波，限时内全部打跑就能拿到蜂王浆和大量蜂蜜。', 'xf_enemy_wasp', '', 'field',
    (e: GameEngine) => e.threats.raidActive()),
  new IntroTopic('star', '明星蜂', '偶尔会孵出带特殊才能的明星蜂，它会给整个蜂群加成。',
    '在蜂群名册或图鉴「明星蜂」里能看到它，用蜂王浆升级最高到 Lv5。明星蜂分蜂时优先跟随新蜂后，一代代攒下来。', 'xf_status_rare', 'panel:roster', '',
    (e: GameEngine) => e.roster.stars().length > 0),
  new IntroTopic('evolution', '进化腔', '研究本种区专属强化的地方。',
    '建成后可以用蜂蜜和蜂王浆进行研究；研究只在本种区有效。', 'xf_building_evolution', 'hive', 'hive',
    (e: GameEngine) => available(e, Bld.Evolution)),
  new IntroTopic('swarm', '分蜂', '攒够 10 蜂王浆，孵一枚新卵，就能把幼虫分化成新蜂后：成功率 25%，每失败一次 +2%，失败返还一半蜂王浆。',
    '有了新蜂后就能原地分蜂：她带走一半资源和人口在附近建新巢。本种区蜂群够多（最少 2 个，难度越高越多）并达成发展条件后，才能远征新的种区。每个传承点让之后所有蜂巢产量永久 +2%。', 'xf_nav_split', '', '',
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

  /** 新手阶段：采蜜 → 酿蜜房 → 手动孵化/工蜂 → 采集房/采集蜂 → 侦察房/侦察蜂（见 GameConfig.TUTORIAL）。 */
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
      if (this.inTutorial() && ['storage', 'wax', 'seasons', 'expand', 'upgrade', 'nursery'].includes(t.id)) continue;
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
    if (this.inTutorial()) {
      const step = w.cfg.tutorial[e.state.meta.tutorialStep];
      if (step !== undefined) {
        const buildingByTask: Record<string, string> = {
          t_build_brewery: Bld.Brewery, t_build_forager: Bld.ForagerRoom, t_build_scout: Bld.ScoutRoom
        };
        const building = buildingByTask[step.doneTask];
        let text = step.text;
        let action = step.focus === 'hive' ? 'focus:hive@hive' : step.focus === 'queen' ? 'queen' : 'focus:field@field';
        if (building !== undefined) {
          const cost = e.hive.buildCost(building);
          const short = e.reasonsForShortage(cost);
          text = short.length === 0 ? `蜂蜜够了：建造${w.bldDef(building).name}` : `${step.title} · ${short}。${step.text}`;
          action = short.length === 0 ? `build:${building}` : 'focus:field@field';
        } else if (step.focus === 'queen' && step.doneTask !== 't_first_egg') {
          const target = step.doneTask === 't_first_house' ? Role.House : step.doneTask === 't_first_forager' ? Role.Forager : Role.Scout;
          const batch = e.run.colony.batches.find((b) => b.targetRole === target);
          if (batch) text = `${w.roleDef(target).name}分化中 · ${Math.ceil(Math.max(0, batch.finishAt - e.run.time))}秒`;
          else if (e.run.colony.larvae === 0) text = `先手动孵化新卵，再选择分化为${w.roleDef(target).name}`;
        }
        add(new Hint(step.id, text, 'next', action, building ? BLD_ICON[building] : 'xf_nav_tasks'));
      }
      return out;
    }
    // 注意
    const bear = e.threats.pendingBear();
    if (bear !== null && bear.phase !== 'postponed') {
      add(new Hint('bear', '熊来了！点熊拍打、让守卫迎战，赶不走可能整个蜂巢都会被掀翻', 'warn', 'panel:eco', 'xf_enemy_bear'));
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
      const target = threats[0];
      const onField = target.type !== ThreatType.Moth;
      add(new Hint('noGuard', `${e.threats.def(target.type).name}来了：点它亲手驱赶${w.count(Bld.GuardRoom) > 0 ? '，或培养守卫蜂' : ''}`,
        'warn', onField ? `focus:fieldId:${target.targetId}@field` : 'focus:hive@hive', 'xf_threat_danger'));
    }
    // 交接后只介绍首次开放的系统，不再指定下一步繁育或建造。
    const topic = this.pendingIntro();
    if (topic !== null) {
      add(new Hint(`intro_${topic.id}`, `新事物：${topic.title}`, 'new', `intro:${topic.id}`, topic.icon));
    }
    if (e.swarmPreview().ready) {
      add(new Hint('swarm', '种区分蜂条件已达成，可以远征新的种区', 'new', 'panel:swarm', 'xf_nav_split'));
    } else if (e.run.colony.youngQueens > 0) {
      add(new Hint('localSwarm', '新蜂后已就位：可以原地分蜂，带走一半资源和人口建新巢', 'new', 'panel:swarm', 'xf_nav_split'));
    } else if (e.w.unlocked('t_survive_winter') && e.w.econ.canAfford(e.colony.queenCost())) {
      add(new Hint('rearQueen', e.run.colony.larvae > 0 ? '蜂王浆够 10 了：可以把幼虫分化成新蜂后' : '蜂王浆够 10 了：孵一枚新卵，就能分化新蜂后',
        'try', 'panel:swarm', 'xf_building_queen'));
    }
    if (e.daily.canSign()) {
      add(new Hint('dailySign', `今日签到：领取第 ${e.daily.nextStreak()} 天奖励`, 'new', 'panel:tasks', 'xf_card_updated'));
    } else if (e.daily.state.tasks.some((t) => !t.claimed && t.progress >= t.target) || e.daily.bonusReady()) {
      add(new Hint('dailyTask', '每日目标完成了：到「任务」里领取奖励', 'new', 'panel:tasks', 'xf_nav_tasks'));
    }
    const ct = e.prog.colonyTask();
    if (ct !== null && !ct.claimed && ct.current >= ct.target) {
      add(new Hint('colonyTask', '蜂群任务完成：到「任务」里领取蜂王浆奖励', 'new', 'panel:tasks', 'xf_nav_tasks'));
    }
    const up = upgradeReady(e);
    if (up.length > 0 && w.unlocked('t_first_forager') && !this.seen('upgrade')) {
      add(new Hint(`up_${up}`, `${w.bldDef(up).name}有可以升级的属性`, 'try', `upgrade:${up}`, 'xf_action_upgrade'));
    }
    if (expandReady(e) && !this.seen('expand')) {
      add(new Hint('expand', '蜂蜡够了，可以扩建蜂巢外圈', 'try', 'focus:expand@hive', 'xf_action_expand'));
    }
    if (w.econ.fillRatio(Res.Honey) >= 0.95 && w.unlocked('t_auto_loop')) {
      add(new Hint('full', '蜂蜜仓快满了：再建一个储蜜格或升级容量', 'try', `build:${Bld.Storage}`, 'xf_status_full'));
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
