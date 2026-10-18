import { formatBig, formatDuration } from '../../common/BigNum';
import { Bld, ForageStrategy, GuardPriority, Res, Role } from '../../domain/Types';
import type { CmdResult, CostAmount } from '../../domain/World';
import { GameSession, PRIVACY_VERSION, seasonName } from '../GameSession';
import { HELP_TEXT, PRIVACY_FULL, PRIVACY_SUMMARY, AGREEMENT_FULL } from '../content';
import { grantBearAid, grantOfflineDouble, grantWinterSupply, winterSupplyWanted } from '../ads/AdRewards';

interface Button { x: number; y: number; w: number; h: number; run: () => void; enabled: boolean; }
export interface CanvasSurface { width: number; height: number; getContext(kind: '2d'): CanvasRenderingContext2D | null; }
export interface Viewport { width: number; height: number; pixelRatio: number; top: number; bottom: number; }

/** 无 DOM 的触控界面。与浏览器端共用会话、规则、场景、存档和广告事务。 */
export class CanvasUI {
  private buttons: Button[] = [];
  private view = 'field';
  private panel = '';
  private page = 0;
  private selected = '';
  private field = '';
  private placing = '';
  private intro = '';
  private toast = '';
  private toastUntil = 0;
  private confirm: (() => void) | null = null;
  private confirmText = '';
  private down: { x: number; y: number; moved: boolean } | null = null;
  private holdField = '';
  private nextHold = 0;
  private held = false;
  private lastTapAt = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  private ctx: CanvasRenderingContext2D;
  private width = 360;
  private height = 640;
  private top = 0;
  private bottom = 0;

  constructor(private surface: CanvasSurface, readonly session: GameSession, viewport: Viewport) {
    const ctx = surface.getContext('2d');
    if (ctx === null) throw new Error('当前设备不支持 Canvas 2D');
    this.ctx = ctx;
    this.resize(viewport);
    session.addDrawer('canvas', () => this.draw());
    session.setAudioContext('game', this.view);
  }

