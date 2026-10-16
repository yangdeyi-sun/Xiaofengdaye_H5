import {
  AchievementDef, BuildingDef, CostDef, EffectDef, FlowerDef, GameConfigDef, KeyLevelDef, RegionDef, ResearchDef,
  RewardDef, RoleDef, SeasonDef, SkinDef, StatDef, TalentDef, TaskDef, ThreatDef, TutorialStepDef, UpgradeTrackDef,
  Bld, Res, Role, SeasonId, ThreatType
} from './Types';

/**
 * 《小峰大业》0.1 数值配置（OPS-001：单位、建筑、价格、天赋、季节、事件全部配置化）
 * 节奏目标见设计文档第十六章，由 tools/sim 自动化测试校验。
 */

function c(res: string, base: number, growth: number): CostDef {
  const d: CostDef = { res: res, base: base, growth: growth };
  return d;
}

function st(id: string, name: string, base: number, min: number, max: number, unit: string): StatDef {
  const d: StatDef = { id: id, name: name, base: base, min: min, max: max, unit: unit };
  return d;
}

function kl(level: number, flag: string, desc: string): KeyLevelDef {
  const d: KeyLevelDef = { level: level, flag: flag, desc: desc };
  return d;
}

function tr(id: string, building: string, stat: string, name: string, perLevel: number, mode: string,
  maxLevel: number, costs: CostDef[], keys: KeyLevelDef[]): UpgradeTrackDef {
  const d: UpgradeTrackDef = {
    id: id, building: building, stat: stat, name: name, perLevel: perLevel, mode: mode,
    maxLevel: maxLevel, costs: costs, keyLevels: keys
  };
  return d;
}

function ef(stat: string, op: string, value: number): EffectDef {
  const d: EffectDef = { stat: stat, op: op, value: value };
  return d;
}

function rw(res: string, amount: number): RewardDef {
  const d: RewardDef = { res: res, amount: amount };
  return d;
}

function sw(spring: number, summer: number, autumn: number, winter: number): Record<string, number> {
  const r: Record<string, number> = {};
  r[SeasonId.Tutorial] = 0;
  r[SeasonId.Spring] = spring;
  r[SeasonId.Summer] = summer;
  r[SeasonId.Autumn] = autumn;
  r[SeasonId.WinterPrep] = autumn;
  r[SeasonId.Winter] = winter;
  return r;
}

const STATS: StatDef[] = [
  st('manual.yield', '手动采集量', 2, 0.5, 1e9, '花蜜/次'),
  st('queen.layRate', '产卵速度', 1, 0.1, 50, '倍'),
  st('queen.popCap', '人口上限', 12, 5, 1e7, '只'),
  st('queen.special', '特殊幼虫概率', 0, 0, 0.5, ''),
  st('nursery.hatchSpeed', '孵化速度', 1, 0.1, 50, '倍'),
  st('nursery.slots', '每间育婴房队列', 2, 1, 50, '格'),
  st('nursery.costMul', '分化消耗', 1, 0.3, 2, '倍'),
  st('scout.speed', '侦察飞行速度', 40, 5, 500, '距离/秒'),
  st('scout.discovery', '发现效率', 1, 0.1, 20, '倍'),
  st('scout.range', '侦察范围', 420, 100, 5000, '距离'),
  st('scout.intel', '信息持续时间', 360, 60, 7200, '秒'),
  st('scout.rare', '稀有发现率', 0.18, 0, 0.95, ''),
  st('forager.speed', '采集飞行速度', 45, 5, 500, '距离/秒'),
  st('forager.collect', '采集速度', 1, 0.1, 20, '倍'),
  st('forager.carry', '单次携带量', 4, 1, 1e9, '花蜜'),
  st('forager.route', '路线效率', 1, 0.2, 10, '倍'),
  st('forager.avoid', '危险规避', 0, 0, 0.9, ''),
  st('house.brewSpeed', '加工速度', 1, 0.1, 50, '倍'),
  st('house.batch', '批次容量', 1, 0.5, 20, '倍'),
  st('house.conversion', '花蜜转化率', 0.5, 0.2, 0.95, ''),
  st('house.slots', '每间酿蜜房槽位', 4, 1, 100, '只'),
  st('house.waxRate', '筑巢效率', 1, 0.1, 50, '倍'),
  st('storage.capacity', '储存容量', 1, 0.1, 1e6, '倍'),
  st('storage.winterLoss', '越冬损耗', 1, 0.1, 2, '倍'),
  st('storage.buffer', '溢出缓冲', 1, 0, 10, '倍'),
  st('guard.range', '巡逻范围', 1, 0.2, 10, '倍'),
  st('guard.attack', '攻击效率', 1, 0.1, 100, '倍'),
  st('guard.recovery', '恢复速度', 1, 0.1, 20, '倍'),
  st('guard.warning', '威胁预警', 1, 0.5, 5, '倍'),
  st('pollinate.rate', '授粉效率', 1, 0.1, 50, '倍'),
  st('expand.costMul', '扩建成本', 1, 0.3, 2, '倍'),
  st('global.offlineHours', '离线收益上限', 2, 1, 24, '小时'),
  st('start.larvae', '开局幼虫', 0, 0, 50, '只')
];

