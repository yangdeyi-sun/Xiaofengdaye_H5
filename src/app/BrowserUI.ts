import { BigNum, formatBig, formatDuration, formatFull } from '../common/BigNum';
import type { GameEngine, UpgradePreview } from '../domain/GameEngine';
import { INTRO_TOPICS } from '../domain/Guide';
import type { Hint, IntroTopic } from '../domain/Guide';
import type { ColonyTask, SwarmCondition } from '../domain/ProgressionService';
import type { FlowerField, GameMessage, HexCell, OfflineReport, ThreatEvent } from '../domain/State';
import {
  ALL_RES, ALL_ROLES, Bld, ForageStrategy, GuardPriority, Res, Role, SeasonId
} from '../domain/Types';
import type {
  AchievementDef, BuildingDef, FlowerDef, RegionDef, ResearchDef, SkinDef, TalentDef, TaskDef, ThreatDef
} from '../domain/Types';
import type { CmdResult, CostAmount, ForageAlloc } from '../domain/World';
import { Sprites } from '../scene/Sprites';
import {
  AGREEMENT_FULL, ECO_NOTES, HELP_TEXT, PRIVACY_FULL, PRIVACY_SUMMARY
} from './content';
import { GameSession, PRIVACY_VERSION, seasonName } from './GameSession';
import {
  grantBearAid, grantOfflineDouble, grantSwarmBonus, grantWinterSupply, offlineHasGains, swarmBonusPoints,
  winterSupplyAmount, winterSupplyWanted
} from './ads/AdRewards';
import { AD_REWARDS, AdPlacement } from './ads/placements';
import type { WatchResult } from './ads/AdService';

type Screen = 'boot' | 'privacy' | 'home' | 'game' | 'error';
type View = 'field' | 'hive';
type LegalKind = '' | 'privacy' | 'agreement' | 'help';

interface ManagedHistoryState {
  xf: true;
  screen: Screen;
  view: View;
  panel: string;
  legal: LegalKind;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  dangerous: boolean;
  run: () => void;
}

interface PointerPoint {
  x: number;
  y: number;
}

const RES_NAMES: Record<string, string> = {
  [Res.Nectar]: '花蜜', [Res.Honey]: '蜂蜜', [Res.Wax]: '蜂蜡', [Res.Jelly]: '蜂王浆'
};

const RES_ICONS: Record<string, string> = {
  [Res.Nectar]: 'xf_res_nectar', [Res.Honey]: 'xf_res_honey', [Res.Wax]: 'xf_res_wax', [Res.Jelly]: 'xf_res_jelly'
};

const ROLE_ICONS: Record<string, string> = {
  [Role.Scout]: 'xf_role_scout', [Role.Forager]: 'xf_role_forager', [Role.House]: 'xf_role_house',
  [Role.Guard]: 'xf_role_guard'
};

const BLD_ICONS: Record<string, string> = {
  [Bld.Queen]: 'xf_building_queen', [Bld.Nursery]: 'xf_building_nursery',
  [Bld.ScoutRoom]: 'xf_building_scout', [Bld.ForagerRoom]: 'xf_building_forager',
  [Bld.Brewery]: 'xf_building_brewery', [Bld.Storage]: 'xf_building_storage',
  [Bld.GuardRoom]: 'xf_building_guard', [Bld.Evolution]: 'xf_building_evolution'
};

const SEASON_ICONS: Record<string, string> = {
  [SeasonId.Tutorial]: 'xf_season_tutorial', [SeasonId.Spring]: 'xf_season_spring',
  [SeasonId.Summer]: 'xf_season_summer', [SeasonId.Autumn]: 'xf_season_autumn',
  [SeasonId.WinterPrep]: 'xf_season_winter_prep', [SeasonId.Winter]: 'xf_season_winter'
};

const NAV: Record<string, [string, string]> = {
  tasks: ['任务', 'xf_nav_tasks'], build: ['建造', 'xf_action_build'], colony: ['蜂群', 'xf_nav_swarm'],
  eco: ['生态', 'xf_nav_ecology'], evolution: ['进化', 'xf_nav_evolution'], swarm: ['分蜂', 'xf_nav_split'],
  resources: ['资源', 'xf_nav_resources'], codex: ['图鉴', 'xf_action_search'], settings: ['设置', 'xf_nav_settings']
};

