import { BigNum } from '../common/BigNum';
import { hashText } from './BeeNames';
import { FlowerField, PendingPayout, SeasonEventState, TimedEffect } from './State';
import { ALL_ROLES, Reason, Res, Role, SeasonId } from './Types';
import { CmdResult, CostAmount, World } from './World';

/**
 * 季节事件：每个春、夏、秋、冬开头出现一个二选一/三选一的小事件，选完当场见效。
 * 界面在玩家空闲时自动弹出一次；点“稍后再说”后顶部保留事件条，季节结束前没选就自然过去。
 */

export class EventOption {
  id: string;
  label: string;
  detail: string;
  /** 看广告才能选的“两全”选项 */
  ad: boolean;

  constructor(id: string, label: string, detail: string, ad: boolean = false) {
    this.id = id;
    this.label = label;
    this.detail = detail;
    this.ad = ad;
  }
}

export class EventView {
  id: string = '';
  title: string = '';
  text: string = '';
  icon: string = '';
  remaining: number = 0;
  options: EventOption[] = [];
}

interface EventDef {
  id: string;
  title: string;
  icon: string;
  seasons: string[];
}

const EVENTS: EventDef[] = [
  { id: 'stray', title: '流浪蜂群来投奔', icon: 'xf_nav_swarm', seasons: [SeasonId.Spring, SeasonId.Summer] },
  { id: 'farbloom', title: '远处花海盛开', icon: 'xf_flower_rapeseed', seasons: [SeasonId.Spring, SeasonId.Summer] },
  { id: 'storm', title: '暴雨将至', icon: 'xf_season_summer', seasons: [SeasonId.Spring, SeasonId.Summer, SeasonId.Autumn] },
  { id: 'trader', title: '养蜂人路过', icon: 'xf_res_wax', seasons: [SeasonId.Summer, SeasonId.Autumn] },
  { id: 'pollen', title: '花粉丰年', icon: 'xf_talent_e_pollen', seasons: [SeasonId.Spring, SeasonId.Summer] },
  { id: 'cub', title: '迷路的小熊崽', icon: 'xf_enemy_bear', seasons: [SeasonId.Spring, SeasonId.Summer, SeasonId.Autumn] },
  { id: 'wish', title: '蜂后的心愿', icon: 'xf_nav_queen', seasons: [SeasonId.Spring, SeasonId.Summer, SeasonId.Autumn] },
  { id: 'dance', title: '摇摆舞大会', icon: 'xf_role_scout', seasons: [SeasonId.Summer, SeasonId.Autumn] },
  { id: 'cold', title: '寒潮来袭', icon: 'xf_season_winter', seasons: [SeasonId.Winter] },
  { id: 'sunny', title: '冬日暖阳', icon: 'xf_season_winter_prep', seasons: [SeasonId.Winter] }
];

export class EventService {
  private w: World;
  honeyPerSec: () => number = () => 0;
  /** 保卫战进行中时不出新事件 */
  busy: () => boolean = () => false;
  /** 公开一片花田（由 GameEngine 注入 MapService.publishDiscovery） */
  publish: (fieldId: string) => void = () => {};

  constructor(w: World) {
    this.w = w;
  }

  private hps(): number {
    return Math.max(0, this.honeyPerSec());
  }

  /** 当前可以选择的事件；没有则返回 null */
  active(): SeasonEventState | null {
    const e = this.w.s.run.season.event;
    if (e === undefined || e.resolved || e.until <= this.w.s.run.time) return null;
    return e;
  }

  private strayCount(): number {
    const free = this.w.popCap() - this.w.population();
    return Math.max(0, Math.min(free, Math.max(3, Math.min(25, Math.round(this.w.adults() * 0.12)))));
  }

  private eligible(id: string): boolean {
    const w = this.w;
    if (id === 'stray') return this.strayCount() >= 3;
    if (id === 'farbloom') return w.role(Role.Forager) >= 4;
    if (id === 'cub') return w.adults() >= 20;
    if (id === 'dance') return w.role(Role.Scout) > 0 && this.hiddenField() !== null;
    if (id === 'trader') return w.unlocked('t_build_storage');
    if (id === 'sunny') return w.role(Role.Forager) >= 2;
    return true;
  }