const ROLES: RoleDef[] = [
  { id: Role.Scout, name: '侦察蜂', desc: '探索花田，回巢跳摇摆舞公开位置与花期', building: Bld.ScoutRoom,
    costs: [c(Res.Honey, 14, 1.32)], hatchTime: 25 },
  { id: Role.Forager, name: '采集蜂', desc: '自动前往已标记花田，把花蜜运回蜂巢', building: Bld.ForagerRoom,
    costs: [c(Res.Honey, 18, 1.085)], hatchTime: 30 },
  { id: Role.House, name: '巢内工蜂', desc: '把花蜜酿成蜂蜜，或消耗蜂蜜分泌蜂蜡', building: Bld.Brewery,
    costs: [c(Res.Honey, 30, 1.09)], hatchTime: 30 },
  { id: Role.Guard, name: '守卫蜂', desc: '巡逻巢门、花田和航线，驱赶敌害', building: Bld.GuardRoom,
    costs: [c(Res.Honey, 45, 1.11)], hatchTime: 35 }
];

const BUILDINGS: BuildingDef[] = [
  { id: Bld.Queen, name: '蜂后室', desc: '蜂后产卵与繁育，蜂巢的中心', adjacency: '相邻育婴房提高孵化效率',
    costs: [], maxCount: 1, unlockTask: '' },
  { id: Bld.ScoutRoom, name: '侦察蜂巢房', desc: '解锁侦察蜂', adjacency: '无',
    costs: [c(Res.Honey, 60, 4)], maxCount: 3, unlockTask: 't_first_egg' },
  { id: Bld.ForagerRoom, name: '采集蜂巢房', desc: '解锁采集蜂', adjacency: '无',
    costs: [c(Res.Honey, 140, 3)], maxCount: 3, unlockTask: 't_first_dance' },
  { id: Bld.Storage, name: '储蜜格', desc: '提升资源上限并承担越冬储备，开启正式四季', adjacency: '储蜜格彼此相邻提高总容量',
    costs: [c(Res.Honey, 160, 1.7)], maxCount: 30, unlockTask: 't_auto_loop' },
  { id: Bld.Nursery, name: '育婴房', desc: '增加孵化队列与人口上限', adjacency: '靠近蜂后室提高孵化效率',
    costs: [c(Res.Honey, 220, 1.8), c(Res.Wax, 8, 1.6)], maxCount: 12, unlockTask: 't_first_expand' },
  { id: Bld.Brewery, name: '酿蜜房', desc: '解锁巢内工蜂，花蜜与蜂蜜形成可管理的产线', adjacency: '靠近储蜜格提高加工与入库效率',
    costs: [c(Res.Honey, 320, 1.85), c(Res.Wax, 12, 1.6)], maxCount: 12, unlockTask: 't_first_expand' },
  { id: Bld.GuardRoom, name: '守卫巢房', desc: '解锁守卫蜂', adjacency: '位于最外圈时提高巢门防御范围',
    costs: [c(Res.Honey, 450, 1.9), c(Res.Wax, 20, 1.6)], maxCount: 8, unlockTask: 't_first_house' },
  { id: Bld.Evolution, name: '进化腔', desc: '当前种区研究与蜂王传承入口', adjacency: '靠近中心功能区提高全局加成效果',
    costs: [c(Res.Honey, 1200, 3), c(Res.Wax, 60, 2)], maxCount: 1, unlockTask: 't_survive_winter' }
];

const H = Res.Honey;
const W = Res.Wax;

