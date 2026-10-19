import { ForageStrategy, Reason, Res, Role } from './Types';
import { FlowerField, ScoutAgent } from './State';
import { CmdResult, ForageAlloc, World } from './World';

export const SCOUT_IDLE = 'idle';
export const SCOUT_FLY = 'fly';
export const SCOUT_SEARCH = 'search';
export const SCOUT_RETURN = 'return';
export const SCOUT_DANCE = 'dance';
export const SCOUT_PATROL = 'patrol';

/** 连击判定窗口（秒） */
const COMBO_WINDOW = 1.5;
/** 蜜流花开放时长（秒） */
const BLOOM_LIFETIME = 20;

/** 侦察蜂可完整模拟的最大逻辑实体数，其余按聚合加速 */
const MAX_SCOUT_AGENTS = 40;

/** 花田、侦察与采集（MAP-001~006，BEE-003/004/007） */
export class MapService {
  private w: World;
  private injureAcc: number = 0;
  private allocTimer: number = 0;

  constructor(w: World) {
    this.w = w;
  }

  maxStock(f: FlowerField): number {
    return this.w.flower(f.flower).maxStock * this.w.attrs.get('scout.stock') * (1 + 0.15 * (f.level - this.w.flower(f.flower).tier));
  }

  /** 侦察信息有效（MAP-003：过期花田不会被自动选为目标） */
  intelValid(f: FlowerField): boolean {
    return f.discovered && (f.home || f.intelExpiresAt > this.w.s.run.time);
  }

  knownFields(): FlowerField[] {
    return this.w.s.run.map.fields.filter((f: FlowerField) => this.intelValid(f));
  }

  /** 手动采集（UI-003） */
  manualCollect(fieldId: string, times: number): CmdResult {
    const f = this.w.field(fieldId);
    if (f === null || !f.discovered) {
      return CmdResult.fail('MAP_UNKNOWN', '还不知道这片花田的位置');
    }
    const fd = this.w.flower(f.flower);
    if (f.stock <= 1e-6) {
      const late = this.pickBloom(f);
      if (late > 0) return CmdResult.ok(`采到蜜流花！直接获得 ${Math.round(late)} 蜂蜜${this.honeyFullNote()}`);
      return CmdResult.fail('MAP_RECOVERING', `花丛正在恢复，约${Math.ceil(this.recoveryRemaining(f))}秒后重新开放`);
    }
    let gain = 0;
    let collected = 0;
    const now = this.w.s.run.time;
    for (let i = 0; i < Math.max(0, Math.floor(times)); i++) {
      const take = Math.min(f.stock, this.w.attrs.get('manual.yield'));
      if (take <= 1e-6) break;
      f.stock = Math.max(0, f.stock - take);
      gain += take * fd.yieldMul * this.w.attrs.get('scout.quality') * Math.max(0.15, this.w.seasonDef().nectarMul);
      collected++;
    }
    this.markDepleted(f);
    // 连击：1.5 秒内连续采集，每 10 次多 10% 花蜜，最多 +50%
    this.w.comboCount = now - this.w.comboAt <= COMBO_WINDOW ? this.w.comboCount + collected : collected;
    this.w.comboAt = now;
    const comboMul = this.comboMultiplier();
    gain *= comboMul;
    const got = this.w.econ.addN(Res.Nectar, gain, Reason.Manual, fieldId);
    this.w.s.run.stats.manualCollects += collected;
    this.w.dailyBump('collect', collected);
    this.w.rates.manualIn += gain;
    if (this.w.s.run.stats.firstNectarAt < 0) {
      this.w.s.run.stats.firstNectarAt = this.w.s.run.time;
    }
    const amount = `+${gain >= 10 ? Math.round(gain) : gain.toFixed(1)}`;
    this.w.emit('collect', f.x, f.y, comboMul > 1 ? `${amount} 连击×${this.w.comboCount}` : amount, 'field');
    const burst = this.pickBloom(f);
    if (burst > 0) {
      return CmdResult.ok(`采到蜜流花！直接获得 ${Math.round(burst)} 蜂蜜${this.honeyFullNote()}`);
    }
    if (got < gain - 0.01) {
      return CmdResult.ok('花蜜仓已满');
    }
    return CmdResult.ok('');
  }