  /** 还没发现、在侦察范围附近的花田（摇摆舞大会可以直接公布） */
  private hiddenField(): FlowerField | null {
    const range = this.w.attrs.get('scout.range') * 1.3;
    let best: FlowerField | null = null;
    this.w.s.run.map.fields.forEach((f: FlowerField) => {
      if (f.discovered || f.home || f.hidden || f.dist > range) return;
      if (best === null || f.dist < best.dist) best = f;
    });
    return best;
  }

  /** 每秒一次：开新事件、结算延迟发放、清理过期效果、检查限时挑战 */
  tick(): void {
    const w = this.w;
    const run = w.s.run;
    const s = run.season;
    const t = run.time;
    if (Array.isArray(s.effects)) s.effects = s.effects.filter((fx: TimedEffect) => fx.until > t);
    if (Array.isArray(s.payouts) && s.payouts.length > 0) {
      const due = s.payouts.filter((p: PendingPayout) => p.at <= t);
      s.payouts = s.payouts.filter((p: PendingPayout) => p.at > t);
      due.forEach((p: PendingPayout) => this.pay(p));
    }
    const ch = s.challenge;
    if (ch !== undefined) {
      const done = run.stats.manualCollects - ch.start;
      if (done >= ch.target) {
        this.w.econ.add(Res.Jelly, BigNum.of(2), Reason.Task, 'wish');
        this.w.econ.addN(Res.Honey, ch.reward, Reason.Task, 'wish');
        w.msg('milestone', `蜂后的心愿达成了！获得 2 蜂王浆和 ${ch.reward} 蜂蜜`);
        w.emit('task', 0, 0, '心愿达成', 'any');
        delete s.challenge;
      } else if (t >= ch.until) {
        w.msg('info', `蜂后的心愿没赶上（${done}/${ch.target}），下次再试试`);
        delete s.challenge;
      }
    }
    if (w.offline || !w.s.meta.tutorialDone || !s.formal || this.busy()) return;
    const key = `${s.cycleIndex}:${s.season}`;
    if (s.lastEventKey === key) return;
    const def = EVENTS.filter((d: EventDef) => d.seasons.indexOf(s.season) >= 0);
    if (def.length === 0) return;
    // 季节开始 15 秒后出现，给换季提示留出位置
    if (t - s.startedAt < 15 || s.endsAt - t < 45) return;
    s.lastEventKey = key;
    const last = s.event?.id ?? '';
    const pool = def.filter((d: EventDef) => d.id !== last && this.eligible(d.id));
    if (pool.length === 0) return;
    const pick = pool[hashText(`${w.s.meta.playerId}:${run.regionIndex}:${key}`) % pool.length];
    s.event = { id: pick.id, key, until: Math.min(s.endsAt - 5, t + 150), resolved: false };
  }

  private pay(p: PendingPayout): void {
    if (p.amount > 0) {
      if (p.res === Res.Honey) this.w.econ.addN(Res.Honey, p.amount, Reason.Task, p.kind);
      else this.w.econ.add(p.res, BigNum.of(p.amount), Reason.Task, p.kind);
    }
    if (p.kind === 'cub') {
      const th = this.w.s.run.threats;
      th.nextBearAt = Math.max(th.nextBearAt, this.w.s.run.time) + 1800;
    }
    this.w.msg(p.kind === 'cub' || p.amount >= 1 ? 'milestone' : 'info', p.text);
  }

  private effect(id: string, label: string, stat: string, mul: number, sec: number): void {
    const s = this.w.s.run.season;
    if (!Array.isArray(s.effects)) s.effects = [];
    s.effects.push({ id, label, stat, mul, until: this.w.s.run.time + sec });
    this.w.attrs.recompute();
  }

  private later(kind: string, sec: number, res: string, amount: number, text: string): void {
    const s = this.w.s.run.season;
    if (!Array.isArray(s.payouts)) s.payouts = [];
    s.payouts.push({ kind, at: this.w.s.run.time + sec, res, amount: Math.round(amount), text });
  }