  resize(v: Viewport): void {
    this.width = v.width; this.height = v.height; this.top = v.top; this.bottom = v.bottom;
    const ratio = Math.max(1, Math.min(2, v.pixelRatio));
    this.surface.width = Math.round(v.width * ratio);
    this.surface.height = Math.round(v.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.session.renderer?.fitDefault(this.width, this.sceneHeight());
  }

  private roleRows(): string[] {
    if (!this.session.ready) return [];
    const e = this.session.engine();
    const efficiency: Record<string, string> = {
      [Role.Forager]: `运蜜${e.rateView.nectarIn.toFixed(1)}/秒`,
      [Role.House]: `酿蜜产能${e.prod.brewCapacity().toFixed(1)}/秒`,
      [Role.Scout]: `发现效率${e.w.attrs.get('scout.discovery').toFixed(1)}倍`,
      [Role.Guard]: `攻击效率${e.w.attrs.get('guard.attack').toFixed(1)}倍`
    };
    return e.w.cfg.roles.filter((r) => e.w.role(r.id) > 0 || e.w.count(r.building) > 0).map((r) => {
      const level = e.w.cfg.tracks.filter((t) => t.building === r.building).reduce((n, t) => n + e.hive.trackLevel(t.id), 0);
      return `${r.name}${e.w.role(r.id)}只 · Lv${level} · ${efficiency[r.id]}`;
    });
  }
  private hintText(): string {
    if (!this.session.ready) return '';
    return this.placing ? `点空格放置${this.session.engine().w.bldDef(this.placing).name}，点此行取消` : this.session.guide().hints(1)[0]?.text || '';
  }
  private footerHeight(): number {
    this.ctx.font = '12px sans-serif';
    let lines = 1, current = '';
    for (const ch of this.hintText()) {
      if (this.ctx.measureText(current + ch).width > this.width - 24) { lines++; current = ch; }
      else current += ch;
    }
    return Math.max(40, lines * 20 + 14);
  }
  private sceneTop(): number { return this.top + 146 + this.roleRows().length * 18; }
  private sceneHeight(): number { return Math.max(40, this.height - this.sceneTop() - this.bottom - 54 - this.footerHeight()); }
  private text(text: string, x: number, y: number, size = 14, color = '#45301c'): void {
    this.ctx.fillStyle = color; this.ctx.font = `${size}px sans-serif`;
    this.ctx.textAlign = 'left'; this.ctx.textBaseline = 'top'; this.ctx.fillText(text, x, y);
  }
  private wrap(text: string, x: number, y: number, max: number, size = 14): number {
    let line = ''; let row = y;
    for (const ch of text) {
      this.ctx.font = `${size}px sans-serif`;
      if (ch === '\n' || this.ctx.measureText(line + ch).width > max) {
        this.text(line, x, row, size); row += size + 8; line = ch === '\n' ? '' : ch;
      } else line += ch;
    }
    if (line) { this.text(line, x, row, size); row += size + 8; }
    return row;
  }
  private box(x: number, y: number, w: number, h: number, fill: string): void {
    this.ctx.fillStyle = fill; this.ctx.fillRect(x, y, w, h);
  }
  private button(label: string, x: number, y: number, w: number, run: () => void, enabled = true, height = 42): void {
    this.box(x, y, w, height, enabled ? '#efbf47' : '#d6d0b7');
    this.ctx.save(); this.ctx.beginPath(); this.ctx.rect(x + 4, y, w - 8, height); this.ctx.clip();
    this.text(label, x + 10, y + 13, 14, enabled ? '#3b2a14' : '#746d5b'); this.ctx.restore();
    this.buttons.push({ x, y, w, h: height, run, enabled });
  }
  private cost(costs: CostAmount[]): string {
    const names: Record<string, string> = { honey: '蜂蜜', wax: '蜂蜡', jelly: '蜂王浆', nectar: '花蜜' };
    return costs.map((c) => `${names[c.res] || c.res}${Math.ceil(c.amount.toNumber())}`).join(' / ');
  }
  private result(r: CmdResult): void { this.notice(r.message || (r.ok ? '完成' : '暂时无法操作')); }
  private notice(text: string): void { this.toast = text; this.toastUntil = Date.now() + 3000; }
  private open(panel: string): void { this.panel = panel; this.page = 0; }
  private ask(text: string, run: () => void): void { this.confirmText = text; this.confirm = run; }

  draw(): void {
    const c = this.ctx, s = this.session;
    this.buttons = [];
    c.clearRect(0, 0, this.width, this.height);
    this.box(0, 0, this.width, this.height, '#f4e4ac');
    if (!s.ready || s.status === 'error') {
      this.wrap(s.bootError || '正在准备蜂巢…', 20, this.top + 100, this.width - 40); return;
    }
    const e = s.engine(), settings = e.state.meta.settings;
    if (!settings.privacyAccepted || settings.privacyVersion !== PRIVACY_VERSION) { this.drawPrivacy(); return; }
    if (this.down && !this.down.moved && this.holdField && Date.now() >= this.nextHold) {
      e.collect(this.holdField, 1); this.held = true;
      this.nextHold = Date.now() + 1000 / e.w.cfg.economy.holdCollectPerSec;
    }
    this.text('小峰大业', 14, this.top + 12, 21);
    this.text(`${seasonName(e.run.season.season)}  蜂群 ${e.w.population()}/${e.w.popCap()}`, 14, this.top + 43);
    this.text(`花蜜 ${formatBig(e.w.econ.amount(Res.Nectar))}   蜂蜜 ${formatBig(e.w.econ.amount(Res.Honey))}`, 14, this.top + 68, 16);
    const capacity = e.prod.baseConvertCapacity() + e.prod.brewCapacity();
    const load = capacity > 0 ? Math.min(1, e.rateView.nectarUse / capacity) : 0;
    this.text(`采蜜 +${(e.rateView.nectarIn + e.rateView.manualIn).toFixed(1)}/秒 → 蜂蜜 +${e.rateView.honeyIn.toFixed(1)}/秒`, 14, this.top + 94, 12);
    this.text(`酿蜜 ${e.rateView.nectarUse.toFixed(1)}/${capacity.toFixed(1)} 花蜜/秒 · 负荷${Math.round(load * 100)}%`, 14, this.top + 112, 12);
    this.box(14, this.top + 131, this.width - 28, 5, '#d6c48d');
    this.box(14, this.top + 131, (this.width - 28) * load, 5, '#b77a19');
    this.roleRows().forEach((line, i) => this.text(line, 14, this.top + 143 + i * 18, 12));
    const renderer = s.renderer!;
    renderer.selectedCell = this.selected; renderer.selectedField = this.field; renderer.placing = this.placing;
    c.save(); c.translate(0, this.sceneTop());
    c.beginPath(); c.rect(0, 0, this.width, this.sceneHeight()); c.clip();
    if (this.view === 'field') renderer.drawField(c, this.width, this.sceneHeight());
    else renderer.drawHive(c, this.width, this.sceneHeight());
    c.restore();
    const y = this.height - this.bottom - this.footerHeight() - 54;
    const nav = [['field', '花田'], ['hive', '蜂巢'], ['queen', '繁育'], ['build', '建造'], ['more', '管理']];
    nav.forEach(([id, name], i) => this.button(name, 6 + i * this.width / 5, y, this.width / 5 - 10, () => {
      if (id === 'field' || id === 'hive') { this.view = id; this.panel = ''; if (id === 'field') this.placing = ''; }
      else this.open(id);
      s.setAudioContext('game', this.view);
    }));
    const hint = s.guide().hints(1)[0];
    if (hint) {
      this.box(0, y + 48, this.width, this.footerHeight(), '#fff5d3');
      this.wrap(this.hintText(), 12, y + 54, this.width - 24, 12);
      this.buttons.push({ x: 0, y: y + 48, w: this.width, h: this.footerHeight(), enabled: true, run: () => { if (this.placing) this.placing = ''; else this.followHint(hint.action); } });
    }
    if (!this.intro && !s.pendingOffline && !this.placing && (!this.panel || e.state.meta.tutorialDone && !s.guide().seen('handover'))) {
      this.intro = s.guide().pendingIntro()?.id || '';
    }
    if (this.panel) this.drawPanel();
    if (s.pendingOffline) this.drawOffline();
    if (this.intro) this.drawIntro();
    if (this.confirm) this.drawConfirm();
    if (this.toast && Date.now() < this.toastUntil) {
      this.box(10, this.top + 6, this.width - 20, 62, '#fff5d3'); this.wrap(this.toast, 20, this.top + 15, this.width - 40, 13);
    }
  }

  private followHint(action: string): void {
    if (action === 'queen') this.open('queen');
    else if (action.startsWith('build:')) { this.placing = action.slice(6); this.view = 'hive'; this.panel = ''; }
    else if (action.startsWith('intro:')) this.intro = action.slice(6);
    else if (action.startsWith('upgrade:')) { this.selected = this.session.engine().run.hive.cells.find((c) => c.building === action.slice(8))?.cellId || ''; this.open('cell'); }
    else if (action.startsWith('panel:')) this.open(action.slice(6));
    else if (action.includes('@hive')) { this.view = 'hive'; this.panel = ''; }
    else { this.view = 'field'; this.panel = ''; }
  }

  private sheet(title: string, closable = true): number {
    // 隔离底层命中区域，防止弹层点击穿透到地图或底栏。
    this.buttons = [];
    this.box(8, this.top + 5, this.width - 16, this.height - this.top - this.bottom - 12, '#fff6d7');
    this.text(title, 22, this.top + 20, 20);
    if (closable) this.button('关闭', this.width - 84, this.top + 12, 62, () => { this.panel = ''; });
    return this.top + 72;
  }
  private rows(title: string, rows: Array<{ title: string; detail?: string; action?: () => void; enabled?: boolean }>): void {
    const y = this.sheet(title), size = Math.max(1, Math.floor((this.height - y - this.bottom - 76) / 85));
    const lastPage = Math.max(0, Math.ceil(rows.length / size) - 1);
    this.page = Math.max(0, Math.min(this.page, lastPage));
    rows.slice(this.page * size, (this.page + 1) * size).forEach((r, i) => {
      const ry = y + i * 85;
      this.wrap(r.title, 22, ry, this.width - 44, 14);
      if (r.detail) this.wrap(r.detail, 22, ry + 23, this.width - (r.action ? 112 : 44), 12);
      if (r.action) this.button('选择', this.width - 84, ry + 38, 62, r.action, r.enabled !== false, 36);
    });
    if (lastPage > 0) {
      const by = this.height - this.bottom - 62;
      this.button('上一页', 22, by, 95, () => { this.page--; }, this.page > 0);
      this.text(`${this.page + 1}/${lastPage + 1}`, this.width / 2 - 12, by + 14);
      this.button('下一页', this.width - 117, by, 95, () => { this.page++; }, this.page < lastPage);
    }
  }

  private drawPanel(): void {
    const e = this.session.engine(), s = this.session;
    type Row = { title: string; detail?: string; action?: () => void; enabled?: boolean };
    const rows: Row[] = [];
    const push = (title: string, action?: () => void, detail?: string, enabled = true): void => { rows.push({ title, action, detail, enabled }); };
    if (this.panel === 'queen') {
      push(`孵化新卵 · 幼虫 ${e.run.colony.larvae}`, () => this.result(e.lay()), this.cost(e.colony.eggCost()), e.colony.canLay().ok);
      e.w.cfg.roles.forEach((r) => {
        push(`${r.name} ${e.w.role(r.id)}只 · 分化1只`, () => this.result(e.differentiate(r.id, 1)),
          e.colony.roleAvailable(r.id) ? `${this.cost(e.colony.roleCost(r.id))}，${Math.ceil(e.colony.hatchTime(r.id))}秒` : `需要${e.w.bldDef(r.building).name}`,
          e.colony.roleAvailable(r.id) && e.run.colony.larvae > 0 && e.w.econ.canAfford(e.colony.roleCost(r.id)));
      });
      e.run.colony.batches.forEach((b) => push(`${e.w.roleDef(b.targetRole).name} · ${b.started ? formatDuration(b.finishAt - e.run.time) : '排队中'}`,
        () => this.ask('取消分化？进行中的分化返还一半费用。', () => this.result(e.cancelBatch(b.batchId))), '取消分化'));
    } else if (this.panel === 'build') {
      if (e.w.unlocked('t_build_storage')) {
        const next = e.run.hive.cells.filter((c) => e.hive.canExpandCell(c)).sort((a, b) => a.ring - b.ring)[0];
        if (next) push('扩建一格', () => this.result(e.expand(next.cellId)), this.cost(e.hive.expandCost(next)), e.w.econ.canAfford(e.hive.expandCost(next)));
      }
      e.w.cfg.buildings.filter((b) => b.id !== Bld.Queen).forEach((b) => {
        const available = e.hive.buildingAvailable(b.id);
        const task = e.prog.taskDef(b.unlockTask);
        push(b.name, () => { this.placing = b.id; this.view = 'hive'; this.panel = ''; },
          available ? this.cost(e.hive.buildCost(b.id)) : `完成${task?.name || '前置条件'}后开放`, available && e.w.econ.canAfford(e.hive.buildCost(b.id)));
      });
    } else if (this.panel === 'cell') {
      const cell = e.run.hive.cells.find((c) => c.cellId === this.selected);
      if (cell) {
        if (!cell.unlocked) push('扩建此格', () => this.result(e.expand(cell.cellId)), this.cost(e.hive.expandCost(cell)));
        else if (!cell.building) push('选择要建造的巢房', () => this.open('build'));
        else {
          if (cell.building === Bld.Queen) push('手动孵化与分化', () => this.open('queen'));
          e.w.cfg.tracks.filter((t) => t.building === cell.building).forEach((t) => {
            const lv = e.hive.trackLevel(t.id);
            push(`${t.name} Lv${lv}/${t.maxLevel}`, () => this.result(e.upgrade(t.id)), this.cost(e.hive.upgradeCost(t)), lv < t.maxLevel && e.w.econ.canAfford(e.hive.upgradeCost(t)));
          });
          if (cell.building !== Bld.Queen) push('拆除此巢房', () => this.ask('确认拆除？部分建筑材料将返还。', () => { this.result(e.demolish(cell.cellId)); this.panel = ''; }));
        }
      }
    } else if (this.panel === 'field') {
      const f = e.w.field(this.field);
      if (f) {
        push(e.w.flower(f.flower).name, () => this.result(e.collect(f.fieldId, 1)), `库存${Math.floor(f.stock)}/${Math.floor(e.map.maxStock(f))} · 恢复${Math.ceil(e.map.recoveryRemaining(f))}秒`);
        const poll = e.run.colony.pollinators[f.fieldId] || 0;
        push(`授粉驻守 ${poll}只 · 增加1只`, () => this.result(e.setPollinators(f.fieldId, poll + 1)));
        push('减少1只驻守', () => this.result(e.setPollinators(f.fieldId, Math.max(0, poll - 1))));
      }
    } else if (this.panel === 'more') {
      push(`花潮加速 · 当前${s.ads.boostSpeed()}倍`, () => this.open('boost'));
      [['colony', '蜂群分工'], ['fields', '花源与侦察'], ['tasks', '任务'], ['resources', '资源与溢出'], ['eco', '四季与敌害'], ['research', '研究'], ['swarm', '分蜂'], ['talents', '蜂王传承'], ['codex', '图鉴与消息'], ['settings', '设置与存档'], ['help', '玩法帮助'], ['privacy', '隐私政策'], ['agreement', '用户协议']]
        .forEach(([id, name]) => push(name, () => this.open(id)));
    } else if (this.panel === 'boost') {
      push('观看1个广告，开启2倍加速', () => { void s.ads.watch('flower_boost', 1, () => s.ads.applyBoost(2)).then((r) => this.notice(r.message || '已开启2倍加速')); }, '可选；没有广告时不扣资源');
      push('观看2个广告，开启4倍加速', () => { void s.ads.watch('flower_boost', 2, (i) => s.ads.applyBoost(i === 0 ? 2 : 4)).then((r) => this.notice(r.message || '已开启4倍加速')); }, '只看完第1个时保留2倍');
    } else if (this.panel === 'fields') {
      e.map.knownFields().forEach((f) => push(`${e.w.flower(f.flower).name} · 库存${Math.floor(f.stock)}`, () => {
        this.field = f.fieldId; this.view = 'field'; this.session.renderer?.lookAt(f.x, f.y); this.open('field');
      }, `距离${Math.floor(f.dist)} · 恢复${Math.ceil(e.map.recoveryRemaining(f))}秒`));
    } else if (this.panel === 'colony') {
      push(`巢内筑巢比例 ${Math.round(e.run.colony.houseWaxShare * 100)}%`, () => e.setWaxShare((Math.round(e.run.colony.houseWaxShare * 4 + 1) % 5) / 4), '点击依次调整0%、25%、50%、75%、100%');
      [ForageStrategy.Safe, ForageStrategy.Balanced, ForageStrategy.Rich].forEach((v, i) => push(['安全近路', '均衡采集', '高产远路'][i], () => { e.setStrategy(v); s.saveNow(); }));
      [GuardPriority.Balanced, GuardPriority.Gate, GuardPriority.Fields, GuardPriority.Routes].forEach((v, i) => push(['均衡守卫', '保护巢门', '保护花田', '保护航线'][i], () => { e.setGuardPriority(v); s.saveNow(); }));
    } else if (this.panel === 'tasks') {
      e.w.cfg.tasks.forEach((t) => push(`${e.w.taskDone(t.id) ? '已完成' : '待完成'} · ${t.name}`, undefined, t.desc));
      const task = e.prog.colonyTask(); if (task) push(task.name, () => this.result(e.claimColonyTask()), `${Math.floor(task.current)}/${task.target}`, !task.claimed && task.current >= task.target);
    } else if (this.panel === 'resources') {
      [Res.Nectar, Res.Honey, Res.Wax, Res.Jelly].forEach((r, i) => push(`${['花蜜', '蜂蜜', '蜂蜡', '蜂王浆'][i]} ${formatBig(e.w.econ.amount(r))}`, undefined, `上限${formatBig(e.w.econ.capacity(r))}`));
      push('领取溢出缓冲', () => this.result(e.claimOverflow()));
      push('保存当前进度', () => this.notice(s.saveNow() ? '已保存' : '保存失败'));
    } else if (this.panel === 'eco') {
      push(`${seasonName(e.run.season.season)} · ${formatDuration(e.season.remaining())}`, undefined, `过冬预计需要${Math.ceil(e.season.winterNeed())}蜂蜜`);
      e.threats.activeList().forEach((t) => {
        push(`${t.type} · 生命${Math.ceil(t.hp)}`, undefined, t.phase);
        if (t.type === 'bear' && !t.settled) {
          ['defend', 'tribute', 'later'].forEach((choice, i) => push(['集结防守', '交付蜂蜜', '稍后处理'][i], () => this.result(e.bearChoice(t.eventId, choice))));
          push('观看广告请邻巢援军', () => { void s.ads.watch('bear_aid', 1, () => { grantBearAid(e, t.eventId); s.saveNow(); }).then((r) => this.notice(r.message || '援军已到达')); });
        }
      });
      if (winterSupplyWanted(e)) push('观看广告领取越冬补给', () => { void s.ads.watch('winter_supply', 1, () => { grantWinterSupply(e); s.saveNow(); }).then((r) => this.notice(r.message || '补给已送达')); });
      push('读取入冬前快照', () => this.ask('将回到最近一次入冬前的进度，是否继续？', () => this.notice(s.restoreWinterCheckpoint() ? '已恢复' : '暂无快照')));
      if (e.run.colony.collapsed) push('消耗1点传承重振', () => this.notice(s.recoverColonyWithPoint() ? '蜂群已重振' : '传承点不足'));
    } else if (this.panel === 'research') {
      e.w.cfg.research.forEach((r) => push(r.name, () => this.result(e.research(r.id)), r.desc, e.w.count(Bld.Evolution) > 0));
    } else if (this.panel === 'swarm') {
      const preview = e.swarmPreview();
      if (e.run.colony.youngQueens > 0) push('新蜂后已准备好', undefined, '可带领一半人口与资源建立新巢');
      else push('尝试分化新蜂后', () => this.ask('消耗1000蜂蜜、400蜂蜡、5蜂王浆，成功率25%，失败不返还。确认尝试？', () => this.result(e.differentiateQueen())),
        '1000蜂蜜 · 400蜂蜡 · 5蜂王浆 · 25%成功', e.w.econ.canAfford(e.colony.queenCost()));
      preview.conditions.forEach((c) => push(`${c.met ? '已达成' : '未达成'} ${c.label}`, undefined, `${Math.floor(c.current)}/${c.target}`));
      e.w.cfg.regions.filter((r) => r.id !== e.run.regionId).forEach((r) => push(`分蜂前往${r.name}`, () => this.ask('新蜂后会带走一半人口和当前资源；新巢建设、升级成本为上一代2倍。确认出发？', () => { this.result(e.swarm(r.id)); s.saveNow(); }), `可得${preview.total}传承点`, preview.ready));
    } else if (this.panel === 'talents') {
      push(`可用传承点 ${e.state.meta.inheritance.available}`);
      e.w.cfg.talents.forEach((t) => push(t.name, () => this.result(e.investTalent(t.id)), t.desc));
      push('重置传承天赋', () => this.ask('确认重置传承天赋？', () => this.result(e.resetTalents())));
    } else if (this.panel === 'codex') {
      e.state.meta.codexFlowers.forEach((id) => push(e.w.flower(id).name));
      e.state.messages.slice().reverse().forEach((m) => push(m.text));
    } else if (this.panel === 'settings') {
      const settings = e.state.meta.settings;
      (['music', 'sfx', 'vibration', 'particles', 'reduceMotion', 'ecoMode'] as const).forEach((key, i) => push(`${['音乐', '音效', '振动', '粒子', '减少动态', '工蜂寿命'][i]}：${settings[key] ? '开' : '关'}`, () => { settings[key] = !settings[key]; s.applySettings(); s.saveNow(); }));
      push('保存当前进度', () => this.notice(s.saveNow() ? '已保存' : '保存失败'));
      push('重新开始', () => this.ask('确认清除当前进度并重新开始？', () => { s.resetProgress(true); this.panel = ''; }));
      push('删除全部本地数据', () => this.ask('删除全部存档及设置？此操作不可撤销。', () => { s.deleteAllData(); s.resetProgress(false); this.panel = ''; }));
    } else if (this.panel === 'privacy' || this.panel === 'agreement' || this.panel === 'help') {
      const contents = this.panel === 'privacy' ? PRIVACY_FULL : this.panel === 'agreement' ? AGREEMENT_FULL : HELP_TEXT;
      contents.forEach((text) => { for (let i = 0; i < text.length; i += 46) push(text.slice(i, i + 46)); });
    }
    this.rows(({ queen: '手动孵化与分化', build: '建造巢房', cell: '蜂巢格', field: '花源', more: '蜂群管理' } as Record<string, string>)[this.panel] || '小峰大业', rows);
  }

  private drawPrivacy(): void {
    if (this.panel === 'privacy' || this.panel === 'agreement') { this.drawPanel(); return; }
    let y = this.sheet('欢迎来到小峰大业', false);
    for (const text of PRIVACY_SUMMARY) y = this.wrap(text, 22, y, this.width - 44, 13) + 9;
    const by = Math.max(y + 4, this.height - this.bottom - 180);
    this.button('隐私政策', 22, by, this.width / 2 - 28, () => this.open('privacy'));
    this.button('用户协议', this.width / 2 + 4, by, this.width / 2 - 26, () => this.open('agreement'));
    this.button('同意并开始', 22, by + 52, this.width - 44, () => {
      const settings = this.session.engine().state.meta.settings;
      settings.privacyAccepted = true; settings.privacyVersion = PRIVACY_VERSION;
      this.session.saveNow(); void this.session.audio.unlock();
    });
    this.button('暂不开始', 22, by + 104, this.width - 44, () => this.notice('同意隐私说明后才能开始，也可以直接退出小游戏。'));
    // 隐私确认不能通过普通关闭按钮跳过。
    this.buttons = this.buttons.filter((b) => b.y >= by);
  }
  private drawIntro(): void {
    const guide = this.session.guide(), topic = guide.topic(this.intro);
    if (!topic) { this.intro = ''; return; }
    let y = this.sheet(topic.title, false); this.buttons = [];
    topic.what.split('\n').forEach((line) => { y = this.wrap(line, 22, y, this.width - 44, 16) + 8; });
    y = this.wrap(topic.use, 22, y + 10, this.width - 44, 14);
    this.button(topic.id === 'handover' ? '交给我吧' : '知道了', 22, Math.min(y + 28, this.height - this.bottom - 70), this.width - 44, () => {
      guide.markSeen(this.intro); this.intro = ''; this.session.saveNow();
    });
  }
  private drawOffline(): void {
    const report = this.session.pendingOffline!;
    let y = this.sheet('欢迎回巢', false); this.buttons = [];
    y = this.wrap(`离开期间蜂群工作了${formatDuration(report.credited)}。孵化与工种分化仍由你来决定。`, 22, y, this.width - 44);
    this.button('观看广告，离线收益翻倍', 22, y + 86, this.width - 44, () => {
      void this.session.ads.watch('offline_double', 1, () => { grantOfflineDouble(this.session.engine(), report); this.session.dismissOffline(); this.session.saveNow(); })
        .then((r) => this.notice(r.message || '已领取翻倍收益'));
    });
    this.button('继续经营', 22, y + 32, this.width - 44, () => this.session.dismissOffline());
  }
  private drawConfirm(): void {
    let y = this.sheet('请确认', false); this.buttons = [];
    y = this.wrap(this.confirmText, 22, y, this.width - 44);
    this.button('确认', 22, y + 28, this.width / 2 - 28, () => { const run = this.confirm; this.confirm = null; run?.(); });
    this.button('取消', this.width / 2 + 4, y + 28, this.width / 2 - 26, () => { this.confirm = null; });
  }

  touchStart(x: number, y: number): void {
    if (!this.session.ready || this.session.status === 'error') return;
    this.down = { x, y, moved: false }; this.held = false; this.holdField = '';
    if (this.view === 'field' && !this.panel && !this.intro && !this.confirm && !this.session.pendingOffline &&
      this.session.engine().run.stats.manualCollects >= 2 &&
      y > this.sceneTop() && y < this.sceneTop() + this.sceneHeight()) {
      const id = this.session.renderer!.hitField(x, y - this.sceneTop(), this.width, this.sceneHeight());
      if (id && id !== 'hive') { this.holdField = id; this.nextHold = Date.now() + 250; }
    }
  }
  touchMove(x: number, y: number): void {
    if (!this.down) return;
    const dx = x - this.down.x, dy = y - this.down.y;
    if (!this.panel && !this.intro && !this.session.pendingOffline && !this.confirm && Math.abs(dx) + Math.abs(dy) > 5) {
      this.holdField = ''; this.session.renderer?.pan(dx, dy); this.down = { x, y, moved: true };
    }
  }
  touchEnd(x: number, y: number): void {
    if (!this.session.ready || this.session.status === 'error') return;
    const down = this.down; this.down = null; this.holdField = '';
    if (!down || down.moved || this.held) return;
    const button = this.buttons.slice().reverse().find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (button) { if (button.enabled) button.run(); this.draw(); return; }
    if (this.panel || this.intro || this.session.pendingOffline || this.confirm || !this.session.engine().state.meta.settings.privacyAccepted) return;
    if (y < this.sceneTop() || y > this.sceneTop() + this.sceneHeight()) return;
    const renderer = this.session.renderer!, e = this.session.engine(), sy = y - this.sceneTop();
    if (this.view === 'field') {
      const id = renderer.hitField(x, sy, this.width, this.sceneHeight());
      const now = Date.now();
      if (!id && now - this.lastTapAt < 320 && Math.hypot(x - this.lastTapX, y - this.lastTapY) < 40) {
        this.lastTapAt = 0; renderer.doubleTapZoom(x, sy, this.width, this.sceneHeight()); this.draw(); return;
      }
      this.lastTapAt = now; this.lastTapX = x; this.lastTapY = y;
      if (id === 'hive') { this.view = 'hive'; }
      else if (id) { this.field = id; this.result(e.collect(id, 1)); }
    } else {
      const id = renderer.hitCell(x, sy, this.width, this.sceneHeight());
      if (id) {
        this.selected = id;
        if (this.placing) { const result = e.build(id, this.placing); this.result(result); if (result.ok) this.placing = ''; }
        else this.open('cell');
      }
    }
    this.draw();
  }
  touchCancel(): void { this.down = null; this.holdField = ''; }
  destroy(): void { this.session.removeDrawer('canvas'); }
}