  /** 当前连击加成倍率 */
  comboMultiplier(): number {
    if (this.w.s.run.time - this.w.comboAt > COMBO_WINDOW) return 1;
    return 1 + Math.min(0.5, Math.floor(this.w.comboCount / 10) * 0.1);
  }

  // ---------------- 蜜流花 ----------------
  private honeyFullNote(): string {
    return this.w.econ.fillRatio(Res.Honey) >= 0.999 ? '（蜂蜜仓已满，多出的存入溢出缓冲）' : '';
  }

  /** 当前开放的蜜流花所在花田；没有则返回 null */
  activeBloom(): FlowerField | null {
    const b = this.w.s.run.map.bloom;
    if (b === undefined || b.fieldId.length === 0 || b.until <= this.w.s.run.time) return null;
    return this.w.field(b.fieldId);
  }

  bloomRemaining(): number {
    const b = this.w.s.run.map.bloom;
    return b === undefined || b.fieldId.length === 0 ? 0 : Math.max(0, b.until - this.w.s.run.time);
  }

  /** 蜜流花奖励：约 30 秒的全巢采集量折成蜂蜜，至少 20 */
  bloomReward(): number {
    const nectarRate = this.estimateNectarRate() + this.w.attrs.get('manual.yield') * 2;
    return Math.max(20, Math.round(nectarRate * 0.5 * 30));
  }

  private pickBloom(f: FlowerField): number {
    const b = this.w.s.run.map.bloom;
    if (b === undefined || b.fieldId !== f.fieldId || b.until <= this.w.s.run.time) return 0;
    const reward = this.bloomReward();
    this.w.econ.addN(Res.Honey, reward, Reason.Bloom, `bloom:${f.fieldId}`);
    this.w.dailyBump('bloom', 1);
    b.fieldId = '';
    b.nextAt = this.w.s.run.time + this.bloomInterval(b.count);
    this.w.emit('bloom', f.x, f.y, `蜜流花 +${Math.round(reward)} 蜂蜜`, 'field');
    return reward;
  }

  private bloomInterval(n: number): number {
    // 75~135 秒一次，确定性伪随机（不打乱其他系统的随机序列）
    const h = Math.sin((this.w.s.run.seed % 9973) * 12.9898 + n * 78.233) * 43758.5453;
    return 75 + (h - Math.floor(h)) * 60;
  }

  private bloomTick(): void {
    if (this.w.offline || !this.w.s.meta.tutorialDone) return;
    const m = this.w.s.run.map;
    const t = this.w.s.run.time;
    if (m.bloom === undefined) m.bloom = { fieldId: '', until: 0, nextAt: t + 45, count: 0 };
    const b = m.bloom;
    if (b.fieldId.length > 0) {
      if (t >= b.until) {
        b.fieldId = '';
        b.nextAt = t + this.bloomInterval(b.count);
      }
      return;
    }
    if (t < b.nextAt || this.w.isWinter()) return;
    // 只开在看得见、采得到的花丛上：蜂巢附近或侦察有效、且有花蜜
    const choices = m.fields.filter((f: FlowerField) => f.discovered && f.stock > 1 && (f.home || (this.intelValid(f) && f.dist <= 360)));
    if (choices.length === 0) { b.nextAt = t + 20; return; }
    const pick = choices[(b.count * 7 + Math.floor(t)) % choices.length];
    b.count += 1;
    b.fieldId = pick.fieldId;
    b.until = t + BLOOM_LIFETIME;
    this.w.emit('reveal', pick.x, pick.y, '蜜流花开了', 'field');
  }