  /** 当前进行中的限时效果（界面展示） */
  effects(): TimedEffect[] {
    const s = this.w.s.run.season;
    const t = this.w.s.run.time;
    return Array.isArray(s.effects) ? s.effects.filter((fx: TimedEffect) => fx.until > t) : [];
  }

  view(): EventView | null {
    const ev = this.active();
    if (ev === null) return null;
    const def = EVENTS.find((d: EventDef) => d.id === ev.id);
    if (def === undefined) return null;
    const v = new EventView();
    v.id = def.id;
    v.title = def.title;
    v.icon = def.icon;
    v.remaining = Math.max(0, ev.until - this.w.s.run.time);
    const h = this.hps();
    const cycle = this.w.s.run.season.cycleIndex;
    switch (def.id) {
      case 'stray': {
        const k = this.strayCount();
        const cost = Math.round(Math.max(30, h * 25));
        v.text = `一小群迷路的蜜蜂停在巢门口，想加入你的蜂巢。收留它们会多 ${k} 只成年蜂，但要先喂饱它们。`;
        v.options = [new EventOption('accept', `收留 ${k} 只`, `花 ${cost} 蜂蜜喂饱它们`),
          new EventOption('decline', '婉拒', '什么都不会变'),
          new EventOption('adaccept', `收留 ${k} 只，邻巢送口粮`, '不花蜂蜜', true)];
        break;
      }
      case 'farbloom': {
        const gain = Math.round(Math.max(150, h * 150));
        v.text = '侦察蜂报告：远处有一大片花海正在盛开！派一半采集蜂过去要飞一分钟，路上可能会遇到胡蜂。';
        v.options = [new EventOption('send', '派一半采集蜂去', `1 分钟后带回约 ${gain} 蜂蜜，期间采集减半；四成概率遇到胡蜂只带回一半`),
          new EventOption('stay', '留在近处', '稳稳当当'),
          new EventOption('adsend', '请侦察蜂引路', `必定满载约 ${Math.round(gain * 1.5)} 蜂蜜，不遇胡蜂、不影响采集`, true)];
        break;
      }
      case 'storm':
        v.text = '乌云压过来了，一场暴雨可能就要落下。下大雨时采集蜂飞不出去。';
        v.options = [new EventOption('seal', '提前封巢避雨', '采集飞行变慢 1 分钟，但不怕暴雨'),
          new EventOption('gamble', '照常采蜜，赌它不下', '一半可能暴雨：2 分半采集大减；一半可能雨过天晴，花更好采'),
          new EventOption('adseal', '请邻巢帮忙加固', '完全不受影响', true)];
        break;
      case 'trader': {
        const honey = Math.round(Math.max(100, h * 40));
        const wax = Math.max(10, Math.round(honey * 0.15));
        const waxCost = 60 + 20 * cycle;
        v.text = '一位养蜂人路过，想跟你做点交换。';
        v.options = [new EventOption('wax', `用 ${honey} 蜂蜜换 ${wax} 蜂蜡`, '扩建和高级巢房要用蜂蜡'),
          new EventOption('jelly', `用 ${waxCost} 蜂蜡换 2 蜂王浆`, '蜂王浆用来研究和培养明星蜂'),
          new EventOption('no', '不换', '下次再说'),
          new EventOption('adgift', `养蜂人白送 ${wax} 蜂蜡`, '看完广告直接拿', true)];
        break;
      }
      case 'pollen':
        v.text = '今年花粉格外多，蜂群干劲十足！选一个方向全力以赴 3 分钟。';
        v.options = [new EventOption('forage', '全力采蜜', '采集速度 +40%、飞行速度 +20%'),
          new EventOption('breed', '全力繁育', '产卵和孵化速度 +60%'),
          new EventOption('adboth', '两个都要', '采蜜和繁育一起加速', true)];
        break;
      case 'cub': {
        const cost = Math.round(Math.max(40, h * 30));
        v.text = '一只小熊崽闻着蜜香迷了路，眼巴巴地看着蜂巢。';
        v.options = [new EventOption('feed', `喂它 ${cost} 蜂蜜`, '熊妈妈会记得你的好意'),
          new EventOption('shoo', '轻轻赶走它', '什么都不会发生'),
          new EventOption('adfeed', '喂它（邻巢出蜂蜜）', '不花自己的蜂蜜', true)];
        break;
      }
      case 'wish':
        v.text = `蜂后想尝尝刚采的鲜花蜜：90 秒内亲手采蜜 30 次，她会奖励你 2 蜂王浆和约 ${Math.round(Math.max(60, h * 30))} 蜂蜜。`;
        v.options = [new EventOption('accept', '接受挑战', '开始计时 90 秒'), new EventOption('later', '下次吧', '')];
        break;
      case 'cold': {
        const cost = this.coldCost();
        v.text = '一股寒潮压了过来，巢里越来越冷。蜜蜂们可以抱成一团取暖，但要多吃一点蜂蜜热身。';
        v.options = [new EventOption('huddle', `抱团取暖（${cost} 蜂蜜）`, '本季剩下的时间越冬消耗 -20%'),
          new EventOption('endure', '硬扛过去', '不花蜂蜜，但接下来 2 分钟越冬消耗 +50%'),
          new EventOption('adwarm', '邻巢送来暖巢草', '不花蜂蜜，本季越冬消耗 -20%', true)];
        break;
      }
      case 'sunny':
        v.text = '难得的冬日暖阳！花田里冒出了几朵冬花，巢里也暖和了起来。';
        v.options = [new EventOption('forage', '趁暖出去采蜜', '1 分钟内采集速度 ×3'),
          new EventOption('rest', '让蜂群晒太阳休养', '受伤的蜜蜂全部痊愈'),
          new EventOption('adboth', '两个都要', '出去采蜜，受伤的也全部痊愈', true)];
        break;
      case 'dance':
        v.text = '侦察蜂们要开一场摇摆舞大会！';
        v.options = [new EventOption('reveal', '请它们公布一片新花田', '马上多一片可以采的花田'),
          new EventOption('range', '让它们练习远航', '本季侦察范围 +30%'),
          new EventOption('adboth', '两个都要', '公布花田，并且本季侦察范围 +30%', true)];
        break;
      default:
        return null;
    }
    return v;
  }