const TRACKS: UpgradeTrackDef[] = [
  tr('queen.lay', Bld.Queen, 'queen.layRate', '产卵速度', 0.12, 'pct', 25, [c(H, 120, 1.42)],
    [kl(5, 'queen_double', '蜂后每次产下两枚卵'), kl(15, 'queen_royal', '偶尔产下品质更高的幼虫')]),
  tr('queen.pop', Bld.Queen, 'queen.popCap', '人口上限', 6, 'add', 40, [c(H, 150, 1.38), c(W, 4, 1.3)], []),
  tr('queen.special', Bld.Queen, 'queen.special', '特殊幼虫概率', 0.01, 'add', 15, [c(H, 600, 1.5), c(W, 20, 1.35)], []),
  tr('nursery.speed', Bld.Nursery, 'nursery.hatchSpeed', '孵化速度', 0.12, 'pct', 25, [c(H, 200, 1.4)],
    [kl(10, 'nursery_batch', '育婴房可批量分化')]),
  tr('nursery.slots', Bld.Nursery, 'nursery.slots', '队列数量', 1, 'add', 8, [c(H, 300, 1.7), c(W, 10, 1.5)], []),
  tr('nursery.cost', Bld.Nursery, 'nursery.costMul', '幼虫培养消耗', -0.04, 'pct', 10, [c(H, 350, 1.55)], []),
  tr('scout.speed', Bld.ScoutRoom, 'scout.speed', '飞行速度', 0.1, 'pct', 20, [c(H, 90, 1.4)], []),
  tr('scout.discovery', Bld.ScoutRoom, 'scout.discovery', '发现效率', 0.12, 'pct', 20, [c(H, 110, 1.42)], []),
  tr('scout.range', Bld.ScoutRoom, 'scout.range', '侦察范围', 70, 'add', 15, [c(H, 160, 1.5)],
    [kl(5, 'scout_far', '可以发现远方高价值花田')]),
  tr('scout.intel', Bld.ScoutRoom, 'scout.intel', '信息持续时间', 0.12, 'pct', 20, [c(H, 140, 1.42)], []),
  tr('scout.rare', Bld.ScoutRoom, 'scout.rare', '稀有发现率', 0.04, 'add', 12, [c(H, 300, 1.55), c(W, 6, 1.35)],
    [kl(6, 'scout_special', '识别特殊花田')]),
  tr('forager.speed', Bld.ForagerRoom, 'forager.speed', '飞行速度', 0.1, 'pct', 25, [c(H, 140, 1.38)], []),
  tr('forager.collect', Bld.ForagerRoom, 'forager.collect', '采集速度', 0.12, 'pct', 25, [c(H, 150, 1.38)], []),
  tr('forager.carry', Bld.ForagerRoom, 'forager.carry', '单次携带量', 1, 'add', 40, [c(H, 180, 1.36)],
    [kl(10, 'forager_route', '额外开放一条高产路线')]),
  tr('forager.route', Bld.ForagerRoom, 'forager.route', '路线效率', 0.08, 'pct', 20, [c(H, 220, 1.42), c(W, 3, 1.3)], []),
  tr('forager.avoid', Bld.ForagerRoom, 'forager.avoid', '危险规避', 0.05, 'add', 12, [c(H, 260, 1.45), c(W, 5, 1.3)], []),
  tr('house.speed', Bld.Brewery, 'house.brewSpeed', '加工速度', 0.12, 'pct', 25, [c(H, 300, 1.4), c(W, 5, 1.3)], []),
  tr('house.batch', Bld.Brewery, 'house.batch', '批次容量', 0.1, 'pct', 20, [c(H, 350, 1.42), c(W, 6, 1.3)],
    [kl(8, 'house_bulk', '批量加工：每批额外产出')]),
  tr('house.conv', Bld.Brewery, 'house.conversion', '花蜜转化率', 0.025, 'add', 12, [c(H, 500, 1.5), c(W, 10, 1.35)], []),
  tr('house.slots', Bld.Brewery, 'house.slots', '任务槽位', 2, 'add', 20, [c(H, 400, 1.45), c(W, 8, 1.3)], []),
  tr('house.wax', Bld.Brewery, 'house.waxRate', '筑巢效率', 0.12, 'pct', 20, [c(H, 380, 1.42), c(W, 6, 1.3)], []),
  tr('storage.cap', Bld.Storage, 'storage.capacity', '储存容量', 0.15, 'pct', 30, [c(H, 250, 1.4), c(W, 5, 1.3)], []),
  tr('storage.winter', Bld.Storage, 'storage.winterLoss', '越冬损耗', -0.05, 'pct', 12, [c(H, 300, 1.45)],
    [kl(6, 'winter_guard', '冬季保护：储蜜不足时蜂群停工而非受伤')]),
  tr('storage.buffer', Bld.Storage, 'storage.buffer', '溢出缓冲', 0.2, 'pct', 10, [c(H, 220, 1.45)], []),
  tr('guard.range', Bld.GuardRoom, 'guard.range', '巡逻范围', 0.1, 'pct', 20, [c(H, 300, 1.42), c(W, 6, 1.3)], []),
  tr('guard.attack', Bld.GuardRoom, 'guard.attack', '攻击效率', 0.15, 'pct', 25, [c(H, 320, 1.42), c(W, 6, 1.3)], []),
  tr('guard.recovery', Bld.GuardRoom, 'guard.recovery', '恢复速度', 0.15, 'pct', 15, [c(H, 280, 1.42)], []),
  tr('guard.warning', Bld.GuardRoom, 'guard.warning', '威胁预警', 0.15, 'pct', 10, [c(H, 260, 1.45)],
    [kl(5, 'guard_alarm', '提前预警重大事件')])
];

function fl(id: string, name: string, tier: number, yieldMul: number, maxStock: number, regen: number,
  jelly: number, next: string, petal: string, center: string, rare: boolean): FlowerDef {
  const d: FlowerDef = {
    id: id, name: name, tier: tier, yieldMul: yieldMul, maxStock: maxStock, regen: regen,
    jellyPerTrip: jelly, next: next, petal: petal, center: center, rare: rare
  };
  return d;
}

