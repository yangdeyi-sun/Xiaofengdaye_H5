import { GameEngine } from '../domain/GameEngine';
import { FlowerField, HexCell, LarvaBatch, ScoutAgent, ThreatEvent } from '../domain/State';
import { ForageAlloc, FxEvent } from '../domain/World';
import { Bld, Res, ResearchDef, Role, SeasonId, SkinDef, ThreatType } from '../domain/Types';
import { Rng } from '../common/Rng';
import {
  drawBear, drawBee, drawBuildingIcon, drawFlower, drawMoth, drawSkep, drawSpike, drawWasp, drawWeb, font, hexPath,
  roundRect
} from './Art';
import { buildingAtlas, buildingSkinFrame, DrawOpts, regionTheme, seasonOverlay, Sprites } from './Sprites';

/** 渲染层只读取领域快照，绝不修改真实状态（需求书9.2 Renderer 禁止事项） */

export class Camera {
  x: number = 0;
  y: number = -40;
  zoom: number = 1;
}

class VisualBee {
  fieldId: string = '';
  phase: number = 0;
  wob: number = 0;
  x: number = 0;
  y: number = 0;
  angle: number = 0;
  flip: boolean = false;
  anim: number = 0;
  carrying: boolean = false;
  /** 对应名册里哪只采集蜂（-1 表示名册里没有） */
  beeId: number = -1;
}

/** 巢内画面上画出的蜜蜂位置（屏幕坐标），用于点击命中 */
class HiveSpot {
  x: number = 0;
  y: number = 0;
  id: number = -1;
}

class FloatText {
  x: number = 0;
  y: number = 0;
  text: string = '';
  life: number = 0;
  view: string = '';
  color: string = '#FFFFFF';
  big: boolean = false;
  /** 反馈图标：cost(花蜜滴)/gain(蜂蜜罐)/level(升级箭头)/rare(蜂王浆晶)/insufficient(不足)；空为纯文字 */
  chip: string = '';
}

class Particle {
  x: number = 0;
  y: number = 0;
  vx: number = 0;
  vy: number = 0;
  life: number = 0;
  maxLife: number = 1;
  color: string = '#FFD54A';
  size: number = 2;
  view: string = '';
}

/** 一次性图集动作（特效、建造序列、敌害退场等） */
class OneShot {
  atlas: string = '';
  anim: string = '';
  t: number = 0;
  dur: number = 0.6;
  x: number = 0;
  y: number = 0;
  size: number = 40;
  /** field：世界坐标；hivecell：六边形坐标 (q,r)；screen：屏幕比例坐标 (0~1) */
  view: string = '';
}

class Decor {
  x: number = 0;
  y: number = 0;
  s: number = 1;
  kind: number = 0;
  prop: string = '';
  flip: boolean = false;
}

class Dancer {
  t: number = 0;
}

class ThreatMark {
  type: string = '';
  x: number = 0;
  y: number = 0;
  view: string = 'field';
  seen: number = 0;
}

const MAX_VISUAL_FORAGERS = 140;
const MAX_PARTICLES = 220;
const MAX_ONESHOTS = 24;
const SQRT3 = Math.sqrt(3);
/** 六边形图集：内容框宽 = √3·R（尖顶六边形） */
const HEX_W = SQRT3;

const PROPS: Record<string, string[]> = {
  'meadow': ['grass_0', 'stone_1', 'branch_2', 'mushroom_3', 'stump_6', 'leaf_12', 'fern_16', 'grass_17', 'stone_18',
    'mushroom_20', 'stump_23'],
  'alpine': ['snowrock_8', 'stone_1', 'grass_0', 'fern_16', 'snowrock_25', 'stone_18', 'leaf_12', 'grass_17'],
  'wetland': ['puddle_4', 'reeds_7', 'lily_14', 'grass_0', 'puddle_21', 'reeds_24', 'fern_16', 'grass_17'],
  'dryland': ['cactus_9', 'sandstone_13', 'branch_2', 'grass_17', 'cactus_26', 'stone_1', 'branch_19'],
  'rooftop': ['pot_5', 'pipe_10', 'rail_11', 'crate_15', 'pot_22', 'pipe_27', 'leaf_12', 'grass_0']
};

export class SceneRenderer {
  eng: GameEngine;
  cam: Camera = new Camera();
  time: number = 0;
  selectedCell: string = '';
  selectedField: string = '';
  particlesOn: boolean = true;
  reduceMotion: boolean = false;
  /** 提示焦点：field / hiveIcon / fieldId:<id> / hive / queen / expand / cell:<id> / bld:<type> */
  focus: string = '';
  /** 放置模式：正在放置的巢房类型 */
  placing: string = '';
  /** 渲染层产生的动作音效（GameSession 每帧取走并播放） */
  cues: string[] = [];
  private bees: VisualBee[] = [];
  private texts: FloatText[] = [];
  private particles: Particle[] = [];
  private pool: Particle[] = [];
  private shots: OneShot[] = [];
  private decor: Decor[] = [];
  private decorRegion: string = '';
  private dancers: Dancer[] = [];
  private rng: Rng = new Rng(99);
  private lastFieldW: number = 360;
  private lastFieldH: number = 640;
  private hexSize: number = 30;
  private hexCx: number = 0;
  private hexCy: number = 0;
  private hiveZoom: number = 1;
  private hivePanX: number = 0;
  private hivePanY: number = 0;
  private fieldShownAt: number = -10;
  private hiveShownAt: number = -10;
  private cueAt: Map<string, number> = new Map<string, number>();
  private marks: Map<string, ThreatMark> = new Map<string, ThreatMark>();
  private lastEggAt: number = -10;
  private lastCheerAt: number = -10;
  private lastResearchAt: number = -10;
  /** 双击缩放的平滑过渡目标；zoom<=0 表示没有进行中的过渡 */
  private camTarget: Camera = new Camera();
  /** 巢内视图顶部被界面占用的高度（像素） */
  hudTop: number = 0;
  private camAnim: number = 0;
  /** 正在跟随的蜜蜂（名册编号，-1 表示没有） */
  follow: number = -1;
  /** 跟随的蜜蜂连续多久没出现在画面上（离开采集路线等） */
  followMissing: number = 0;
  private trail: number[] = [];
  private trailAt: number = 0;
  private hiveSpots: HiveSpot[] = [];
  /** 巢内视图高亮的蜜蜂 */
  highlight: number = -1;

  constructor(eng: GameEngine) {
    this.eng = eng;
  }

  /** 第 i 只画出来的某工种蜜蜂对应的名册编号（名册按工种缓存，不会每帧遍历整本名册） */
  private beeIdAt(role: string, i: number): number {
    const bees = this.eng.roster.displayOrder(role);
    return bees.length > 0 ? bees[i % bees.length].id : -1;
  }

  /**
   * 明星蜂：在原蜜蜂上用同一帧再画金色翅膀和特性配饰（scripts/star-art 生成的叠加图集），
   * 原来的可爱形象完全保留；再加两颗一闪一闪的小星星。based=false 表示底图没画成（用的程序化回退）。
   */
  private drawStarBee(ctx: CanvasRenderingContext2D, role: string, id: number, anim: string, t: number, x: number, y: number,
    size: number, o: DrawOpts, based: boolean): void {
    if (id < 0) return;
    const trait = this.eng.roster.traitOf(id);
    if (trait.length === 0) return;
    if (based) {
      Sprites.draw(ctx, `atlas_star_wings_${role}`, anim, t, x, y, size, o);
      Sprites.draw(ctx, `atlas_star_${trait}`, anim, t, x, y, size, o);
    }
    const k = size / 16;
    for (let i = 0; i < 2; i++) {
      const ph = this.time * 2.2 + id * 0.7 + i * 2.1;
      const a = Math.max(0, Math.sin(ph));
      if (a <= 0.05) continue;
      const sx = x + (i === 0 ? -9 : 10) * k + Math.cos(ph * 0.5) * 2 * k;
      const sy = y - (i === 0 ? 10 : 4) * k;
      this.drawSparkle(ctx, sx, sy, (2.2 + a * 1.6) * k, a);
    }
  }

