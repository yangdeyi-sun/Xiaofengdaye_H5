import { Bld, Reason, Res, Role, SeasonDef, SeasonId } from './Types';
import { World } from './World';

/** 巢内加工产线（RES-003/005，BEE-005）：任务切换不复制或吞掉原料——每 tick 先扣原料再按实扣量入库 */
export class ProductionService {
  private w: World;

  constructor(w: World) {
    this.w = w;
  }

  brewSlots(): number {
    return Math.floor(this.w.count(Bld.Brewery) * this.w.attrs.get('house.slots'));
  }

  houseSplit(): number[] {
    const house = this.w.active(Role.House);
    const share = this.w.unlocked('t_build_storage') ? this.w.s.run.colony.houseWaxShare : 0;
    const builders = Math.round(house * share);
    const brewersWanted = house - builders;
    const brewers = Math.min(brewersWanted, this.brewSlots());
    return [brewers, builders, brewersWanted - brewers];
  }

  baseConvertCapacity(): number {
    const e = this.w.cfg.economy;
    return e.baseConvertRate + e.perBeeConvert * this.w.adults();
  }

  conversionRatio(): number {
    return this.w.attrs.get('house.conversion');
  }

  brewCapacity(): number {
    const e = this.w.cfg.economy;
    const split = this.houseSplit();
    return (this.breweryUnits() * e.breweryRate + split[0] * e.houseBrewRate) * this.w.attrs.get('house.brewSpeed') *
      this.w.attrs.get('house.batch') * this.w.seasonDef().brewMul;
  }

  /** 酿蜜房逐级提速：第 k 座提供 1 + 0.5 × (k - 1) 份基础产能 */
  breweryUnits(): number {
    const n = this.w.count(Bld.Brewery);
    return n + 0.25 * n * (n - 1);
  }

  tick(dt: number): void {
    const e = this.w.cfg.economy;
    // 1 蜂巢基础转化：保证开局能完成第一次产卵
    const nectar = this.w.econ.num(Res.Nectar);
    const baseWant = this.baseConvertCapacity() * dt;
    const brewWant = this.brewCapacity() * dt;
    const totalWant = baseWant + brewWant;
    if (totalWant > 0 && nectar > 0) {
      const used = this.w.econ.drain(Res.Nectar, Math.min(nectar, totalWant), Reason.Process, 'brew');
      const baseShare = totalWant > 0 ? baseWant / totalWant : 1;
      let bulk = 1;
      if (this.w.hasFlag('house_bulk')) {
        bulk = 1.1;
      }
      const honey = used * baseShare * e.baseConvertRatio + used * (1 - baseShare) * this.conversionRatio() * bulk;
      const made = this.w.econ.addN(Res.Honey, honey, Reason.Process, 'brew');
      this.w.dailyBump('honey', made);
      this.w.rates.nectarUse += used;
      this.w.rates.honeyIn += honey;
    }
    // 2 蜂蜡：巢内工蜂筑巢；酿蜜房建成前由蜂后室缓慢分泌
    if (this.w.unlocked('t_build_storage')) {
      const split = this.houseSplit();
      let honeyWant = split[1] * e.waxHoneyPerSec * this.w.attrs.get('house.waxRate') * dt;
      let trickle = 0;
      if (this.w.count(Bld.Brewery) === 0 || split[1] === 0) {
        trickle = e.queenWaxTrickle * dt;
        honeyWant += trickle / e.waxRatio;
      }
      const honeyAvail = this.w.econ.num(Res.Honey);
      // 保留产卵所需最低蜂蜜，避免筑巢吃光口粮
      const reserve = 15;
      if (honeyWant > 0 && honeyAvail > reserve) {
        const used = this.w.econ.drain(Res.Honey, Math.min(honeyWant, honeyAvail - reserve), Reason.Wax, 'wax');
        const wax = used * e.waxRatio;
        this.w.econ.addN(Res.Wax, wax, Reason.Wax, 'wax');
        this.w.rates.waxIn += wax;
        this.w.rates.honeyUse += used;
        if (split[1] > 0) {
          this.w.s.run.stats.houseWaxMade += wax;
        }
      }
    }
  }

  /** 预估蜂蜜净产能（升级预览） */
  estimateHoneyRate(nectarIn: number): number {
    const e = this.w.cfg.economy;
    const base = Math.min(nectarIn, this.baseConvertCapacity());
    const brew = Math.min(Math.max(0, nectarIn - base), this.brewCapacity());
    return base * e.baseConvertRatio + brew * this.conversionRatio();
  }
}

/** 四季状态机（ECO-001~004）：新手春季 → 春 → 夏 → 秋 → 冬季准备 → 冬 → 春 */
export class SeasonService {
  private w: World;
  onChange: (from: string, to: string) => void = () => {
  };
  /** 入冬储备不足时由 GameEngine 负责把当前蜂巢从零重建。 */
  onWinterFailure: (need: number, have: number) => void = () => {
  };

  constructor(w: World) {
    this.w = w;
  }

  def(id: string): SeasonDef {
    for (let i = 0; i < this.w.cfg.seasons.length; i++) {
      if (this.w.cfg.seasons[i].id === id) {
        return this.w.cfg.seasons[i];
      }
    }
    return this.w.cfg.seasons[0];
  }