const FLOWERS: FlowerDef[] = [
  fl('wild', '野花丛', 1, 1.0, 120, 1.2, 0, 'sunflower', '#F7C8E0', '#F2B705', false),
  fl('sunflower', '向日葵花田', 2, 1.6, 260, 2.4, 0, 'lavender', '#FFC93C', '#7A4B1E', false),
  fl('lavender', '薰衣草田', 3, 2.4, 480, 4.0, 0, 'eco', '#A88BEB', '#5B3FA0', false),
  fl('eco', '稀有生态花田', 4, 3.4, 800, 6.0, 0.004, '', '#6FD3C1', '#1F7A6C', true),
  fl('clover', '三叶草地', 1, 1.1, 140, 1.4, 0, 'sunflower', '#FFFFFF', '#79B851', false),
  fl('rapeseed', '油菜花田', 2, 1.8, 300, 2.6, 0, 'lavender', '#F9E04B', '#C9A100', false),
  fl('snowlotus', '雪莲', 4, 2.8, 400, 3.0, 0.008, '', '#EAF6FF', '#9CC9E8', true),
  fl('waterlily', '睡莲', 4, 2.6, 420, 3.2, 0.008, '', '#FFB7C5', '#F2D16B', true),
  fl('cactus', '仙人掌花', 4, 3.0, 360, 2.4, 0.009, '', '#FF6F61', '#4C8C3A', true),
  fl('roofrose', '屋顶月季', 4, 2.7, 380, 3.0, 0.008, '', '#E6395B', '#FFD166', true)
];

function sd(id: string, name: string, duration: number, nectar: number, lay: number, threat: number,
  brew: number, upkeep: number, next: string): SeasonDef {
  const d: SeasonDef = {
    id: id, name: name, duration: duration, nectarMul: nectar, layMul: lay, threatMul: threat,
    brewMul: brew, upkeep: upkeep, next: next
  };
  return d;
}

const SEASONS: SeasonDef[] = [
  sd(SeasonId.Tutorial, '新手春季', 0, 1.0, 1.0, 0, 1.0, 0, SeasonId.Spring),
  sd(SeasonId.Spring, '春季', 300, 0.95, 1.1, 0.6, 1.0, 0, SeasonId.Summer),
  sd(SeasonId.Summer, '夏季', 300, 1.35, 1.0, 1.4, 1.0, 0, SeasonId.Autumn),
  sd(SeasonId.Autumn, '秋季', 240, 0.7, 0.9, 0.9, 1.25, 0, SeasonId.WinterPrep),
  sd(SeasonId.WinterPrep, '冬季将至', 60, 0.5, 0.8, 0.5, 1.25, 0, SeasonId.Winter),
  sd(SeasonId.Winter, '冬季', 240, 0.08, 0.4, 0.3, 0.8, 0.008, SeasonId.Spring)
];

function th(id: string, name: string, desc: string, hp: number, hpCycle: number, life: number, area: string,
  reward: RewardDef[], w: Record<string, number>): ThreatDef {
  const d: ThreatDef = {
    id: id, name: name, desc: desc, hp: hp, hpPerCycle: hpCycle, lifetime: life, area: area,
    reward: reward, seasonWeight: w
  };
  return d;
}

const THREATS: ThreatDef[] = [
  th(ThreatType.Wasp, '胡蜂', '袭击运输路线，使采集蜂受伤，降低该花田效率', 40, 15, 150, 'routes',
    [rw(Res.Honey, 40)], sw(0.6, 1.6, 0.9, 0.1)),
  th(ThreatType.Web, '蜘蛛网', '困住经过的蜜蜂，降低花田路线效率直到被清理', 30, 10, 0, 'fields',
    [rw(Res.Honey, 25)], sw(1.1, 0.7, 1.2, 0.2)),
  th(ThreatType.Moth, '蜡螟', '潜入巢内消耗蜂蜡，降低储存效率', 25, 8, 0, 'gate',
    [rw(Res.Wax, 8)], sw(0.6, 0.8, 0.9, 0.8)),
  th(ThreatType.Bear, '熊', '低频蜂巢事件，集中守卫可以击退并获得蜂王浆', 260, 120, 75, 'gate',
    [rw(Res.Jelly, 3), rw(Res.Honey, 300)], sw(0.5, 1.0, 1.0, 0))
];

function rg(id: string, name: string, desc: string, rule: string, diff: number, seasonMul: Record<string, number>,
  nectar: number, regen: number, fly: number, threat: number, count: number, minR: number, maxR: number,
  pool: string[], rare: string, maxRing: number, ground: string, groundAlt: string,
  flyBySeason: Record<string, number>): RegionDef {
  const d: RegionDef = {
    id: id, name: name, desc: desc, rule: rule, difficulty: diff, seasonMul: seasonMul, nectarMul: nectar,
    regenMul: regen, flyMul: fly, threatMul: threat, fieldCount: count, minRadius: minR, maxRadius: maxR,
    flowerPool: pool, rareFlower: rare, maxRing: maxRing, flyBySeason: flyBySeason, ground: ground,
    groundAlt: groundAlt
  };
  return d;
}