  /** 四角小星光（与原素材里的高光星星同色） */
  private drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number): void {
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * alpha;
    ctx.fillStyle = '#FFF2B3';
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.quadraticCurveTo(x, y, x, y + r);
    ctx.quadraticCurveTo(x, y, x - r, y);
    ctx.quadraticCurveTo(x, y, x, y - r);
    ctx.fill();
    ctx.restore();
  }

  /** 第 i 只侦察实体对应的名册编号 */
  private scoutBeeId(i: number): number {
    return this.beeIdAt(Role.Scout, i);
  }

  /** 跟随中蜜蜂的世界坐标；不在画面上返回 null */
  followPos(): number[] | null {
    if (this.follow < 0) return null;
    const v = this.bees.find((b: VisualBee) => b.beeId === this.follow && b.fieldId.length > 0);
    if (v !== undefined) return [v.x, v.y];
    const scouts = this.eng.run.map.scouts;
    for (let i = 0; i < scouts.length; i++) {
      const a = scouts[i];
      if (this.scoutBeeId(i) === this.follow && a.state !== 'idle' && a.state !== 'dance') return [a.x, a.y];
    }
    return null;
  }

  /** 这只蜜蜂此刻在画面上能不能被跟随 */
  canFollow(id: number): boolean {
    const prev = this.follow;
    this.follow = id;
    const ok = this.followPos() !== null;
    this.follow = prev;
    return ok;
  }

  startFollow(id: number): void {
    this.follow = id;
    this.followMissing = 0;
    this.trail = [];
    this.camAnim = 0;
  }

  stopFollow(): void {
    this.follow = -1;
    this.trail = [];
  }

  /** 点中蜜蜂：花田视图找飞行中的采集蜂/侦察蜂（正在花丛上采蜜的不算，免得抢了采蜜的点击），巢内找画出的工蜂与守卫 */
  hitBee(sx: number, sy: number, w: number, h: number, view: string): number {
    let best = -1;
    let bestD = 1e9;
    if (view === 'hive') {
      const r = Math.max(18, this.hexSize * 0.45);
      this.hiveSpots.forEach((p: HiveSpot) => {
        const d = Math.hypot(p.x - sx, p.y - sy);
        if (d < r && d < bestD) { bestD = d; best = p.id; }
      });
      return best;
    }
    const wx = this.screenToWorldX(sx, w);
    const wy = this.screenToWorldY(sy, h);
    const r = Math.max(13, 18 / this.cam.zoom);
    const consider = (x: number, y: number, id: number, fx: number, fy: number): void => {
      if (id < 0) return;
      if (Math.hypot(x - fx, y - fy) < 28 || Math.hypot(x, y + 12) < 50) return;
      const d = Math.hypot(x - wx, y - wy);
      if (d < r && d < bestD) { bestD = d; best = id; }
    };
    this.bees.forEach((b: VisualBee) => {
      const f = this.eng.w.field(b.fieldId);
      if (f !== null) consider(b.x, b.y, b.beeId, f.x, f.y);
    });
    this.eng.run.map.scouts.forEach((a, i: number) => {
      if (a.state === 'idle' || a.state === 'dance') return;
      consider(a.x, a.y, this.scoutBeeId(i), a.tx === a.x ? 1e6 : a.tx, a.ty);
    });
    return best;
  }

  private updateFollow(dt: number): void {
    if (this.follow < 0) return;
    const p = this.followPos();
    if (p === null) {
      this.followMissing += dt;
      return;
    }
    this.followMissing = 0;
    const k = Math.min(1, dt * 5);
    this.cam.x += (p[0] - this.cam.x) * k;
    this.cam.y += (p[1] - this.cam.y) * k;
    this.cam.zoom += (Math.max(1.6, this.cam.zoom) - this.cam.zoom) * Math.min(1, dt * 3);
    this.trailAt -= dt;
    if (this.trailAt <= 0) {
      this.trailAt = 0.08;
      this.trail.push(p[0], p[1]);
      if (this.trail.length > 120) this.trail.splice(0, this.trail.length - 120);
    }
  }

  /** 跟随中的蜜蜂：飞过的轨迹 + 脚下光圈 + 要去的花田 */
  private drawFollow(ctx: CanvasRenderingContext2D): void {
    if (this.follow < 0) return;
    const p = this.followPos();
    if (this.trail.length >= 4) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,214,70,0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(this.trail[0], this.trail[1]);
      for (let i = 2; i < this.trail.length; i += 2) ctx.lineTo(this.trail[i], this.trail[i + 1]);
      ctx.stroke();
      ctx.restore();
    }
    if (p === null) return;
    const v = this.bees.find((b: VisualBee) => b.beeId === this.follow);
    const f = v === undefined ? null : this.eng.w.field(v.fieldId);
    if (f !== null && v !== undefined) {
      const goingOut = v.phase < 0.42;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(goingOut ? f.x : 0, goingOut ? f.y : -10);
      ctx.stroke();
      ctx.restore();
    }
    const pulse = 13 + Math.sin(this.time * 6) * 2;
    ctx.strokeStyle = '#FFD54A';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(p[0], p[1], pulse, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ------------------------------------------------------------ 更新
  update(dt: number): void {
    const d = Math.min(dt, 0.1);
    this.time += d;
    this.consumeFx();
    this.trackThreats();
    this.updateBees(d);
    this.updateFollow(d);
    this.updateParticles(d);
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= d;
      t.y -= d * (t.big ? 10 : 22);
      if (t.life <= 0) {
        this.texts.splice(i, 1);
      }
    }
    for (let i = this.dancers.length - 1; i >= 0; i--) {
      this.dancers[i].t += d;
      if (this.dancers[i].t > 3.2) {
        this.dancers.splice(i, 1);
      }
    }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      this.shots[i].t += d;
      if (this.shots[i].t >= this.shots[i].dur) {
        this.shots.splice(i, 1);
      }
    }
    this.ambientCues();
    if (this.camAnim > 0) {
      const k = Math.min(1, dt * 9);
      this.cam.x += (this.camTarget.x - this.cam.x) * k;
      this.cam.y += (this.camTarget.y - this.cam.y) * k;
      this.cam.zoom += (this.camTarget.zoom - this.cam.zoom) * k;
      this.camAnim -= dt;
      if (this.camAnim <= 0 || Math.abs(this.camTarget.zoom - this.cam.zoom) < 0.002) {
        this.cam.x = this.camTarget.x;
        this.cam.y = this.camTarget.y;
        this.cam.zoom = this.camTarget.zoom;
        this.camAnim = 0;
      }
    }
  }

  private fieldVisible(): boolean {
    return this.time - this.fieldShownAt < 0.5;
  }

  private hiveVisible(): boolean {
    return this.time - this.hiveShownAt < 0.5;
  }

  /** 场景动作音：同名音效在渲染层再做一次节流，避免上百只蜜蜂同时发声 */
  cue(name: string, gap: number): void {
    const last = this.cueAt.get(name);
    if (last !== undefined && this.time - last < gap) {
      return;
    }
    this.cueAt.set(name, this.time);
    this.cues.push(name);
    if (this.cues.length > 16) {
      this.cues.splice(0, this.cues.length - 16);
    }
  }

  takeCues(): string[] {
    const out = this.cues;
    this.cues = [];
    return out;
  }

  private shot(atlas: string, anim: string, x: number, y: number, size: number, view: string): void {
    if (!Sprites.has(atlas, anim)) {
      return;
    }
    const s = new OneShot();
    s.atlas = atlas;
    s.anim = anim;
    s.x = x;
    s.y = y;
    s.size = size;
    s.view = view;
    s.dur = Sprites.duration(atlas, anim) + 0.15;
    this.shots.push(s);
    if (this.shots.length > MAX_ONESHOTS) {
      this.shots.splice(0, this.shots.length - MAX_ONESHOTS);
    }
  }

  /** 屏幕级特效（季节、任务、成就、分蜂、失败、溢出） */
  screenFx(atlas: string, anim: string): void {
    // 放在屏幕上方、尺寸受限：避免盖住蜂巢中央的蜂后和建筑
    this.shot(atlas, anim, 0.5, 0.13, 96, 'screen');
  }

  /** UI 命令失败时的反馈（vfx_17） */
  flashFail(): void {
    this.shot('atlas_vfx_17', 'fail', 0.5, 0.42, 90, 'screen');
  }

  private spawnParticle(view: string, x: number, y: number, color: string, speed: number, size: number): void {
    if (!this.particlesOn || this.particles.length >= MAX_PARTICLES) {
      return;
    }
    const p = this.pool.length > 0 ? this.pool.pop() as Particle : new Particle();
    const a = this.rng.range(0, Math.PI * 2);
    const v = this.rng.range(0.3, 1) * speed;
    p.x = x;
    p.y = y;
    p.vx = Math.cos(a) * v;
    p.vy = Math.sin(a) * v - speed * 0.4;
    p.maxLife = this.rng.range(0.5, 1.1);
    p.life = p.maxLife;
    p.color = color;
    p.size = size;
    p.view = view;
    this.particles.push(p);
  }

  private addText(view: string, x: number, y: number, text: string, color: string, big: boolean, chip: string): void {
    const t = new FloatText();
    t.x = x;
    t.y = y;
    t.text = text;
    t.life = big ? 2.6 : 1.1;
    t.view = view;
    t.color = color;
    t.big = big;
    t.chip = chip;
    this.texts.push(t);
    if (this.texts.length > 40) {
      this.texts.splice(0, this.texts.length - 40);
    }
  }

  private firstCellOf(type: string): HexCell | null {
    const c = this.eng.run.hive.cells.find((x: HexCell) => x.building === type);
    return c === undefined ? null : c;
  }

  private consumeFx(): void {
    const fx = this.eng.w.fx;
    if (fx.length === 0) {
      return;
    }
    fx.forEach((e: FxEvent) => {
      if (e.kind === 'collect') {
        this.addText('field', e.x, e.y - 20, e.text, '#FFF3B0', false, 'cost');
        this.shot('atlas_vfx_01', 'collect', e.x, e.y - 6, 54, 'field');
        for (let i = 0; i < 4; i++) {
          this.spawnParticle('field', e.x, e.y, '#FFD54A', 60, 2.2);
        }
      } else if (e.kind === 'reveal') {
        this.addText('field', e.x, e.y - 34, e.text, '#FFFFFF', true, '');
        this.shot('atlas_vfx_04', 'discover', e.x, e.y - 10, 90, 'field');
      } else if (e.kind === 'bloom') {
        this.addText('field', e.x, e.y - 34, e.text, '#FFFFFF', true, '');
        this.shot('atlas_vfx_10', 'bloom', e.x, e.y, 96, 'field');
      } else if (e.kind === 'dance') {
        const dn = new Dancer();
        this.dancers.push(dn);
        this.addText('hive', 0, -1.2, '摇摆舞！', '#FFFFFF', true, '');
        this.shot('atlas_vfx_05', 'dance', 0, -1.05, 2.4, 'hivecell');
      } else if (e.kind === 'egg') {
        this.lastEggAt = this.time;
        this.addText('hive', 0, -0.6, e.text, '#FFF3B0', false, '');
        this.shot('atlas_vfx_02', 'egg', 0, 0.1, 1.3, 'hivecell');
      } else if (e.kind === 'hatch') {
        this.addText('hive', 0, -0.6, `${e.text}诞生`, '#FFF3B0', false, '');
        const nur = this.firstCellOf(Bld.Nursery);
        const q = nur === null ? 0 : nur.q;
        const r = nur === null ? 0 : nur.r;
        this.shot('atlas_vfx_03', 'hatch', q, r, 1.2, 'hivecell');
        this.shot('atlas_bees_larva', 'differentiate', q + 0.25, r + 0.2, 0.9, 'hivecell');
      } else if (e.kind === 'build' || e.kind === 'expand') {
        this.addText('hive', e.x, e.y, e.text, '#FFFFFF', true, '');
        // 建造是即时完成的；特效只在本格内播放，不遮住蜂后和相邻巢房
        this.shot('atlas_construction', e.kind, e.x, e.y, 0.72, 'hivecell');
        this.shot(e.kind === 'build' ? 'atlas_vfx_06' : 'atlas_vfx_07', e.kind, e.x, e.y, 0.7, 'hivecell');
        this.burstCell(e.x, e.y);
      } else if (e.kind === 'upgrade') {
        const lv = e.text.lastIndexOf('Lv');
        this.addText('hive', 0, 1.2, lv >= 0 ? e.text.substring(lv) : e.text, '#D6F5D6', true, lv >= 0 ? 'level' : '');
        this.shot('atlas_vfx_08', 'upgrade', 0, 0.6, 1.4, 'hivecell');
        if (this.eng.w.cfg.research.some((r: ResearchDef) => e.text.indexOf(r.name) === 0)) {
          this.lastResearchAt = this.time;
        }
      } else if (e.kind === 'victory') {
        this.lastCheerAt = this.time;
        this.addText(e.view === 'hive' ? 'hive' : 'field', 0, e.view === 'hive' ? -1.6 : -60, e.text, '#FFE082', true,
          '');
        this.victoryFx(e.text);
      } else if (e.kind === 'spring') {
        this.screenFx('atlas_vfx_12', 'spring_return');
      } else if (e.kind === 'season') {
        const s = this.eng.run.season.season;
        const anim = s === SeasonId.Winter || s === SeasonId.WinterPrep ? 'season_winter' :
          (s === SeasonId.Autumn ? 'season_autumn' : (s === SeasonId.Summer ? 'season_summer' : 'season_spring'));
        // 秋季不再播放落叶特效
        if (anim !== 'season_autumn') {
          this.screenFx('atlas_vfx_11', anim);
        }
      } else if (e.kind === 'task') {
        this.screenFx('atlas_vfx_15', 'task');
      } else if (e.kind === 'milestone') {
        this.screenFx('atlas_vfx_15', 'milestone');
        this.addText('banner', 0, 0, e.text, '#FFFFFF', true, '');
      } else if (e.kind === 'swarm') {
        this.screenFx('atlas_vfx_16', 'swarm_arrive');
        this.addText('banner', 0, 0, e.text, '#FFFFFF', true, '');
      } else if (e.kind === 'death') {
        // 敌害咬死蜜蜂：在敌害位置飘一个红色的减员数字
        this.addText(e.view === 'hive' ? 'hive' : 'field', e.x, e.view === 'hive' ? e.y - 0.5 : e.y - 26, e.text, '#FF8A80', true, '');
      } else if (e.kind === 'fail') {
        this.flashFail();
        this.addText('banner', 0, 0, e.text, '#FFB4A8', true, '');
      }
    });
    this.eng.w.fx = [];
  }

  /** 由消息驱动的屏幕特效（成就、关键升级、溢出、稀有发现） */
  onMessage(kind: string): void {
    if (kind === 'achievement') {
      this.screenFx('atlas_vfx_15', 'achievement');
    } else if (kind === 'key') {
      this.shot('atlas_vfx_09', 'key', 0, 0.4, 1.6, 'hivecell');
    } else if (kind === 'overflow') {
      this.screenFx('atlas_vfx_18', 'overflow');
    } else if (kind === 'swarmDepart') {
      this.screenFx('atlas_vfx_16', 'swarm_depart');
    }
  }

  private victoryFx(text: string): void {
    let type = ThreatType.Wasp as string;
    if (text.indexOf('熊') >= 0) {
      type = ThreatType.Bear;
    } else if (text.indexOf('蜡螟') >= 0) {
      type = ThreatType.Moth;
    } else if (text.indexOf('蛛') >= 0) {
      type = ThreatType.Web;
    }
    const cands: ThreatMark[] = [];
    this.marks.forEach((x: ThreatMark) => {
      if (x.type === type) {
        cands.push(x);
      }
    });
    if (cands.length === 0) {
      return;
    }
    let m = cands[0];
    for (let i = 1; i < cands.length; i++) {
      if (cands[i].seen > m.seen) {
        m = cands[i];
      }
    }
    if (m.view === 'hive') {
      this.shot('atlas_combat', 'victory', m.x, m.y, 1.2, 'hivecell');
      this.shot('atlas_vfx_14', 'victory', m.x, m.y - 0.3, 1.4, 'hivecell');
      if (type === ThreatType.Moth) {
        this.shot('atlas_enemies_moth', 'escape', m.x + 0.3, m.y, 0.8, 'hivecell');
      } else {
        this.shot('atlas_enemies_bear', 'retreat', m.x, m.y, 1.6, 'hivecell');
      }
      return;
    }
    this.shot('atlas_combat', 'victory', m.x, m.y, 50, 'field');
    this.shot('atlas_vfx_14', 'victory', m.x, m.y - 16, 70, 'field');
    if (type === ThreatType.Web) {
      this.shot('atlas_enemies_web', 'clear', m.x, m.y, 46, 'field');
      this.cue('web_clear', 0.5);
    } else if (type === ThreatType.Bear) {
      this.shot('atlas_enemies_bear', 'retreat', m.x, m.y, 80, 'field');
    } else {
      this.shot('atlas_enemies_wasp', 'escape', m.x, m.y, 30, 'field');
    }
  }

  /** 记录敌害位置：新出现时播放预警特效，击退时用于定位胜利特效 */
  private trackThreats(): void {
    const eng = this.eng;
    const live: Set<string> = new Set<string>();
    eng.threats.activeList().forEach((e: ThreatEvent) => {
      live.add(e.eventId);
      let m = this.marks.get(e.eventId);
      const isNew = m === undefined;
      if (m === undefined) {
        m = new ThreatMark();
        m.type = e.type;
        this.marks.set(e.eventId, m);
      }
      m.seen = this.time;
      if (e.type === ThreatType.Moth) {
        const st = this.firstCellOf(Bld.Storage);
        m.view = 'hive';
        m.x = st === null ? 0.8 : st.q;
        m.y = st === null ? 0.8 : st.r;
      } else if (e.type === ThreatType.Bear) {
        m.view = 'field';
        const p = this.bearPos(e);
        m.x = p[0];
        m.y = p[1];
      } else {
        const f = eng.w.field(e.targetId);
        m.view = 'field';
        if (f !== null) {
          const anchor = e.type === ThreatType.Wasp ? this.waspAnchor(e, f) : [f.x + 12, f.y - 8];
          m.x = anchor[0];
          m.y = anchor[1];
        }
      }
      if (isNew && e.phase !== 'postponed') {
        if (m.view === 'field') {
          this.shot('atlas_vfx_13', 'warning', m.x, m.y - 30, 64, 'field');
        } else {
          this.shot('atlas_vfx_13', 'warning', m.x, m.y - 0.6, 1.2, 'hivecell');
        }
        if (e.type === ThreatType.Web) {
          this.cue('web_trap', 1);
        }
      }
    });
    const gone: string[] = [];
    this.marks.forEach((m: ThreatMark, id: string) => {
      if (!live.has(id) && this.time - m.seen > 3) {
        gone.push(id);
      }
    });
    gone.forEach((id: string) => {
      this.marks.delete(id);
    });
  }

  /** 熊的位置：预警阶段从远处走近，袭击阶段停在蜂箱旁 */
  private bearPos(e: ThreatEvent): number[] {
    if (e.phase === 'warning') {
      const span = Math.max(1, e.endsAt - e.startedAt);
      const p = Math.max(0, Math.min(1, (this.eng.run.time - e.startedAt) / span));
      return [300 - 220 * p, 220 - 180 * p];
    }
    return [80, 40];
  }

  private burstCell(q: number, r: number): void {
    for (let i = 0; i < 12; i++) {
      this.spawnParticle('hivecell', q, r, i % 2 === 0 ? '#FFD54A' : '#FFFFFF', 1.6, 2.2);
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.view === 'hivecell' ? 2 : 90) * dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        this.pool.push(p);
      }
    }
  }

  /** 可见蜜蜂只是逻辑蜂群的代表（需求书7.2） */
  private updateBees(dt: number): void {
    const alloc = this.eng.w.alloc;
    let total = 0;
    alloc.forEach((a: ForageAlloc) => {
      total += a.bees;
    });
    const want = Math.min(MAX_VISUAL_FORAGERS, Math.ceil(total));
    while (this.bees.length < want) {
      const b = new VisualBee();
      b.phase = this.rng.next();
      b.wob = this.rng.range(-1, 1);
      b.anim = this.rng.range(0, 3);
      this.bees.push(b);
    }
    if (this.bees.length > want) {
      this.bees.splice(want, this.bees.length - want);
    }
    // 按分配比例给可见蜜蜂指派花田
    let idx = 0;
    alloc.forEach((a: ForageAlloc) => {
      const n = total > 0 ? Math.round(want * a.bees / total) : 0;
      for (let i = 0; i < n && idx < this.bees.length; i++) {
        if (this.bees[idx].fieldId !== a.fieldId && this.bees[idx].phase > 0.9) {
          this.bees[idx].fieldId = a.fieldId;
        } else if (this.bees[idx].fieldId.length === 0) {
          this.bees[idx].fieldId = a.fieldId;
        }
        idx++;
      }
    });
    // 可见的采集蜂按顺序对应到名册里的采集蜂，点它就能看到是谁
    this.bees.forEach((b: VisualBee, i: number) => { b.beeId = this.beeIdAt(Role.Forager, i); });
    const speedMul = this.reduceMotion ? 0.6 : 1;
    const watching = this.fieldVisible();
    this.bees.forEach((b: VisualBee) => {
      const f = this.eng.w.field(b.fieldId);
      b.anim += dt * speedMul;
      if (f === null) {
        b.phase = 0;
        return;
      }
      const a = alloc.find((x: ForageAlloc) => x.fieldId === b.fieldId);
      const trip = a === undefined ? 12 : Math.max(5, Math.min(26, a.tripTime));
      const before = b.phase;
      b.phase += dt / trip * speedMul;
      if (b.phase >= 1) {
        b.phase -= 1;
        if (watching) {
          this.cue('forager_deliver', 1.4);
          if (this.rng.next() < 0.08) {
            this.shot('atlas_production', 'production_nectar', 0, -34, 26, 'field');
          }
        }
      }
      if (before < 0.5 && b.phase >= 0.5 && watching && this.onScreen(f.x, f.y)) {
        this.cue('forager_pickup', 1.6);
      }
      const px = b.x;
      const py = b.y;
      const nx = -f.y / Math.max(1, f.dist);
      const ny = f.x / Math.max(1, f.dist);
      if (b.phase < 0.42) {
        const t = b.phase / 0.42;
        const arc = Math.sin(t * Math.PI) * 28 * b.wob;
        b.x = f.x * t + nx * arc;
        b.y = f.y * t + ny * arc;
        b.carrying = false;
      } else if (b.phase < 0.58) {
        const t = (b.phase - 0.42) / 0.16;
        const ang = t * Math.PI * 2 + b.wob * 3;
        b.x = f.x + Math.cos(ang) * 16;
        b.y = f.y + Math.sin(ang) * 10;
      } else {
        const t = (b.phase - 0.58) / 0.42;
        const arc = Math.sin(t * Math.PI) * 22 * b.wob;
        b.x = f.x * (1 - t) - nx * arc;
        b.y = f.y * (1 - t) - ny * arc;
        b.carrying = true;
      }
      const dx = b.x - px;
      const dy = b.y - py;
      if (Math.abs(dx) + Math.abs(dy) > 0.01) {
        b.angle = Math.atan2(dy, dx);
        if (Math.abs(dx) > 0.05) {
          b.flip = dx < 0;
        }
      }
    });
  }

  /** 与动作对应的场景音（只在对应视图正在显示时发声） */
  private ambientCues(): void {
    const eng = this.eng;
    if (this.fieldVisible()) {
      eng.threats.activeList().forEach((e: ThreatEvent) => {
        if (e.type === ThreatType.Wasp && e.phase === 'active') {
          if (eng.w.active(Role.Guard) > 0) {
            this.cue('guard_attack', 1.3);
          }
          if (this.rng.next() < 0.004) {
            this.cue('wasp_attack', 2.5);
            this.cue('bee_hurt', 2.5);
          }
        } else if (e.type === ThreatType.Bear && e.phase === 'warning') {
          this.cue('bear_step', 1.1);
        } else if (e.type === ThreatType.Bear && e.phase === 'active') {
          this.cue('bear_swipe', 2.6);
          if (eng.w.active(Role.Guard) > 0) {
            this.cue('guard_attack', 1.2);
          }
        }
      });
    }
    if (this.hiveVisible()) {
      if (eng.w.mothActive) {
        this.cue('moth_chew_loop', 5.5);
      }
      const v = eng.rateView;
      if (eng.w.count(Bld.Brewery) > 0 && v.honeyIn > 0.05) {
        this.cue('brew_loop', 7);
      }
      if (v.waxIn > 0.01) {
        this.cue('wax_make', 6);
      }
      if (v.jellyIn > 0) {
        this.cue('jelly_drop', 9);
      }
    }
  }

  // ------------------------------------------------------------ 坐标
  private worldToScreenX(x: number, w: number): number {
    return (x - this.cam.x) * this.cam.zoom + w / 2;
  }

  private worldToScreenY(y: number, h: number): number {
    return (y - this.cam.y) * this.cam.zoom + h / 2;
  }

  private onScreen(x: number, y: number): boolean {
    const sx = this.worldToScreenX(x, this.lastFieldW);
    const sy = this.worldToScreenY(y, this.lastFieldH);
    return sx > -40 && sy > -40 && sx < this.lastFieldW + 40 && sy < this.lastFieldH + 40;
  }

  screenToWorldX(sx: number, w: number): number {
    return (sx - w / 2) / this.cam.zoom + this.cam.x;
  }

  screenToWorldY(sy: number, h: number): number {
    return (sy - h / 2) / this.cam.zoom + this.cam.y;
  }

  pan(dx: number, dy: number): void {
    this.camAnim = 0;
    this.cam.x -= dx / this.cam.zoom;
    this.cam.y -= dy / this.cam.zoom;
    const lim = this.eng.w.region().maxRadius + 120;
    this.cam.x = Math.max(-lim, Math.min(lim, this.cam.x));
    this.cam.y = Math.max(-lim, Math.min(lim, this.cam.y));
  }

  zoomBy(f: number): void {
    this.camAnim = 0;
    this.cam.zoom = Math.max(0.25, Math.min(2.5, this.cam.zoom * f));
  }

  /** 蜂巢视图支持双指/滚轮缩放；上下限避免巢格小到无法点击或无限放大。 */
  zoomHiveBy(f: number): void {
    this.hiveZoom = Math.max(0.7, Math.min(1.8, this.hiveZoom * f));
    if (this.hiveZoom <= 0.72) { this.hivePanX = 0; this.hivePanY = 0; }
  }

  panHive(dx: number, dy: number): void {
    const limit = 320 * this.hiveZoom;
    this.hivePanX = Math.max(-limit, Math.min(limit, this.hivePanX + dx));
    this.hivePanY = Math.max(-limit, Math.min(limit, this.hivePanY + dy));
  }

  /** 双击：以点击处为中心放大一档；已经放大时平滑回到默认视野 */
  doubleTapZoom(sx: number, sy: number, w: number, h: number): void {
    const base = Math.max(0.35, Math.min(1.4, Math.min(w, h) / 420));
    const lim = this.eng.w.region().maxRadius + 120;
    if (this.cam.zoom > base * 1.35) {
      this.camTarget.zoom = base;
      this.camTarget.x = 0;
      this.camTarget.y = -40;
    } else {
      const z = Math.min(2.5, base * 2);
      const wx = this.screenToWorldX(sx, w);
      const wy = this.screenToWorldY(sy, h);
      this.camTarget.zoom = z;
      // 放大后点击处仍停在手指下方
      this.camTarget.x = Math.max(-lim, Math.min(lim, wx - (sx - w / 2) / z));
      this.camTarget.y = Math.max(-lim, Math.min(lim, wy - (sy - h / 2) / z));
    }
    this.camAnim = 0.6;
  }

  fitDefault(w: number, h: number): void {
    this.cam.zoom = Math.max(0.35, Math.min(1.4, Math.min(w, h) / 420));
    this.cam.x = 0;
    this.cam.y = -40;
  }

  /** 把镜头移到某块花田（提示“带我看看”） */
  lookAt(x: number, y: number): void {
    this.cam.x = x;
    this.cam.y = y - 20;
    this.cam.zoom = Math.max(this.cam.zoom, 0.8);
  }

  /** 命中花田或蜂巢：返回 fieldId、'hive' 或 '' */
  hitField(sx: number, sy: number, w: number, h: number): string {
    const wx = this.screenToWorldX(sx, w);
    const wy = this.screenToWorldY(sy, h);
    // 蜂箱（含上方屋顶）
    if (wx * wx + (wy + 12) * (wy + 12) < 46 * 46) {
      return 'hive';
    }
    let best = '';
    let bestD = 1e9;
    const touchR = Math.max(36, 30 / this.cam.zoom);
    this.eng.run.map.fields.forEach((f: FlowerField) => {
      if (!f.discovered) {
        return;
      }
      const dx = f.x - wx;
      const dy = f.y - wy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < touchR + 10 * f.level && d < bestD) {
        bestD = d;
        best = f.fieldId;
      }
    });
    return best;
  }

  /** 命中敌害：花田视图找胡蜂 / 蛛网 / 正在袭击的熊，蜂巢视图找蜡螟；返回 eventId */
  hitThreat(sx: number, sy: number, w: number, h: number, view: string): string {
    const eng = this.eng;
    let best = '';
    let bestD = 1e9;
    if (view === 'hive') {
      this.layoutHex(w, h);
      const st = this.firstCellOf(Bld.Storage);
      if (st === null) return '';
      eng.threats.activeList().forEach((e: ThreatEvent) => {
        if (e.type !== ThreatType.Moth || e.phase !== 'active') return;
        const d = Math.hypot(this.cellX(st) - sx, this.cellY(st) - sy);
        if (d < Math.max(30, this.hexSize * 1.1) && d < bestD) { bestD = d; best = e.eventId; }
      });
      return best;
    }
    const wx = this.screenToWorldX(sx, w);
    const wy = this.screenToWorldY(sy, h);
    const touch = Math.max(34, 28 / this.cam.zoom);
    eng.threats.activeList().forEach((e: ThreatEvent) => {
      if (e.phase !== 'active') return;
      let x = 0;
      let y = 0;
      let r = touch;
      if (e.type === ThreatType.Wasp || e.type === ThreatType.Web) {
        const f = eng.w.field(e.targetId);
        if (f === null) return;
        const anchor = e.type === ThreatType.Wasp ? this.waspAnchor(e, f) : [f.x + 12, f.y - 8];
        x = anchor[0];
        y = anchor[1];
        if (e.type === ThreatType.Wasp) r = touch + (e.boss === true ? 26 : 12);
      } else if (e.type === ThreatType.Bear) {
        const p = this.bearPos(e);
        x = p[0];
        y = p[1];
        r = touch + 16;
      } else {
        return;
      }
      const d = Math.hypot(x - wx, y - wy);
      if (d < r && d < bestD) { bestD = d; best = e.eventId; }
    });
    return best;
  }

  /** 镜头对准某个敌害（跳到敌害时用，胡蜂在航线中段而不在花田上） */
  lookAtThreat(eventId: string): boolean {
    // 熊的位置随阶段变化（预警时走近、袭击时停在蜂箱旁），按当前状态现算，不用上一帧的标记
    const bear = this.eng.run.threats.active.find((x: ThreatEvent) => x.eventId === eventId && x.type === ThreatType.Bear);
    if (bear !== undefined) {
      const p = this.bearPos(bear);
      this.stopFollow();
      this.lookAt(p[0], p[1] + 20);
      return true;
    }
    const m = this.marks.get(eventId);
    if (m === undefined || m.view !== 'field') return false;
    this.stopFollow();
    this.lookAt(m.x, m.y + 20);
    return true;
  }

  /** 胡蜂所在位置：普通胡蜂在航线中段；保卫战的小兵错开一点，免得叠在一起 */
  private waspAnchor(e: ThreatEvent, f: FlowerField): number[] {
    const x = f.x * 0.55;
    const y = f.y * 0.55;
    if (e.raid !== true || e.boss === true) return [x, y];
    const n = Number(e.eventId.replace(/\D/g, '')) || 0;
    const a = n * 2.399;
    return [x + Math.cos(a) * 34, y + Math.sin(a) * 22];
  }

  /** 拍打敌害的即时反馈：伤害数字 + 打击特效 */
  swatFx(eventId: string, text: string, big: boolean = false): void {
    const m = this.marks.get(eventId);
    if (m === undefined) return;
    if (m.view === 'hive') {
      this.addText('hive', m.x, m.y - 0.7, text, '#FFE082', big, '');
      this.shot('atlas_combat', 'impact', m.x, m.y, 0.9, 'hivecell');
    } else {
      this.addText('field', m.x, m.y - 30, text, '#FFE082', big, '');
      this.shot('atlas_combat', 'impact', m.x, m.y - 4, 44, 'field');
      for (let i = 0; i < 3; i++) this.spawnParticle('field', m.x, m.y, '#FFFFFF', 50, 1.6);
    }
  }

  /** 命中还没探明的花田（带锁云朵），用于点击时给出说明 */
  hitFog(sx: number, sy: number, w: number, h: number): string {
    const wx = this.screenToWorldX(sx, w);
    const wy = this.screenToWorldY(sy, h);
    const range = this.eng.w.attrs.get('scout.range');
    let best = '';
    let bestD = 1e9;
    this.eng.run.map.fields.forEach((f: FlowerField) => {
      if (f.discovered || f.hidden || f.dist > range * 1.15) return;
      const d = Math.hypot(f.x - wx, f.y - (wy + 8));
      if (d < Math.max(40, 32 / this.cam.zoom) && d < bestD) { bestD = d; best = f.fieldId; }
    });
    return best;
  }

  // ------------------------------------------------------------ 巢外视图
  private ensureDecor(): void {
    const region = this.eng.w.region();
    if (this.decorRegion === region.id + this.eng.run.seed) {
      return;
    }
    this.decorRegion = region.id + this.eng.run.seed;
    const r = new Rng(this.eng.run.seed ^ 0x5bd1);
    this.decor = [];
    const props = PROPS[regionTheme(region.id)];
    const R = region.maxRadius + 260;
    for (let i = 0; i < 520; i++) {
      const d = new Decor();
      d.x = r.range(-R, R);
      d.y = r.range(-R, R);
      d.s = r.range(0.6, 1.4);
      d.kind = r.int(0, 3);
      d.flip = r.next() < 0.5;
      // 每 4 个装饰中 1 个使用图集道具，其余保留轻量草叶
      if (i % 4 === 0 && props !== undefined && d.x * d.x + d.y * d.y > 70 * 70) {
        d.prop = props[r.int(0, props.length - 1)];
      }
      this.decor.push(d);
    }
    Sprites.warm('atlas_props');
    Sprites.warm('atlas_skep');
  }

  private seasonTint(): string {
    const s = this.eng.run.season.season;
    if (s === SeasonId.Winter) {
      return 'rgba(235,242,250,0.12)';
    }
    if (s === SeasonId.WinterPrep) {
      return 'rgba(220,200,170,0.16)';
    }
    if (s === SeasonId.Autumn) {
      return 'rgba(230,160,60,0.06)';
    }
    return 'rgba(0,0,0,0)';
  }

  private skepAnim(): string {
    const eng = this.eng;
    const threat = eng.threats.activeList().some((e: ThreatEvent) =>
      e.phase !== 'postponed' && (e.type === ThreatType.Bear || e.targetId === 'hive'));
    if (threat) {
      return 'threat';
    }
    if (eng.run.season.season === SeasonId.Winter) {
      return 'winter';
    }
    return eng.w.alloc.length > 0 ? 'active' : 'normal';
  }

  drawField(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this.lastFieldW = w;
    this.lastFieldH = h;
    this.fieldShownAt = this.time;
    this.handDrawn = false;
    this.ensureDecor();
    const eng = this.eng;
    const region = eng.w.region();
    const theme = regionTheme(region.id);
    const z = this.cam.zoom;
    const t = this.time;
    ctx.save();
    // 地面：种区无缝地表；未解码时用原渐变
    const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, Math.max(w, h));
    g.addColorStop(0, region.ground);
    g.addColorStop(1, region.groundAlt);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    ctx.scale(z, z);
    ctx.translate(-this.cam.x, -this.cam.y);
    const vx0 = this.cam.x - w / 2 / z - 30;
    const vx1 = this.cam.x + w / 2 / z + 30;
    const vy0 = this.cam.y - h / 2 / z - 30;
    const vy1 = this.cam.y + h / 2 / z + 30;
    Sprites.tile(ctx, `art/v1/tile_${theme}.webp`, vx0, vy0, vx1, vy1, 256, 1);
    // 四季地表：春夏用嫩芽/盛花覆盖层；秋季整片地面转为金黄（不再铺落叶）；冬季整片积雪
    const season = eng.run.season.season;
    if (season === SeasonId.Winter) {
      this.drawSnowGround(ctx, vx0, vy0, vx1, vy1);
    } else if (season === SeasonId.Autumn || season === SeasonId.WinterPrep) {
      this.drawAutumnGround(ctx, vx0, vy0, vx1, vy1, season === SeasonId.WinterPrep);
    } else if (eng.run.season.formal || season !== SeasonId.Tutorial) {
      Sprites.tile(ctx, `art/v1/overlay_${seasonOverlay(season)}.webp`, vx0, vy0, vx1, vy1, 256, 0.9);
    }
    // 装饰：草叶 + 种区道具（冬季草叶被雪盖住）
    if (z > 0.3) {
      ctx.strokeStyle = season === SeasonId.Winter ? 'rgba(150,170,190,0.22)' :
        (season === SeasonId.Autumn || season === SeasonId.WinterPrep ? 'rgba(160,110,40,0.32)' : 'rgba(60,110,40,0.28)');
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      this.decor.forEach((d: Decor) => {
        if (d.prop.length > 0 || d.kind === 3 || d.x < vx0 || d.x > vx1 || d.y < vy0 || d.y > vy1) {
          return;
        }
        const sw = Math.sin(t * 1.3 + d.x * 0.05) * 1.5;
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - 3 * d.s + sw, d.y - 8 * d.s);
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + sw, d.y - 10 * d.s);
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + 3 * d.s + sw, d.y - 7 * d.s);
      });
      ctx.stroke();
      const po = new DrawOpts();
      po.align = 'bottom';
      this.decor.forEach((d: Decor) => {
        if (d.prop.length === 0 || d.x < vx0 || d.x > vx1 || d.y < vy0 || d.y > vy1) {
          return;
        }
        po.flip = d.flip;
        if (!Sprites.draw(ctx, 'atlas_props', d.prop, 0, d.x, d.y, 26 * d.s, po)) {
          ctx.fillStyle = 'rgba(120,100,70,0.25)';
          ctx.beginPath();
          ctx.ellipse(d.x, d.y, 5 * d.s, 3 * d.s, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 侦察范围
    const range = eng.w.attrs.get('scout.range');
    if (eng.w.count(Bld.ScoutRoom) > 0) {
      ctx.strokeStyle = 'rgba(103,216,255,0.72)';
      ctx.lineWidth = 1.5 / z;
      ctx.setLineDash([8 / z, 8 / z]);
      ctx.beginPath();
      ctx.arc(0, 0, range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(18,67,82,0.9)';
      ctx.font = font(11 / Math.max(0.7, z), true);
      ctx.textAlign = 'center';
      ctx.fillText(`侦察范围 ${Math.round(range)}`, 0, -range - 8 / z);
    }
    // 航线：普通 / 高产 / 危险 / 摇摆舞加成（虚线颜色 + 图集路线标记）
    eng.w.alloc.forEach((a: ForageAlloc) => {
      const f = eng.w.field(a.fieldId);
      if (f === null) {
        return;
      }
      this.drawRoute(ctx, f, a, z);
    });
    // 花田
    eng.run.map.fields.forEach((f: FlowerField) => {
      if (f.x < vx0 - 80 || f.x > vx1 + 80 || f.y < vy0 - 80 || f.y > vy1 + 80) {
        return;
      }
      this.drawFieldPatch(ctx, f, z, range);
    });
    // 蜜流花：金色光环 + 倒计时，提示玩家去点
    const bloom = eng.map.activeBloom();
    if (bloom !== null) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 6);
      const r = 30 + 10 * bloom.level;
      ctx.save();
      ctx.shadowColor = 'rgba(255,200,40,0.95)';
      ctx.shadowBlur = 18 + pulse * 14;
      ctx.strokeStyle = `rgba(255,214,70,${0.7 + 0.3 * pulse})`;
      ctx.lineWidth = 4 / Math.max(0.6, z);
      ctx.beginPath();
      ctx.arc(bloom.x, bloom.y - 6, r + pulse * 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      for (let i = 0; i < 6; i++) {
        const a = t * 1.6 + i / 6 * Math.PI * 2;
        ctx.fillStyle = 'rgba(255,236,140,0.95)';
        ctx.beginPath();
        ctx.arc(bloom.x + Math.cos(a) * (r + 8), bloom.y - 6 + Math.sin(a) * (r + 8) * 0.7, 2.6 / Math.max(0.6, z), 0, Math.PI * 2);
        ctx.fill();
      }
      const k = 1 / Math.max(0.7, z);
      ctx.font = font(13 * k, true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = `蜜流花 ${Math.ceil(eng.map.bloomRemaining())}秒`;
      ctx.lineWidth = 4 * k;
      ctx.strokeStyle = 'rgba(80,45,0,0.85)';
      ctx.strokeText(label, bloom.x, bloom.y - r - 22 * k);
      ctx.fillStyle = '#FFE16B';
      ctx.fillText(label, bloom.x, bloom.y - r - 22 * k);
    }
    // 蜂群远景层
    const adults = eng.w.adults();
    if (adults >= 6) {
      const dens = adults < 30 ? 'sparse' : (adults < 100 ? 'medium' : 'dense');
      const so = new DrawOpts();
      so.alpha = 0.85;
      so.full = true;
      Sprites.draw(ctx, 'atlas_swarm', dens, t, 0, -30, 170, so);
    }
    // 蜂箱
    const ko = new DrawOpts();
    ko.align = 'bottom';
    if (!Sprites.draw(ctx, 'atlas_skep', this.skepAnim(), t, 0, 30, 66, ko)) {
      drawSkep(ctx, 0, 0, 1, 0);
    }
    if (this.focus === 'hiveIcon') {
      this.drawFocusRing(ctx, 0, -2, 54);
    }
    // 授粉蜂（驻守花田）
    const poll = eng.run.colony.pollinators;
    const bo = new DrawOpts();
    Object.keys(poll).forEach((id: string) => {
      const n = Math.min(6, poll[id]);
      const f = eng.w.field(id);
      if (f === null || n <= 0) {
        return;
      }
      for (let i = 0; i < n; i++) {
        const a = t * 1.2 + i / n * Math.PI * 2;
        const x = f.x + Math.cos(a) * 22;
        const y = f.y + Math.sin(a) * 14 - 6;
        bo.flip = Math.sin(a) > 0;
        if (!Sprites.draw(ctx, 'atlas_bees_forager', 'pollinate', t + i * 0.3, x, y, 15, bo)) {
          drawBee(ctx, x, y, 0.9, a + Math.PI / 2, t * 40 + i, 'forager', true, z > 0.8);
        }
      }
    });
    // 采集蜂
    const detail = z > 0.9;
    const status = this.fieldStatusIcon();
    let statusShown = 0;
    this.bees.forEach((b: VisualBee) => {
      if (b.fieldId.length === 0 || b.x < vx0 || b.x > vx1 || b.y < vy0 || b.y > vy1) {
        return;
      }
      const anim = b.phase < 0.42 ? 'fly' : (b.phase < 0.58 ? 'collect' : 'loaded');
      bo.flip = b.flip;
      const based = Sprites.draw(ctx, 'atlas_bees_forager', anim, b.anim, b.x, b.y, 15, bo);
      if (!based) drawBee(ctx, b.x, b.y, 0.85, b.angle, b.anim * 40, 'forager', b.carrying, detail);
      this.drawStarBee(ctx, 'forager', b.beeId, anim, b.anim, b.x, b.y, 15, bo, based);
      if (based && status.length > 0 && statusShown < 6 && b.wob > 0.6) {
        const st = new DrawOpts();
        st.full = true;
        Sprites.draw(ctx, 'atlas_bee_status', status, t, b.x, b.y, 22, st);
        statusShown++;
      }
    });
    // 侦察蜂（逻辑实体位置）
    eng.run.map.scouts.forEach((a: ScoutAgent, si: number) => {
      if (a.state === 'idle' || a.state === 'dance') {
        return;
      }
      bo.flip = a.tx < a.x;
      const anim = a.state === 'search' ? 'search' : 'fly';
      const scoutBased = Sprites.draw(ctx, 'atlas_bees_scout', anim, t + a.id * 0.2, a.x, a.y, 17, bo);
      if (!scoutBased) {
        const ang = Math.atan2(a.ty - a.y, a.tx - a.x);
        drawBee(ctx, a.x, a.y, 0.95, ang, t * 45 + a.id, 'scout', false, detail);
      }
      this.drawStarBee(ctx, 'scout', this.scoutBeeId(si), anim, t + a.id * 0.2, a.x, a.y, 17, bo, scoutBased);
      if (a.state === 'search') {
        ctx.strokeStyle = 'rgba(93,173,226,0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(a.x, a.y, 14 + Math.sin(t * 6) * 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    this.drawFollow(ctx);
    // 敌害
    this.drawFieldThreats(ctx);
    // 一次性特效
    this.drawShots(ctx, 'field', 1, 0, 0, 1);
    // 粒子与飘字
    this.particles.forEach((p: Particle) => {
      if (p.view !== 'field') {
        return;
      }
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    this.texts.forEach((tx: FloatText) => {
      if (tx.view !== 'field') {
        return;
      }
      ctx.globalAlpha = Math.min(1, tx.life * 2);
      this.drawFloat(ctx, tx, 1 / Math.max(0.6, z));
    });
    ctx.globalAlpha = 1;
    ctx.restore();
    // 季节色调（四季覆盖层 + 天气 + 顶部文字共同传达，不以颜色作为唯一信息来源）
    ctx.fillStyle = this.seasonTint();
    ctx.fillRect(0, 0, w, h);
    this.drawWeather(ctx, w, h);
    this.drawShots(ctx, 'screen', w, 0, 0, h);
  }

  /** 秋季地面：整片转为暖金色草甸，叠几处浅色干草光斑；不铺落叶贴图 */
  private drawAutumnGround(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, late: boolean): void {
    ctx.fillStyle = late ? 'rgba(222,196,146,0.62)' : 'rgba(238,186,92,0.58)';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    const step = 110;
    const sx = Math.floor(x0 / step) * step;
    const sy = Math.floor(y0 / step) * step;
    ctx.fillStyle = late ? 'rgba(245,232,205,0.35)' : 'rgba(255,224,150,0.38)';
    for (let x = sx; x < x1 + step; x += step) {
      for (let y = sy; y < y1 + step; y += step) {
        const h = Math.sin(x * 7.13 + y * 3.71) * 24634.6345;
        const r = h - Math.floor(h);
        if (r < 0.5) {
          continue;
        }
        ctx.beginPath();
        ctx.ellipse(x + r * 60, y + (1 - r) * 50, 26 + r * 30, 10 + r * 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** 冬季积雪地面：整片覆盖白雪，再叠一层淡蓝阴影和雪粒，避免露出草地 */
  private drawSnowGround(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    ctx.fillStyle = 'rgba(246,249,252,0.94)';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    // 起伏的雪堆阴影：按世界坐标固定，平移镜头时不闪烁
    const step = 90;
    const sx = Math.floor(x0 / step) * step;
    const sy = Math.floor(y0 / step) * step;
    ctx.fillStyle = 'rgba(196,214,232,0.35)';
    for (let x = sx; x < x1 + step; x += step) {
      for (let y = sy; y < y1 + step; y += step) {
        const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const r = h - Math.floor(h);
        if (r < 0.45) {
          continue;
        }
        ctx.beginPath();
        ctx.ellipse(x + r * 50, y + (1 - r) * 40, 18 + r * 26, 6 + r * 6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    for (let x = sx; x < x1 + step; x += step) {
      for (let y = sy; y < y1 + step; y += step) {
        const h = Math.sin(x * 4.1 + y * 9.7) * 15731.743;
        const r = h - Math.floor(h);
        ctx.beginPath();
        ctx.ellipse(x + 20 + r * 40, y + 10 + r * 50, 14 + r * 18, 4 + r * 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** 采集蜂头顶状态角标：冬季寒冷 / 缺蜜停工 / 受伤 */
  private fieldStatusIcon(): string {
    const eng = this.eng;
    if (eng.run.season.starving) {
      return 'stopped';
    }
    if (eng.run.season.season === SeasonId.Winter) {
      return 'cold';
    }
    if (eng.w.injured(Role.Forager) > 0) {
      return 'injured';
    }
    return '';
  }

  private drawRoute(ctx: CanvasRenderingContext2D, f: FlowerField, a: ForageAlloc, z: number): void {
    const eng = this.eng;
    const dance = f.danceBonusUntil > eng.run.time;
    const threatened = f.webbed || f.danger >= 0.3 || eng.threats.activeList().some((e: ThreatEvent) =>
      e.targetId === f.fieldId && e.phase === 'active');
    const rich = eng.w.flower(f.flower).yieldMul >= 1.6;
    let kind = 'normal';
    let color = 'rgba(110,139,78,0.75)';
    if (threatened) {
      kind = 'danger';
      color = 'rgba(214,108,70,0.8)';
    } else if (dance) {
      kind = 'dance';
      color = 'rgba(150,120,200,0.8)';
    } else if (rich) {
      kind = 'high_yield';
      color = 'rgba(232,163,23,0.85)';
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.min(6, 1.4 + a.bees * 0.22);
    ctx.setLineDash([10, 7]);
    ctx.lineDashOffset = -this.time * 14;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    const mx = f.x * 0.5 - f.y * 0.08;
    const my = f.y * 0.5 + f.x * 0.08;
    ctx.quadraticCurveTo(mx, my, f.x, f.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    if (z > 0.45 && f.dist > 90) {
      const o = new DrawOpts();
      o.full = true;
      o.alpha = 0.95;
      Sprites.draw(ctx, 'atlas_routes', kind, this.time, f.x * 0.5, f.y * 0.5, 44, o);
    }
  }

  private flowerAnim(f: FlowerField, ratio: number): string {
    if (this.eng.run.season.season === SeasonId.Winter) {
      return 'dormant';
    }
    if (ratio < 0.25) {
      return 'spent';
    }
    if (ratio < 0.6) {
      return 'bud';
    }
    return 'bloom';
  }

  private drawFieldPatch(ctx: CanvasRenderingContext2D, f: FlowerField, z: number, range: number): void {
    const eng = this.eng;
    const t = this.time;
    if (!f.discovered) {
      if (f.hidden || f.dist > range * 1.15) {
        return;
      }
      const scouting = eng.run.map.scouts.some((a: ScoutAgent) => a.targetField === f.fieldId && a.state !== 'idle');
      const fo = new DrawOpts();
      fo.align = 'bottom';
      if (!Sprites.draw(ctx, 'atlas_fog', scouting ? 'scouting' : 'unknown', t, f.x, f.y + 14, 58, fo)) {
        // 未知区域：灌木剪影 + 问号
        ctx.fillStyle = 'rgba(40,70,30,0.22)';
        ctx.beginPath();
        ctx.arc(f.x - 10, f.y, 16, 0, Math.PI * 2);
        ctx.arc(f.x + 10, f.y - 4, 18, 0, Math.PI * 2);
        ctx.arc(f.x + 2, f.y + 8, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = font(20, true);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', f.x, f.y);
      }
      return;
    }
    const fd = eng.w.flower(f.flower);
    const valid = eng.map.intelValid(f);
    const max = eng.map.maxStock(f);
    const ratio = Math.max(0, Math.min(1, f.stock / Math.max(1, max)));
    const winter = eng.run.season.season === SeasonId.Winter;
    const R = 20 + f.level * 5;
    if (f.fieldId === this.selectedField) {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5 / z;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y + 6, R + 12, (R + 12) * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (fd.rare && !winter) {
      ctx.strokeStyle = `rgba(255,255,255,${0.4 + 0.3 * Math.sin(t * 3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y + 4, R + 14, (R + 14) * 0.6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    const anim = this.flowerAnim(f, ratio);
    const atlas = `atlas_flowers_${fd.id}`;
    const o = new DrawOpts();
    o.align = 'bottom';
    o.alpha = valid ? 1 : 0.55;
    const phase = Number(f.fieldId.substring(1)) * 0.37;
    const drawn = Sprites.draw(ctx, atlas, anim, t + phase, f.x, f.y + R * 0.45, R * 2 + 10, o);
    if (drawn && f.level >= 2) {
      // 高等级花田：两侧再长出小花丛
      o.flip = true;
      Sprites.draw(ctx, atlas, anim, t + phase + 0.4, f.x - R * 0.95, f.y + R * 0.15, R * 1.2, o);
      if (f.level >= 3) {
        o.flip = false;
        Sprites.draw(ctx, atlas, anim, t + phase + 0.8, f.x + R * 0.95, f.y + R * 0.25, R * 1.2, o);
      }
      o.flip = false;
    }
    if (!drawn) {
      this.drawFieldPatchFallback(ctx, f, ratio, valid, winter, R);
    }
    if (f.webbed) {
      const wo = new DrawOpts();
      const a = eng.w.alloc.find((x: ForageAlloc) => x.fieldId === f.fieldId);
      const guarded = eng.threats.guardsByArea['fields'] !== undefined && eng.threats.guardsByArea['fields'] > 0;
      const wa = guarded ? 'damaged' : (a !== undefined && a.bees > 0 ? 'trapped' : 'weave');
      const wx = f.x + R * 0.45;
      const wy = f.y - R * 0.35;
      if (!Sprites.draw(ctx, 'atlas_enemies_web', wa, t, wx, wy, 40, wo)) {
        drawWeb(ctx, wx, wy, 18);
      }
      const webEv = eng.threats.activeList().find((x: ThreatEvent) => x.type === ThreatType.Web && x.targetId === f.fieldId);
      if (webEv !== undefined && webEv.maxHp > 0) this.drawHpBar(ctx, wx, wy - 26, webEv.hp / webEv.maxHp);
      if (guarded) {
        for (let i = 0; i < 2; i++) {
          const ga = t * 2.4 + i * Math.PI;
          wo.flip = Math.cos(ga) > 0;
          Sprites.draw(ctx, 'atlas_bees_guard', 'attack', t + i * 0.3,
            wx + Math.cos(ga) * 28, wy + Math.sin(ga) * 16, 18, wo);
        }
        const co = new DrawOpts(); co.full = true;
        Sprites.draw(ctx, 'atlas_combat', Math.floor(t * 3) % 2 === 0 ? 'impact' : 'dash', t, wx, wy, 34, co);
      }
    }
    if (!valid && !f.home) {
      const eo = new DrawOpts();
      eo.alpha = 0.95;
      Sprites.draw(ctx, 'atlas_fog', 'expired', t, f.x, f.y - R * 0.9, 34, eo);
    }
    // 默认只保留弱化名称与库存条；等级仅在玩家选中地块时显示在信息气泡中。
    if (z > 0.55 || f.fieldId === this.selectedField) {
      const label = valid ? fd.name : `${fd.name}（信息过期）`;
      const k = 1 / Math.max(0.7, z);
      ctx.font = font(10 * k, false);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const ly = f.y + R * 0.6 + 16;
      ctx.fillStyle = 'rgba(83,75,59,0.82)';
      ctx.fillText(label, f.x, ly);
      // 使用高对比青蓝色，避免库存条与绿色草地融在一起。
      const bw = 40 * k;
      const bh = 6 * k;
      const barY = ly + 8 * k;
      ctx.fillStyle = '#17344A';
      roundRect(ctx, f.x - bw / 2, barY, bw, bh, 2 * k);
      ctx.fill();
      ctx.strokeStyle = '#F4F5D6';
      ctx.lineWidth = k;
      ctx.stroke();
      if (ratio > 0) {
        ctx.fillStyle = '#28C7FA';
        roundRect(ctx, f.x - bw / 2, barY, Math.max(k, bw * ratio), bh, 2 * k);
        ctx.fill();
      }
      if (f.fieldId === this.selectedField) {
        const bubbleW = 150 * k;
        const bubbleH = 44 * k;
        const by = f.y - R - 54 * k;
        ctx.fillStyle = 'rgba(255,244,218,0.96)';
        roundRect(ctx, f.x - bubbleW / 2, by, bubbleW, bubbleH, 13 * k);
        ctx.fill();
        ctx.strokeStyle = 'rgba(183,121,31,0.72)';
        ctx.lineWidth = 1.5 * k;
        ctx.stroke();
        ctx.fillStyle = '#4A3218';
        ctx.font = font(12 * k, true);
        ctx.fillText(`${fd.name} · ${f.level}级`, f.x, by + 14 * k);
        ctx.fillStyle = '#806847';
        ctx.font = font(10 * k, false);
        ctx.fillText(eng.map.recoveryRemaining(f) > 0 ? `恢复中 · ${Math.ceil(eng.map.recoveryRemaining(f))}秒` : `品质 ×${(fd.yieldMul * eng.w.attrs.get('scout.quality')).toFixed(1)}  ·  存量 ${Math.floor(f.stock)}`, f.x, by + 31 * k);
        ctx.fillStyle = 'rgba(255,244,218,0.96)';
        ctx.beginPath();
        ctx.moveTo(f.x - 7 * k, by + bubbleH);
        ctx.lineTo(f.x + 7 * k, by + bubbleH);
        ctx.lineTo(f.x, by + bubbleH + 8 * k);
        ctx.closePath();
        ctx.fill();
      }
    }
    if (f.home && this.focus === 'field' && f.fieldId === 'f0') {
      this.drawFocusRing(ctx, f.x, f.y, R + 14);
    } else if (this.focus === `fieldId:${f.fieldId}`) {
      this.drawFocusRing(ctx, f.x, f.y, R + 14);
    }
  }

  private drawFieldPatchFallback(ctx: CanvasRenderingContext2D, f: FlowerField, ratio: number, valid: boolean,
    winter: boolean, R: number): void {
    const fd = this.eng.w.flower(f.flower);
    const t = this.time;
    const n = 5 + f.level * 2;
    const r = new Rng(Number(f.fieldId.substring(1)) * 7919 + 13);
    ctx.fillStyle = 'rgba(70,120,45,0.35)';
    ctx.beginPath();
    ctx.ellipse(f.x, f.y + 4, R + 8, (R + 8) * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = valid ? 1 : 0.45;
    for (let i = 0; i < n; i++) {
      const a = r.range(0, Math.PI * 2);
      const d = Math.sqrt(r.next()) * R;
      const fx = f.x + Math.cos(a) * d;
      const fy = f.y + Math.sin(a) * d * 0.6;
      const show = r.next() < 0.35 + 0.65 * ratio;
      const sway = Math.sin(t * 1.6 + i) * 0.12;
      if (winter) {
        ctx.fillStyle = '#9C8F7A';
        ctx.beginPath();
        ctx.arc(fx, fy, 2.2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      if (fd.id === 'lavender') {
        drawSpike(ctx, fx, fy + 6, 21 + r.range(0, 7), show ? fd.petal : '#8E9A7A', sway);
      } else {
        const size = (fd.id === 'sunflower' ? 11 : 7.5) + r.range(0, 2.5);
        drawFlower(ctx, fx, fy, size, show ? fd.petal : '#C9C2A6', fd.center, fd.id === 'sunflower' ? 12 : 5, sway);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** 提示焦点：引导圈 + 点击手势（tutorial_ring / tutorial_hand） */
  private handDrawn: boolean = false;

  private drawFocusRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    const t = this.time;
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    const size = (r + pulse * 6) * 2.3;
    // 真机兼容模式使用完整脉冲圆，避免 C 形引导素材在空白图集上看起来像卡死的加载圈。
    if (!Sprites.atlasCropEnabled ||
      !Sprites.still(ctx, 'art/v1/tutorial_ring.webp', x, y, size, size, 0.6 + 0.4 * pulse)) {
      ctx.strokeStyle = `rgba(255,255,255,${0.5 + 0.5 * pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, r + pulse * 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.handDrawn) {
      return;
    }
    this.handDrawn = true;
    const hb = Math.sin(t * 4) * 4;
    Sprites.still(ctx, 'art/v1/tutorial_hand.webp', x + r * 0.7 + hb, y + r * 0.7 + hb, r * 1.5, r * 1.5, 1);
  }

  private drawFieldThreats(ctx: CanvasRenderingContext2D): void {
    const t = this.time;
    const eng = this.eng;
    const o = new DrawOpts();
    eng.threats.activeList().forEach((e: ThreatEvent) => {
      if (e.type === ThreatType.Wasp && e.phase === 'active') {
        const f = eng.w.field(e.targetId);
        if (f === null) {
          return;
        }
        const anchor = this.waspAnchor(e, f);
        const cx = anchor[0];
        const cy = anchor[1];
        const fighting = eng.w.active(Role.Guard) > 0;
        const boss = e.boss === true;
        const count = boss || e.raid === true ? 1 : 2;
        for (let i = 0; i < count; i++) {
          const a = t * (boss ? 0.9 : 1.8) + i * Math.PI;
          const px = cx + Math.cos(a) * (boss ? 12 : 30);
          const py = cy + Math.sin(a) * (boss ? 8 : 18);
          o.flip = Math.sin(a) > 0;
          const anim = (Math.floor(t * 0.7 + i) % 3 === 0) ? 'dash' : 'hover';
          if (!Sprites.draw(ctx, 'atlas_enemies_wasp', anim, t + i, px, py, boss ? 48 : 22, o)) {
            drawWasp(ctx, px, py, boss ? 2.8 : 1.3, a + Math.PI / 2, t * 50);
          }
          if (boss) this.drawCrown(ctx, px, py - 30);
        }
        this.drawHpBar(ctx, cx, cy - (boss ? 52 : 34), e.hp / e.maxHp);
        const g = Math.min(4, Math.ceil(eng.w.active(Role.Guard) / 3));
        for (let i = 0; i < g; i++) {
          const a = -t * 2.2 + i / Math.max(1, g) * Math.PI * 2;
          const gx = cx + Math.cos(a) * 44;
          const gy = cy + Math.sin(a) * 26;
          o.flip = Math.cos(a) > 0;
          const anim = Math.floor(t * 1.5 + i) % 2 === 0 ? 'attack' : 'dash';
          if (!Sprites.draw(ctx, 'atlas_bees_guard', anim, t + i * 0.25, gx, gy, 18, o)) {
            drawBee(ctx, gx, gy, 1, a - Math.PI / 2, t * 45, 'guard', false, true);
          }
        }
        if (fighting) {
          const po = new DrawOpts();
          po.full = true;
          const k = Math.floor(t * 2) % 3;
          Sprites.draw(ctx, 'atlas_combat', k === 0 ? 'impact' : (k === 1 ? 'dash' : 'shield'), t,
            cx + Math.cos(t * 3) * 14, cy + Math.sin(t * 2) * 10, 40, po);
        }
      }
      if (e.type === ThreatType.Bear && !e.settled && e.phase !== 'postponed') {
        const p = this.bearPos(e);
        let anim = 'approach';
        if (e.phase === 'active') {
          anim = Math.floor(t / 2.6) % 3 === 0 ? 'sniff' : 'swipe';
        } else if (e.endsAt - eng.run.time < 12) {
          anim = 'warning';
        }
        const bo = new DrawOpts();
        bo.align = 'bottom';
        if (!Sprites.draw(ctx, 'atlas_enemies_bear', anim, t, p[0], p[1] + 30, 64, bo)) {
          drawBear(ctx, p[0], p[1], 1.1, t);
        }
        if (e.phase === 'active') {
          this.drawHpBar(ctx, p[0], p[1] - 46, e.hp / e.maxHp);
          const po = new DrawOpts();
          po.full = true;
          Sprites.draw(ctx, 'atlas_combat', Math.floor(t * 2) % 2 === 0 ? 'impact' : 'hurt', t, p[0] - 20, p[1] - 10, 40,
            po);
          const activeGuards = eng.w.active(Role.Guard);
          const guards = activeGuards > 0 ? Math.min(4, Math.max(1, Math.ceil(activeGuards / 4))) : 0;
          for (let i = 0; i < guards; i++) {
            const a = -0.8 + i * 0.45 + Math.sin(t * 3 + i) * 0.12;
            const gx = p[0] - 32 + Math.cos(a) * 18;
            const gy = p[1] + 8 + Math.sin(a) * 24;
            o.flip = false;
            if (!Sprites.draw(ctx, 'atlas_bees_guard', Math.floor(t * 3 + i) % 2 === 0 ? 'attack' : 'dash',
              t + i * 0.2, gx, gy, 18, o)) {
              drawBee(ctx, gx, gy, 1, a, t * 45 + i, 'guard', false, true);
            }
          }
        }
      }
    });
  }

  /** 胡蜂王头上的小王冠 */
  private drawCrown(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.fillStyle = '#FFD54A';
    ctx.strokeStyle = '#8C5A00';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x - 10, y + 5);
    ctx.lineTo(x - 10, y - 3);
    ctx.lineTo(x - 5, y + 1);
    ctx.lineTo(x, y - 6);
    ctx.lineTo(x + 5, y + 1);
    ctx.lineTo(x + 10, y - 3);
    ctx.lineTo(x + 10, y + 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private drawHpBar(ctx: CanvasRenderingContext2D, x: number, y: number, ratio: number): void {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, x - 20, y, 40, 5, 2);
    ctx.fill();
    ctx.fillStyle = '#E74C3C';
    roundRect(ctx, x - 20, y, 40 * Math.max(0, Math.min(1, ratio)), 5, 2);
    ctx.fill();
  }

  /** 天气：图集粒子平铺在屏幕空间（雨 / 雪 / 落叶 / 干旱飞尘与热浪） */
  private drawWeather(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const s = this.eng.run.season.season;
    const theme = regionTheme(this.eng.w.region().id);
    let anim = '';
    if (s === SeasonId.Spring && this.eng.w.regionSeasonFly() < 0.95) {
      anim = 'rain';
    } else if (s === SeasonId.Winter) {
      anim = 'snow';
    } else if (s === SeasonId.Summer && theme === 'dryland') {
      anim = Math.floor(this.time / 8) % 2 === 0 ? 'heat' : 'dust';
    }
    if (anim.length === 0 || !this.particlesOn) {
      return;
    }
    const tile = 150;
    const drift = this.reduceMotion ? 0 : this.time;
    const vy = anim === 'rain' ? 160 : (anim === 'snow' ? 26 : (anim === 'leaves' ? 32 : 6));
    const vx = anim === 'rain' ? -30 : (anim === 'leaves' ? 12 : 4);
    const ox = ((drift * vx) % tile + tile) % tile;
    const oy = ((drift * vy) % tile + tile) % tile;
    const o = new DrawOpts();
    o.full = true;
    o.alpha = anim === 'rain' ? 0.6 : 0.85;
    ctx.save();
    for (let x = -tile + ox; x < w + tile; x += tile) {
      for (let y = -tile + oy; y < h + tile; y += tile) {
        if (!Sprites.draw(ctx, 'atlas_weather', anim, this.time, x + tile / 2, y + tile / 2, tile, o)) {
          ctx.restore();
          return;
        }
      }
    }
    ctx.restore();
  }

  /** 一次性特效。field：世界坐标；hivecell：q,r 换算；screen：比例坐标 */
  private drawShots(ctx: CanvasRenderingContext2D, view: string, w: number, ox: number, oy: number, h: number): void {
    const o = new DrawOpts();
    this.shots.forEach((s: OneShot) => {
      if (s.view !== view) {
        return;
      }
      o.alpha = Math.min(1, (s.dur - s.t) * 4);
      if (view === 'screen') {
        o.alpha = o.alpha * 0.9;
        Sprites.draw(ctx, s.atlas, s.anim, s.t, s.x * w, Math.max(s.y * h, 70), Math.min(s.size, w * 0.26), o);
      } else {
        Sprites.draw(ctx, s.atlas, s.anim, s.t, s.x + ox, s.y + oy, s.size, o);
      }
    });
  }

  // ------------------------------------------------------------ 飘字反馈（feedback_* 图标 + 数字条）
  private drawFloat(ctx: CanvasRenderingContext2D, tx: FloatText, k: number): void {
    const size = (tx.big ? 18 : 15) * k;
    if (tx.chip.length > 0 && this.drawChip(ctx, tx.chip, tx.text, tx.x, tx.y, size * 1.5)) {
      return;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(size, true);
    ctx.lineWidth = 3 * k;
    ctx.strokeStyle = 'rgba(60,35,5,0.7)';
    ctx.strokeText(tx.text, tx.x, tx.y);
    ctx.fillStyle = tx.color;
    ctx.fillText(tx.text, tx.x, tx.y);
  }

  /**
   * 反馈胶囊：左端（圆角 + 图标）裁自 feedback_<kind>，中段拉伸胶囊内部，
   * 数字使用 feedback_digits 数字条；符号、小数点与 K/M/B 由文字绘制（metadata/feedback.json）。
   */
  private drawChip(ctx: CanvasRenderingContext2D, kind: string, text: string, x: number, y: number, h: number): boolean {
    const path = `art/v1/feedback_${kind}.webp`;
    const digits = Sprites.image('art/v1/feedback_digits.webp');
    if (Sprites.image(path) === null || digits === null) {
      return false;
    }
    // 胶囊在 256 图内：x 14~242，y 78~172
    const v0 = 78 / 256;
    const v1 = 172 / 256;
    const scale = h / (94 / 256);
    const headW = (82 - 14) / 256 * scale;
    const tailW = (242 - 200) / 256 * scale;
    const digitW = 24 / 256 * scale * 0.82;
    let bodyW = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      bodyW += ch >= '0' && ch <= '9' ? digitW : h * 0.42;
    }
    const total = headW + bodyW + tailW;
    let cx = x - total / 2;
    const top = y - h / 2;
    Sprites.crop(ctx, path, 14 / 256, v0, 82 / 256, v1, cx, top, headW + 0.5, h);
    Sprites.crop(ctx, path, 120 / 256, v0, 128 / 256, v1, cx + headW, top, bodyW + 0.5, h);
    Sprites.crop(ctx, path, 200 / 256, v0, 242 / 256, v1, cx + headW + bodyW, top, tailW, h);
    cx += headW;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(h * 0.5, true);
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      if (ch >= '0' && ch <= '9') {
        const d = ch.charCodeAt(0) - 48;
        Sprites.crop(ctx, 'art/v1/feedback_digits.webp', (8 + 24 * d) / 256, 100 / 256, (32 + 24 * d) / 256, 138 / 256,
          cx, y - h * 0.24, digitW, h * 0.48);
        cx += digitW;
      } else {
        ctx.fillStyle = ch === '+' ? '#5E8C31' : (ch === '-' ? '#B5523B' : '#5A3E1B');
        ctx.fillText(ch, cx + h * 0.21, y + h * 0.02);
        cx += h * 0.42;
      }
    }
    return true;
  }

  // ------------------------------------------------------------ 巢内视图
  private skin(): SkinDef {
    const id = this.eng.state.meta.settings.skin;
    const skins = this.eng.w.cfg.skins;
    for (let i = 0; i < skins.length; i++) {
      if (skins[i].id === id) {
        return skins[i];
      }
    }
    return skins[0];
  }

  private visibleRing(): number {
    const run = this.eng.run;
    const canExpand = this.eng.w.unlocked('t_build_storage');
    return Math.min(this.eng.w.region().maxRing, run.hive.ringLevel + (canExpand ? 1 : 0));
  }

  private layoutHex(w: number, h: number): void {
    const vr = this.visibleRing();
    const span = (vr * 2 + 1);
    // 顶部信息栏占用的高度不放巢格，避免外圈被资源栏、提示行挡住
    const top = Math.max(0, Math.min(this.hudTop, h * 0.45));
    const avail = Math.max(120, h - top - 12);
    const fitted = Math.max(14, Math.min(w / (span * SQRT3 + 0.4), avail / (span * 1.5 + 1.2)) * 0.98);
    this.hexSize = fitted * this.hiveZoom;
    this.hexCx = w / 2 + this.hivePanX;
    this.hexCy = top + avail / 2 + this.hexSize * 0.2 + this.hivePanY;
  }

  cellX(c: HexCell): number {
    return this.hexCx + this.hexSize * SQRT3 * (c.q + c.r / 2);
  }

  cellY(c: HexCell): number {
    return this.hexCy + this.hexSize * 1.5 * c.r;
  }

  private qrX(q: number, r: number): number {
    return this.hexCx + this.hexSize * SQRT3 * (q + r / 2);
  }

  private qrY(r: number): number {
    return this.hexCy + this.hexSize * 1.5 * r;
  }

  hitCell(sx: number, sy: number, w: number, h: number): string {
    this.layoutHex(w, h);
    const px = (sx - this.hexCx) / this.hexSize;
    const py = (sy - this.hexCy) / this.hexSize;
    const qf = (SQRT3 / 3 * px - 1 / 3 * py);
    const rf = (2 / 3 * py);
    const sf = -qf - rf;
    let q = Math.round(qf);
    let r = Math.round(rf);
    const s = Math.round(sf);
    const dq = Math.abs(q - qf);
    const dr = Math.abs(r - rf);
    const ds = Math.abs(s - sf);
    if (dq > dr && dq > ds) {
      q = -r - s;
    } else if (dr > ds) {
      r = -q - s;
    }
    const id = `${q},${r}`;
    const c = this.eng.hive.cell(id);
    if (c === null || c.ring > this.visibleRing()) {
      return '';
    }
    return id;
  }

  /** 巢房动作状态（经典外观使用带动作的建筑图集） */
  private buildingState(c: HexCell): string {
    const eng = this.eng;
    const t = this.time;
    const b = c.building;
    if (b === Bld.Queen) {
      return t - this.lastEggAt < 1.6 ? 'lay' : 'idle';
    }
    if (b === Bld.Nursery) {
      const run = eng.run.colony.batches.filter((x: LarvaBatch) => x.started).length;
      if (run >= eng.colony.hatchSlots()) {
        return 'full';
      }
      return run > 0 ? 'hatch' : 'idle';
    }
    if (b === Bld.ScoutRoom) {
      return eng.run.map.scouts.some((a: ScoutAgent) => a.state !== 'idle' && a.state !== 'dance') ? 'dispatch' : 'idle';
    }
    if (b === Bld.ForagerRoom) {
      return eng.w.alloc.length > 0 ? 'transport' : 'idle';
    }
    if (b === Bld.Brewery) {
      const v = eng.rateView;
      if (v.waxIn > 0.01 && (v.honeyIn <= 0.05 || Math.floor(t / 4) % 2 === 1)) {
        return 'wax';
      }
      return v.honeyIn > 0.05 ? 'brew' : 'idle';
    }
    if (b === Bld.Storage) {
      if (eng.run.season.season === SeasonId.Winter) {
        return 'winter';
      }
      const f = eng.w.econ.fillRatio(Res.Honey);
      const ob = eng.run.overflow[Res.Honey];
      if (f >= 0.97 || (ob !== undefined && ob.toNumber() >= 1)) {
        return 'overflow';
      }
      return f < 0.12 ? 'empty' : (f < 0.6 ? 'half' : 'full');
    }
    if (b === Bld.GuardRoom) {
      const list = eng.threats.activeList();
      if (list.some((e: ThreatEvent) => e.phase === 'active') && eng.w.active(Role.Guard) > 0) {
        return 'attack';
      }
      return list.length > 0 ? 'alert' : 'idle';
    }
    if (b === Bld.Evolution) {
      if (t - this.lastResearchAt < 1.5) {
        return 'complete';
      }
      const lv = Object.keys(eng.run.research).length;
      return lv > 0 ? 'research' : 'inactive';
    }
    return 'idle';
  }

  /** 巢房上方的生产可视化（花蜜入库 / 酿成蜂蜜 / 分泌蜂蜡 / 蜂王浆） */
  private productionAnim(c: HexCell): string {
    const eng = this.eng;
    const v = eng.rateView;
    if (c.building === Bld.ForagerRoom && v.nectarIn > 0.05) {
      return 'production_nectar';
    }
    if (c.building === Bld.Brewery) {
      if (v.waxIn > 0.01 && Math.floor(this.time / 4) % 2 === 1) {
        return 'production_wax';
      }
      return v.honeyIn > 0.05 ? 'production_honey' : '';
    }
    if (c.building === Bld.Evolution && v.jellyIn > 0) {
      return 'production_jelly';
    }
    return '';
  }

  private focusCell(c: HexCell): boolean {
    const f = this.focus;
    if (f.length === 0) {
      return false;
    }
    if (f === 'hive') {
      return c.unlocked && c.building.length === 0 && c.ring === 1;
    }
    if (f === 'queen') {
      return c.building === Bld.Queen;
    }
    if (f === 'expand') {
      return !c.unlocked && this.eng.hive.canExpandCell(c);
    }
    if (f.startsWith('cell:')) {
      return c.cellId === f.substring(5);
    }
    if (f.startsWith('bld:')) {
      return c.building === f.substring(4);
    }
    return false;
  }

  drawHive(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const eng = this.eng;
    const skin = this.skin();
    const t = this.time;
    this.hiveShownAt = t;
    this.handDrawn = false;
    this.hiveSpots = [];
    this.layoutHex(w, h);
    const S = this.hexSize;
    const hexW = S * HEX_W;
    ctx.save();
    ctx.fillStyle = skin.bg;
    ctx.fillRect(0, 0, w, h);
    // 皮肤背景按“铺满”绘制一次（该图非无缝平铺图）
    const side = Math.max(w, h);
    Sprites.still(ctx, `art/v1/skin_background_${skin.id}.webp`, w / 2, h / 2, side, side, 0.4);
    const glow = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, Math.max(w, h) * 0.7);
    glow.addColorStop(0, 'rgba(255,200,90,0.30)');
    glow.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    const vr = this.visibleRing();
    const honeyFill = eng.w.econ.fillRatio(Res.Honey);
    const larvae = eng.run.colony.larvae;
    const running = eng.run.colony.batches.filter((b: LarvaBatch) => b.started);
    const classic = skin.id === 'classic';
    const skinAtlas = `atlas_skin_${skin.id}`;
    const ho = new DrawOpts();
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    eng.run.hive.cells.forEach((c: HexCell) => {
      if (c.ring > vr) {
        return;
      }
      const x = this.cellX(c);
      const y = this.cellY(c);
      ho.alpha = 1;
      if (!c.unlocked) {
        const can = eng.hive.canExpandCell(c);
        ho.alpha = can ? 0.95 : 0.4;
        if (!Sprites.draw(ctx, 'atlas_hex', can ? 'expand' : 'locked', 0, x, y, hexW * 0.94, ho)) {
          hexPath(ctx, x, y, S * 0.92);
          ctx.fillStyle = can ? 'rgba(255,240,200,0.10)' : 'rgba(255,255,255,0.04)';
          ctx.fill();
          if (can) {
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(255,230,170,0.6)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        if (can) {
          const cost = eng.hive.expandCost(c)[0].amount.toNumber();
          ctx.font = font(Math.max(9, S * 0.24), true);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(60,35,5,0.65)';
          ctx.strokeText(`${Math.ceil(cost)}蜡`, x, y + S * 0.55);
          ctx.fillStyle = '#FFF3D0';
          ctx.fillText(`${Math.ceil(cost)}蜡`, x, y + S * 0.55);
          if (this.focusCell(c)) {
            this.drawFocusRing(ctx, x, y, S * 0.8);
          }
        }
        return;
      }
      let drawn = false;
      if (c.building.length > 0) {
        drawn = classic ?
          Sprites.draw(ctx, buildingAtlas(c.building), this.buildingState(c), t + (c.q * 0.31 + c.r * 0.17), x, y,
            hexW * 0.96, ho) :
          Sprites.draw(ctx, skinAtlas, buildingSkinFrame(c.building), 0, x, y, hexW * 0.96, ho);
      } else {
        const placingHere = this.placing.length > 0;
        ho.alpha = placingHere ? 0.75 + 0.25 * pulse : 1;
        drawn = Sprites.draw(ctx, 'atlas_hex', 'empty', 0, x, y, hexW * 0.94, ho);
        ho.alpha = 1;
      }
      if (!drawn) {
        const g = ctx.createLinearGradient(x, y - S, x, y + S);
        g.addColorStop(0, '#FFE39A');
        g.addColorStop(1, skin.cellFill);
        hexPath(ctx, x, y, S * 0.94);
        ctx.fillStyle = c.building.length > 0 ? g : 'rgba(255,226,150,0.35)';
        ctx.fill();
        ctx.strokeStyle = skin.cellStroke;
        ctx.lineWidth = Math.max(1.5, S * 0.08);
        ctx.stroke();
        // 蜂后由下面的动态实体层单独绘制，避免兼容渲染时与房间图标叠成两只蜂。
        // 育幼房存在卵或幼虫时也让动态内容接管中心区域。
        const hasDynamicNurseryContent = c.building === Bld.Nursery && (larvae > 0 || running.length > 0);
        if (c.building.length > 0 && c.building !== Bld.Queen && !hasDynamicNurseryContent) {
          drawBuildingIcon(ctx, c.building, x, y, S * 0.62, honeyFill, t);
        }
      }
      // 蜡螟啃食的储蜜格显示裂痕
      if (eng.w.mothActive && c.building === Bld.Storage) {
        ho.alpha = 0.85;
        Sprites.draw(ctx, 'atlas_hex', 'damaged', 0, x, y, hexW * 0.94, ho);
        ho.alpha = 1;
      }
      // 生产可视化
      const prod = c.building.length > 0 ? this.productionAnim(c) : '';
      if (prod.length > 0 && this.particlesOn) {
        Sprites.draw(ctx, 'atlas_production', prod, t + c.q, x + S * 0.45, y - S * 0.45, S * 0.5, ho);
      }
      // 蜂后坐在蜂后室
      if (c.building === Bld.Queen) {
        this.drawQueen(ctx, x, y, S);
      }
      // 卵 / 幼虫 / 破壳
      if ((c.building === Bld.Queen || c.building === Bld.Nursery) && (larvae > 0 || running.length > 0)) {
        this.drawLarvae(ctx, c, x, y, S, larvae, running);
      }
      // 孵化进度
      if (c.building === Bld.Queen && running.length > 0) {
        const b = running[0];
        const p = Math.max(0, Math.min(1, (eng.run.time - b.startAt) / Math.max(0.1, b.finishAt - b.startAt)));
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = Math.max(2, S * 0.07);
        ctx.beginPath();
        ctx.arc(x, y, S * 0.8, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
        ctx.stroke();
      }
      const selected = c.cellId === this.selectedCell;
      const placeable = this.placing.length > 0 && c.building.length === 0;
      if (selected) {
        // 选中只描边，不盖住巢房图标
        hexPath(ctx, x, y, S * 0.97);
        ctx.save();
        ctx.shadowColor = 'rgba(255,214,90,0.95)';
        ctx.shadowBlur = Math.max(6, S * 0.35);
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = Math.max(2.5, S * 0.1);
        ctx.stroke();
        ctx.restore();
      } else if (placeable) {
        ho.alpha = 0.55 + 0.45 * pulse;
        if (!Sprites.draw(ctx, 'atlas_hex', 'selected', 0, x, y, hexW * 0.98, ho)) {
          hexPath(ctx, x, y, S * 0.96);
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = Math.max(2.5, S * 0.11);
          ctx.stroke();
        }
        ho.alpha = 1;
      }
      if (selected) {
        eng.hive.neighbors(c).forEach((n: HexCell) => {
          if (n.ring > vr) {
            return;
          }
          hexPath(ctx, this.cellX(n), this.cellY(n), S * 0.9);
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
      }
      if (this.focusCell(c) || placeable) {
        this.drawFocusRing(ctx, x, y, S * 0.8);
      }
      // 放置预览：在空格上写出放在这里能拿到的相邻加成
      if (placeable) {
        const bonus = eng.hive.previewAdjacency(c, this.placing);
        if (bonus.length > 0) {
          ctx.font = font(Math.max(10, S * 0.24), true);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(20,60,20,0.75)';
          ctx.strokeText(bonus, x, y);
          ctx.fillStyle = '#B8F5A0';
          ctx.fillText(bonus, x, y);
        }
      }
    });
    // 摇摆舞：8 字舞路径
    const qc = eng.hive.cell('0,0');
    if (qc !== null) {
      const qx = this.cellX(qc);
      const qy = this.cellY(qc);
      const o = new DrawOpts();
      this.dancers.forEach((d: Dancer) => {
        const u = d.t * 2.4;
        const px = qx + Math.sin(u) * S * 0.9;
        const py = qy + Math.sin(u * 2) * S * 0.35 - S * 1.05;
        o.flip = Math.cos(u) < 0;
        if (!Sprites.draw(ctx, 'atlas_bees_scout', 'dance', d.t, px, py, S * 0.55, o)) {
          const ang = Math.atan2(Math.cos(u * 2) * 0.7, Math.cos(u));
          drawBee(ctx, px, py, S / 22, ang, t * 60, 'scout', false, true);
        }
      });
    }
    this.drawHouseBees(ctx, S);
    this.drawGuardsInHive(ctx, S);
    // 蜡螟
    const stores = eng.run.hive.cells.filter((c: HexCell) => c.building === Bld.Storage);
    if (eng.w.mothActive && stores.length > 0) {
      const c = stores[0];
      const mx = this.cellX(c) + Math.sin(t * 2) * S * 0.3;
      const my = this.cellY(c) + Math.cos(t * 1.5) * S * 0.2;
      const mo = new DrawOpts();
      mo.flip = Math.cos(t * 2) < 0;
      if (!Sprites.draw(ctx, 'atlas_enemies_moth', Math.floor(t / 3) % 2 === 0 ? 'nibble' : 'sneak', t, mx, my, S * 0.6,
        mo)) {
        drawMoth(ctx, mx, my, S / 16, t * 10);
      }
      const defending = eng.threats.guardsByArea['gate'] !== undefined && eng.threats.guardsByArea['gate'] > 0;
      if (defending) {
        for (let i = 0; i < 2; i++) {
          const a = -t * 2.8 + i * Math.PI;
          mo.flip = Math.cos(a) > 0;
          Sprites.draw(ctx, 'atlas_bees_guard', 'attack', t + i * 0.25,
            mx + Math.cos(a) * S * 0.75, my + Math.sin(a) * S * 0.45, S * 0.42, mo);
        }
        const co = new DrawOpts(); co.full = true;
        Sprites.draw(ctx, 'atlas_combat', Math.floor(t * 3) % 2 === 0 ? 'impact' : 'shield', t, mx, my, S * 0.9, co);
      }
    }
    // 熊
    const bear = eng.threats.pendingBear();
    if (bear !== null && bear.phase !== 'postponed') {
      const bx = w - S * 1.4;
      const by = h - S * 0.4;
      const bo = new DrawOpts();
      bo.align = 'bottom';
      const anim = bear.phase === 'warning' ? 'warning' : 'swipe';
      if (!Sprites.draw(ctx, 'atlas_enemies_bear', anim, t, bx, by, S * 2.2, bo)) {
        drawBear(ctx, bx, by - S * 1.2, S / 22, t);
      }
      if (bear.phase === 'active' && eng.w.active(Role.Guard) > 0) {
        const count = Math.min(3, Math.max(1, Math.ceil(eng.w.active(Role.Guard) / 4)));
        for (let i = 0; i < count; i++) {
          const gx = bx - S * (1.2 + i * 0.45);
          const gy = by - S * (0.6 + (i % 2) * 0.35);
          bo.flip = false;
          Sprites.draw(ctx, 'atlas_bees_guard', Math.floor(t * 3 + i) % 2 === 0 ? 'attack' : 'dash',
            t + i * 0.2, gx, gy, S * 0.45, bo);
        }
        const co = new DrawOpts(); co.full = true;
        Sprites.draw(ctx, 'atlas_combat', Math.floor(t * 2) % 2 === 0 ? 'impact' : 'shield', t,
          bx - S * 0.9, by - S * 0.8, S * 0.9, co);
      }
      ctx.fillStyle = 'rgba(200,40,30,0.95)';
      ctx.font = font(13, true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(bear.phase === 'warning' ? '熊接近中' : '熊袭击中', bx, by - S * 2.7);
    }
    // 一次性特效（六边形坐标）
    const o2 = new DrawOpts();
    this.shots.forEach((s: OneShot) => {
      if (s.view !== 'hivecell') {
        return;
      }
      o2.alpha = Math.min(1, (s.dur - s.t) * 4);
      Sprites.draw(ctx, s.atlas, s.anim, s.t, this.qrX(s.x, s.y), this.qrY(s.y), s.size * S, o2);
    });
    // 粒子/飘字（巢内坐标 q,r → 屏幕）
    this.particles.forEach((p: Particle) => {
      if (p.view !== 'hivecell') {
        return;
      }
      const x = this.qrX(p.x, p.y);
      const y = this.qrY(p.y);
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    this.texts.forEach((tx: FloatText) => {
      if (tx.view !== 'hive') {
        return;
      }
      const ft = new FloatText();
      ft.x = this.qrX(tx.x, tx.y);
      ft.y = this.qrY(tx.y) - (1.1 - tx.life) * 8;
      ft.text = tx.text;
      ft.color = tx.color;
      ft.big = tx.big;
      ft.chip = tx.chip;
      ctx.globalAlpha = Math.min(1, tx.life * 2);
      this.drawFloat(ctx, ft, 0.95);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
    this.drawShots(ctx, 'screen', w, 0, 0, h);
  }

  private drawQueen(ctx: CanvasRenderingContext2D, x: number, y: number, S: number): void {
    const eng = this.eng;
    const t = this.time;
    let anim = 'idle';
    if (t - this.lastEggAt < 1.4) {
      anim = 'lay';
    } else if (eng.threats.activeList().some((e: ThreatEvent) => e.phase === 'active')) {
      anim = 'startled';
    } else if (t - this.lastCheerAt < 3) {
      anim = 'celebrate';
    } else if (Math.floor(t / 7) % 3 === 2) {
      anim = 'patrol';
    }
    const o = new DrawOpts();
    o.align = 'bottom';
    if (!Sprites.draw(ctx, 'atlas_bees_queen', anim, t, x, y + S * 0.62, S * 0.78, o)) {
      drawBee(ctx, x, y + S * 0.06, S / 32, -Math.PI / 2, t * 28, 'queen', false, true);
    }
  }

  private drawLarvae(ctx: CanvasRenderingContext2D, c: HexCell, x: number, y: number, S: number, larvae: number,
    running: LarvaBatch[]): void {
    const eng = this.eng;
    const t = this.time;
    const isQueen = c.building === Bld.Queen;
    const eggs = isQueen ? Math.min(2, larvae) : Math.min(3, Math.max(0, larvae - 2));
    const hatching = isQueen ? 0 : Math.min(2, running.length);
    const n = eggs + hatching;
    if (n === 0) {
      return;
    }
    const o = new DrawOpts();
    o.align = 'bottom';
    for (let i = 0; i < n; i++) {
      const a = (isQueen ? Math.PI * 0.75 : Math.PI * 0.55) + i * 0.9;
      const px = x + Math.cos(a) * S * 0.62;
      const py = y + Math.sin(a) * S * 0.55 + S * 0.18;
      let anim = 'egg';
      if (i >= eggs) {
        const b = running[i - eggs];
        const p = (eng.run.time - b.startAt) / Math.max(0.1, b.finishAt - b.startAt);
        anim = p > 0.85 ? 'shell' : 'larva';
      } else if (larvae > 0 && i > 0) {
        anim = 'larva';
      }
      if (!Sprites.draw(ctx, 'atlas_bees_larva', anim, t + i * 0.4, px, py, S * 0.34, o)) {
        ctx.fillStyle = '#FFFBEA';
        ctx.beginPath();
        ctx.ellipse(px, py - S * 0.06, S * 0.12, S * 0.08, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** 巢内工蜂：在酿蜜房与储蜜格之间搬运；停在酿蜜房时酿蜜/筑蜡 */
  private drawHouseBees(ctx: CanvasRenderingContext2D, S: number): void {
    const eng = this.eng;
    const t = this.time;
    const houseVis = Math.min(12, eng.w.active(Role.House));
    const brews = eng.run.hive.cells.filter((c: HexCell) => c.building === Bld.Brewery);
    const stores = eng.run.hive.cells.filter((c: HexCell) => c.building === Bld.Storage);
    if (houseVis <= 0 || brews.length === 0) {
      return;
    }
    const waxing = eng.rateView.waxIn > 0.01;
    const o = new DrawOpts();
    for (let i = 0; i < houseVis; i++) {
      const a = brews[i % brews.length];
      const b = stores.length > 0 ? stores[i % stores.length] : a;
      const ph = Math.sin(t * 0.8 + i * 1.7);
      const u = (ph + 1) / 2;
      const px = this.cellX(a) * (1 - u) + this.cellX(b) * u + Math.sin(t * 3 + i) * S * 0.2;
      const py = this.cellY(a) * (1 - u) + this.cellY(b) * u + Math.cos(t * 2 + i) * S * 0.2 + S * 0.25;
      let anim = 'carry';
      if (u < 0.12) {
        anim = waxing && i % 3 === 0 ? 'wax' : 'brew';
      } else if (u > 0.9) {
        anim = 'idle';
      }
      o.flip = Math.cos(t * 0.8 + i * 1.7) < 0;
      const houseId = this.beeIdAt(Role.House, i);
      this.addHiveSpot(ctx, px, py, houseId, S);
      const houseBased = Sprites.draw(ctx, 'atlas_bees_house', anim, t + i * 0.3, px, py, S * 0.42, o);
      if (!houseBased) drawBee(ctx, px, py, S / 34, o.flip ? Math.PI : 0, t * 50 + i, 'house', false, S > 26);
      this.drawStarBee(ctx, 'house', houseId, anim, t + i * 0.3, px, py, S * 0.42, o, houseBased);
    }
  }

  private addHiveSpot(ctx: CanvasRenderingContext2D, x: number, y: number, id: number, S: number): void {
    if (id < 0) return;
    const p = new HiveSpot();
    p.x = x;
    p.y = y;
    p.id = id;
    this.hiveSpots.push(p);
    if (id === this.highlight) {
      ctx.strokeStyle = '#FFD54A';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, S * 0.36 + Math.sin(this.time * 6) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** 守卫蜂：守卫巢房旁巡逻；出现敌害时警戒 */
  private drawGuardsInHive(ctx: CanvasRenderingContext2D, S: number): void {
    const eng = this.eng;
    const t = this.time;
    const g = this.firstCellOf(Bld.GuardRoom);
    const n = Math.min(3, eng.w.active(Role.Guard));
    if (g === null || n <= 0) {
      return;
    }
    const alert = eng.threats.activeList().length > 0;
    const o = new DrawOpts();
    for (let i = 0; i < n; i++) {
      const a = t * 0.6 + i * 2.1;
      o.flip = Math.cos(a) < 0;
      const px = this.cellX(g) + Math.cos(a) * S * 0.9;
      const py = this.cellY(g) + Math.sin(a) * S * 0.5 + S * 0.3;
      const guardId = this.beeIdAt(Role.Guard, i);
      this.addHiveSpot(ctx, px, py, guardId, S);
      const guardAnim = alert ? (eng.w.mothActive ? 'attack' : 'alert') : 'patrol';
      const guardBased = Sprites.draw(ctx, 'atlas_bees_guard', guardAnim, t + i * 0.3, px, py, S * 0.42, o);
      if (!guardBased) drawBee(ctx, px, py, S / 34, a + Math.PI / 2, t * 50 + i, 'guard', false, S > 26);
      this.drawStarBee(ctx, 'guard', guardId, guardAnim, t + i * 0.3, px, py, S * 0.42, o, guardBased);
    }
  }

  /** 横幅类表现（季节切换、里程碑），由 UI 层以 ArkUI 呈现 */
  takeBanners(): string[] {
    const out: string[] = [];
    for (let i = this.texts.length - 1; i >= 0; i--) {
      if (this.texts[i].view === 'banner') {
        out.push(this.texts[i].text);
        this.texts.splice(i, 1);
      }
    }
    return out;
  }
}