  duration(id: string): number {
    return this.w.seasonDuration(id);
  }

  remaining(): number {
    const s = this.w.s.run.season;
    if (!s.formal) {
      return 0;
    }
    return Math.max(0, s.endsAt - this.w.s.run.time);
  }

  /** 正式四季在首个储蜜格建成后开启（ECO-002） */
  startFormal(): void {
    const s = this.w.s.run.season;
    if (s.formal) {
      return;
    }
    s.formal = true;
    s.season = SeasonId.Spring;
    s.startedAt = this.w.s.run.time;
    s.endsAt = this.w.s.run.time + this.duration(SeasonId.Spring);
    this.w.msg('season', '正式四季开始了：春季。秋季记得储备蜂蜜过冬。');
    this.onChange(SeasonId.Tutorial, SeasonId.Spring);
  }

  tick(dt: number): void {
    const s = this.w.s.run.season;
    if (!s.formal) {
      return;
    }
    const t = this.w.s.run.time;
    const known = this.w.cfg.seasons.some((season: SeasonDef) => season.id === s.season);
    if (!known || !Number.isFinite(s.startedAt) || !Number.isFinite(s.endsAt) || s.endsAt < s.startedAt) {
      s.season = SeasonId.Spring;
      s.startedAt = t;
      s.endsAt = t + this.duration(SeasonId.Spring);
      s.starving = false;
      s.starveSeconds = 0;
      this.w.msg('warn', '季节进度异常已自动修复，当前恢复为春季。');
    }
    let guard = 0;
    while (t >= s.endsAt && guard < 12) {
      guard++;
      const from = s.season;
      let to = this.def(from).next;
      // 开局前 30 分钟为引导期，不进入真正冬季
      if (to === SeasonId.WinterPrep && this.w.s.meta.totalPlayTime < 1800 && this.w.s.meta.swarmCount === 0) {
        // 以“剩余在线新手时长”确定唯一截止点。旧实现会在部分设备的大时间步/离线补算中反复顺延，
        // 导致永远无法进入冬季准备阶段。
        s.endsAt = t + Math.max(0.1, 1800 - this.w.s.meta.totalPlayTime);
        break;
      }
      if (from === SeasonId.Winter) {
        s.wintersSurvived += 1;
        s.cycleIndex += 1;
        s.firstWinterProtected = false;
        this.w.s.meta.totalWinters += 1;
        this.w.gainXp(25);
        this.w.msg('season', `成功度过第 ${s.wintersSurvived} 个冬季！春天来了。`);
        this.w.emit('spring', 0, 0, '度过冬季', 'hive');
      }
      if (to === SeasonId.Winter && this.w.s.run.stats.firstWinterAt < 0) {
        this.w.s.run.stats.firstWinterAt = s.endsAt;
      }
      if (to === SeasonId.Winter) {
        const need = this.winterNeed();
        const have = this.w.econ.num(Res.Honey);
        if (have + 1e-9 < need) {
          this.onWinterFailure(need, have);
          return;
        }
        const saving = this.w.attrs.get('storage.winterLoss') * (this.w.hasFlag('winter_guard') ? 0.85 : 1);
        const spent = Math.min(need, need * Math.max(0, saving));
        this.w.econ.drain(Res.Honey, spent, Reason.Winter, 'winter-reserve');
        this.w.msg('season', `越冬储备已交付：门槛 ${Math.ceil(need)}，实际消耗 ${Math.ceil(spent)} 蜂蜜。`);
      }
      s.season = to;
      s.startedAt = s.endsAt;
      s.endsAt = s.endsAt + Math.max(10, this.duration(to));
      // 冬去春来已经有一条完整提示，不再额外排队“春季到了”，避免两张季节弹窗重叠。
      if (from !== SeasonId.Winter) {
        // 季节每几分钟就换一次：第一轮全部提示；之后只提示需要玩家行动的秋季和冬季将至，其余记入消息
        const lines: Record<string, string> = {
          summer: '夏季到了：花蜜最多，敌害也更活跃',
          autumn: '秋季到了：花蜜变少，开始为冬天储蜜',
          winterPrep: '冬季将至：花田即将停产，抓紧储蜜',
          winter: '冬季到了：蜂群开始消耗储蜜'
        };
        const text = lines[to] ?? `${this.def(to).name}到了`;
        const important = to === SeasonId.Autumn || to === SeasonId.WinterPrep;
        this.w.msg(s.cycleIndex === 0 || important ? 'season' : 'info', text);
      }
      this.onChange(from, to);
    }
    this.upkeep(dt);
  }

  /** 越冬储备在入冬时一次结算；冬季内不再重复扣费。 */
  private upkeep(dt: number): void {
    const s = this.w.s.run.season;
    void dt;
    if (s.starving || s.starveSeconds > 0) {
      s.starving = false;
      s.starveSeconds = 0;
      this.w.attrs.recompute();
    }
  }

  /** 越冬阶梯：首冬 100，第二个冬季 300，此后每次 +100，最高 2500。 */
  winterNeed(): number {
    const survived = Math.max(0, Math.floor(this.w.s.run.season.wintersSurvived));
    return survived === 0 ? 100 : Math.min(2500, 200 + survived * 100);
  }
}