  // ---------------- 侦察蜂状态机 ----------------
  private syncScoutAgents(): void {
    const m = this.w.s.run.map;
    const want = Math.min(MAX_SCOUT_AGENTS, this.w.active(Role.Scout));
    while (m.scouts.length < want) {
      const a: ScoutAgent = {
        id: m.nextScoutId, state: SCOUT_IDLE, targetField: '', tx: 0, ty: 0, x: 0, y: 0,
        timer: this.w.rng.range(0, 3), found: false
      };
      m.nextScoutId += 1;
      m.scouts.push(a);
    }
    while (m.scouts.length > want) {
      m.scouts.pop();
    }
  }

  private pickScoutTarget(a: ScoutAgent): FlowerField | null {
    const range = this.w.attrs.get('scout.range');
    const t = this.w.s.run.time;
    const taken: Set<string> = new Set<string>();
    this.w.s.run.map.scouts.forEach((o: ScoutAgent) => {
      if (o.id !== a.id && o.targetField.length > 0) {
        taken.add(o.targetField);
      }
    });
    let best: FlowerField | null = null;
    let bestScore = -1e9;
    this.w.s.run.map.fields.forEach((f: FlowerField) => {
      if (f.home || f.dist > range || taken.has(f.fieldId)) {
        return;
      }
      const stale = !f.discovered || f.intelExpiresAt - t < 40;
      if (!stale) {
        return;
      }
      // 优先未知、近处；已知但将过期的也会被重新侦察
      const score = (f.discovered ? 0 : 400) - f.dist + this.w.rng.range(0, 120);
      if (score > bestScore) {
        bestScore = score;
        best = f;
      }
    });
    return best;
  }

  private scoutsTick(dt: number): void {
    this.syncScoutAgents();
    const scouts = this.w.s.run.map.scouts;
    if (scouts.length === 0) {
      return;
    }
    const winterHold = this.w.isWinter() && !this.w.hasFlag('winterScout');
    const speed = this.w.attrs.get('scout.speed');
    const extra = Math.max(1, this.w.active(Role.Scout) / Math.max(1, scouts.length));
    const step = dt * extra;
    scouts.forEach((a: ScoutAgent) => {
      this.agentTick(a, step, speed, winterHold);
    });
  }

  private agentTick(a: ScoutAgent, dt: number, speed: number, winterHold: boolean): void {
    a.timer -= dt;
    if (a.state === SCOUT_IDLE) {
      if (a.timer > 0) {
        return;
      }
      if (winterHold) {
        a.timer = 5;
        return;
      }
      const f = this.pickScoutTarget(a);
      if (f === null) {
        // 无可侦察目标：近巢巡航，保持低频检查
        a.state = SCOUT_PATROL;
        const ang = this.w.rng.range(0, Math.PI * 2);
        a.tx = Math.cos(ang) * 70;
        a.ty = Math.sin(ang) * 70;
        a.timer = 8;
        a.targetField = '';
        return;
      }
      a.state = SCOUT_FLY;
      this.w.onBee('flight', this.w.s.run.map.scouts.indexOf(a), f.fieldId);
      a.targetField = f.fieldId;
      a.tx = f.x;
      a.ty = f.y;
      a.found = false;
      return;
    }
    if (a.state === SCOUT_PATROL) {
      this.moveToward(a, speed * 0.4, dt);
      if (a.timer <= 0) {
        a.state = SCOUT_RETURN;
        a.tx = 0;
        a.ty = 0;
      }
      return;
    }
    if (a.state === SCOUT_FLY) {
      const f = this.w.field(a.targetField);
      if (f === null) {
        this.resetAgent(a);
        return;
      }
      if (this.moveToward(a, speed, dt)) {
        a.state = SCOUT_SEARCH;
        a.timer = 6 / this.w.attrs.get('scout.discovery');
      }
      return;
    }
    if (a.state === SCOUT_SEARCH) {
      if (a.timer > 0) {
        return;
      }
      const f = this.w.field(a.targetField);
      if (f === null) {
        this.resetAgent(a);
        return;
      }
      a.found = !f.hidden || this.w.rng.chance(this.w.attrs.get('scout.rare'));
      a.state = SCOUT_RETURN;
      a.tx = 0;
      a.ty = 0;
      return;
    }
    if (a.state === SCOUT_RETURN) {
      if (this.moveToward(a, speed, dt)) {
        if (a.found && a.targetField.length > 0) {
          a.state = SCOUT_DANCE;
          a.timer = 3.2;
          this.w.emit('dance', 0, 0, '摇摆舞', 'hive');
        } else {
          if (a.targetField.length > 0) {
            this.w.econ.addN(Res.Nectar, this.w.cfg.economy.scoutSample * 0.5, Reason.ScoutSample, 'scout');
          }
          this.resetAgent(a);
        }
      }
      return;
    }
    if (a.state === SCOUT_DANCE) {
      if (a.timer > 0) {
        return;
      }
      // MAP-004：动画结束与业务生效时点一致
      const target = this.w.field(a.targetField);
      const fresh = target !== null && !target.discovered;
      this.publishDiscovery(a.targetField);
      if (fresh) {
        this.w.onBee('find', this.w.s.run.map.scouts.indexOf(a), a.targetField);
        this.w.gainXp(4);
      }
      if (this.w.hasFlag('doubleDance')) {
        const second = this.pickScoutTarget(a);
        if (second !== null && second.discovered && !second.hidden) {
          this.publishDiscovery(second.fieldId);
        }
      }
      this.w.econ.addN(Res.Nectar, this.w.cfg.economy.scoutSample, Reason.ScoutSample, 'scout');
      this.resetAgent(a);
    }
  }

