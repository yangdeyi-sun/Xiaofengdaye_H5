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
      this.w.econ.addN(Res.Honey, honey, Reason.Process, 'brew');
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
  private starveTimer: number = 0;
  private starveDeathTimer: number = 0;

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
        this.w.msg('season', `成功度过第 ${s.wintersSurvived} 个冬季！春天来了。`);
        this.w.emit('spring', 0, 0, '度过冬季', 'hive');
      }
      if (to === SeasonId.Winter && this.w.s.run.stats.firstWinterAt < 0) {
        this.w.s.run.stats.firstWinterAt = s.endsAt;
      }
      s.season = to;
      s.startedAt = s.endsAt;
      s.endsAt = s.endsAt + Math.max(10, this.duration(to));
      // 冬去春来已经有一条完整提示，不再额外排队“春季到了”，避免两张季节弹窗重叠。
      if (from !== SeasonId.Winter) this.w.msg('season', `${this.def(to).name}到了`);
      this.onChange(from, to);
    }
    this.upkeep(dt);
  }

  /** 冬季储备消耗（ECO-004）：不足时进入饥饿，首冬只降低产量；不产生负库存 */
  private upkeep(dt: number): void {
    const s = this.w.s.run.season;
    const sd = this.def(s.season);
    if (sd.upkeep <= 0) {
      if (s.starving) {
        s.starving = false;
        this.w.attrs.recompute();
      }
      this.starveTimer = 0;
      this.starveDeathTimer = 0;
      return;
    }
    const need = this.w.adults() * sd.upkeep * this.w.attrs.get('storage.winterLoss') * dt;
    const got = this.w.econ.drain(Res.Honey, need, Reason.Winter, 'winter');
    this.w.rates.upkeep += got;
    const starving = got + 1e-9 < need * 0.95;
    if (starving !== s.starving) {
      s.starving = starving;
      this.w.attrs.recompute();
      if (starving) {
        this.w.msg('warn', s.firstWinterProtected ? '储蜜不足：首个冬季受到保护，蜂群只会降低产量' : '储蜜不足：蜂群体力下降，部分蜜蜂暂停工作');
      } else {
        s.starveSeconds = 0;
        this.starveTimer = 0;
        this.starveDeathTimer = 0;
        this.w.msg('info', '储蜜恢复，蜂群停止衰败并开始休养');
      }
    }
    if (starving) {
      const before = s.starveSeconds;
      s.starveSeconds += dt;
      if (!s.firstWinterProtected && before < 60 && s.starveSeconds >= 60) {
        this.w.msg('warn', '持续饥饿：蜂后产卵与幼虫孵化速度下降');
        this.w.attrs.recompute();
      }
      if (!s.firstWinterProtected && before < 150 && s.starveSeconds >= 150) {
        this.w.msg('warn', '严重饥饿：若不补充蜂蜜，蜂群将开始缓慢减员');
      }
    }
    // 后续冬季按阶段衰败：先受伤停工，持续饥饿后限制繁育，最后才缓慢减员。
    if (starving && !s.firstWinterProtected && !this.w.offline && !this.w.hasFlag('winter_guard')) {
      this.starveTimer += dt;
      if (this.starveTimer >= 30) {
        this.starveTimer = 0;
        [Role.Forager, Role.House].forEach((r: string) => {
          const n = Math.ceil(this.w.role(r) * 0.03);
          const cap = Math.floor(this.w.role(r) * this.w.cfg.economy.injuryCapRatio);
          this.w.s.run.colony.injured[r] = Math.min(cap, this.w.injured(r) + n);
        });
      }
      if (s.starveSeconds >= 150) {
        this.starveDeathTimer += dt;
        if (this.starveDeathTimer >= 45) {
          this.starveDeathTimer = 0;
          const roles = [Role.Forager, Role.House, Role.Scout, Role.Guard];
          for (let i = 0; i < roles.length; i++) {
            const role = roles[i];
            if (this.w.role(role) > 0) {
              this.w.s.run.colony.roles[role] = this.w.role(role) - 1;
              this.w.s.run.colony.injured[role] = Math.min(this.w.injured(role), this.w.role(role));
              this.w.msg('warn', `长期缺蜜：1只${this.w.roleDef(role).name}死亡`);
              break;
            }
          }
          if (this.w.adults() <= 0 && this.w.s.run.colony.hatched > 0) {
            this.w.s.run.colony.collapsed = true;
            this.w.msg('error', '蜂群已经衰败，可消耗1点传承原地重启，或读取入冬前快照');
          }
        }
      }
    }
  }

  /** 预估过冬所需蜂蜜 */
  winterNeed(): number {
    return this.w.adults() * this.def(SeasonId.Winter).upkeep * this.duration(SeasonId.Winter) *
      this.w.attrs.get('storage.winterLoss');
  }
}