function sm(spring: number, summer: number, autumn: number, winter: number): Record<string, number> {
  const r: Record<string, number> = {};
  r[SeasonId.Spring] = spring;
  r[SeasonId.Summer] = summer;
  r[SeasonId.Autumn] = autumn;
  r[SeasonId.WinterPrep] = 1;
  r[SeasonId.Winter] = winter;
  return r;
}

const REGIONS: RegionDef[] = [
  rg('meadow', '起源草甸', '温和的草甸，适合建立第一座蜂巢', '标准四季', 0, sm(1, 1, 1, 1), 1, 1, 1, 1,
    16, 110, 900, ['wild', 'clover', 'sunflower', 'rapeseed'], 'eco', 4, '#9BCF6A', '#86BF57', sm(1, 1, 1, 1)),
  rg('alpine', '高寒山地', '冬季更长，夏季短暂，花蜜品质更高', '冬季时长×1.6，花蜜×1.25', 2, sm(1, 0.7, 1, 1.6),
    1.25, 0.9, 0.95, 0.8, 15, 130, 950, ['wild', 'clover', 'lavender'], 'snowlotus', 4, '#B7D3C4', '#A3C2B1', sm(1, 1, 1, 0.85)),
  rg('rainy', '雨季湿地', '春季多雨，飞行变慢；花田恢复很快', '春季飞行速度×0.7，恢复×1.4', 1, sm(1.2, 1, 1, 0.9),
    1, 1.4, 0.85, 1.1, 18, 110, 950, ['wild', 'clover', 'rapeseed'], 'waterlily', 4, '#7FBF8E', '#6DAE7D', sm(0.7, 1, 1, 1)),
  rg('drought', '干旱荒原', '花田稀少恢复慢，但单次收获丰厚；夏季胡蜂猖獗', '恢复×0.6，产量×1.4，夏季威胁×1.5', 2,
    sm(1, 1.2, 0.9, 0.8), 1.4, 0.6, 1, 1.5, 13, 140, 1000, ['wild', 'sunflower'], 'cactus', 4, '#D9C28A', '#CCB273', sm(1, 0.9, 1, 1)),
  rg('rooftop', '城市屋顶', '空间狭小但花盆密集，蜂巢最多扩建到第三圈', '蜂巢上限3圈，花田距离近', 3, sm(1, 1, 1, 1),
    1.1, 1.1, 1.05, 1.2, 20, 90, 650, ['wild', 'rapeseed', 'sunflower', 'lavender'], 'roofrose', 3, '#B9B4AA', '#A8A398', sm(1, 1, 1, 1))
];

const RESEARCH: ResearchDef[] = [
  { id: 'r_flight', name: '气流导航', desc: '侦察蜂和采集蜂飞行速度提高', maxLevel: 5,
    costs: [c(H, 900, 2), c(Res.Jelly, 1, 1.6)], effects: [ef('forager.speed', 'pct', 0.1), ef('scout.speed', 'pct', 0.1)] },
  { id: 'r_carry', name: '蜜囊扩容', desc: '采集蜂单次携带量提高', maxLevel: 5,
    costs: [c(H, 1000, 2), c(Res.Jelly, 1, 1.6)], effects: [ef('forager.carry', 'pct', 0.1)] },
  { id: 'r_brew', name: '高效酿造', desc: '巢内加工速度提高', maxLevel: 5,
    costs: [c(H, 1100, 2), c(Res.Jelly, 1, 1.6)], effects: [ef('house.brewSpeed', 'pct', 0.12)] },
  { id: 'r_breed', name: '群体繁育', desc: '产卵与孵化同时加速', maxLevel: 5,
    costs: [c(H, 1000, 2), c(Res.Jelly, 1, 1.6)], effects: [ef('queen.layRate', 'pct', 0.1), ef('nursery.hatchSpeed', 'pct', 0.1)] },
  { id: 'r_defense', name: '防御阵型', desc: '守卫蜂攻击效率提高', maxLevel: 5,
    costs: [c(H, 1200, 2), c(Res.Jelly, 1, 1.6)], effects: [ef('guard.attack', 'pct', 0.15)] },
  { id: 'r_store', name: '储藏技术', desc: '全部资源容量提高', maxLevel: 5,
    costs: [c(H, 1200, 2), c(Res.Jelly, 1, 1.6)], effects: [ef('storage.capacity', 'pct', 0.12)] },
  { id: 'r_pollen', name: '授粉学', desc: '授粉效率提高', maxLevel: 5,
    costs: [c(H, 1000, 2), c(Res.Jelly, 1, 1.6)], effects: [ef('pollinate.rate', 'pct', 0.2)] },
  { id: 'r_offline', name: '长效储备', desc: '离线收益上限延长半小时', maxLevel: 4,
    costs: [c(H, 1500, 2.2), c(Res.Jelly, 2, 1.5)], effects: [ef('global.offlineHours', 'add', 0.5)] }
];