  private resetAgent(a: ScoutAgent): void {
    a.state = SCOUT_IDLE;
    a.targetField = '';
    a.timer = this.w.rng.range(0.5, 2);
    a.found = false;
  }

  private moveToward(a: ScoutAgent, speed: number, dt: number): boolean {
    const dx = a.tx - a.x;
    const dy = a.ty - a.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const stepLen = speed * dt;
    if (d <= stepLen || d < 0.5) {
      a.x = a.tx;
      a.y = a.ty;
      return true;
    }
    a.x += dx / d * stepLen;
    a.y += dy / d * stepLen;
    return false;
  }

  /** 摇摆舞公开花田位置、花期、收益和危险（BEE-003） */
  publishDiscovery(fieldId: string): void {
    const f = this.w.field(fieldId);
    if (f === null || (!f.home && f.dist > this.w.attrs.get('scout.range'))) {
      return;
    }
    const t = this.w.s.run.time;
    const first = !f.discovered;
    f.discovered = true;
    f.intelExpiresAt = t + this.w.attrs.get('scout.intel');
    f.danceBonusUntil = t + this.w.attrs.get('scout.intel');
    const fd = this.w.flower(f.flower);
    const meta = this.w.s.meta;
    if (meta.codexFlowers.indexOf(f.flower) < 0) {
      meta.codexFlowers.push(f.flower);
      this.w.msg('codex', `花种图鉴新增：${fd.name}`);
    }
    if (first) {
      if (fd.rare) {
        this.w.s.run.stats.rareFound += 1;
        this.w.msg('rare', `侦察蜂发现了稀有花田：${fd.name}！`);
      } else {
        this.w.msg('dance', `摇摆舞：发现${fd.name}（距离 ${Math.round(f.dist)}，危险 ${Math.round(f.danger * 100)}%）`);
      }
    }
    if (this.w.s.run.stats.firstDanceAt < 0) {
      this.w.s.run.stats.firstDanceAt = t;
    }
    this.w.emit('reveal', f.x, f.y, fd.name, 'field');
  }

  /** 季节变化使侦察信息加速失效（MAP-003） */
  onSeasonChange(): void {
    const t = this.w.s.run.time;
    this.w.s.run.map.fields.forEach((f: FlowerField) => {
      if (!f.home && f.discovered) {
        f.intelExpiresAt = Math.min(f.intelExpiresAt, t + 60);
      }
    });
  }