  /** 玩家做出选择；viaAd 表示已经看完广告（广告选项只能这样选） */
  choose(option: string, viaAd: boolean = false): CmdResult {
    const ev = this.active();
    const v = this.view();
    if (ev === null || v === null) return CmdResult.fail('EVENT_NONE', '这个事件已经过去了');
    const opt = v.options.find((o: EventOption) => o.id === option);
    if (opt === undefined) return CmdResult.fail('EVENT_OPTION', '无效的选择');
    if (opt.ad && !viaAd) return CmdResult.fail('EVENT_AD', '这个选项需要看广告');
    const w = this.w;
    const h = this.hps();
    const cycle = w.s.run.season.cycleIndex;
    let msg = '';
    switch (`${ev.id}:${option}`) {
      case 'stray:accept':
      case 'stray:adaccept': {
        const cost = Math.round(Math.max(30, h * 25));
        if (option === 'accept' && !w.econ.spend([new CostAmount(Res.Honey, BigNum.of(cost))], Reason.Hatch, 'stray')) {
          return CmdResult.fail('ECON_SHORT', `需要 ${cost} 蜂蜜`);
        }
        const k = this.strayCount();
        const roles = ALL_ROLES.filter((r: string) => w.count(w.roleDef(r).building) > 0);
        const weights: Record<string, number> = { forager: 5, house: 3, scout: 1, guard: 1 };
        const total = roles.reduce((n: number, r: string) => n + (weights[r] ?? 1), 0);
        let left = k;
        roles.forEach((r: string, i: number) => {
          const n = i === roles.length - 1 ? left : Math.min(left, Math.round(k * (weights[r] ?? 1) / Math.max(1, total)));
          w.s.run.colony.roles[r] = w.role(r) + n;
          left -= n;
        });
        msg = `${k} 只流浪蜜蜂加入了蜂群，去「蜂群名册」看看它们的名字吧`;
        break;
      }
      case 'farbloom:send': {
        const wasp = (hashText(`${ev.key}:fb`) % 10) < 4;
        const gain = Math.max(150, h * 150) * (wasp ? 0.5 : 1 + (hashText(`${ev.key}:g`) % 40) / 100);
        this.effect('farbloom', '采集蜂外出', 'forager.carry', 0.5, 60);
        this.later('farbloom', 60, Res.Honey, gain, wasp ? `采集蜂回来了，路上遇到胡蜂，只带回 ${Math.round(gain)} 蜂蜜` : `采集蜂从花海满载而归：+${Math.round(gain)} 蜂蜜`);
        msg = '一半采集蜂出发去远处花海了，1 分钟后回来';
        break;
      }
      case 'farbloom:adsend':
        this.later('farbloom', 60, Res.Honey, Math.max(150, h * 150) * 1.5, `侦察蜂引路，采集蜂满载而归：+${Math.round(Math.max(150, h * 150) * 1.5)} 蜂蜜`);
        msg = '侦察蜂带路出发了，1 分钟后满载回来';
        break;
      case 'storm:seal':
        this.effect('storm', '封巢避雨', 'forager.speed', 0.6, 60);
        msg = '封好巢门了，暴雨过后就恢复';
        break;
      case 'storm:gamble': {
        const rain = (hashText(`${ev.key}:rain`) % 2) === 0;
        if (rain) {
          this.effect('storm', '暴雨', 'forager.speed', 0.3, 150);
          msg = '哗啦啦——暴雨来了！采集蜂躲在巢里，2 分半后雨停';
        } else {
          const bonus = Math.round(Math.max(40, h * 20));
          w.econ.addN(Res.Honey, bonus, Reason.Task, 'storm');
          msg = `乌云散了，雨过天晴，花开得更好：+${bonus} 蜂蜜`;
        }
        break;
      }
      case 'storm:adseal':
        msg = '邻巢帮忙加固了蜂巢，暴雨一点影响都没有';
        break;
      case 'trader:wax': {
        const honey = Math.round(Math.max(100, h * 40));
        const wax = Math.max(10, Math.round(honey * 0.15));
        if (!w.econ.spend([new CostAmount(Res.Honey, BigNum.of(honey))], Reason.Task, 'trader')) {
          return CmdResult.fail('ECON_SHORT', `需要 ${honey} 蜂蜜`);
        }
        w.econ.add(Res.Wax, BigNum.of(wax), Reason.Task, 'trader');
        msg = `换到了 ${wax} 蜂蜡`;
        break;
      }
      case 'trader:jelly': {
        const waxCost = 60 + 20 * cycle;
        if (!w.econ.spend([new CostAmount(Res.Wax, BigNum.of(waxCost))], Reason.Task, 'trader')) {
          return CmdResult.fail('ECON_SHORT', `需要 ${waxCost} 蜂蜡`);
        }
        w.econ.add(Res.Jelly, BigNum.of(2), Reason.Task, 'trader');
        msg = '换到了 2 蜂王浆';
        break;
      }
      case 'trader:adgift': {
        const wax = Math.max(10, Math.round(Math.max(100, h * 40) * 0.15));
        w.econ.add(Res.Wax, BigNum.of(wax), Reason.Task, 'trader');
        msg = `养蜂人送了 ${wax} 蜂蜡`;
        break;
      }
      case 'pollen:forage':
      case 'pollen:breed':
      case 'pollen:adboth':
        if (option === 'forage' || option === 'adboth') {
          this.effect('pollen', '花粉丰年', 'forager.collect', 1.4, 180);
          this.effect('pollen', '花粉丰年', 'forager.speed', 1.2, 180);
        }
        if (option === 'breed' || option === 'adboth') {
          this.effect('pollen', '花粉丰年', 'queen.layRate', 1.6, 180);
          this.effect('pollen', '花粉丰年', 'nursery.hatchSpeed', 1.6, 180);
        }
        msg = '花粉丰年：接下来 3 分钟全力以赴！';
        break;
      case 'cub:feed':
      case 'cub:adfeed': {
        const cost = Math.round(Math.max(40, h * 30));
        if (option === 'feed' && !w.econ.spend([new CostAmount(Res.Honey, BigNum.of(cost))], Reason.Task, 'cub')) {
          return CmdResult.fail('ECON_SHORT', `需要 ${cost} 蜂蜜`);
        }
        this.later('cub', 90, Res.Jelly, 2, '熊妈妈来接小熊崽，留下 2 蜂王浆当谢礼，这个轮回熊也会晚点来');
        msg = '小熊崽吃得很开心，在巢边打起了瞌睡';
        break;
      }
      case 'cold:huddle':
      case 'cold:adwarm': {
        const cost = this.coldCost();
        if (option === 'huddle' && !w.econ.spend([new CostAmount(Res.Honey, BigNum.of(cost))], Reason.Winter, 'cold')) {
          return CmdResult.fail('ECON_SHORT', `需要 ${cost} 蜂蜜`);
        }
        const sec = Math.max(30, w.s.run.season.endsAt - w.s.run.time);
        this.effect('cold', '抱团取暖', 'storage.winterLoss', 0.8, sec);
        msg = '蜜蜂们抱成一团，巢里暖和多了：本季越冬消耗 -20%';
        break;
      }
      case 'cold:endure':
        this.effect('cold', '寒潮', 'storage.winterLoss', 1.5, 120);
        msg = '寒潮里硬扛着：接下来 2 分钟越冬消耗 +50%';
        break;
      case 'sunny:forage':
      case 'sunny:rest':
      case 'sunny:adboth':
        if (option !== 'rest') this.effect('sunny', '冬日暖阳', 'forager.collect', 3, 60);
        if (option !== 'forage') ALL_ROLES.forEach((r: string) => { w.s.run.colony.injured[r] = 0; });
        msg = option === 'forage' ? '采集蜂趁着暖阳出发了：1 分钟内采集速度 ×3'
          : (option === 'rest' ? '晒过太阳，受伤的蜜蜂全都恢复了' : '采集蜂出去采蜜，受伤的蜜蜂也全都恢复了');
        break;
      case 'wish:accept':
        w.s.run.season.challenge = {
          kind: 'wish', until: w.s.run.time + 90, start: w.s.run.stats.manualCollects, target: 30,
          reward: Math.round(Math.max(60, h * 30))
        };
        msg = '挑战开始：90 秒内亲手采蜜 30 次！';
        break;
      case 'dance:reveal':
      case 'dance:range':
      case 'dance:adboth': {
        if (option !== 'range') {
          const f = this.hiddenField();
          if (f !== null) {
            this.w.onBee('find', hashText(ev.key) % 7, f.fieldId);
            this.reveal(f);
          }
        }
        if (option !== 'reveal') {
          const sec = Math.max(30, w.s.run.season.endsAt - w.s.run.time);
          this.effect('dance', '摇摆舞大会', 'scout.range', 1.3, sec);
        }
        msg = option === 'range' ? '侦察蜂练得飞得更远了' : '侦察蜂公布了一片新花田！';
        break;
      }
      default:
        msg = '好的，这次就算了';
    }
    ev.resolved = true;
    ev.choice = option;
    w.gainXp(6);
    w.attrs.recompute();
    return CmdResult.ok(msg);
  }

  /** 寒潮抱团取暖要多吃的蜂蜜：约 4% 储备，至少 20 */
  private coldCost(): number {
    return Math.round(Math.max(20, this.w.econ.num(Res.Honey) * 0.04));
  }

  /** 季节没选就过去了 */
  dismiss(): void {
    const ev = this.active();
    if (ev !== null) {
      ev.resolved = true;
      ev.choice = 'skip';
    }
  }

  private reveal(f: FlowerField): void {
    // 与侦察蜂跳完摇摆舞相同的公开流程，保证图鉴、提示一致
    this.publish(f.fieldId);
  }
}