function tl(id: string, branch: string, name: string, desc: string, maxLevel: number, cost: number, branchReq: number,
  requires: string, effects: EffectDef[], ruleFlag: string): TalentDef {
  const d: TalentDef = {
    id: id, branch: branch, name: name, desc: desc, maxLevel: maxLevel, costPerLevel: cost,
    branchPointsRequired: branchReq, requires: requires, effects: effects, ruleFlag: ruleFlag
  };
  return d;
}

const TALENTS: TalentDef[] = [
  tl('b_lay', 'breed', '产卵加速', '蜂后产卵速度 +8%/级', 5, 1, 0, '', [ef('queen.layRate', 'pct', 0.08)], ''),
  tl('b_hatch', 'breed', '温巢孵化', '幼虫孵化速度 +8%/级', 5, 1, 0, '', [ef('nursery.hatchSpeed', 'pct', 0.08)], ''),
  tl('b_pop', 'breed', '人口扩容', '蜂群人口上限 +6%/级', 5, 1, 2, 'b_lay', [ef('queen.popCap', 'pct', 0.06)], ''),
  tl('b_start', 'breed', '随行幼虫', '新种区开局额外 2 只幼虫/级', 3, 2, 3, '', [ef('start.larvae', 'add', 2)], ''),
  tl('b_emerg', 'breed', '危难繁育', '关键能力：蜂群低于安全数量时自动加速繁育×2', 1, 3, 6, 'b_pop', [], 'emergencyBoost'),
  tl('p_carry', 'prod', '大蜜囊', '采集蜂携带量 +8%/级', 5, 1, 0, '', [ef('forager.carry', 'pct', 0.08)], ''),
  tl('p_brew', 'prod', '酿造传承', '酿蜜效率 +8%/级', 5, 1, 0, '', [ef('house.brewSpeed', 'pct', 0.08)], ''),
  tl('p_store', 'prod', '宽敞储蜜格', '储存容量 +10%/级', 5, 1, 2, 'p_brew', [ef('storage.capacity', 'pct', 0.1)], ''),
  tl('p_expand', 'prod', '蜂蜡精工', '扩建格子成本 -6%/级', 3, 2, 3, '', [ef('expand.costMul', 'pct', -0.06)], ''),
  tl('p_full', 'prod', '满载归巢', '关键能力：采集蜂满载时获得额外返巢速度（+20%飞行）', 1, 3, 6, 'p_carry',
    [ef('forager.speed', 'pct', 0.2)], 'fullReturn'),
  tl('e_range', 'eco', '远眺', '侦察范围 +10%/级', 5, 1, 0, '', [ef('scout.range', 'pct', 0.1)], ''),
  tl('e_pollen', 'eco', '花语者', '授粉效率 +12%/级', 5, 1, 0, '', [ef('pollinate.rate', 'pct', 0.12)], ''),
  tl('e_season', 'eco', '季节适应', '越冬损耗 -8%/级', 5, 1, 2, 'e_range', [ef('storage.winterLoss', 'pct', -0.08)], ''),
  tl('e_rare', 'eco', '珍稀嗅觉', '稀有发现率 +4%/级', 3, 2, 3, '', [ef('scout.rare', 'add', 0.04)], ''),
  tl('e_winter', 'eco', '雪中侦察', '关键能力：冬季侦察蜂继续出巢工作', 1, 3, 5, 'e_season', [], 'winterScout'),
  tl('e_dance', 'eco', '双路舞步', '关键能力：摇摆舞同时标记两条路线', 1, 3, 8, 'e_winter', [], 'doubleDance')
];

function tk(id: string, name: string, desc: string, kind: string, rewards: RewardDef[]): TaskDef {
  const d: TaskDef = { id: id, name: name, desc: desc, kind: kind, rewards: rewards };
  return d;
}