  // ---------------- 采集（聚合） ----------------
  tripTime(f: FlowerField): number {
    const speed = this.w.attrs.get('forager.speed') * this.w.attrs.get('forager.route');
    const dance = f.danceBonusUntil > this.w.s.run.time ? 1.15 : 1;
    const eff = this.w.fieldEff[f.fieldId] === undefined ? 1 : this.w.fieldEff[f.fieldId];
    const fly = 2 * f.dist / (speed * dance * Math.max(0.2, eff));
    return fly + 5 / this.w.attrs.get('forager.collect');
  }

  private fieldWeight(f: FlowerField, strategy: string): number {
    const fd = this.w.flower(f.flower);
    const perTrip = fd.yieldMul / this.tripTime(f);
    const avoid = this.w.attrs.get('forager.avoid');
    const danger = f.danger * (1 - avoid);
    if (strategy === ForageStrategy.Safe) {
      return perTrip * Math.pow(Math.max(0.01, 1 - danger), 4);
    }
    if (strategy === ForageStrategy.Rich) {
      return Math.pow(perTrip, 1.6) * 10;
    }
    return perTrip * Math.max(0.05, 1 - danger);
  }

  pollinatorTotal(): number {
    let n = 0;
    const p = this.w.s.run.colony.pollinators;
    Object.keys(p).forEach((k: string) => {
      n += p[k];
    });
    return n;
  }

  /** 分配采集蜂：按收益/距离/危险/策略加权，并按花田可持续产量封顶，避免全部拥堵同一点（MAP-006） */
  private allocate(): void {
    const carry = this.w.attrs.get('forager.carry');
    const avail = Math.max(0, this.w.active(Role.Forager) - this.pollinatorTotal());
    const fields = this.knownFields().filter((f: FlowerField) => (f.stock > 1 || this.regen(f) > 0.05) && this.recoveryRemaining(f) <= 0);
    const strategy = this.w.s.run.colony.forageStrategy;
    const out: ForageAlloc[] = [];
    const caps: number[] = [];
    const weights: number[] = [];
    fields.forEach((f: FlowerField) => {
      const trip = this.tripTime(f);
      const perBee = carry / trip;
      const sustain = (this.regen(f) * 1.1 + f.stock / 90) / Math.max(1e-6, perBee);
      caps.push(Math.max(f.stock > carry ? 1 : 0, sustain));
      weights.push(this.fieldWeight(f, strategy));
      out.push(new ForageAlloc(f.fieldId, 0, trip, 0));
    });
    let remaining = avail;
    for (let pass = 0; pass < 4 && remaining > 0.01; pass++) {
      let wsum = 0;
      for (let i = 0; i < out.length; i++) {
        if (out[i].bees < caps[i] - 1e-6) {
          wsum += weights[i];
        }
      }
      if (wsum <= 0) {
        break;
      }
      let used = 0;
      for (let i = 0; i < out.length; i++) {
        if (out[i].bees >= caps[i] - 1e-6) {
          continue;
        }
        const share = remaining * weights[i] / wsum;
        const add = Math.min(share, caps[i] - out[i].bees);
        out[i].bees += add;
        used += add;
      }
      remaining -= used;
    }
    this.w.alloc = out.filter((a: ForageAlloc) => a.bees > 0.001);
    this.w.forageIdle = Math.max(0, remaining);
  }

  recoveryRemaining(f: FlowerField): number {
    if (f.depletedAt === undefined || f.stock > 1e-6) return 0;
    const wait = this.w.cfg.economy.flowerRecoverSec ?? 3;
    return Math.max(0, f.depletedAt + wait / this.w.attrs.get('scout.regrowth') - this.w.s.run.time);
  }

  private markDepleted(f: FlowerField): void {
    if (f.stock <= 1e-6) {
      f.stock = 0;
      f.depletedAt = this.w.s.run.time;
    }
  }