function h(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function media(name: string): string { return `./media/${name}.svg`; }
function art(name: string): string { return `./art/v1/${name}.webp`; }
function icon(name: string, alt = ''): string {
  return `<img class="ui-icon" src="${media(name)}" alt="${h(alt)}" draggable="false">`;
}
function artImage(name: string, alt = '', className = ''): string {
  return `<img class="art-image ${h(className)}" src="${art(name)}" alt="${h(alt)}" draggable="false">`;
}
function resName(id: string): string { return RES_NAMES[id] ?? id; }
function resIcon(id: string): string { return RES_ICONS[id] ?? 'xf_res_honey'; }
function roleIcon(id: string): string { return ROLE_ICONS[id] ?? 'xf_role_forager'; }
function bldIcon(id: string): string { return BLD_ICONS[id] ?? 'xf_action_build'; }
function flowerIcon(id: string): string { return `xf_flower_${id}`; }
function threatIcon(id: string): string { return `xf_enemy_${id}`; }
function seasonIcon(id: string): string { return SEASON_ICONS[id] ?? 'xf_season_spring'; }
function researchIcon(id: string): string { return `xf_research_${id}`; }
function talentIcon(id: string): string { return `xf_talent_${id}`; }
function num1(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1000) return formatBig(BigNum.of(value));
  return Math.abs(value) >= 100 ? value.toFixed(0) : (Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2)).replace(/\.?0+$/, '');
}
function pct(value: number): string { return `${Math.round(Math.max(0, value) * 100)}%`; }
function costStr(costs: CostAmount[]): string {
  if (costs.length === 0) return '免费';
  return costs.map((cost) => `${resName(cost.res)} ${formatBig(cost.amount)}`).join('、');
}
function regionArt(id: string): string { return id === 'rainy' ? 'wetland' : (id === 'drought' ? 'dryland' : id); }
function button(action: string, label: string, options: {
  id?: string; value?: string | number; disabled?: boolean; primary?: boolean; danger?: boolean; title?: string;
} = {}): string {
  const classes = ['btn', options.primary ? 'primary' : 'ghost', options.danger ? 'danger' : ''].filter(Boolean).join(' ');
  return `<button type="button" class="${classes}" data-action="${h(action)}"${options.id === undefined ? '' : ` data-id="${h(options.id)}"`}${options.value === undefined ? '' : ` data-value="${h(options.value)}"`}${options.disabled ? ' disabled' : ''}${options.title === undefined ? '' : ` title="${h(options.title)}"`}>${label}</button>`;
}
function panelCard(body: string, danger = false): string { return `<section class="panel-card${danger ? ' danger-card' : ''}">${body}</section>`; }
function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Browser-only DOM and Pointer Events adapter. All game mutations are delegated to GameEngine/GameSession. */
export class BrowserUI {
  private screen: Screen = 'boot';
  private view: View = 'field';
  private panel = '';
  private legal: LegalKind = '';
  private privacyDeclined = false;
  private drawerOpen = false;
  private selectedCell = '';
  private selectedField = '';
  private placing = '';
  private upgradeBuilding = '';
  private evolutionTab = 'research';
  private talentBranch = 'breed';
  private codexTab = 'eco';
  private swarmTarget = '';
  private hiddenHint = '';
  private introId = '';
  private introReplay = false;
  private introGapUntil = 0;
  private offlineReport: OfflineReport | null = null;
  private boostModal = false;
  /** 分蜂成功后可通过广告额外领取的传承点；0 表示不弹出 */
  private swarmBonus = 0;
  private bearModal = false;
  private bearPromptKey = '';
  private pendingBearUntil = 0;
  private banner = '';
  private bannerKind = '';
  private bannerUntil = 0;
  private eventTitle = '';
  private eventText = '';
  private eventIcon = '';
  private eventUntil = 0;
  private toastText = '';
  private toastUntil = 0;
  private confirmState: ConfirmState | null = null;
  private focusTarget = '';
  private focusUntil = 0;
  private deepTarget = '';
  private lastPanelRender = 0;
  private rangeActive = false;
  private lastScrollAt = 0;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private canvasWidth = 0;
  private canvasHeight = 0;
  private canvasFitted = false;
  private resizeObserver: ResizeObserver | null = null;
  private readonly pointers = new Map<number, PointerPoint>();
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;
  private downAt = 0;
  private dragging = false;
  private multiTouch = false;
  private pinchDistance = 0;
  private holdField = '';
  private holdAcc = 0;
  private lastHoldTick = 0;
  /** 本次按下是否已经在花丛上采过蜜（按下即采一次，松手不再重复） */
  private holdCollected = false;
  private holdEnabledOnDown = false;
  private lastTapAt = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  /** 触屏点开面板后浏览器会补发一次 click，落在刚出现的遮罩上把面板又关掉；在此之前忽略遮罩点击 */
  private suppressScrimUntil = 0;
  /** 侧栏的上一级面板（返回键逐级退回） */
  private panelStack: string[] = [];
  private readonly drawerId = `browser-scene-${Math.random().toString(36).slice(2)}`;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly root: HTMLElement, private readonly session: GameSession) {}

  mount(): void {
    this.root.addEventListener('click', (event) => this.onClick(event));
    this.root.addEventListener('input', (event) => this.onRange(event, false));
    this.root.addEventListener('scroll', () => { this.lastScrollAt = Date.now(); }, { capture: true, passive: true });
    this.root.addEventListener('change', (event) => this.onRange(event, true));
    this.root.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.type === 'range') this.rangeActive = true;
    });
    window.addEventListener('pointerup', () => {
      if (this.rangeActive) {
        this.rangeActive = false;
        this.refreshGame(true);
      }
    });
    window.addEventListener('popstate', (event) => this.onPopState(event));
    this.unsubscribe = this.session.subscribeUi(() => this.onSessionTick());
    const target = new URLSearchParams(location.search).get('target') ?? '';
    if (['hive', 'eco', 'swarm', 'resources'].includes(target)) this.deepTarget = target;
    if (this.session.status === 'error' || !this.session.ready) {
      this.screen = 'error';
    } else {
      const settings = this.engine().state.meta.settings;
      if (!settings.privacyAccepted || settings.privacyVersion !== PRIVACY_VERSION) this.screen = 'privacy';
      else if (this.deepTarget.length > 0) this.applyDeepTarget();
      else this.screen = 'home';
    }
    if (this.screen === 'home') this.session.beginAway();
    this.render();
    history.replaceState(this.historyState(), '', location.href);
  }

  destroy(): void {
    this.destroyCanvas();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Reconcile an infrastructure status change initiated outside the DOM adapter. */
  syncSessionStatus(): void {
    if (this.session.status !== 'error') return;
    this.screen = 'error';
    this.panel = '';
    this.legal = '';
    this.drawerOpen = false;
    this.render();
    this.writeHistory(false);
  }

  private engine(): GameEngine { return this.session.engine(); }

  private historyState(): ManagedHistoryState {
    return { xf: true, screen: this.screen, view: this.view, panel: this.panel, legal: this.legal };
  }

  private writeHistory(push: boolean): void {
    if (push) history.pushState(this.historyState(), '', location.href);
    else history.replaceState(this.historyState(), '', location.href);
  }

  private onPopState(event: PopStateEvent): void {
    const state = event.state as Partial<ManagedHistoryState> | null;
    if (state?.xf === true && typeof state.screen === 'string') {
      if (this.screen === 'game' && state.screen !== 'game') { this.session.saveNow(); this.session.beginAway(); }
      if (this.screen !== 'game' && state.screen === 'game') this.session.endAway();
      this.screen = state.screen as Screen;
      this.view = state.view === 'hive' ? 'hive' : 'field';
      this.panel = typeof state.panel === 'string' ? state.panel : '';
      this.legal = (['privacy', 'agreement', 'help'].includes(String(state.legal)) ? state.legal : '') as LegalKind;
      this.drawerOpen = this.panel.length > 0;
      this.panelStack = [];
      if (this.screen === 'privacy' && this.engine().state.meta.settings.privacyAccepted) this.screen = 'home';
      this.render();
      return;
    }
    if (this.legal.length > 0) this.legal = '';
    else if (this.panelStack.length > 0) this.panel = this.panelStack.pop() ?? '';
    else if (this.panel.length > 0) { this.panel = ''; this.drawerOpen = false; }
    else if (this.screen === 'game') { this.session.saveNow(); this.screen = 'home'; this.session.beginAway(); }
    this.render();
    history.pushState(this.historyState(), '', location.href);
  }

  private applyDeepTarget(): void {
    this.screen = 'game';
    this.panel = '';
    this.drawerOpen = false;
    if (this.deepTarget === 'hive') this.view = 'hive';
    else {
      this.view = 'field';
      this.panel = this.deepTarget;
      this.drawerOpen = true;
    }
    this.deepTarget = '';
  }

  private render(): void {
    if (this.screen !== 'game') this.destroyCanvas();
    if (this.screen === 'privacy') this.renderPrivacy();
    else if (this.screen === 'home') this.renderHome();
    else if (this.screen === 'game') this.renderGame();
    else if (this.screen === 'error') this.renderError();
    else this.root.innerHTML = `<main class="screen boot-screen">${artImage('logo_mark', '小峰大业')}<p>蜂群探查领地中……</p></main>`;
    this.session.setAudioContext(this.screen, this.view);
  }

  private renderPrivacy(): void {
    const legal = this.renderLegalOverlay();
    if (this.privacyDeclined) {
      this.root.innerHTML = `<main class="screen privacy-screen"><section class="privacy-card declined-card">
        ${artImage('logo_lockup', '小峰大业', 'logo-lockup')}
        <h1>需要同意后才能开始</h1>
        <p>你已选择不同意。游戏保持在此页面，不会进入蜂巢。</p>
        ${button('privacy-reconsider', '重新阅读', { primary: true })}
      </section></main>${legal}`;
      return;
    }
    this.root.innerHTML = `<main class="screen privacy-screen"><section class="privacy-card">
      ${artImage('logo_lockup', '小峰大业', 'logo-lockup')}
      <h1>欢迎来到小峰大业</h1><p class="muted">在开始之前，请阅读并同意以下说明</p>
      <div class="privacy-summary">${PRIVACY_SUMMARY.map((line) => `<p><span>•</span>${h(line)}</p>`).join('')}</div>
      <div class="legal-links"><button data-action="open-legal" data-id="privacy">《隐私政策》</button><button data-action="open-legal" data-id="agreement">《用户协议》</button></div>
      <div class="stack-actions">${button('privacy-accept', '同意并开始', { primary: true })}${button('privacy-decline', '不同意', {})}</div>
    </section></main>${legal}`;
  }

  private renderHome(): void {
    const e = this.engine();
    const hasProgress = e.run.colony.eggsLaid > 0 || e.state.meta.swarmCount > 0;
    const subtitle = hasProgress
      ? `${e.w.region().name} · 蜂群 ${e.w.adults()} 只 · 已分蜂 ${e.state.meta.swarmCount} 次`
      : '从一只蜂后开始，建立属于你的蜂群帝国';
    const scene = `scene_${regionArt(e.run.regionId)}`;
    this.root.innerHTML = `<main class="screen home-screen" style="--home-bg:url('${art(scene)}')">
      <div class="home-swarm" aria-hidden="true"><span>🐝</span><span>🐝</span><span>🐝</span></div>
      <section class="home-card">${artImage('logo_lockup', '小峰大业', 'home-logo')}
        <p>${h(subtitle)}</p>
        ${button('home-start', hasProgress ? '▶ 继续游戏' : '▶ 开始采蜜', { primary: true })}
        <div class="home-shortcuts">${button('home-panel', '任务', { id: 'tasks' })}${button('home-panel', '图鉴', { id: 'codex' })}${button('home-panel', '设置', { id: 'settings' })}</div>
      </section>
      <p class="health-note">适度游戏益脑，沉迷游戏伤身。合理安排时间，享受健康生活。</p>
    </main>${this.renderLegalOverlay()}`;
  }

  private renderError(): void {
    this.root.innerHTML = `<main class="screen error-screen">${artImage('state_error', '启动失败', 'error-art')}
      <h1>无法启动</h1><p>${h(this.session.bootError || '初始化失败，请刷新页面重试。')}</p>
      ${button('reload', '重试', { primary: true })}</main>`;
  }

  private renderGame(): void {
    if (this.root.querySelector('#game-screen') === null) {
      this.root.innerHTML = `<main id="game-screen" class="game-screen">
        <canvas id="scene-canvas" class="scene-canvas" tabindex="0" aria-label="游戏场景"></canvas>
        <div id="drawer-scrim" class="drawer-scrim" data-action="close-panel"></div>
        <div class="hud-stack">
          <header id="top-bar" class="top-bar"></header>
          <div id="prod-strip" class="prod-wrap"></div>
          <div id="hint-line" class="hint-wrap"></div>
          <div id="placing-bar" class="placing-wrap"></div>
        </div>
        <div id="field-mini" class="field-mini-wrap"></div>
        <button id="view-toggle" class="view-toggle" type="button" data-action="toggle-view"></button>
        <aside id="game-drawer" class="game-drawer" aria-label="功能面板">
          <nav id="drawer-nav" class="drawer-nav"></nav>
          <div class="drawer-main"><div class="drawer-header">
            <button type="button" class="drawer-view" data-action="toggle-view"></button>
            <span class="drawer-spacer"></span>
            <button type="button" id="panel-back" class="round-btn" data-action="panel-back" aria-label="返回上一级">${icon('xf_action_back')}</button>
            <button type="button" class="round-btn" data-action="close-panel" aria-label="收起面板">${icon('xf_action_close')}</button>
          </div><div id="panel-host" class="panel-host"></div></div>
        </aside>
        <button id="drawer-handle" class="drawer-handle" type="button" data-action="drawer-toggle" aria-label="打开功能面板"></button>
        <div id="runtime-overlays" class="runtime-overlays"></div>
      </main>`;
      this.setupCanvas();
      this.introGapUntil = Date.now() + 1200;
    }
    this.refreshGame(true);
  }

  private setupCanvas(): void {
    this.canvas = this.root.querySelector<HTMLCanvasElement>('#scene-canvas');
    this.ctx = this.canvas?.getContext('2d', { alpha: true }) ?? null;
    if (this.canvas === null || this.ctx === null) return;
    this.canvas.addEventListener('pointerdown', (event) => this.onCanvasDown(event));
    this.canvas.addEventListener('pointermove', (event) => this.onCanvasMove(event));
    this.canvas.addEventListener('pointerup', (event) => this.onCanvasUp(event));
    this.canvas.addEventListener('pointercancel', (event) => this.onCanvasUp(event));
    // 阻止触屏在 touchend 后补发的 click：它会落到刚打开的面板遮罩上，把面板立刻关掉
    this.canvas.addEventListener('touchend', (event) => { if (event.cancelable) event.preventDefault(); }, { passive: false });
    this.canvas.addEventListener('wheel', (event) => {
      if (this.view !== 'field' || this.session.renderer === null) return;
      event.preventDefault();
      this.session.renderer.zoomBy(Math.exp(-event.deltaY * 0.0012));
    }, { passive: false });
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    this.resizeObserver.observe(this.canvas);
    this.resizeCanvas();
    this.session.addDrawer(this.drawerId, () => this.drawCanvas());
  }

  private destroyCanvas(): void {
    if (this.canvas !== null) this.session.removeDrawer(this.drawerId);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.canvas = null;
    this.ctx = null;
    this.pointers.clear();
    this.holdField = '';
  }

  private resizeCanvas(): void {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (canvas === null || ctx === null) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      this.canvasWidth = width;
      this.canvasHeight = height;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.view === 'field' && !this.canvasFitted && this.session.renderer !== null) {
        this.session.renderer.fitDefault(width, height);
        this.canvasFitted = true;
      }
    }
  }

  private drawCanvas(): void {
    const ctx = this.ctx;
    const renderer = this.session.renderer;
    if (ctx === null || renderer === null || this.canvasWidth <= 0 || this.canvasHeight <= 0 || this.screen !== 'game') return;
    this.holdTick();
    ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    const compact = this.canvasHeight > this.canvasWidth;
    if (compact !== Sprites.compactCanvas) {
      Sprites.compactCanvas = compact;
      Sprites.bitmapState = 0;
    }
    Sprites.probeCanvas(ctx);
    ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    const hud = this.root.querySelector<HTMLElement>('.hud-stack');
    if (hud !== null && this.canvas !== null) {
      renderer.hudTop = hud.getBoundingClientRect().bottom - this.canvas.getBoundingClientRect().top + 4;
    }
    if (this.view === 'field') renderer.drawField(ctx, this.canvasWidth, this.canvasHeight);
    else renderer.drawHive(ctx, this.canvasWidth, this.canvasHeight);
  }

  private canvasPoint(event: PointerEvent): PointerPoint {
    const rect = this.canvas?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }

  private onCanvasDown(event: PointerEvent): void {
    if (this.canvas === null || this.session.renderer === null) return;
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    const point = this.canvasPoint(event);
    this.pointers.set(event.pointerId, point);
    if (this.pointers.size === 1) {
      this.downX = point.x; this.downY = point.y; this.lastX = point.x; this.lastY = point.y;
      this.downAt = Date.now(); this.lastHoldTick = this.downAt; this.holdAcc = 0;
      this.dragging = false; this.multiTouch = false; this.pinchDistance = 0; this.holdCollected = false;
      if (this.view === 'field') {
        const hit = this.session.renderer.hitField(point.x, point.y, this.canvasWidth, this.canvasHeight);
        this.holdField = hit.length > 0 && hit !== 'hive' ? hit : '';
        // 按在花丛上立刻采一次，按住不放则持续采集
        if (this.holdField.length > 0) {
          this.holdEnabledOnDown = this.engine().run.stats.manualCollects >= 2;
          if (this.drawerOpen) this.closePanel(false);
          const result = this.engine().collect(this.holdField, 1);
          if (!result.ok) this.feedback(result);
          this.holdCollected = true;
          this.selectedField = this.holdField;
        }
      }
    } else if (this.pointers.size >= 2) {
      this.multiTouch = true; this.dragging = true; this.holdField = '';
      const points = [...this.pointers.values()];
      this.pinchDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    }
  }

  private onCanvasMove(event: PointerEvent): void {
    const renderer = this.session.renderer;
    if (!this.pointers.has(event.pointerId) || renderer === null) return;
    event.preventDefault();
    const point = this.canvasPoint(event);
    this.pointers.set(event.pointerId, point);
    if (this.pointers.size >= 2 && this.view === 'field') {
      const points = [...this.pointers.values()];
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (this.pinchDistance > 0) renderer.zoomBy(distance / this.pinchDistance);
      this.pinchDistance = distance; this.dragging = true; this.multiTouch = true; this.holdField = '';
      return;
    }
    if (this.pointers.size !== 1) return;
    const dx = point.x - this.lastX;
    const dy = point.y - this.lastY;
    if (!this.dragging && Math.abs(point.x - this.downX) + Math.abs(point.y - this.downY) > 10) {
      this.dragging = true;
      this.holdField = '';
    }
    if (this.dragging && this.view === 'field') renderer.pan(dx, dy);
    this.lastX = point.x; this.lastY = point.y;
  }

  private onCanvasUp(event: PointerEvent): void {
    const renderer = this.session.renderer;
    if (!this.pointers.has(event.pointerId) || renderer === null) return;
    event.preventDefault();
    const collected = this.holdCollected;
    this.pointers.delete(event.pointerId);
    if (this.pointers.size > 0) return;
    this.holdField = '';
    this.holdCollected = false;
    if (event.type === 'pointercancel' || this.dragging || this.multiTouch) return;
    this.suppressScrimUntil = Date.now() + 450;
    if (this.view === 'field') {
      if (collected) { this.refreshGame(true); return; }
      const now = Date.now();
      const hit = renderer.hitField(this.downX, this.downY, this.canvasWidth, this.canvasHeight);
      // 双击空地缩放地图：放大到点击处，已放大时恢复默认视野
      if (hit.length === 0 && now - this.lastTapAt < 320 && Math.hypot(this.downX - this.lastTapX, this.downY - this.lastTapY) < 40) {
        this.lastTapAt = 0;
        renderer.doubleTapZoom(this.downX, this.downY, this.canvasWidth, this.canvasHeight);
        return;
      }
      this.lastTapAt = now; this.lastTapX = this.downX; this.lastTapY = this.downY;
      this.onTapField(hit);
    } else {
      const hit = renderer.hitCell(this.downX, this.downY, this.canvasWidth, this.canvasHeight);
      this.onTapCell(hit);
    }
  }

  private holdTick(): void {
    if (!this.holdEnabledOnDown || this.holdField.length === 0 || this.pointers.size !== 1 || this.dragging) return;
    const now = Date.now();
    const e = this.engine();
    // 按住约 0.25 秒后开始连续采集（按下那一下已经采过一次）
    if (now - this.downAt < 250) {
      this.lastHoldTick = now;
      return;
    }
    this.holdAcc += (now - this.lastHoldTick) / 1000 * e.w.cfg.economy.holdCollectPerSec;
    this.lastHoldTick = now;
    while (this.holdAcc >= 1) {
      this.holdAcc -= 1;
      const field = e.w.field(this.holdField);
      // 花丛采空时停在原地等它重新开花，不连续弹出失败提示
      if (field === null || field.stock <= 1e-6) { this.holdAcc = 0; break; }
      e.collect(this.holdField, 1);
    }
  }

  private onTapField(id: string): void {
    if (this.drawerOpen) this.closePanel(false);
    if (id.length === 0) { this.selectedField = ''; this.refreshGame(true); return; }
    if (id === 'hive') { this.enterHive(); return; }
    const result = this.engine().collect(id, 1);
    if (!result.ok) this.feedback(result);
    this.selectedField = id;
    this.refreshGame(true);
  }

  private onTapCell(id: string): void {
    if (this.drawerOpen) this.closePanel(false);
    const e = this.engine();
    if (this.placing.length > 0) {
      const cell = id.length > 0 ? e.hive.cell(id) : null;
      if (cell === null) { this.cancelPlacing(); return; }
      if (cell.unlocked && cell.building.length === 0) {
        const result = e.build(id, this.placing);
        this.feedback(result);
        if (result.ok) this.placing = '';
      } else this.showToast('请点一个发光的空格', true);
      this.refreshGame(true);
      return;
    }
    if (id.length === 0) { this.selectedCell = ''; this.refreshGame(true); return; }
    const cell = e.hive.cell(id);
    this.selectedCell = id;
    // 外圈带“+”的格子：蜂蜡够就直接扩建，不够再打开详情说明还差多少
    if (cell !== null && this.cellMode(cell) === 'expand' && e.w.econ.canAfford(e.hive.expandCost(cell))) {
      const result = e.expand(id);
      this.feedback(result);
      if (result.ok) { this.focusTarget = ''; this.focusUntil = 0; }
      this.refreshGame(true);
      return;
    }
    this.panelStack = [];
    this.openPanel(cell !== null && cell.building === Bld.Queen ? 'queen' : 'cell', true, true);
  }

  /** 进入蜂巢内部视图 */
  private enterHive(): void {
    this.view = 'hive';
    this.placing = '';
    this.selectedField = '';
    this.closePanel(false);
    this.session.audio.play('ui_tab');
    this.refreshGame(true);
    this.writeHistory(false);
  }

  /** 扩建离蜂后最近的一格（侧栏“扩建一格”） */
  private expandNext(): void {
    const e = this.engine();
    const candidates = e.run.hive.cells.filter((cell) => e.hive.canExpandCell(cell)).sort((a, b) => a.ring - b.ring);
    if (!e.w.unlocked('t_build_storage')) { this.showToast('建成第一个储蜜格后才能扩建', true); return; }
    if (candidates.length === 0) { this.showToast('已达本种区蜂巢上限', true); return; }
    const affordable = candidates.find((cell) => e.w.econ.canAfford(e.hive.expandCost(cell)));
    if (affordable === undefined) {
      this.showToast(`蜂蜡不足：扩建需要 ${costStr(e.hive.expandCost(candidates[0]))}`, true);
      return;
    }
    const result = e.expand(affordable.cellId);
    this.feedback(result);
    if (result.ok) {
      this.view = 'hive';
      this.selectedCell = affordable.cellId;
      this.focusTarget = `cell:${affordable.cellId}`; this.focusUntil = Date.now() + 2500;
    }
  }

  private onSessionTick(): void {
    if (this.session.status === 'error') {
      this.syncSessionStatus();
      return;
    }
    if (this.screen !== 'game') return;
    this.checkRuntimeEvents();
    this.refreshGame(false);
  }

  private checkRuntimeEvents(): void {
    const now = Date.now();
    if (this.session.pendingOffline !== null && this.offlineReport === null) {
      this.offlineReport = this.session.pendingOffline;
      this.session.pendingOffline = null;
      this.session.audio.play('offline_return');
    }
    if (this.session.recoveredNotice.length > 0) {
      this.showBanner(this.session.recoveredNotice, 'warn');
      this.session.recoveredNotice = '';
    }
    const bear = this.engine().threats.pendingBear();
    if (bear !== null && bear.phase === 'warning') {
      const key = `${bear.eventId}:${bear.postponed}`;
      if (key !== this.bearPromptKey) {
        this.bearPromptKey = key;
        if (this.engine().state.meta.settings.eventAnimations) {
          this.showEvent('熊来袭', '守住蜂巢，或交付少量蜂蜜劝退', 'xf_enemy_bear', 2200);
          this.pendingBearUntil = now + 2200;
        } else this.bearModal = true;
      }
    }
    if (this.pendingBearUntil > 0 && now >= this.pendingBearUntil) {
      this.pendingBearUntil = 0;
      this.eventTitle = '';
      if (bear !== null && bear.phase === 'warning') this.bearModal = true;
    }
    if (this.eventTitle.length > 0 && now >= this.eventUntil && this.pendingBearUntil === 0) this.eventTitle = '';
    if (this.banner.length > 0 && now >= this.bannerUntil) this.banner = '';
    if (this.toastText.length > 0 && now >= this.toastUntil) this.toastText = '';
    if (this.eventTitle.length === 0 && !this.bearModal && this.banner.length === 0) {
      const notice = this.session.popNotice();
      if (notice !== null) {
        if (notice.kind === 'season' && this.engine().state.meta.settings.eventAnimations) {
          this.showEvent(seasonName(this.engine().run.season.season), notice.text,
            seasonIcon(this.engine().run.season.season), 2600);
        } else if (!(notice.kind === 'threat' && notice.text.includes('熊'))) this.showBanner(notice.text, notice.kind);
      }
    }
    const renderer = this.session.renderer;
    if (renderer !== null) {
      renderer.selectedCell = this.selectedCell;
      renderer.selectedField = this.selectedField;
      renderer.placing = this.placing;
      renderer.focus = now < this.focusUntil ? this.focusTarget : this.autoFocus();
      const banners = renderer.takeBanners();
      if (banners.length > 0 && this.banner.length === 0) this.showBanner(banners[0], 'milestone');
    }
    const handoverPending = this.engine().state.meta.tutorialDone && !this.session.guide().seen('handover');
    if (this.introId.length === 0 && this.offlineReport === null && this.placing.length === 0 &&
      (this.panel.length === 0 || handoverPending) && !this.boostModal && this.swarmBonus === 0 && !this.session.ads.busy &&
      now >= this.introGapUntil) {
      const topic = this.session.guide().pendingIntro();
      if (topic !== null) {
        this.introId = topic.id;
        this.introReplay = false;
        this.session.audio.play('codex_new');
      }
    }
  }

  private showBanner(text: string, kind: string): void {
    this.banner = text; this.bannerKind = kind;
    this.bannerUntil = Date.now() + (kind === 'threat' || kind === 'warn' ? 4500 : 3000);
  }

  /** 横幅图标：按消息类型选择已有的图标文件（季节横幅显示当前季节） */
  private bannerIcon(): string {
    switch (this.bannerKind) {
      case 'threat': case 'warn': case 'error': return 'xf_status_danger';
      case 'season': return seasonIcon(this.engine().run.season.season);
      case 'rare': return 'xf_status_rare';
      case 'swarm': return 'xf_nav_split';
      case 'key': return 'xf_action_upgrade';
      case 'achievement': case 'milestone': return 'xf_status_complete';
      default: return 'xf_card_alarm';
    }
  }

  private showEvent(title: string, text: string, eventIcon: string, duration: number): void {
    this.eventTitle = title; this.eventText = text; this.eventIcon = eventIcon;
    this.eventUntil = Date.now() + duration;
  }

  private showToast(text: string, error = false): void {
    this.toastText = text; this.toastUntil = Date.now() + 2600;
    if (error) this.session.audio.play('ui_error');
  }

  /** 激励视频按钮：统一显示“广告”角标和今日剩余次数，不满足条件时置灰并说明原因 */
  private adButton(action: string, label: string, placement: string, options: {
    id?: string; value?: string | number; primary?: boolean; need?: number;
  } = {}): string {
    const check = this.session.ads.check(placement, options.need ?? 1);
    const note = check.ok ? `今日剩余 ${check.remaining}` : check.reason;
    return `<button type="button" class="btn ad-btn ${options.primary === false ? 'ghost' : 'primary'}" data-action="${h(action)}"${options.id === undefined ? '' : ` data-id="${h(options.id)}"`}${options.value === undefined ? '' : ` data-value="${h(options.value)}"`}${check.ok ? '' : ' disabled'}><span class="ad-tag">广告</span><span class="ad-label">${label}<small>${h(note)}</small></span></button>`;
  }

  /** 播放激励视频，看完后执行 reward；未看完或无广告时只提示，不扣任何东西 */
  private runAd(placement: string, count: number, reward: (index: number) => void, done?: (result: WatchResult) => void): void {
    if (this.session.ads.busy) return;
    void this.session.ads.watch(placement, count, reward).then((result) => {
      if (result.completed === 0) this.showToast(result.message, result.status !== 'skipped');
      done?.(result);
      if (result.completed > 0) {
        this.session.audio.play('ui_claim_reward');
        this.session.saveNow();
        // 广告 SDK 未接入时是占位跳过，提示一下，避免误以为广告已经上线
        if (result.placeholder) this.showToast(`${this.toastText.length > 0 ? `${this.toastText} · ` : ''}（广告位占位，已直接发放）`);
      }
      this.refreshGame(true);
    });
  }

  private feedback(result: CmdResult): void {
    this.showToast(result.message, !result.ok);
    this.session.audio.play(result.ok ? 'ui_confirm' : 'ui_error');
  }

  private autoFocus(): string {
    const guide = this.session.guide();
    if (!guide.inTutorial()) return '';
    const hints = guide.hints(3);
    if (hints.some((item) => item.id === 'collect')) return 'field';
    if (hints.some((item) => item.id === 'lay') && this.view === 'field') return 'hiveIcon';
    const scout = hints.find((item) => item.id === `new_${Bld.ScoutRoom}`);
    return scout !== undefined && scout.action.startsWith('build:') ? (this.view === 'field' ? 'hiveIcon' : 'hive') : '';
  }

  private refreshGame(forcePanel: boolean): void {
    if (this.screen !== 'game' || this.root.querySelector('#game-screen') === null) return;
    const renderer = this.session.renderer;
    if (renderer !== null) {
      renderer.selectedCell = this.selectedCell;
      renderer.selectedField = this.selectedField;
      renderer.placing = this.placing;
    }
    const game = this.root.querySelector<HTMLElement>('#game-screen');
    const drawer = this.root.querySelector<HTMLElement>('#game-drawer');
    const scrim = this.root.querySelector<HTMLElement>('#drawer-scrim');
    game?.classList.toggle('drawer-open', this.drawerOpen);
    drawer?.classList.toggle('open', this.drawerOpen);
    scrim?.classList.toggle('visible', this.drawerOpen);
    this.setHtml('#top-bar', this.renderTopBar());
    this.setHtml('#prod-strip', this.renderProdStrip());
    this.setHtml('#hint-line', this.renderHintLine());
    this.setHtml('#placing-bar', this.renderPlacingBar());
    this.setHtml('#field-mini', this.renderFieldMini());
    this.setHtml('#view-toggle', `${icon(this.view === 'field' ? 'xf_nav_hive' : 'xf_flower_wild')}<span>${this.view === 'field' ? '蜂巢' : '花田'}</span>`);
    const drawerView = this.root.querySelector<HTMLElement>('.drawer-view');
    if (drawerView !== null) drawerView.innerHTML = `${icon(this.view === 'field' ? 'xf_nav_hive' : 'xf_flower_wild')} ${this.view === 'field' ? '进入蜂巢' : '返回花田'}`;
    this.setHtml('#drawer-nav', this.renderDrawerNav());
    const back = this.root.querySelector<HTMLElement>('#panel-back');
    if (back !== null) back.hidden = this.panel === 'hub' && this.panelStack.length === 0;
    const now = Date.now();
    // 玩家正在滚动面板时暂停定时重绘，滚动结束后再刷新数据
    const scrolling = now - this.lastScrollAt < 900;
    if ((forcePanel || (now - this.lastPanelRender >= 1000 && !scrolling)) && !this.rangeActive) {
      this.setHtml('#panel-host', this.panel.length > 0 ? this.renderPanel() : '');
      this.lastPanelRender = now;
    }
    const handle = this.root.querySelector<HTMLElement>('#drawer-handle');
    if (handle !== null) {
      const badge = this.badgeCount();
      handle.innerHTML = `${icon('xf_nav_comb')}<span>${this.drawerOpen ? '›' : '‹'}</span>${badge > 0 ? `<b>${badge}</b>` : ''}`;
      handle.setAttribute('aria-label', this.drawerOpen ? '收起功能面板' : '打开功能面板');
    }
    this.setHtml('#runtime-overlays', this.renderRuntimeOverlays());
    this.session.setAudioContext('game', this.view);
  }

  private setHtml(selector: string, value: string): void {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (element === null || element.innerHTML === value) return;
    // 重绘会替换内部的滚动容器：先记下各滚动区域的位置，替换后按“类名 + 序号”还原，避免列表跳回顶部
    const saved: [string, number, number][] = [];
    element.querySelectorAll<HTMLElement>('*').forEach((node) => {
      if (node.scrollTop > 0 || node.scrollLeft > 0) saved.push([this.scrollKey(element, node), node.scrollTop, node.scrollLeft]);
    });
    element.innerHTML = value;
    if (saved.length === 0) return;
    const fresh = new Map<string, HTMLElement>();
    element.querySelectorAll<HTMLElement>('*').forEach((node) => {
      const key = this.scrollKey(element, node);
      if (!fresh.has(key)) fresh.set(key, node);
    });
    saved.forEach(([key, top, left]) => {
      const node = fresh.get(key);
      if (node !== undefined) { node.scrollTop = top; node.scrollLeft = left; }
    });
  }

  /** 滚动区域的稳定标识：同一面板重绘前后保持一致 */
  private scrollKey(host: HTMLElement, node: HTMLElement): string {
    const cls = (node.getAttribute('class') ?? '').trim();
    const selector = cls.length > 0 && /^[\w\s-]+$/.test(cls) ? `.${cls.split(/\s+/).join('.')}` : node.tagName;
    const same = host.querySelectorAll(selector);
    return `${this.panel}|${selector}|${Array.prototype.indexOf.call(same, node)}`;
  }

  private resourceList(): string[] {
    const e = this.engine();
    return ALL_RES.filter((res) => res === Res.Nectar || res === Res.Honey ||
      (res === Res.Wax && e.w.unlocked('t_build_storage')) ||
      (res === Res.Jelly && e.w.econ.num(Res.Jelly) > 0.001));
  }

  private resourceRate(res: string): string {
    const rate = this.engine().rateView;
    let value = 0;
    if (res === Res.Nectar) value = rate.nectarIn + rate.manualIn - rate.nectarUse;
    else if (res === Res.Honey) value = rate.honeyIn - rate.honeyUse - rate.upkeep;
    else if (res === Res.Wax) value = rate.waxIn;
    else {
      value = rate.jellyIn * 60;
      return value > 0 ? `+${num1(value)}/分` : '';
    }
    return Math.abs(value) < 0.05 ? '' : `${value > 0 ? '+' : ''}${num1(value)}/秒`;
  }

  private renderTopBar(): string {
    const e = this.engine();
    const season = e.run.season;
    const threats = e.threats.activeList().length;
    const winterRisk = season.formal && [SeasonId.Autumn, SeasonId.WinterPrep].includes(season.season as SeasonId) &&
      e.w.econ.num(Res.Honey) < e.season.winterNeed();
    const alert = threats > 0
      ? `<button class="status-alert" data-action="open-panel" data-id="eco">${icon('xf_threat_danger')}<b>${threats}</b></button>`
      : (season.starving || winterRisk
        ? `<button class="status-alert" data-action="open-panel" data-id="eco">${icon(season.starving ? 'xf_status_insufficient' : 'xf_season_winter_prep')}</button>` : '');
    const resources = this.resourceList().map((res) => {
      const full = e.w.econ.fillRatio(res) >= 0.95;
      const rate = this.resourceRate(res);
      return `<div class="resource-chip${full ? ' full' : ''}">${icon(resIcon(res), resName(res))}<span><b>${formatBig(e.w.econ.amount(res))}</b>${rate.length > 0 ? `<small>${h(rate)}</small>` : ''}</span></div>`;
    }).join('');
    const boost = this.session.ads.boostSpeed();
    const boostChip = boost > 1
      ? `<button class="boost-chip active" data-action="open-boost">⚡${boost}× <small>${clock(this.session.ads.boostRemainingSec())}</small></button>`
      : `<button class="boost-chip" data-action="open-boost">⚡加速</button>`;
    return `${boostChip}<button class="season-chip" data-action="open-panel" data-id="eco">${icon(seasonIcon(season.season), seasonName(season.season))}<span><b>${h(seasonName(season.season))}</b>${season.formal ? `<small>${formatDuration(e.season.remaining())}</small>` : ''}</span></button>${alert}<button class="resource-scroll" data-action="open-resources">${resources}</button>`;
  }

  /** 工种巢房的等级：该巢房全部属性升级等级之和 */
  private buildingLevel(building: string): number {
    const e = this.engine();
    return e.w.cfg.tracks.filter((track) => track.building === building)
      .reduce((sum, track) => sum + e.hive.trackLevel(track.id), 0);
  }

  /** 资源栏下方的产线条：采蜜 → 酿蜜 → 蜂蜜，以及各蜂种数量、等级和运行效率 */
  private renderProdStrip(): string {
    const e = this.engine();
    const rate = e.rateView;
    const nectarIn = rate.nectarIn + rate.manualIn;
    const capacity = e.prod.baseConvertCapacity() + e.prod.brewCapacity();
    const used = rate.nectarUse;
    const load = capacity > 0 ? Math.max(0, Math.min(1, used / capacity)) : 0;
    const stock = e.w.econ.num(Res.Nectar);
    let state = '';
    if (stock > 1 && load >= 0.95) state = nectarIn > used * 1.05 ? '酿不完' : '满负荷';
    else if (stock <= 1 && nectarIn < capacity * 0.5) state = '缺花蜜';
    const flow = `<div class="prod-flow">
      <span class="prod-node">${icon('xf_res_nectar', '花蜜')}<b>采蜜</b><em>+${num1(nectarIn)}/秒</em></span>
      <span class="prod-bar" title="酿蜜效率"><i style="width:${Math.round(load * 100)}%"></i><span>酿蜜 ${num1(used)}/秒 · 负荷 ${pct(load)}${state.length > 0 ? ` · ${h(state)}` : ''}</span></span>
      <span class="prod-node">${icon('xf_res_honey', '蜂蜜')}<b>蜂蜜</b><em>+${num1(rate.honeyIn)}/秒</em></span>
    </div>`;
    const chips: string[] = [];
    const known = e.map.knownFields().length;
    const split = e.prod.houseSplit();
    const roleLine: Record<string, string> = {
      [Role.Forager]: `运蜜 ${num1(rate.nectarIn)}/秒`,
      [Role.House]: `酿蜜 ${split[0]}/${e.prod.brewSlots()} · 产能${num1(e.prod.brewCapacity())}/秒${split[1] > 0 ? ` · 筑巢 ${split[1]}` : ''}`,
      [Role.Scout]: `发现效率${num1(e.w.attrs.get('scout.discovery'))}倍 · 花田${known}`,
      [Role.Guard]: `攻击效率${num1(e.w.attrs.get('guard.attack'))}倍 · 敌害${e.threats.activeList().length}`
    };
    [Role.Forager, Role.House, Role.Scout, Role.Guard].forEach((role) => {
      const building = e.w.roleDef(role).building;
      if (e.w.role(role) === 0 && e.w.count(building) === 0) return;
      const injured = e.w.injured(role);
      chips.push(`<span class="prod-chip">${icon(roleIcon(role))}<b>${h(e.w.roleDef(role).name)} ${e.w.role(role)}</b><small>Lv${this.buildingLevel(building)} · ${h(roleLine[role] ?? '')}${injured > 0 ? ` · 休养${injured}` : ''}</small></span>`);
    });
    if (e.w.count(Bld.Brewery) > 0) {
      chips.splice(Math.min(1, chips.length), 0, `<span class="prod-chip">${icon('xf_building_brewery')}<b>酿蜜房 ${e.w.count(Bld.Brewery)}</b><small>Lv${this.buildingLevel(Bld.Brewery)} · 产能 ${num1(capacity)}/秒</small></span>`);
    }
    const action = e.colony.roleAvailable(Role.Forager) || e.colony.roleAvailable(Role.House) ? 'colony' : 'resources';
    return `<button type="button" class="prod-strip" data-action="open-panel" data-id="${action}">${flow}${chips.length > 0 ? `<div class="prod-chips">${chips.join('')}</div>` : ''}</button>`;
  }

  private visibleHints(): Hint[] {
    const guide = this.session.guide();
    const hints = guide.hints(2);
    return guide.inTutorial() ? hints : hints.filter((item) => item.kind === 'warn' || item.kind === 'new');
  }

  private renderHintLine(): string {
    const hints = this.visibleHints();
    if (hints.length === 0 || hints[0].id === this.hiddenHint) return '';
    const item = hints[0];
    return `<div class="hint-line ${h(item.kind)}"><button class="hint-main" data-action="run-hint" data-id="${h(item.action)}">${icon(item.icon)}<span>${h(item.text)}</span>${hints.length > 1 ? `<b>+${hints.length - 1}</b>` : ''}<i>›</i></button><button class="hint-close" data-action="hide-hint" data-id="${h(item.id)}" aria-label="隐藏提示">${icon('xf_action_close')}</button></div>`;
  }

  private renderPlacingBar(): string {
    if (this.placing.length === 0) return '';
    const def = this.engine().w.bldDef(this.placing);
    return `<div class="placing-bar">${icon(bldIcon(this.placing))}<span>点一个发光的空格，放置「${h(def.name)}」</span>${button('cancel-place', '取消')}</div>`;
  }

  private renderFieldMini(): string {
    if (this.view !== 'field' || this.drawerOpen || this.selectedField.length === 0) return '';
    const field = this.engine().w.field(this.selectedField);
    if (field === null) return '';
    return `<button class="field-mini" data-action="open-panel" data-id="field">${icon(flowerIcon(field.flower))}<span>${h(this.engine().w.flower(field.flower).name)} · 存量 ${Math.floor(field.stock)}</span><b>查看详情 ›</b></button>`;
  }

  private dockItems(): string[] {
    const e = this.engine();
    const out = ['tasks'];
    if (e.w.unlocked('t_first_egg') || e.w.unlocked('t_first_nectar')) out.push('build');
    if (e.w.unlocked('t_first_forager')) out.push('colony');
    if (e.run.season.formal || e.w.unlocked('t_build_brewery')) out.push('eco');
    if (e.w.count(Bld.Evolution) > 0 || e.state.meta.inheritance.unlocked) out.push('evolution');
    if (e.w.unlocked('t_survive_winter')) out.push('swarm');
    if (e.w.unlocked('t_build_storage')) out.push('resources');
    if (e.w.unlocked('t_first_egg')) out.push('codex');
    out.push('settings');
    return out;
  }

  private navBadge(key: string): boolean {
    const e = this.engine();
    if (key === 'tasks') return this.session.guide().hints(3).some((item) => item.kind === 'warn' || item.kind === 'new');
    if (key === 'build') return e.hive.buildingOptions().some((def) => e.w.count(def.id) === 0 &&
      e.hive.buildingAvailable(def.id) && e.w.econ.canAfford(e.hive.buildCost(def.id)));
    if (key === 'eco') return e.threats.activeList().length > 0 || e.run.season.starving;
    if (key === 'swarm') return e.swarmPreview().ready;
    return false;
  }

  private badgeCount(): number { return this.dockItems().filter((key) => this.navBadge(key)).length; }

  private renderDrawerNav(): string {
    return this.dockItems().map((key) => {
      const [label, itemIcon] = NAV[key];
      return `<button type="button" class="nav-item${this.panel === key ? ' active' : ''}" data-action="open-panel" data-id="${key}">${icon(itemIcon)}<span>${h(label)}</span>${this.navBadge(key) ? '<i></i>' : ''}</button>`;
    }).join('');
  }

  private panelFrame(title: string, frameIcon: string, body: string): string {
    return `<section class="panel-frame"><header>${frameIcon.length > 0 ? icon(frameIcon) : ''}<h2>${h(title)}</h2></header><div class="panel-scroll">${body}</div></section>`;
  }

  private renderPanel(): string {
    if (this.panel === 'hub') return this.renderHubPanel();
    if (this.panel === 'queen') return this.renderQueenPanel();
    if (this.panel === 'tasks') return this.renderTaskPanel();
    if (this.panel === 'build') return this.renderBuildListPanel();
    if (this.panel === 'colony') return this.renderColonyPanel();
    if (this.panel === 'cell') return this.renderCellPanel();
    if (this.panel === 'upgrade') return this.renderUpgradePanel();
    if (this.panel === 'field') return this.renderFieldPanel();
    if (this.panel === 'eco') return this.renderEcoPanel();
    if (this.panel === 'evolution') return this.renderEvolutionPanel();
    if (this.panel === 'swarm') return this.renderSwarmPanel();
    if (this.panel === 'resources') return this.renderResourcePanel();
    if (this.panel === 'codex') return this.renderCodexPanel();
    if (this.panel === 'settings') return this.renderSettingsPanel();
    return this.panelFrame('功能', 'xf_nav_hive', '<p class="muted">请选择一项功能。</p>');
  }

  private upgradeReady(building: string): boolean {
    const e = this.engine();
    return e.w.cfg.tracks.some((track) => track.building === building && e.hive.trackLevel(track.id) < track.maxLevel &&
      e.w.econ.canAfford(e.hive.upgradeCost(track)));
  }

  private renderHubPanel(): string {
    const e = this.engine();
    const roles = ALL_ROLES.filter((role) => e.colony.roleAvailable(role));
    const built = e.w.cfg.buildings.filter((def) => e.w.count(def.id) > 0);
    const newly = e.hive.buildingOptions().filter((def) => e.w.count(def.id) === 0 && e.hive.buildingAvailable(def.id));
    const roleButtons = roles.map((role) => button('hatch', `${icon(roleIcon(role))}+1`, {
      id: role, value: 1, disabled: e.run.colony.larvae <= 0 || !e.w.econ.canAfford(e.colony.roleCost(role))
    })).join('');
    const queen = panelCard(`<div class="card-head large-icon">${icon('xf_nav_queen')}<div><h3>蜂后</h3><p>${h(`孵化新卵消耗 ${costStr(e.colony.eggCost())}${e.run.colony.layCooldown > 0 ? ` · 休息 ${Math.ceil(e.run.colony.layCooldown)} 秒` : ''}`)}</p><small>手动孵化，亲自选择工种分化</small></div>${button('lay', '孵化新卵', { primary: true, disabled: !e.colony.canLay().ok })}</div>${roles.length > 0 ? `<div class="quick-row"><span>培养</span>${roleButtons}</div>` : ''}<button class="text-link" data-action="open-panel" data-id="queen">蜂后详情、分化与蜂后室升级 ›</button>`);
    const buildings = built.map((def) => panelCard(`<button class="list-button" data-action="open-upgrade" data-id="${h(def.id)}">${icon(bldIcon(def.id))}<span><b>${h(def.name)}${e.w.count(def.id) > 1 ? ` ×${e.w.count(def.id)}` : ''}</b></span>${this.upgradeReady(def.id) ? '<em>可升级</em>' : ''}<i>升级 ›</i></button>`)).join('');
    const newBuildings = newly.length === 0 ? '' : `<h3 class="section-title">新开放的巢房</h3>${newly.map((def) => `<div class="compact-row">${icon(bldIcon(def.id))}<span><b>${h(def.name)}</b><small>${h(costStr(e.hive.buildCost(def.id)))}</small></span>${button('start-place', '放置', { id: def.id })}</div>`).join('')}`;
    const expandRow = e.w.unlocked('t_build_storage') ? `<div class="compact-row">${icon('xf_action_expand')}<span><b>扩建蜂巢</b><small>${h(e.run.hive.cells.some((cell) => e.hive.canExpandCell(cell)) ? `下一格 ${costStr(e.hive.expandCost(e.run.hive.cells.filter((cell) => e.hive.canExpandCell(cell)).sort((a, b) => a.ring - b.ring)[0]))}` : '已达本种区上限')}</small></span>${button('expand-next', '扩建一格')}</div>` : '';
    return this.panelFrame('蜂巢', 'xf_nav_hive', `<p>蜂群 ${e.w.adults()} 只 · 上限 ${e.w.popCap()} · 幼虫 ${e.run.colony.larvae}</p>${queen}<h3 class="section-title">巢房</h3>${buildings}${newBuildings}${expandRow}${button('enter-hive', '进入蜂巢 ›', { primary: true })}`);
  }

  private renderUpgradeList(building: string): string {
    const e = this.engine();
    const tracks = e.w.cfg.tracks.filter((track) => track.building === building);
    if (tracks.length === 0) return '<p class="muted">此巢房没有可升级属性。</p>';
    return tracks.map((track) => {
      const preview = e.previewUpgrade(track.id);
      const maxed = preview.level >= preview.maxLevel;
      const value = maxed
        ? `Lv${preview.level}（满级） 当前 ${num1(preview.cur)}${preview.unit}`
        : `Lv${preview.level} → ${preview.level + 1}　${num1(preview.cur)} → ${num1(preview.next)} ${preview.unit}`;
      const delta = Math.abs(preview.honeyPerMinDelta) >= 0.05
        ? `预计蜂蜜产量 ${preview.honeyPerMinDelta >= 0 ? '+' : ''}${num1(preview.honeyPerMinDelta)}/分钟 · ` : '';
      return panelCard(`<div class="card-head">${icon(`xf_stat_${track.id.replace('.', '_')}`)}<div><h3>${h(preview.name)}</h3><p>${h(value)}</p><small>${h(`${delta}升级消耗 ${costStr(preview.costs)}`)}</small>${preview.keyNote.length > 0 ? `<em class="key-note">关键节点 ${h(preview.keyNote)}</em>` : ''}</div>${button('upgrade', '升级', { id: track.id, primary: true, disabled: maxed || !preview.affordable })}</div>`);
    }).join('');
  }

  private renderQueenPanel(): string {
    const e = this.engine();
    const colony = e.run.colony;
    const roles = ALL_ROLES.filter((role) => e.w.unlocked(e.w.bldDef(e.w.roleDef(role).building).unlockTask) || e.w.role(role) > 0);
    const roleCards = roles.map((role) => {
      const def = e.w.roleDef(role);
      const available = e.colony.roleAvailable(role);
      const can = available && colony.larvae > 0 && e.w.econ.canAfford(e.colony.roleCost(role));
      const line = available ? `拥有 ${e.w.role(role)} · ${costStr(e.colony.roleCost(role))} · 孵化 ${Math.ceil(e.colony.hatchTime(role))} 秒`
        : `需要先建造${e.w.bldDef(def.building).name}`;
      return panelCard(`<div class="card-head">${icon(roleIcon(role))}<div><h3>${h(def.name)}</h3><p>${h(line)}</p><small>${h(def.desc)}</small></div><div class="button-pair">${button('hatch', '×1', { id: role, value: 1, primary: true, disabled: !can })}${button('hatch', '×5', { id: role, value: 5, disabled: !can })}</div></div>`);
    }).join('');
    const batches = colony.batches.length === 0 ? '<p class="muted">队列为空</p>' : colony.batches.slice(0, 12).map((batch) => {
      const text = batch.started
        ? `${e.w.roleDef(batch.targetRole).name} · 剩余 ${formatDuration(batch.finishAt - e.run.time)}`
        : `${e.w.roleDef(batch.targetRole).name} · 排队中`;
      return `<div class="compact-row">${icon(roleIcon(batch.targetRole))}<span>${h(text)}</span>${button('cancel-batch', batch.started ? '取消（返还50%）' : '取消', { id: String(batch.batchId) })}</div>`;
    }).join('');
    const canLay = e.colony.canLay();
    return this.panelFrame('蜂后与幼虫', 'xf_nav_queen', `<p>蜂群 ${e.w.population()} / ${e.w.popCap()}（成年 ${e.w.adults()}，幼虫 ${colony.larvae}，孵化中 ${e.w.inHatch()}）</p><div class="action-line">${button('lay', '孵化新卵', { primary: true, disabled: !canLay.ok })}<span>孵化新卵消耗 ${h(costStr(e.colony.eggCost()))}${colony.layCooldown > 0 ? ` · 休息 ${Math.ceil(colony.layCooldown)} 秒` : ''}</span></div>${!canLay.ok ? `<p class="warning">${h(canLay.message)}</p>` : ''}<p class="muted">每次点击孵化获得幼虫，然后选择工种分化。新卵费用随累计孵化次数递增，离线不会自动繁育。</p><hr><h3 class="section-title">选择幼虫分化工种</h3>${roleCards}<hr><h3 class="section-title">孵化队列 ${colony.batches.filter((batch) => batch.started).length} / ${e.colony.hatchSlots()}</h3>${batches}<hr><h3 class="section-title">蜂后室升级</h3>${this.renderUpgradeList(Bld.Queen)}`);
  }

  private toggleButton(key: string, on: boolean): string {
    return `<button type="button" class="switch ${on ? 'on' : 'off'}" role="switch" aria-checked="${on}" data-action="toggle-setting" data-id="${h(key)}"><span></span></button>`;
  }

  private range(action: string, id: string, value: number, min: number, max: number, step: number, label: string): string {
    return `<label class="range-row"><span>${h(label)}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-range="${h(action)}" data-id="${h(id)}" aria-label="${h(label)}"><output>${h(value)}</output></label>`;
  }

  private renderColonyPanel(): string {
    const e = this.engine();
    const colony = e.run.colony;
    const roles = ALL_ROLES.filter((role) => e.colony.roleAvailable(role));
    const roleCards = roles.map((role) => {
      const injured = e.w.injured(role);
      let extra = '';
      if (role === Role.Forager) extra = ` · 授粉 ${e.map.pollinatorTotal()} · 空闲 ${Math.floor(e.w.forageIdle)}`;
      if (role === Role.House) {
        const split = e.prod.houseSplit();
        extra = ` · 酿蜜 ${split[0]} · 筑巢 ${split[1]}${split[2] > 0 ? ` · 缺槽位 ${split[2]}` : ''}`;
      }
      return panelCard(`<div class="card-head">${icon(roleIcon(role))}<div><h3>${h(e.w.roleDef(role).name)}</h3><p>${e.w.role(role)} 只${injured > 0 ? `（受伤休养 ${injured}）` : ''}${h(extra)}</p>${button('open-panel', '孵化与分化', { id: 'queen' })}</div></div>`);
    }).join('');
    let injuredTotal = 0;
    [Role.Forager, Role.House, Role.Scout, Role.Guard].forEach((role) => { injuredTotal += e.w.injured(role); });
    const need = Math.ceil(e.season.winterNeed());
    const have = Math.floor(e.w.econ.num(Res.Honey));
    const winter = e.run.season.formal
      ? `越冬预估：需要 ${need} 蜂蜜 · 当前 ${have} · ${have >= need ? '储备充足' : `缺少 ${need - have}`}`
      : '建成储蜜格后开启四季与越冬预算';
    const strategy = colony.forageStrategy;
    const strategyButtons = [
      [ForageStrategy.Safe, '安全近路'], [ForageStrategy.Balanced, '均衡'], [ForageStrategy.Rich, '高产远路']
    ].map(([id, label]) => button('set-strategy', label, { id, primary: strategy === id })).join('');
    const guards = [
      [GuardPriority.Balanced, '均衡'], [GuardPriority.Gate, '巢门'], [GuardPriority.Fields, '花田'],
      [GuardPriority.Routes, '航线']
    ].map(([id, label]) => button('set-guard', label, { id, primary: colony.guardPriority === id })).join('');
    const wax = Math.round(colony.houseWaxShare * 100);
    const idle = e.w.forageIdle >= 1
      ? `<p class="warning">${Math.floor(e.w.forageIdle)} 只采集蜂没有可去的花田：派侦察蜂探索更远处，或升级侦察范围</p>` : '';
    return this.panelFrame('蜂群管理', 'xf_nav_swarm', `${panelCard(`<h3>成年蜂 ${e.w.adults()} · 幼虫 ${colony.larvae} · 孵化中 ${e.w.inHatch()} · 总占用 ${e.w.population()}/${e.w.popCap()}</h3><small>${h(winter)}</small>`)}${roles.length === 0 ? `${artImage('state_no_tasks', '暂无工种', 'empty-art')}<p class="muted">建造工种巢房后，可以在这里管理蜂群。</p>` : roleCards}${idle}${injuredTotal > 0 ? `<p class="muted">${icon('xf_status_injured')} ${injuredTotal} 只蜜蜂受伤休养中，会逐渐恢复</p>` : ''}<h3 class="section-title">采集路线策略</h3><div class="choice-row">${strategyButtons}</div><p class="muted">安全近路减少受伤；高产远路收益更高但更危险。</p>${e.colony.roleAvailable(Role.House) && e.w.unlocked('t_build_storage') ? `<h3 class="section-title">巢内工蜂分工：筑巢 ${wax}%，酿蜜 ${100 - wax}%</h3>${this.range('wax-share', 'wax', wax, 0, 100, 5, '筑巢比例')}<p class="muted">筑巢消耗蜂蜜产出蜂蜡；酿蜜把花蜜加工为蜂蜜。</p>` : ''}${e.colony.roleAvailable(Role.Guard) ? `<h3 class="section-title">守卫优先区域</h3><div class="choice-row">${guards}</div>` : ''}${e.colony.lifespanWarning() ? '<p class="warning">生态模式预警：工蜂老化速度快于补员，请手动孵化并分化新工蜂。</p>' : ''}`);
  }

  private renderBuildListPanel(): string {
    const e = this.engine();
    const defs = e.w.cfg.buildings.filter((def) => def.id !== Bld.Queen);
    const free = e.run.hive.cells.filter((cell) => cell.unlocked && cell.building.length === 0).length;
    const cards = defs.map((def) => {
      const unlocked = e.w.unlocked(def.unlockTask);
      const available = e.hive.buildingAvailable(def.id);
      const can = available && e.w.econ.canAfford(e.hive.buildCost(def.id)) && free > 0;
      let line = '';
      if (!unlocked) {
        const task = e.w.cfg.tasks.find((item) => item.id === def.unlockTask);
        line = task === undefined ? '尚未开放' : `完成「${task.name}」后开放`;
      } else if (e.w.count(def.id) >= def.maxCount) line = `已达上限 ${def.maxCount}`;
      else {
        const shortage = e.reasonsForShortage(e.hive.buildCost(def.id));
        line = `${costStr(e.hive.buildCost(def.id))} · 已有 ${e.w.count(def.id)}${shortage.length > 0 ? ` · ${shortage}` : ''}`;
      }
      return panelCard(`<div class="card-head${unlocked ? '' : ' locked'}">${icon(bldIcon(def.id))}<div><h3>${h(unlocked ? def.name : `${def.name}（未开放）`)}</h3><p>${h(def.desc)}</p><small class="${can ? 'ok' : 'warning-text'}">${h(line)}</small></div>${available ? button('start-place', '放置', { id: def.id, primary: true, disabled: !can }) : ''}</div>`);
    }).join('');
    const nextExpand = e.run.hive.cells.filter((cell) => e.hive.canExpandCell(cell)).sort((a, b) => a.ring - b.ring)[0];
    const expandCostText = nextExpand === undefined ? '已达本种区上限' : `下一格 ${costStr(e.hive.expandCost(nextExpand))}，现有蜂蜡 ${Math.floor(e.w.econ.num(Res.Wax))}`;
    const expand = `<div class="compact-row">${icon('xf_action_expand')}<span><b>扩建蜂巢</b><small>${e.w.unlocked('t_build_storage') ? `点蜂巢外圈带“+”的格子即可扩建 · ${expandCostText}` : '建成第一个储蜜格后开放'}</small></span>${e.w.unlocked('t_build_storage') ? `${button('expand-next', '扩建一格', { primary: true })}${button('focus-expand', '去蜂巢选格')}` : ''}</div>`;
    return this.panelFrame('建造', 'xf_action_build', `<p class="muted">${free > 0 ? `选好巢房后，在蜂巢里点一个发光的空格放置（空格 ${free} 个）` : '蜂巢没有空格了：先扩建外圈的格子'}</p>${cards}<hr>${expand}`);
  }

  private cellMode(cell: HexCell | null): string {
    if (cell === null) return 'none';
    if (!cell.unlocked) return this.engine().hive.canExpandCell(cell) ? 'expand' : 'locked';
    return cell.building.length === 0 ? 'empty' : 'building';
  }

  private renderCellPanel(): string {
    const e = this.engine();
    const cell = e.hive.cell(this.selectedCell);
    const mode = this.cellMode(cell);
    if (cell === null) return this.panelFrame('巢格', 'xf_nav_hive', '<p class="muted">巢格不存在或已经变化。</p>');
    if (mode === 'expand') {
      const can = e.w.unlocked('t_build_storage') && e.w.econ.canAfford(e.hive.expandCost(cell));
      const short = e.reasonsForShortage(e.hive.expandCost(cell));
      return this.panelFrame('扩建格子', 'xf_action_expand', `<p>第 ${cell.ring} 圈 · 消耗 ${h(costStr(e.hive.expandCost(cell)))}</p>${short.length > 0 ? `<p class="warning">${h(short)}：巢内工蜂筑巢会产出蜂蜡（「蜂群」里调整筑巢比例）</p>` : ''}<p class="muted">扩建后可以建造新的巢房；外圈越大成本越高，同时提高人口上限。</p>${button('expand-cell', '确认扩建', { primary: true, disabled: !can })}`);
    }
    if (mode === 'locked') {
      let text = '只能扩建与现有蜂巢相邻的格子';
      if (!e.w.unlocked('t_build_storage')) text = '建成第一个储蜜格后解锁蜂蜡与扩建';
      else if (cell.ring > e.w.region().maxRing) text = '已达本种区蜂巢上限';
      return this.panelFrame('扩建格子', 'xf_action_expand', `<p class="warning">${icon('xf_status_locked')} ${h(text)}</p>`);
    }
    if (mode === 'empty') {
      const options = e.hive.buildingOptions().map((def) => {
        const can = e.hive.buildingAvailable(def.id) && e.w.econ.canAfford(e.hive.buildCost(def.id));
        const shortage = e.reasonsForShortage(e.hive.buildCost(def.id));
        const line = e.w.count(def.id) >= def.maxCount ? `已达上限 ${def.maxCount}`
          : `${costStr(e.hive.buildCost(def.id))} · 已有 ${e.w.count(def.id)}`;
        return panelCard(`<div class="card-head">${icon(bldIcon(def.id))}<div><h3>${h(def.name)}</h3><p>${h(def.desc)}</p><small>布局：${h(def.adjacency)}</small><small class="${can ? 'ok' : 'warning-text'}">${h(line)}${!can && shortage.length > 0 ? ` · ${h(shortage)}` : ''}</small></div>${button('build-cell', '建造', { id: def.id, primary: true, disabled: !can })}</div>`);
      }).join('');
      return this.panelFrame('建造巢房', 'xf_action_build', options || '<p class="muted">目前没有可建造的巢房。</p>');
    }
    const def = e.w.bldDef(cell.building);
    const notes = e.hive.describeCell(cell).map((note) => `<li>${h(note)}</li>`).join('');
    const demolish = cell.building === Bld.Queen ? '' : button('confirm-demolish', `${icon('xf_action_delete')} 拆除`, { danger: true });
    return this.panelFrame(def.name, bldIcon(def.id), `<p>${h(def.desc)}</p>${notes.length > 0 ? `<ul class="detail-list">${notes}</ul>` : ''}${demolish}<hr><h3 class="section-title">属性升级（作用于该工种的全部蜜蜂）</h3>${this.renderUpgradeList(def.id)}`);
  }

  private upgradeBuildings(): string[] {
    const e = this.engine();
    const out: string[] = [];
    e.w.cfg.tracks.forEach((track) => {
      if (!out.includes(track.building) && e.w.count(track.building) > 0) out.push(track.building);
    });
    return out;
  }

  private renderUpgradePanel(): string {
    const e = this.engine();
    const tabs = this.upgradeBuildings();
    if (!tabs.includes(this.upgradeBuilding)) this.upgradeBuilding = tabs[0] ?? Bld.Queen;
    const tabHtml = tabs.map((building) => button('upgrade-tab', `${icon(bldIcon(building))}${h(e.w.bldDef(building).name)}`, {
      id: building, primary: this.upgradeBuilding === building
    })).join('');
    return this.panelFrame('巢房升级', 'xf_action_upgrade', `<div class="tab-row">${tabHtml}</div><p class="muted">升级作用于该工种的全部蜜蜂；关键等级会解锁新的规则。</p>${tabs.length === 0 ? '<p class="muted">建造巢房后即可升级。</p>' : this.renderUpgradeList(this.upgradeBuilding)}`);
  }

  private fieldLines(field: FlowerField): string[] {
    const e = this.engine();
    const def = e.w.flower(field.flower);
    const out = [
      `距离 ${Math.round(field.dist)} · 往返约 ${Math.round(e.map.tripTime(field))} 秒 · 危险 ${pct(field.danger)}`,
      `花蜜存量 ${Math.floor(field.stock)} / ${Math.floor(e.map.maxStock(field))} · ${e.map.recoveryRemaining(field) > 0 ? `重新开花剩余 ${Math.ceil(e.map.recoveryRemaining(field))} 秒` : `恢复 ${num1(e.map.regen(field))}/秒`} · 品质 ×${def.yieldMul}`
    ];
    if (field.home) out.push('蜂巢旁的花丛，信息永久有效');
    else if (e.map.intelValid(field)) out.push(`侦察信息剩余 ${formatDuration(field.intelExpiresAt - e.run.time)}${field.danceBonusUntil > e.run.time ? ' · 摇摆舞导航加成 +15%' : ''}`);
    else out.push('侦察信息已过期：采集蜂暂不前往，等待侦察蜂重新侦察');
    const alloc = e.w.alloc.find((item: ForageAlloc) => item.fieldId === field.fieldId);
    out.push(`正在采集的蜜蜂 ${alloc === undefined ? 0 : Math.round(alloc.bees)}`);
    if (field.webbed) out.push('被蜘蛛网覆盖：路线效率降低，需要守卫蜂清理');
    if (def.next.length > 0) out.push(`授粉成长 ${pct(field.growth / e.map.growthNeeded(field))} → ${e.w.flower(def.next).name}`);
    else out.push(`授粉成长 ${pct(field.growth / e.map.growthNeeded(field))} → 等级 ${field.level + 1}`);
    if (def.jellyPerTrip > 0) out.push('稀有花田：采集时有机会获得蜂王浆');
    return out;
  }

  private renderFieldPanel(): string {
    const e = this.engine();
    const field = e.w.field(this.selectedField);
    if (field === null) return this.panelFrame('花田', 'xf_flower_unknown', '<p class="muted">请先在花田场景中选择一片花田。</p>');
    const def = e.w.flower(field.flower);
    const expired = !field.home && !e.map.intelValid(field);
    const withered = field.stock < e.map.maxStock(field) * 0.08 || e.run.season.season === SeasonId.Winter;
    const pollUnlocked = e.w.unlocked('t_build_storage') && e.w.role(Role.Forager) > 1;
    const poll = e.run.colony.pollinators[field.fieldId] ?? 0;
    const maxPoll = Math.max(1, Math.min(30, Math.floor(e.w.active(Role.Forager) * 0.5)));
    return this.panelFrame(def.name, flowerIcon(field.flower), `${expired ? `<p class="warning">${icon('xf_field_expired')} 信息已过期</p>` : ''}${withered ? `<p class="muted">${icon('xf_field_withered')} ${e.run.season.season === SeasonId.Winter ? '冬季休眠：花蜜几乎不再恢复' : '花蜜快被采空了，可以等待恢复或寻找更多花源'}</p>` : ''}${this.fieldLines(field).map((line) => `<p>${h(line)}</p>`).join('')}${button('collect-field', e.map.recoveryRemaining(field) > 0 ? `恢复中 ${Math.ceil(e.map.recoveryRemaining(field))}秒` : '采集一次', { primary: true, disabled: e.map.recoveryRemaining(field) > 0 })}${pollUnlocked ? `<hr><h3 class="section-title">${icon('xf_talent_e_pollen')} 授粉特化：驻守 ${poll} 只采集蜂</h3>${this.range('pollinators', field.fieldId, poll, 0, maxPoll, 1, '驻守采集蜂')}<p class="muted">驻守的采集蜂不运蜜，但会提高花田恢复速度并让它成长为更高级的花田（会吸引更强敌害）。</p>` : ''}`);
  }

  private renderEcoPanel(): string {
    const e = this.engine();
    const season = e.run.season;
    const seasonDef = e.w.seasonDef();
    const seasonLine = season.formal
      ? `${seasonName(season.season)} · ${formatDuration(e.season.remaining())}后换季 · 第 ${season.cycleIndex + 1} 轮`
      : '新手春季：建成第一个储蜜格后开启正式四季';
    const effects = [
      `花蜜产量 ×${seasonDef.nectarMul} · 产卵 ×${seasonDef.layMul} · 酿蜜 ×${seasonDef.brewMul} · 敌害活跃 ×${seasonDef.threatMul}`,
      `种区：${e.w.region().name}（${e.w.region().rule}）`
    ];
    if (season.formal) {
      const need = e.season.winterNeed();
      const have = e.w.econ.num(Res.Honey);
      effects.push(`预计越冬需要 ${Math.ceil(need)} 蜂蜜，当前储备 ${Math.floor(have)}（${have >= need ? '充足' : '不足'}）`);
      effects.push(`已度过冬季 ${season.wintersSurvived} 次${season.firstWinterProtected ? ' · 首个冬季受保护：只降低产量' : ''}`);
    }
    if (season.starving) effects.push('当前储蜜不足：采集与加工效率减半');
    const collapsed = e.run.colony.collapsed ? panelCard(`<h3 class="danger-text">蜂群衰败</h3><p>存档仍然保留。可以消耗1点传承在当前种区重启，或读取最近一次入冬前快照。</p><div class="choice-stack">${this.adButton('ad-revive', '免费重振蜂群（不消耗传承）', AdPlacement.ColonyRevive)}${button('recover-colony', '消耗1点传承重启', { primary: false })}${button('restore-winter', '读取入冬前快照')}</div>`, true) : '';
    const supply = winterSupplyWanted(e) ? panelCard(`<h3>${icon('xf_season_winter_prep')} 储备告急</h3><p>邻近蜂巢愿意支援一批蜂蜜（约 ${Math.round(winterSupplyAmount(e))}），帮你熬过这个冬天。</p>${this.adButton('ad-winter-supply', '领取紧急补给', AdPlacement.WinterSupply)}`) : '';
    const guardsByArea = e.threats.guardsByArea;
    const guardParts = Object.keys(guardsByArea).map((key) => `${key === 'gate' ? '巢门' : (key === 'fields' ? '花田' : '航线')} ${Math.round(guardsByArea[key])}`);
    const guardInjured = e.w.injured(Role.Guard);
    const guardLine = `守卫蜂 ${e.w.role(Role.Guard)}${guardInjured > 0 ? `（休养 ${guardInjured}）` : ''}${guardParts.length > 0 ? ` · 出动：${guardParts.join('，')}` : ' · 待命'}`;
    const threats = e.threats.activeList();
    const threatCards = threats.map((event) => {
      const def = e.threats.def(event.type);
      const field = event.targetId === 'hive' ? null : e.w.field(event.targetId);
      const where = event.targetId === 'hive' ? '巢门' : (field === null ? '花田' : e.w.flower(field.flower).name);
      let phase = '交战中';
      if (event.phase === 'warning') phase = `${Math.max(0, Math.ceil(event.endsAt - e.run.time))} 秒后到达`;
      else if (event.phase === 'postponed') phase = `暂时离开，${formatDuration(event.endsAt - e.run.time)}后返回`;
      const bearActions = event.type === 'bear' && event.phase !== 'active'
        ? `<div class="choice-row">${button('bear-choice', '集结防守', { id: event.eventId, value: 'defend', primary: true })}${button('bear-choice', '交付蜂蜜', { id: event.eventId, value: 'tribute' })}${button('bear-choice', '稍后处理', { id: event.eventId, value: 'later' })}</div>${this.adButton('ad-bear-aid', '请邻巢援军', AdPlacement.BearAid, { id: event.eventId, primary: false })}` : '';
      return panelCard(`<div class="card-head">${icon(threatIcon(event.type))}<div><h3>${h(def.name)} @ ${h(where)}</h3><p>${h(phase)} · 剩余 ${Math.max(0, Math.ceil(event.hp))}/${Math.ceil(event.maxHp)}</p><small>${h(def.desc)}</small></div></div>${bearActions}`, true);
    }).join('');
    const injured = e.w.injured(Role.Forager) + e.w.injured(Role.House);
    let threatSection = '<p class="muted">第一只守卫蜂孵化后，胡蜂、蜘蛛网和蜡螟会开始出现。</p>';
    if (e.run.threats.enabled) {
      threatSection = `<h3 class="section-title">${icon('xf_status_danger')} 敌害</h3><p>${h(guardLine)}</p>${threats.length > 1 ? `<p class="warning">同时存在 ${threats.length} 个敌害，守卫会分区，单个目标获得的攻击力下降。</p>` : ''}${injured > 0 ? `<p class="muted">${icon('xf_status_injured')} 受伤休养中的工蜂 ${injured} 只，会逐渐恢复。</p>` : ''}${threats.length === 0 ? `${artImage('state_no_threats', '没有威胁', 'empty-art')}<p class="ok">目前没有威胁</p>` : threatCards}<p class="muted">敌害在第一只守卫蜂孵化后开放；离线期间不会发生熊袭击与毁巢。</p>`;
    }
    const starving = season.starving ? `<p class="warning">${icon('xf_status_stopped')} ${season.starveSeconds >= 150 ? '严重饥饿：蜂群正在缓慢减员' : (season.starveSeconds >= 60 ? '持续饥饿：产卵与孵化受限' : '部分蜜蜂因缺蜜暂停工作')}</p>` : '';
    return this.panelFrame('四季与防御', 'xf_nav_ecology', `<div class="heading-line">${icon(seasonIcon(season.season))}<h3>${h(seasonLine)}</h3></div>${effects.map((line) => `<p>${h(line)}</p>`).join('')}${starving}${supply}${collapsed}<hr>${threatSection}`);
  }

  private renderEvolutionPanel(): string {
    const e = this.engine();
    const hasEvolution = e.w.count(Bld.Evolution) > 0;
    const inheritance = e.state.meta.inheritance;
    if (!hasEvolution && inheritance.unlocked && this.evolutionTab === 'research') this.evolutionTab = 'talent';
    const tabs = `<div class="tab-row">${button('evolution-tab', '当前种区研究', { id: 'research', primary: this.evolutionTab === 'research' })}${inheritance.unlocked ? button('evolution-tab', '蜂王传承', { id: 'talent', primary: this.evolutionTab === 'talent' }) : ''}</div>`;
    if (this.evolutionTab === 'research') {
      const cards = e.w.cfg.research.map((def: ResearchDef) => {
        const level = e.prog.researchLevel(def.id);
        const cost = e.prog.researchCost(def);
        const can = hasEvolution && level < def.maxLevel && e.w.econ.canAfford(cost);
        return panelCard(`<div class="card-head">${icon(researchIcon(def.id))}<div><h3>${h(def.name)}</h3><p>${h(def.desc)}</p><small>${level >= def.maxLevel ? `Lv${level}（满级）` : `Lv${level}/${def.maxLevel} · ${costStr(cost)}`}</small></div>${button('research', '研究', { id: def.id, primary: true, disabled: !can })}</div>`);
      }).join('');
      return this.panelFrame('进化腔', 'xf_nav_evolution', `${tabs}<p class="muted">研究只影响本轮种区，分蜂后清除。</p>${!hasEvolution ? '<p class="warning">需要先在蜂巢中建造进化腔（度过第一个冬季后解锁）。</p>' : ''}${cards}`);
    }
    const branchButtons = [['breed', '繁育'], ['prod', '生产'], ['eco', '生态']].map(([id, label]) =>
      button('talent-branch', `${label} ${e.prog.branchPoints(id)}`, { id, primary: this.talentBranch === id })).join('');
    const talents = e.w.cfg.talents.filter((def: TalentDef) => def.branch === this.talentBranch).map((def) => {
      const level = e.prog.talentLevel(def.id);
      const lock = e.prog.talentLockReason(def);
      const can = level < def.maxLevel && lock.length === 0 && inheritance.available >= def.costPerLevel;
      return panelCard(`<div class="card-head">${icon(talentIcon(def.id))}<div><h3 class="${def.ruleFlag.length > 0 ? 'special' : ''}">${h(def.name)}</h3><p>${h(def.desc)}</p><small>Lv${level}/${def.maxLevel} · 每级 ${def.costPerLevel} 点${lock.length > 0 ? ` · ${h(lock)}` : ''}</small></div>${button('invest-talent', '投入', { id: def.id, primary: true, disabled: !can })}</div>`);
    }).join('');
    const presets = [0, 1, 2].map((index) => {
      const preset = inheritance.presets[index];
      const name = preset === undefined || preset.name.length === 0 ? `预设${index + 1}（空）` : preset.name;
      return `<div class="compact-row"><span>${h(name)}</span>${button('preset-save', '保存', { id: String(index) })}${button('preset-load', '载入', { id: String(index) })}</div>`;
    }).join('');
    const resetLabel = e.prog.resetCost() === 0 ? '重置天赋（首次免费）' : `重置天赋（${e.prog.resetCost()} 蜂王浆）`;
    return this.panelFrame('进化腔', 'xf_nav_evolution', `${tabs}<h3 class="section-title">可用传承点 ${inheritance.available} / 累计 ${inheritance.totalPoints}</h3><p class="muted">传承天赋永久作用于之后所有种区；每条路线投入足够点数后开放改变规则的关键能力。</p><div class="tab-row">${branchButtons}</div>${talents}<hr><h3 class="section-title">天赋预设</h3>${presets}${button('confirm-reset-talents', resetLabel, {})}`);
  }

  private renderSwarmPanel(): string {
    const e = this.engine();
    const preview = e.swarmPreview();
    const regions = e.w.cfg.regions.filter((region: RegionDef) => region.id !== e.run.regionId);
    if (!regions.some((region) => region.id === this.swarmTarget)) this.swarmTarget = '';
    const conditions = preview.conditions.map((condition: SwarmCondition) => `<p class="condition ${condition.met ? 'met' : ''}">${condition.met ? '✓' : '○'} ${h(condition.label)}　${Math.floor(condition.current)} / ${condition.target}</p>`).join('');
    const sources = preview.sources.map((source) => `<p>${h(source.label)} <b>+${source.points}</b></p>`).join('');
    const regionCards = regions.map((region) => `<button type="button" class="region-card${this.swarmTarget === region.id ? ' selected' : ''}" data-action="swarm-target" data-id="${h(region.id)}">${artImage(`region_${regionArt(region.id)}`, region.name)}<span><b>${h(region.name)}</b><em>难度 ${'★'.repeat(region.difficulty + 1)}</em><small>${h(region.desc)}</small><small>${h(region.rule)}</small></span></button>`).join('');
    const illustration = e.state.meta.swarmCount > 0 && e.run.time < 300 ? 'illustration_split_arrive'
      : (preview.ready ? 'illustration_split_depart' : 'illustration_split_prepare');
    return this.panelFrame('分蜂迁徙', 'xf_nav_split', `${artImage(illustration, '分蜂迁徙', 'wide-art')}<p class="muted">老蜂后带领蜂群离巢，前往新的种区。本轮进度重置，换取永久的蜂王传承点。</p><h3 class="section-title">分蜂条件</h3>${conditions}<hr><h3 class="section-title">预计获得传承点 ${preview.total}</h3>${sources}<hr><div class="two-column"><div><h3>将会重置</h3><ul class="reset-list">${preview.resets.map((item) => `<li>${h(item)}</li>`).join('')}</ul></div><div><h3>永久保留</h3><ul class="keep-list">${preview.keeps.map((item) => `<li>${h(item)}</li>`).join('')}</ul></div></div><hr><h3 class="section-title">选择新种区</h3>${regionCards}${button('confirm-swarm', '发起分蜂', { primary: true, disabled: !preview.ready || this.swarmTarget.length === 0 })}`);
  }

  private visibleTasks(): TaskDef[] {
    const e = this.engine();
    const out: TaskDef[] = [];
    let pending = 0;
    e.w.cfg.tasks.forEach((task) => {
      if (e.w.taskDone(task.id)) out.push(task);
      else if (task.kind === 'main' && pending < 2) { out.push(task); pending += 1; }
      else if (task.kind === 'colony' && e.w.unlocked('t_build_storage')) out.push(task);
    });
    return out.filter((task) => !e.w.taskDone(task.id)).concat(out.filter((task) => e.w.taskDone(task.id)));
  }

  private renderTaskPanel(): string {
    const e = this.engine();
    const hints = this.session.guide().hints(5);
    const hintCards = hints.length === 0 ? '<p class="muted">蜂群运转良好，随意探索吧。</p>' : hints.map((item) => panelCard(`<button class="list-button hint-${h(item.kind)}" data-action="run-hint" data-id="${h(item.action)}">${icon(item.icon)}<span>${h(item.text)}</span><i>›</i></button>`)).join('');
    const colonyTask = e.prog.colonyTask();
    let colonyTaskHtml = '';
    if (colonyTask !== null) {
      const reward = colonyTask.reward[0];
      colonyTaskHtml = panelCard(`<div class="heading-line">${icon('xf_res_jelly')}<h3>蜂群任务</h3>${colonyTask.claimed ? icon('xf_status_complete') : ''}</div><p>${h(colonyTask.name)}：${Math.min(colonyTask.current, colonyTask.target).toFixed(0)} / ${colonyTask.target} · 奖励 ${reward.amount} ${h(resName(reward.res))}${colonyTask.claimed ? '（已领取）' : ''}</p>${button('claim-colony-task', '领取', { primary: true, disabled: colonyTask.claimed || colonyTask.current < colonyTask.target })}`);
    }
    const tasks = this.visibleTasks().map((task) => {
      const done = e.w.taskDone(task.id);
      return `<div class="task-row ${done ? 'done' : ''}">${done ? artImage('badge_task', '已完成') : icon('xf_nav_tasks')}<span><b>${h(task.name)}</b><small>${h(task.desc)}</small></span></div>`;
    }).join('');
    const seen = INTRO_TOPICS.filter((topic) => e.state.meta.introsSeen.includes(topic.id));
    const topics = seen.length === 0 ? '' : `<hr><h3 class="section-title">已了解的新事物（点一下再看）</h3><div class="topic-chips">${seen.map((topic) => `<button data-action="replay-intro" data-id="${h(topic.id)}">${icon(topic.icon)}${h(topic.title)}</button>`).join('')}</div>`;
    return this.panelFrame('任务', 'xf_nav_tasks', `<h3 class="section-title">现在可以做的</h3>${hintCards}${colonyTaskHtml}<hr><h3 class="section-title">目标</h3>${tasks}${topics}`);
  }

  private renderResourcePanel(): string {
    const e = this.engine();
    const cards = this.resourceList().map((res) => {
      const rate = e.rateView;
      let line = '';
      if (res === Res.Nectar) line = `采集 +${num1(rate.nectarIn + rate.manualIn)}/秒 · 加工消耗 -${num1(rate.nectarUse)}/秒`;
      else if (res === Res.Honey) line = `酿造 +${num1(rate.honeyIn)}/秒 · 筑巢 -${num1(rate.honeyUse)}/秒${rate.upkeep > 0 ? ` · 越冬 -${num1(rate.upkeep)}/秒` : ''}`;
      else if (res === Res.Wax) line = `筑巢 +${num1(rate.waxIn)}/秒`;
      else line = rate.jellyIn > 0 ? `稀有花田 +${num1(rate.jellyIn * 60)}/分钟` : '来源：稀有花田、里程碑、击退熊、蜂群任务';
      const overflow = e.run.overflow[res];
      return panelCard(`<div class="heading-line">${icon(resIcon(res))}<h3>${h(resName(res))}</h3></div><p>${formatFull(e.w.econ.amount(res))} / ${formatFull(e.w.econ.capacity(res))}</p><small>${h(line)}</small>${overflow !== undefined && overflow.toNumber() >= 1 ? `<p class="warning">溢出缓冲 ${formatBig(overflow)}（会缓慢流失，腾出空间后可领取）</p>` : ''}`);
    }).join('');
    const hasOverflow = ALL_RES.some((res) => (e.run.overflow[res]?.toNumber() ?? 0) >= 1);
    let warning = '';
    if (e.w.econ.fillRatio(Res.Nectar) > 0.95 && e.rateView.nectarUse < e.rateView.nectarIn) warning = '花蜜仓已满且加工跟不上：建造酿蜜房、培养巢内工蜂或升级加工速度。';
    else if (e.w.econ.fillRatio(Res.Honey) > 0.95) warning = '蜂蜜仓已满：建造更多储蜜格或升级储存容量。';
    return this.panelFrame('资源与仓储', 'xf_nav_resources', `${cards}${warning.length > 0 ? `<p class="warning">${h(warning)}</p>` : ''}${hasOverflow ? button('claim-overflow', `${icon('xf_action_claim')} 领取溢出资源`, { primary: true }) : ''}`);
  }

  private badgeFor(id: string): string {
    const badges: Record<string, string> = {
      a_first_swarm: 'badge_departure', a_pop_200: 'badge_bee_city', a_bear: 'badge_bear',
      a_winters_5: 'badge_winter', a_regions_3: 'badge_regions', a_codex_flowers: 'badge_flowers'
    };
    return badges[id] ?? 'badge_task';
  }

  private ecoIcon(id: string): string {
    const icons: Record<string, string> = {
      pollination: 'xf_flower_wild', colony_roles: 'xf_nav_swarm', waggle: 'xf_action_search',
      diversity: 'xf_status_rare', winter: 'xf_season_winter', balance: 'xf_status_danger'
    };
    return icons[id] ?? 'xf_flower_unknown';
  }

  private renderCodexPanel(): string {
    const e = this.engine();
    const tabs = [['eco', '生态观察'], ['flowers', '花种'], ['threats', '敌害'], ['ach', '成就'], ['stats', '统计'], ['msg', '消息']]
      .map(([id, label]) => button('codex-tab', label, { id, primary: this.codexTab === id })).join('');
    let body = '';
    if (this.codexTab === 'eco') {
      const known = (unlock: string): boolean => unlock === 'codex_3' ? e.state.meta.codexFlowers.length >= 3 : e.w.taskDone(unlock);
      const count = ECO_NOTES.filter((note) => known(note.unlockTask)).length;
      body = `<p class="muted">跟随游玩解锁 · ${count} / ${ECO_NOTES.length}</p>${ECO_NOTES.map((note) => {
        const open = known(note.unlockTask);
        return panelCard(`<div class="card-head ${open ? '' : 'locked'}">${icon(open ? this.ecoIcon(note.id) : 'xf_flower_unknown')}<div><h3>${h(open ? note.title : '继续经营，解锁观察')}</h3>${open ? `<p>${h(note.fact)}</p><small class="link-color">${h(note.gameLink)}</small>` : '<p class="muted">完成新的蜂群行动后，这条生态关系会在这里出现。</p>'}</div></div>`);
      }).join('')}<p class="fine-print">知识内容为科普摘要；游戏数值为玩法抽象，不用于真实养蜂决策。</p>`;
    } else if (this.codexTab === 'flowers') {
      body = e.w.cfg.flowers.map((def: FlowerDef) => {
        const known = e.state.meta.codexFlowers.includes(def.id);
        return `<div class="codex-row">${icon(known ? flowerIcon(def.id) : 'xf_flower_unknown')}<span><b>${h(known ? def.name : '？？？')}</b><small>${known ? `${def.rare ? '稀有 · ' : ''}品质 ×${def.yieldMul} · 等级 ${def.tier}` : '尚未发现'}</small></span></div>`;
      }).join('');
    } else if (this.codexTab === 'threats') {
      body = e.w.cfg.threats.map((def: ThreatDef) => {
        const known = e.state.meta.codexThreats.includes(def.id);
        return `<div class="codex-row">${icon(known ? threatIcon(def.id) : 'xf_enemy_unknown')}<span><b>${h(known ? def.name : '？？？')}</b><small>${h(known ? def.desc : '尚未遭遇')}</small></span></div>`;
      }).join('');
    } else if (this.codexTab === 'ach') {
      body = e.w.cfg.achievements.map((def: AchievementDef) => {
        const done = e.state.meta.achievements.includes(def.id);
        return `<div class="codex-row ${done ? '' : 'locked'}">${artImage(this.badgeFor(def.id), def.name)}<span><b>${h(def.name)}</b><small>${h(`${def.desc}${def.skin.length > 0 ? ' · 奖励蜂巢外观' : ''}`)}</small></span></div>`;
      }).join('');
    } else if (this.codexTab === 'stats') {
      const meta = e.state.meta;
      const stats = e.run.stats;
      const produced = e.run.produced[Res.Honey];
      const lines = [
        `总游玩时间 ${formatDuration(meta.totalPlayTime)}`,
        `当前种区 ${e.w.region().name} · 本轮 ${formatDuration(e.run.time)}`,
        `分蜂次数 ${meta.swarmCount} · 累计度过冬季 ${meta.totalWinters}`,
        `本轮蜂群峰值 ${stats.peakPop} · 累计产卵 ${e.run.colony.eggsLaid}`,
        `手动采集 ${stats.manualCollects} 次 · 采集蜂运回花蜜 ${Math.floor(stats.deliveredNectar)}`,
        `本轮累计蜂蜜 ${produced === undefined ? 0 : Math.floor(produced.toNumber())}`,
        `击退敌害 ${e.run.threats.cleared} 次 · 花田授粉成长 ${stats.pollinations} 次 · 稀有花田 ${stats.rareFound}`,
        ...meta.history.map((record) => `历史：${record.regionId} 获得 ${record.points} 传承点，峰值 ${record.peakPop} 只`)
      ];
      body = lines.map((line) => `<p>${h(line)}</p>`).join('');
    } else {
      const messages = e.state.messages.slice().reverse().slice(0, 40);
      body = `<p class="muted">消息中心：重要提示会保留在这里。</p>${messages.length === 0 ? artImage('state_no_tasks', '暂无消息', 'empty-art') : messages.map((message: GameMessage) => `<p class="message ${h(message.kind)}">${h(message.text)}</p>`).join('')}`;
    }
    return this.panelFrame('图鉴与记录', 'xf_action_search', `<div class="tab-row scroll-tabs">${tabs}</div>${body}`);
  }

  private renderSettingsPanel(): string {
    const e = this.engine();
    const settings = e.state.meta.settings;
    const toggleRow = (key: string, label: string, desc: string, on: boolean, rowIcon: string): string =>
      `<div class="setting-row">${icon(rowIcon)}<span><b>${h(label)}</b>${desc.length > 0 ? `<small>${h(desc)}</small>` : ''}</span>${this.toggleButton(key, on)}</div>`;
    const skins = e.w.cfg.skins.filter((skin: SkinDef) => e.state.meta.skins.includes(skin.id)).map((skin) =>
      `<button type="button" class="skin-choice${settings.skin === skin.id ? ' selected' : ''}" data-action="set-skin" data-id="${h(skin.id)}">${artImage(`skin_background_${skin.id}`, skin.name)}<span>${h(skin.name)}</span></button>`).join('');
    return this.panelFrame('设置', 'xf_nav_settings', `<h3 class="section-title">音画</h3>${toggleRow('music', '背景音乐', '', settings.music, 'xf_action_music')}${toggleRow('sfx', '音效', '', settings.sfx, 'xf_action_sound')}${this.range('volume', 'musicVolume', settings.musicVolume, 0, 100, 5, `音乐音量 ${settings.musicVolume}%`)}${this.range('volume', 'effectsVolume', settings.effectsVolume, 0, 100, 5, `音效音量 ${settings.effectsVolume}%`)}${toggleRow('vibration', '振动', '浏览器和设备支持时使用', settings.vibration, 'xf_action_vibration')}${toggleRow('particles', '粒子特效', '关闭可降低功耗', settings.particles, 'xf_status_rare')}${toggleRow('reduceMotion', '减少动态效果', '降低动画速度与天气粒子', settings.reduceMotion, 'xf_action_pause')}${toggleRow('eventAnimations', '事件动画', '敌害与季节更替的非阻塞通告', settings.eventAnimations, 'xf_card_alarm')}${toggleRow('lowPower', '省电模式', '画面降为 30 帧、使用半尺寸美术', this.session.lowPower, 'xf_action_low_power')}<hr><h3 class="section-title">玩法</h3><div class="setting-row"><span><b>花潮加速</b><small>${this.session.ads.boostSpeed() > 1 ? `${this.session.ads.boostSpeed()}× 进行中，剩余 ${clock(this.session.ads.boostRemainingSec())}` : `看 1 个广告 2×，看 2 个广告 4×，持续 ${AD_REWARDS.boostMinutes} 分钟`}</small></span>${button('open-boost', '⚡ 加速')}</div>${toggleRow('ecoMode', '生态模式（工蜂寿命）', '开启后工蜂会自然老化，需要手动孵化并分化补员', settings.ecoMode, 'xf_nav_ecology')}<h3 class="section-title">蜂巢外观</h3><div class="skin-grid">${skins}</div><hr><h3 class="section-title">${icon('xf_action_help')} 帮助与说明</h3><div class="choice-row">${button('open-legal', '玩法帮助', { id: 'help' })}${button('open-legal', '隐私政策', { id: 'privacy' })}${button('open-legal', '用户协议', { id: 'agreement' })}</div><hr><h3 class="section-title">数据与隐私</h3><p class="muted">进度保存在本设备。清除进度会重新开始；删除全部数据会同时清除设置与隐私同意记录。</p><div class="choice-row">${button('confirm-reset-progress', '清除游戏进度', { danger: true })}${button('confirm-delete-all', `${icon('xf_action_delete')} 删除全部数据`, { danger: true })}</div><div class="about-row">${artImage('logo_mark', '小峰大业')}${artImage('app_icon', '应用图标')}<span><b>小峰大业</b><small>版本 0.5.0</small></span>${button('save-now', `${icon('xf_status_save')} 立即保存`)}</div><div class="choice-row home-row">${button('exit-home', `${icon('xf_action_back')} 保存并返回首页`)}</div>`);
  }

  private renderLegalOverlay(): string {
    if (this.legal.length === 0) return '';
    let title = '隐私政策';
    let lines = PRIVACY_FULL;
    let legalIcon = 'xf_status_save';
    if (this.legal === 'agreement') {
      title = '用户协议'; lines = AGREEMENT_FULL; legalIcon = 'xf_card_updated';
    } else if (this.legal === 'help') {
      title = '玩法帮助'; lines = HELP_TEXT; legalIcon = 'xf_action_help';
    }
    return `<div class="modal-layer legal-layer"><section class="modal-card legal-card"><header>${icon(legalIcon)}<h2>${h(title)}</h2><button class="round-btn" data-action="close-legal" aria-label="关闭">${icon('xf_action_close')}</button></header><div class="legal-scroll">${lines.map((line) => `<p>${h(line)}</p>`).join('')}</div>${button('close-legal', '我知道了', { primary: true })}</section></div>`;
  }

  private renderOfflineOverlay(report: OfflineReport): string {
    const gains = ALL_RES.map((res) => {
      const amount = BigNum.parse(report.gains[res] ?? '0');
      if (Math.abs(amount.toNumber()) < 0.001) return '';
      return `<div class="gain-item">${icon(resIcon(res))}<span>${h(resName(res))}</span><b>${amount.toNumber() >= 0 ? '+' : ''}${formatBig(amount)}</b></div>`;
    }).filter(Boolean).join('');
    const seasons = report.seasonsPassed.length > 0
      ? `<p class="muted">期间经过：${h(report.seasonsPassed.map((item) => seasonName(item)).join('、'))}</p>` : '';
    return `<div class="modal-layer"><section class="modal-card offline-card">${artImage('illustration_offline', '离线归来', 'wide-art')}<h2>欢迎回来</h2><p>离开了 ${h(formatDuration(report.elapsed))}，结算了 ${h(formatDuration(report.credited))} 的蜂群运转。</p>${report.truncated > 0 ? `<p class="warning">超过离线收益上限的 ${h(formatDuration(report.truncated))} 未计入收益。</p>` : ''}${report.anomaly.length > 0 ? `<p class="warning">${h(report.anomaly)}</p>` : ''}<div class="gain-grid">${gains || '<p class="muted">本次没有资源变化</p>'}</div>${seasons}${report.notes.map((line) => `<p class="note-line">${icon('xf_card_alarm')}${h(line)}</p>`).join('')}<div class="choice-stack">${offlineHasGains(report) ? this.adButton('ad-offline-double', '收益翻倍', AdPlacement.OfflineDouble) : ''}${button('close-offline', '收下并继续', { primary: !offlineHasGains(report) })}</div></section></div>`;
  }

  private renderBearOverlay(event: ThreatEvent): string {
    const tribute = Math.round(this.engine().threats.bearTribute());
    const seconds = Math.max(0, Math.ceil(event.endsAt - this.engine().run.time));
    return `<div class="modal-layer threat-layer"><section class="modal-card bear-card">${artImage('badge_bear', '熊来袭', 'bear-badge')}<h2>${icon('xf_enemy_bear')} 熊来袭</h2><p>熊循着蜜香靠近蜂巢，约 ${seconds} 秒后开始抢蜜。蜂巢不会被摧毁。</p><div class="choice-stack">${button('bear-choice', '集结守卫蜂防守', { id: event.eventId, value: 'defend', primary: true })}${button('bear-choice', `交付 ${tribute} 蜂蜜让它离开`, { id: event.eventId, value: 'tribute' })}${this.adButton('ad-bear-aid', '请邻巢援军赶走熊（不损失蜂蜜）', AdPlacement.BearAid, { id: event.eventId, primary: false })}${button('bear-choice', event.postponed >= 2 ? '不能再稍后处理' : '稍后处理（10分钟后回来）', { id: event.eventId, value: 'later', disabled: event.postponed >= 2 })}</div></section></div>`;
  }

  private renderBoostOverlay(): string {
    const ads = this.session.ads;
    const active = ads.boostSpeed();
    const status = active > 1
      ? `<p class="boost-status">⚡ 当前 ${active}× 加速，剩余 ${clock(ads.boostRemainingSec())}</p>`
      : '<p class="muted">花期正盛，蜂群全力出动：游戏内时间按倍速流逝，采集、繁育和季节一起加快。</p>';
    const tiers = AD_REWARDS.boostTiers.map((tier) =>
      `<div class="boost-tier"><b>${tier.speed}×</b><span>${AD_REWARDS.boostMinutes} 分钟 · 看 ${tier.ads} 个广告</span>${this.adButton('ad-boost', tier.ads > 1 ? `连看 ${tier.ads} 个，开启 ${tier.speed}×` : `开启 ${tier.speed}×`, AdPlacement.FlowerBoost, { value: tier.speed, need: tier.ads, primary: tier.speed === 4 })}</div>`).join('');
    return `<div class="modal-layer"><section class="modal-card boost-card"><h2>⚡ 花潮加速</h2>${status}<div class="boost-tiers">${tiers}</div><p class="muted small-note">连看两个广告时，看完第一个就先获得 2×，看完第二个升级为 4×。</p>${button('close-boost', '关闭')}</section></div>`;
  }

  private renderSwarmBonusOverlay(): string {
    return `<div class="modal-layer"><section class="modal-card swarm-bonus-card">${artImage('illustration_split_arrive', '分蜂完成', 'wide-art')}<h2>分蜂完成</h2><p>蜂群已抵达新种区。看一个广告，额外获得 <b>${this.swarmBonus}</b> 点传承。</p><div class="choice-stack">${this.adButton('ad-swarm-bonus', `传承点 +${this.swarmBonus}`, AdPlacement.SwarmBonus)}${button('close-swarm-bonus', '不用了')}</div></section></div>`;
  }

  private renderIntroOverlay(topic: IntroTopic): string {
    if (topic.id === 'handover') {
      return `<div class="modal-layer intro-layer"><section class="modal-card intro-card handover-card">${artImage('app_icon', '蜂后', 'handover-art')}<p class="eyebrow">蜂后的托付</p><h2>${h(topic.title)}</h2>${topic.what.split('\n').map((line) => `<p>${h(line)}</p>`).join('')}<p class="handover-oath">${h(topic.use)}</p><div class="choice-row">${button('intro-done', '交给我吧', { primary: true })}</div></section></div>`;
    }
    return `<div class="modal-layer intro-layer"><section class="modal-card intro-card"><div class="intro-icon">${icon(topic.icon)}</div><p class="eyebrow">新发现</p><h2>${h(topic.title)}</h2><h3>这是什么</h3><p>${h(topic.what)}</p><h3>有什么用</h3><p>${h(topic.use)}</p><div class="choice-row">${topic.focus.length > 0 || topic.view.length > 0 ? button('intro-show', '带我看看', { primary: true }) : ''}${button('intro-done', '知道了', { primary: topic.focus.length === 0 && topic.view.length === 0 })}</div></section></div>`;
  }

  private renderRuntimeOverlays(): string {
    const out: string[] = [];
    if (this.banner.length > 0) out.push(`<button class="event-banner ${h(this.bannerKind)}" data-action="banner-click">${icon(this.bannerIcon())}<span>${h(this.banner)}</span></button>`);
    if (this.eventTitle.length > 0) out.push(`<button class="season-event" data-action="close-event">${icon(this.eventIcon)}<span><b>${h(this.eventTitle)}</b><small>${h(this.eventText)}</small></span></button>`);
    if (this.introId.length > 0) {
      const topic = this.session.guide().topic(this.introId);
      if (topic !== null) out.push(this.renderIntroOverlay(topic));
    }
    if (this.offlineReport !== null) out.push(this.renderOfflineOverlay(this.offlineReport));
    if (this.swarmBonus > 0) out.push(this.renderSwarmBonusOverlay());
    if (this.boostModal) out.push(this.renderBoostOverlay());
    const bear = this.engine().threats.pendingBear();
    if (this.bearModal && bear !== null && bear.phase === 'warning') out.push(this.renderBearOverlay(bear));
    if (this.confirmState !== null) {
      const state = this.confirmState;
      out.push(`<div class="modal-layer"><section class="modal-card confirm-card">${icon(state.dangerous ? 'xf_status_danger' : 'xf_action_help')}<h2>${h(state.title)}</h2><p>${h(state.message)}</p><div class="choice-row">${button('confirm-cancel', '取消')}${button('confirm-accept', h(state.confirmLabel), { primary: !state.dangerous, danger: state.dangerous })}</div></section></div>`);
    }
    if (this.legal.length > 0) out.push(this.renderLegalOverlay());
    if (this.toastText.length > 0) out.push(`<button class="toast" data-action="dismiss-toast">${h(this.toastText)}</button>`);
    return out.join('');
  }

  private onClick(event: Event): void {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>('[data-action]');
    if (target === null || target.hasAttribute('disabled')) return;
    const action = target.dataset.action ?? '';
    const id = target.dataset.id ?? '';
    const value = target.dataset.value ?? '';
    const inPanel = target.closest('#panel-host') !== null;
    if (this.session.status === 'error' && action !== 'reload') {
      this.syncSessionStatus();
      return;
    }
    const e = this.engine();
    switch (action) {
      case 'reload': location.reload(); return;
      case 'privacy-reconsider': this.privacyDeclined = false; this.render(); return;
      case 'privacy-decline': this.privacyDeclined = true; this.render(); return;
      case 'privacy-accept': {
        e.state.meta.settings.privacyAccepted = true;
        e.state.meta.settings.privacyVersion = PRIVACY_VERSION;
        if (!this.session.saveNow()) return;
        if (this.deepTarget.length > 0) this.applyDeepTarget();
        else this.screen = 'home';
        this.render(); this.writeHistory(true); return;
      }
      case 'open-legal':
        if (!['privacy', 'agreement', 'help'].includes(id)) return;
        this.legal = id as LegalKind; this.render(); this.writeHistory(true); return;
      case 'close-legal': this.legal = ''; this.render(); this.writeHistory(false); return;
      case 'home-start': this.enterGame(); return;
      case 'home-panel': this.enterGame(id); return;
      case 'exit-home': this.exitHome(); return;
      case 'panel-back': this.panelBack(); return;
      case 'drawer-toggle': if (this.drawerOpen) this.closePanel(); else this.openPanel(this.panel || 'hub'); return;
      case 'close-panel':
        if (target.id === 'drawer-scrim' && Date.now() < this.suppressScrimUntil) return;
        this.closePanel(); return;
      case 'open-panel': this.openPanel(id, true, !inPanel); return;
      case 'open-resources': this.openPanel('resources'); return;
      case 'toggle-view': this.toggleView(); return;
      case 'run-hint': this.runHint(id, inPanel); return;
      case 'hide-hint': this.hiddenHint = id; break;
      case 'start-place': this.startPlacing(id); return;
      case 'cancel-place': this.cancelPlacing(); return;
      case 'focus-expand': this.focusTarget = 'expand'; this.focusUntil = Date.now() + 6000; this.view = 'hive'; this.closePanel(false); this.refreshGame(true); this.writeHistory(false); return;
      case 'enter-hive': this.view = 'hive'; this.placing = ''; this.closePanel(false); this.refreshGame(true); this.writeHistory(false); return;
      case 'lay': this.feedback(e.lay()); break;
      case 'hatch': this.feedback(e.differentiate(id, Number(value) || 1)); break;
      case 'cancel-batch': this.feedback(e.cancelBatch(Number(id))); break;
      case 'open-upgrade': this.upgradeBuilding = id; this.openPanel('upgrade', true, !inPanel); return;
      case 'expand-next': this.expandNext(); break;
      case 'upgrade-tab': this.upgradeBuilding = id; break;
      case 'upgrade': this.feedback(e.upgrade(id)); break;
      case 'set-strategy': e.setStrategy(id); e.saveRequested = true; this.session.audio.play('ui_confirm'); break;
      case 'set-guard': e.setGuardPriority(id); e.saveRequested = true; this.session.audio.play('ui_confirm'); break;
      case 'expand-cell': this.feedback(e.expand(this.selectedCell)); break;
      case 'build-cell': this.feedback(e.build(this.selectedCell, id)); break;
      case 'confirm-demolish': this.confirmDemolish(); return;
      case 'collect-field': {
        const fieldId = this.selectedField || 'f0';
        this.feedback(e.collect(fieldId, 1)); break;
      }
      case 'bear-choice': {
        const result = e.bearChoice(id, value);
        this.feedback(result);
        if (result.ok) { this.bearModal = false; this.bearPromptKey = ''; }
        break;
      }
      case 'recover-colony': {
        const ok = this.session.recoverColonyWithPoint();
        this.showToast(ok ? '蜂群已在当前种区重新开始' : '传承点不足', !ok);
        break;
      }
      case 'restore-winter': {
        const ok = this.session.restoreWinterCheckpoint();
        this.showToast(ok ? '已恢复到最近一次入冬前快照' : '没有可用的入冬前快照', !ok);
        break;
      }
      case 'evolution-tab': this.evolutionTab = id; break;
      case 'talent-branch': this.talentBranch = id; break;
      case 'research': this.feedback(e.research(id)); break;
      case 'invest-talent': this.feedback(e.investTalent(id)); break;
      case 'preset-save': {
        const slot = Number(id);
        const oldName = e.state.meta.inheritance.presets[slot]?.name ?? '';
        this.feedback(e.prog.savePreset(slot, oldName || `预设${slot + 1}`));
        e.saveRequested = true; break;
      }
      case 'preset-load': this.feedback(e.prog.loadPreset(Number(id))); e.saveRequested = true; break;
      case 'confirm-reset-talents': this.requestConfirm('重置全部传承天赋', `已投入的传承点会全部返还${e.prog.resetCost() > 0 ? `，需要 ${e.prog.resetCost()} 蜂王浆` : '，首次重置免费'}。`, '确认重置', () => this.feedback(e.resetTalents())); return;
      case 'swarm-target': this.swarmTarget = id; break;
      case 'confirm-swarm': this.confirmSwarm(); return;
      case 'claim-colony-task': this.feedback(e.claimColonyTask()); break;
      case 'replay-intro': this.introId = id; this.introReplay = true; this.closePanel(false); break;
      case 'claim-overflow': this.feedback(e.claimOverflow()); break;
      case 'codex-tab': this.codexTab = id; break;
      case 'toggle-setting': this.toggleSetting(id); return;
      case 'open-boost': this.boostModal = true; this.session.audio.play('ui_open_panel'); break;
      case 'close-boost': this.boostModal = false; break;
      case 'ad-boost': {
        const tier = AD_REWARDS.boostTiers.find((item) => item.speed === Number(value));
        if (tier === undefined) return;
        const tiers = AD_REWARDS.boostTiers;
        this.runAd(AdPlacement.FlowerBoost, tier.ads, (index) => {
          // 第 1 个广告给最低档，之后每看完一个升一档，直到所选档位
          const reached = tiers.filter((item) => item.ads <= index + 1 && item.speed <= tier.speed);
          this.session.ads.applyBoost(reached.length > 0 ? reached[reached.length - 1].speed : tiers[0].speed);
        }, (result) => {
          if (result.completed > 0) {
            this.boostModal = false;
            this.showToast(`⚡ ${this.session.ads.boostSpeed()}× 花潮加速开启，持续 ${AD_REWARDS.boostMinutes} 分钟${result.status === 'partial' ? '（第二个广告未看完，保留 2×）' : ''}`);
          }
        });
        return;
      }
      case 'ad-offline-double': {
        const report = this.offlineReport;
        if (report === null) return;
        this.runAd(AdPlacement.OfflineDouble, 1, () => {
          grantOfflineDouble(e, report);
          this.offlineReport = null;
          this.session.dismissOffline();
          this.showToast('离线收益已翻倍');
        });
        return;
      }
      case 'ad-bear-aid':
        this.runAd(AdPlacement.BearAid, 1, () => {
          if (grantBearAid(e, id)) { this.bearModal = false; this.bearPromptKey = ''; this.showToast('援军赶走了熊'); }
          else this.showToast('熊已经离开了');
        });
        return;
      case 'ad-winter-supply':
        this.runAd(AdPlacement.WinterSupply, 1, () => {
          const got = grantWinterSupply(e);
          this.showToast(`获得 ${Math.round(got)} 蜂蜜`);
        });
        return;
      case 'ad-revive':
        this.runAd(AdPlacement.ColonyRevive, 1, () => {
          const ok = this.session.reviveColonyFree();
          this.showToast(ok ? '蜂群重新振作起来了' : '蜂群状态已变化，未能重振', !ok);
        });
        return;
      case 'ad-swarm-bonus': {
        const extra = this.swarmBonus;
        this.runAd(AdPlacement.SwarmBonus, 1, () => {
          grantSwarmBonus(this.engine(), extra);
          this.swarmBonus = 0;
          this.showToast(`额外获得 ${extra} 传承点`);
        });
        return;
      }
      case 'close-swarm-bonus': this.swarmBonus = 0; break;
      case 'set-skin': this.setSkin(id); return;
      case 'confirm-reset-progress': this.requestConfirm('清除游戏进度', '当前蜂群、资源、建筑与本轮进度将被清除，设置和隐私同意记录会保留。', '清除进度', () => this.resetProgress(true)); return;
      case 'confirm-delete-all': this.requestConfirm('删除全部本地数据', '游戏进度、设置、图鉴与隐私同意记录都会从当前浏览器删除。', '全部删除', () => this.resetProgress(false)); return;
      case 'save-now': this.showToast(this.session.saveNow() ? '进度已保存' : this.session.bootError, !this.session.ready); break;
      case 'close-offline': this.offlineReport = null; this.session.dismissOffline(); this.session.audio.play('ui_confirm'); break;
      case 'close-event': this.eventTitle = ''; this.eventUntil = 0; if (this.pendingBearUntil > 0) { this.pendingBearUntil = 0; this.bearModal = true; } break;
      case 'banner-click': {
        const shouldOpenEco = this.bannerKind === 'threat' || this.bannerKind === 'warn';
        this.banner = '';
        if (shouldOpenEco) { this.openPanel('eco'); return; }
        break;
      }
      case 'intro-show': this.closeIntro(true); return;
      case 'intro-done': this.closeIntro(false); return;
      case 'confirm-cancel': this.confirmState = null; break;
      case 'confirm-accept': {
        const pending = this.confirmState;
        this.confirmState = null;
        pending?.run();
        break;
      }
      case 'dismiss-toast': this.toastText = ''; break;
      default: return;
    }
    this.refreshGame(true);
  }

  private onRange(event: Event, final: boolean): void {
    if (!(event.target instanceof HTMLInputElement) || event.target.type !== 'range') return;
    const input = event.target;
    const kind = input.dataset.range ?? '';
    const id = input.dataset.id ?? '';
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) return;
    const output = input.closest('label')?.querySelector('output');
    if (output !== null && output !== undefined) output.textContent = `${value}`;
    const e = this.engine();
    if (kind === 'role-ratio') {
      e.setRatio(id, value); e.saveRequested = true;
    } else if (kind === 'wax-share') {
      e.setWaxShare(value / 100); e.saveRequested = true;
    } else if (kind === 'pollinators' && final) {
      this.feedback(e.setPollinators(id, value));
    } else if (kind === 'volume') {
      const settings = e.state.meta.settings;
      if (id === 'musicVolume') settings.musicVolume = value;
      else if (id === 'ambientVolume') settings.ambientVolume = value;
      else if (id === 'effectsVolume') settings.effectsVolume = value;
      this.session.applySettings();
      if (final) this.session.saveNow();
    }
    if (final && kind !== 'volume') e.saveRequested = true;
  }

  private enterGame(initialPanel = ''): void {
    this.session.endAway();
    this.screen = 'game';
    this.panel = initialPanel;
    this.drawerOpen = initialPanel.length > 0;
    this.render();
    this.checkRuntimeEvents();
    this.refreshGame(true);
    this.writeHistory(true);
  }

  private exitHome(): void {
    if (!this.session.saveNow()) return;
    this.panel = ''; this.drawerOpen = false; this.placing = ''; this.legal = ''; this.panelStack = [];
    this.screen = 'home';
    this.session.beginAway();
    this.render();
    this.writeHistory(true);
  }

  /** root：从侧栏导航、提示行、场景点开（清空上一级）；否则是从面板内部进入下一级，返回键可退回 */
  private openPanel(key: string, push = true, root = true): void {
    if (this.screen !== 'game' || key.length === 0) return;
    const wasClosed = this.panel.length === 0 || !this.drawerOpen;
    if (root || wasClosed) this.panelStack = [];
    else if (this.panel !== key) this.panelStack.push(this.panel);
    this.panel = key; this.drawerOpen = true;
    this.session.audio.play('ui_open_panel');
    this.refreshGame(true);
    this.writeHistory(push && wasClosed);
  }

  /** 侧栏“返回”：回到点进来的上一级；已在最上层时回到蜂巢总览，总览再按返回则收起 */
  private panelBack(): void {
    const prev = this.panelStack.pop();
    if (prev !== undefined) {
      this.panel = prev;
      this.session.audio.play('ui_tab');
      this.refreshGame(true);
      return;
    }
    if (this.panel !== 'hub') { this.openPanel('hub', false, true); return; }
    this.closePanel();
  }

  /** Android 返回键先处理当前面板层级；没有可返回的界面时才交给原生退出确认。 */
  handleNativeBack(): boolean {
    if (this.legal) { this.legal = ''; this.render(); return true; }
    if (this.screen !== 'game') return false;
    if (this.introId) { this.closeIntro(false); return true; }
    if (this.confirmState) { this.confirmState = null; this.refreshGame(true); return true; }
    if (this.offlineReport) { this.offlineReport = null; this.session.dismissOffline(); this.refreshGame(true); return true; }
    if (this.boostModal) { this.boostModal = false; this.refreshGame(true); return true; }
    if (this.placing) { this.cancelPlacing(); return true; }
    if (this.panel || this.drawerOpen) { this.panelBack(); return true; }
    return false;
  }

  private closePanel(write = true): void {
    const changed = this.panel.length > 0 || this.drawerOpen;
    this.panel = ''; this.drawerOpen = false; this.panelStack = [];
    if (changed) this.session.audio.play('ui_close_panel');
    this.refreshGame(true);
    if (write) this.writeHistory(false);
  }

  private toggleView(): void {
    this.view = this.view === 'field' ? 'hive' : 'field';
    this.placing = '';
    this.panel = ''; this.drawerOpen = false;
    this.selectedCell = ''; this.selectedField = '';
    this.session.audio.play('ui_tab');
    this.refreshGame(true);
    this.writeHistory(false);
  }

  private startPlacing(building: string): void {
    if (!this.engine().hive.buildingAvailable(building)) return;
    // 没有空格时不进入放置模式，直接引导去扩建
    if (!this.engine().run.hive.cells.some((c) => c.unlocked && c.building.length === 0)) {
      this.showToast('蜂巢没有空格了：先用蜂蜡扩建外圈', true);
      this.focusTarget = 'expand'; this.focusUntil = Date.now() + 6000;
      this.view = 'hive';
      this.closePanel(false);
      this.refreshGame(true);
      return;
    }
    this.placing = building;
    this.view = 'hive';
    this.focusTarget = 'hive'; this.focusUntil = Date.now() + 6000;
    this.closePanel(false);
    this.refreshGame(true);
    this.writeHistory(false);
  }

  private cancelPlacing(): void {
    this.placing = '';
    this.focusTarget = ''; this.focusUntil = 0;
    this.refreshGame(true);
  }

  private runHint(action: string, inPanel = false): void {
    this.hiddenHint = '';
    const root = !inPanel;
    if (action === 'hub') this.openPanel('hub', true, root);
    else if (action === 'queen') this.openPanel('queen', true, root);
    else if (action.startsWith('panel:')) this.openPanel(action.substring(6), true, root);
    else if (action.startsWith('build:')) this.startPlacing(action.substring(6));
    else if (action.startsWith('upgrade:')) { this.upgradeBuilding = action.substring(8); this.openPanel('upgrade', true, root); }
    else if (action.startsWith('intro:')) { this.introId = action.substring(6); this.introReplay = true; this.refreshGame(true); }
    else if (action.startsWith('focus:')) {
      const pair = action.substring(6).split('@');
      this.goTo(pair[0], pair[1] ?? '');
    }
  }

  private goTo(focus: string, requestedView: string): void {
    if (requestedView === 'field' || requestedView === 'hive') this.view = requestedView;
    this.panel = ''; this.drawerOpen = false; this.placing = '';
    this.focusTarget = focus; this.focusUntil = Date.now() + 6500;
    if (focus.startsWith('fieldId:')) {
      const fieldId = focus.substring(8);
      this.selectedField = fieldId;
      const field = this.engine().w.field(fieldId);
      if (field !== null) this.session.renderer?.lookAt(field.x, field.y);
    }
    this.refreshGame(true);
    this.writeHistory(false);
  }

  private closeIntro(showTarget: boolean): void {
    const topic = this.session.guide().topic(this.introId);
    if (topic !== null && !this.introReplay) {
      this.session.guide().markSeen(topic.id);
      this.engine().saveRequested = true;
    }
    this.introId = ''; this.introReplay = false;
    this.introGapUntil = Date.now() + 900;
    if (showTarget && topic !== null) this.goTo(topic.focus, topic.view);
    else this.refreshGame(true);
  }

  private requestConfirm(title: string, message: string, confirmLabel: string, run: () => void, dangerous = true): void {
    this.confirmState = { title, message, confirmLabel, dangerous, run };
    this.refreshGame(true);
  }

  private confirmDemolish(): void {
    const cell = this.engine().hive.cell(this.selectedCell);
    if (cell === null || cell.building.length === 0 || cell.building === Bld.Queen) return;
    const name = this.engine().w.bldDef(cell.building).name;
    this.requestConfirm(`拆除${name}`, '拆除后不返还建造资源；与它相邻的巢房加成也会重新计算。', '确认拆除', () => {
      const result = this.engine().demolish(cell.cellId);
      this.feedback(result);
      if (result.ok) this.closePanel(false);
    });
  }

  private confirmSwarm(): void {
    if (this.swarmTarget.length === 0) return;
    const target = this.engine().w.cfg.regions.find((region) => region.id === this.swarmTarget);
    if (target === undefined) return;
    this.requestConfirm(`前往${target.name}`, '本轮蜂群、资源、建筑与研究将重置；传承点、天赋、图鉴、成就和设置永久保留。', '确认分蜂', () => {
      const points = this.engine().swarmPreview().total;
      const result = this.engine().swarm(target.id);
      this.feedback(result);
      if (result.ok) {
        this.session.saveNow();
        if (points > 0 && this.session.ads.remaining(AdPlacement.SwarmBonus) > 0) this.swarmBonus = swarmBonusPoints(points);
        this.swarmTarget = '';
        this.view = 'hive';
        this.closePanel(false);
      }
    });
  }

  private toggleSetting(id: string): void {
    const e = this.engine();
    const settings = e.state.meta.settings;
    if (id === 'auto-lay') e.setAuto(!e.run.colony.autoLay, e.run.colony.autoHatch);
    else if (id === 'auto-hatch') e.setAuto(e.run.colony.autoLay, !e.run.colony.autoHatch);
    else if (id === 'music') settings.music = !settings.music;
    else if (id === 'sfx') settings.sfx = !settings.sfx;
    else if (id === 'vibration') settings.vibration = !settings.vibration;
    else if (id === 'particles') settings.particles = !settings.particles;
    else if (id === 'reduceMotion') settings.reduceMotion = !settings.reduceMotion;
    else if (id === 'eventAnimations') settings.eventAnimations = !settings.eventAnimations;
    else if (id === 'ecoMode') settings.ecoMode = !settings.ecoMode;
    else if (id === 'lowPower') this.session.lowPower = !this.session.lowPower;
    else return;
    e.saveRequested = true;
    this.session.applySettings();
    this.session.audio.play('ui_toggle');
    this.session.saveNow();
    this.refreshGame(true);
  }

  private setSkin(id: string): void {
    const e = this.engine();
    if (!e.state.meta.skins.includes(id) || !e.w.cfg.skins.some((skin) => skin.id === id)) return;
    e.state.meta.settings.skin = id;
    e.saveRequested = true;
    this.session.audio.play('ui_confirm');
    this.session.saveNow();
    this.refreshGame(true);
  }

  private resetProgress(keepSettings: boolean): void {
    if (!keepSettings) this.session.deleteAllData();
    this.session.resetProgress(keepSettings);
    this.offlineReport = null; this.bearModal = false; this.introId = ''; this.confirmState = null;
    this.boostModal = false; this.swarmBonus = 0;
    this.panel = ''; this.legal = ''; this.drawerOpen = false; this.placing = '';
    this.selectedCell = ''; this.selectedField = ''; this.view = 'field';
    this.screen = keepSettings ? 'home' : 'privacy';
    this.privacyDeclined = false;
    this.render();
    this.writeHistory(true);
  }
}