const TASKS: TaskDef[] = [
  tk('t_first_nectar', '第一滴花蜜', '点击花朵采集花蜜', 'main', [rw(H, 4)]),
  tk('t_first_egg', '首次产卵', '蜂后消耗蜂蜜产下第一只幼虫', 'main', [rw(H, 30)]),
  tk('t_build_scout', '侦察蜂巢房', '在蜂巢空格上建造侦察蜂巢房', 'main', [rw(H, 10)]),
  tk('t_first_scout', '第一只侦察蜂', '把幼虫分化为侦察蜂', 'main', [rw(H, 10)]),
  tk('t_first_dance', '摇摆舞', '侦察蜂发现花田并回巢跳舞', 'main', [rw(H, 20)]),
  tk('t_build_forager', '采集蜂巢房', '建造采集蜂巢房', 'main', [rw(H, 15)]),
  tk('t_first_forager', '第一只采集蜂', '把幼虫分化为采集蜂', 'main', [rw(H, 20)]),
  tk('t_auto_loop', '蜂巢开始自行运转', '采集蜂自动运蜜，蜂后自动产卵', 'main', [rw(H, 60)]),
  tk('t_build_storage', '第一个储蜜格', '建造储蜜格，正式四季随之开启', 'main', [rw(W, 30)]),
  tk('t_first_expand', '首次扩巢', '消耗蜂蜡扩建一个新的六边形格子', 'main', [rw(H, 80)]),
  tk('t_build_brewery', '酿蜜房', '建造酿蜜房，正式拆分花蜜与蜂蜜', 'main', [rw(W, 20)]),
  tk('t_first_house', '巢内工蜂', '分化第一只巢内工蜂', 'main', [rw(H, 100)]),
  tk('t_first_wax', '分泌蜂蜡', '让巢内工蜂筑巢，产出第一份蜂蜡', 'main', [rw(W, 15)]),
  tk('t_build_guard', '守卫巢房', '建造守卫巢房以应对敌害', 'main', [rw(H, 120)]),
  tk('t_first_clear', '首次击退', '守卫蜂清除一次敌害', 'main', [rw(Res.Jelly, 1)]),
  tk('t_survive_winter', '度过冬季', '依靠储备度过第一个冬季', 'main', [rw(Res.Jelly, 2)]),
  tk('t_pollinate', '花田成长', '通过授粉让花田升级', 'main', [rw(Res.Jelly, 1)]),
  tk('t_build_evolution', '进化腔', '建造进化腔，开启当前种区研究', 'main', [rw(Res.Jelly, 2)]),
  tk('t_first_research', '第一次研究', '在进化腔完成一项研究', 'main', [rw(H, 300)]),
  tk('t_pop_50', '五十之众', '蜂群数量达到 50', 'colony', [rw(Res.Jelly, 1)]),
  tk('t_rare_field', '珍稀花种', '发现一片稀有花田', 'colony', [rw(Res.Jelly, 2)]),
  tk('t_swarm_ready', '分蜂准备', '满足分蜂全部条件', 'main', [rw(Res.Jelly, 1)])
];

const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'a_first_swarm', name: '离巢远征', desc: '完成第一次分蜂', skin: 'amber' },
  { id: 'a_pop_200', name: '嗡嗡之城', desc: '单个种区蜂群达到 200', skin: 'lavender' },
  { id: 'a_bear', name: '熊口夺蜜', desc: '击退一次熊袭击', skin: 'midnight' },
  { id: 'a_winters_5', name: '凛冬行家', desc: '累计度过 5 个冬季', skin: 'frost' },
  { id: 'a_regions_3', name: '四海为巢', desc: '在 3 个不同种区建立蜂巢', skin: 'meadow' },
  { id: 'a_codex_flowers', name: '百花图谱', desc: '花种图鉴收集 8 种', skin: '' }
];

const SKINS: SkinDef[] = [
  { id: 'classic', name: '经典蜂蜡', cellFill: '#F6C453', cellStroke: '#B7791F', bg: '#3B2A14' },
  { id: 'amber', name: '琥珀', cellFill: '#F2A541', cellStroke: '#9C4F12', bg: '#2E1A0B' },
  { id: 'lavender', name: '薰衣草', cellFill: '#E8D27A', cellStroke: '#7D5BA6', bg: '#2C2340' },
  { id: 'midnight', name: '午夜', cellFill: '#E9B949', cellStroke: '#3D5A80', bg: '#141C2B' },
  { id: 'frost', name: '霜蜜', cellFill: '#F4E3A1', cellStroke: '#7FA7C9', bg: '#23313F' },
  { id: 'meadow', name: '草甸', cellFill: '#F5CF5B', cellStroke: '#5E8C31', bg: '#22301A' }
];

function tu(id: string, title: string, text: string, focus: string, doneTask: string): TutorialStepDef {
  const d: TutorialStepDef = { id: id, title: title, text: text, focus: focus, doneTask: doneTask };
  return d;
}