  regen(f: FlowerField): number {
    const fd = this.w.flower(f.flower);
    const region = this.w.region();
    const season = this.w.seasonDef().nectarMul;
    const poll = this.w.s.run.colony.pollinators[f.fieldId];
    const pollBonus = 1 + Math.min(0.8, 0.08 * (poll === undefined ? 0 : poll));
    return fd.regen * this.w.attrs.get('scout.regrowth') * region.regenMul * season * pollBonus * (1 + 0.15 * (f.level - fd.tier));
  }

  private foragingTick(dt: number): void {
    this.allocTimer -= dt;
    if (this.allocTimer <= 0 || dt >= 1) {
      this.allocate();
      this.allocTimer = 1;
    }
    const carry = this.w.attrs.get('forager.carry');
    const region = this.w.region();
    const season = this.w.seasonDef().nectarMul;
    const avoid = this.w.attrs.get('forager.avoid');
    let totalNectar = 0;
    let jelly = 0;
    let injuries = 0;
    this.w.alloc.forEach((a: ForageAlloc) => {
      const f = this.w.field(a.fieldId);
      if (f === null || !this.intelValid(f)) {
        a.rate = 0;
        return;
      }
      const fd = this.w.flower(f.flower);
      const want = a.bees * carry / a.tripTime * dt;
      const take = Math.min(want, f.stock);
      f.stock -= take;
      if (take > 0) this.markDepleted(f);
      const nectar = take * fd.yieldMul * this.w.attrs.get('scout.quality') * Math.max(0.05, season) * region.nectarMul;
      totalNectar += nectar;
      a.rate = dt > 0 ? nectar / dt : 0;
      jelly += take / carry * fd.jellyPerTrip;
      injuries += a.bees / a.tripTime * dt * f.danger * 0.012 * (1 - avoid);
    });
    if (totalNectar > 0) {
      this.w.econ.addN(Res.Nectar, totalNectar, Reason.Forage, 'forage');
      this.w.s.run.stats.deliveredNectar += totalNectar;
      this.w.rates.nectarIn += totalNectar;
    }
    if (jelly > 0 && this.w.unlocked('t_build_storage')) {
      this.w.econ.addN(Res.Jelly, jelly, Reason.Forage, 'rare');
      this.w.rates.jellyIn += jelly;
    }
    if (!this.w.offline) {
      this.injureAcc += injuries;
      if (this.injureAcc >= 1) {
        const n = Math.floor(this.injureAcc);
        this.injureAcc -= n;
        this.w.s.run.colony.injured[Role.Forager] = Math.min(
          Math.floor(this.w.role(Role.Forager) * this.w.cfg.economy.injuryCapRatio),
          this.w.injured(Role.Forager) + n);
      }
    }
  }

  private regenTick(dt: number): void {
    this.w.s.run.map.fields.forEach((f: FlowerField) => {
      const max = this.maxStock(f);
      f.stock = Math.min(f.stock, max);
      if (f.stock <= 1e-6 && f.depletedAt !== undefined) {
        if (this.recoveryRemaining(f) <= 0) f.stock = max;
        return;
      }
      if (f.stock < max) {
        f.stock = Math.min(max, f.stock + this.regen(f) * dt);
      }
    });
  }

  // ---------------- 授粉特化（BEE-007，MAP-005） ----------------
  setPollinators(fieldId: string, n: number): CmdResult {
    const f = this.w.field(fieldId);
    if (f === null || !f.discovered) {
      return CmdResult.fail('MAP_UNKNOWN', '花田未知');
    }
    if (!this.w.unlocked('t_build_storage')) {
      return CmdResult.fail('MAP_LOCKED', '建成储蜜格后开放授粉特化');
    }
    const p = this.w.s.run.colony.pollinators;
    const cur = p[fieldId] === undefined ? 0 : p[fieldId];
    const others = this.pollinatorTotal() - cur;
    const maxForField = Math.max(0, Math.floor(this.w.active(Role.Forager) * 0.5) - others);
    const v = Math.max(0, Math.min(Math.floor(n), maxForField, 30));
    p[fieldId] = v;
    return CmdResult.ok(v > 0 ? `${v} 只采集蜂驻守授粉` : '已撤回授粉蜂');
  }

  growthNeeded(f: FlowerField): number {
    return 1 + 0.6 * f.level;
  }

  private pollinationTick(dt: number): void {
    const p = this.w.s.run.colony.pollinators;
    const rate = 0.0012 * this.w.attrs.get('pollinate.rate') * (this.w.isWinter() ? 0.1 : 1);
    const maxP = Math.floor(this.w.active(Role.Forager) * 0.5);
    let total = 0;
    Object.keys(p).forEach((id: string) => {
      const f = this.w.field(id);
      if (f === null || !f.discovered) {
        p[id] = 0;
        return;
      }
      if (total + p[id] > maxP) {
        p[id] = Math.max(0, maxP - total);
      }
      total += p[id];
      if (p[id] <= 0) {
        return;
      }
      f.growth += p[id] * rate * dt;
      const fd = this.w.flower(f.flower);
      if (f.growth >= this.growthNeeded(f)) {
        f.growth = 0;
        if (fd.next.length > 0) {
          f.flower = fd.next;
          f.level = Math.max(f.level + 1, this.w.flower(fd.next).tier);
          f.stock = Math.min(this.maxStock(f), f.stock + 50);
          const nd = this.w.flower(f.flower);
          this.w.msg('pollinate', `授粉成功：花田成长为${nd.name}`);
          if (this.w.s.meta.codexFlowers.indexOf(f.flower) < 0) {
            this.w.s.meta.codexFlowers.push(f.flower);
          }
          // 高等级花田吸引更强敌害
          f.danger = Math.min(0.9, f.danger + 0.05);
        } else {
          f.level += 1;
          this.w.msg('pollinate', `授粉成功：${fd.name}等级提升到 ${f.level}`);
        }
        this.w.s.run.stats.pollinations += 1;
        this.w.gainXp(8);
        this.w.emit('bloom', f.x, f.y, '花田成长', 'field');
      }
    });
  }

  tick(dt: number): void {
    if (this.w.offline) {
      // 离线：不逐只模拟侦察蜂。有侦察蜂时已知花田信息维持（保留最低安全产出）
      if (this.w.active(Role.Scout) > 0) {
        const t = this.w.s.run.time;
        this.w.s.run.map.fields.forEach((f: FlowerField) => {
          if (f.discovered && !f.home && f.dist <= this.w.attrs.get('scout.range')) {
            f.intelExpiresAt = Math.max(f.intelExpiresAt, t + 30);
          }
        });
      }
    } else {
      this.scoutsTick(dt);
    }
    this.foragingTick(dt);
    this.regenTick(dt);
    this.pollinationTick(dt);
    this.bloomTick();
  }

  /** 预估采集产能（升级预览用，不修改状态） */
  estimateNectarRate(): number {
    const carry = this.w.attrs.get('forager.carry');
    const region = this.w.region();
    const season = Math.max(0.05, this.w.seasonDef().nectarMul);
    const avail = Math.max(0, this.w.active(Role.Forager) - this.pollinatorTotal());
    let total = 0;
    let used = 0;
    const fields = this.knownFields().slice().sort((a: FlowerField, b: FlowerField) =>
      this.fieldWeight(b, ForageStrategy.Balanced) - this.fieldWeight(a, ForageStrategy.Balanced));
    fields.forEach((f: FlowerField) => {
      if (used >= avail) {
        return;
      }
      const trip = this.tripTime(f);
      const perBee = carry / trip;
      const cap = (this.regen(f) * 1.1 + f.stock / 90) / Math.max(1e-6, perBee);
      const n = Math.min(cap, avail - used);
      used += n;
      total += n * perBee * this.w.flower(f.flower).yieldMul * this.w.attrs.get('scout.quality') * season * region.nectarMul;
    });
    return total;
  }
}