// 新手引导节点：采蜜 → 产卵 → 侦察蜂巢房 → 侦察蜂 → 采集蜂巢房 → 采集蜂 → 储蜜格（之后的系统由 Guide 气泡按需介绍）。
const TUTORIAL: TutorialStepDef[] = [
  tu('tap', '采集花蜜', '点击花田里的花朵，采集第一份花蜜。蜂巢会把花蜜慢慢转化为蜂蜜。', 'field', 't_first_nectar'),
  tu('egg', '蜂后产卵', '蜂蜜够了！打开「蜂后」，消耗蜂蜜产下第一只幼虫。', 'queen', 't_first_egg'),
  tu('scoutRoom', '建造侦察蜂巢房', '切换到蜂巢，点击蜂后室旁的空格，建造侦察蜂巢房。', 'hive', 't_build_scout'),
  tu('scout', '培养侦察蜂', '把幼虫培养成侦察蜂，它会去找新的花田。', 'queen', 't_first_scout'),
  tu('foragerRoom', '建造采集蜂巢房', '侦察蜂跳完摇摆舞后，建造采集蜂巢房。', 'hive', 't_build_forager'),
  tu('forager', '培养采集蜂', '培养第一只采集蜂，之后蜂后会自动产卵、自动培养。', 'queen', 't_first_forager'),
  tu('storage', '建造储蜜格', '蜂巢会自动为储蜜格攒蜂蜜，攒够后建造储蜜格，正式四季开始。', 'hive', 't_build_storage')
];

export const DEFAULT_CONFIG: GameConfigDef = {
  configVersion: '0.1.0-cfg6',
  schemaVersion: 2,
  economy: {
    manualYield: 2,
    baseConvertRate: 3.0,
    perBeeConvert: 0.12,
    baseConvertRatio: 0.5,
    houseBrewRate: 1.5,
    houseConvertRatio: 0.5,
    waxHoneyPerSec: 0.4,
    waxRatio: 0.25,
    queenWaxTrickle: 0.02,
    eggCost: c(Res.Honey, 8, 1.012),
    layInterval: 7,
    queenSlots: 2,
    nurserySlots: 2,
    popBase: 12,
    popPerNursery: 8,
    popPerRing: 10,
    capHoney: 400,
    capNectar: 400,
    capWax: 120,
    capJelly: 60,
    storageHoney: 600,
    storageNectar: 400,
    storageWax: 150,
    overflowRatio: 0.25,
    overflowDecayPerMin: 0.005,
    safetyLine: 4,
    injuryCapRatio: 0.2,
    lifespan: 1800,
    scoutSample: 4,
    holdCollectPerSec: 3,
    expandBaseWax: 18,
    expandRingGrowth: 2.4,
    expandCellGrowth: 1.07,
    offlineBaseHours: 2,
    offlineStep: 10,
    maxOfflineDays: 30
  },
  stats: STATS,
  roles: ROLES,
  buildings: BUILDINGS,
  tracks: TRACKS,
  flowers: FLOWERS,
  seasons: SEASONS,
  threats: THREATS,
  regions: REGIONS,
  research: RESEARCH,
  talents: TALENTS,
  tasks: TASKS,
  achievements: ACHIEVEMENTS,
  skins: SKINS,
  tutorial: TUTORIAL,
  swarm: {
    popBase: 36,
    popPerSwarm: 12,
    upgradeLevels: 12,
    honeyBase: 1200,
    honeyGrowth: 1.35,
    honeyCap: 12000,
    jelly: 3,
    minFields: 6,
    minWinters: 0,
    minPollinations: 0,
    basePoints: 5,
    resourceBonusCap: 0.2
  }
};

/** 配置 schema 校验（OPS-001/OPS-002）：非法配置回退安全默认值 */
export function validateConfig(cfg: GameConfigDef): string[] {
  const errs: string[] = [];
  if (cfg.configVersion === undefined || cfg.configVersion.length === 0) {
    errs.push('configVersion missing');
  }
  const ids: Set<string> = new Set<string>();
  cfg.tracks.forEach((t: UpgradeTrackDef) => {
    if (ids.has(t.id)) {
      errs.push(`duplicate track ${t.id}`);
    }
    ids.add(t.id);
    if (t.mode !== 'pct' && t.mode !== 'add') {
      errs.push(`bad mode ${t.id}`);
    }
    if (t.costs.length === 0) {
      errs.push(`track ${t.id} has no cost`);
    }
  });
  const statIds: Set<string> = new Set<string>();
  cfg.stats.forEach((s: StatDef) => {
    statIds.add(s.id);
  });
  cfg.tracks.forEach((t: UpgradeTrackDef) => {
    if (!statIds.has(t.stat)) {
      errs.push(`track ${t.id} stat ${t.stat} unknown`);
    }
  });
  cfg.research.forEach((r: ResearchDef) => {
    r.effects.forEach((e: EffectDef) => {
      if (!statIds.has(e.stat)) {
        errs.push(`research ${r.id} stat ${e.stat} unknown`);
      }
    });
  });
  cfg.talents.forEach((t: TalentDef) => {
    t.effects.forEach((e: EffectDef) => {
      if (!statIds.has(e.stat)) {
        errs.push(`talent ${t.id} stat ${e.stat} unknown`);
      }
    });
  });
  cfg.seasons.forEach((s: SeasonDef) => {
    if (s.duration < 0 || s.nectarMul < 0) {
      errs.push(`season ${s.id} invalid`);
    }
  });
  if (cfg.regions.length === 0) {
    errs.push('no regions');
  }
  return errs;
}
