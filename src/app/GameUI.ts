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
  winterSupplyAmount, winterSupplyWanted, grantHoneyTopUp, grantSpringSupply, honeyTopUp, springSupplyAmount,
  springSupplyWanted
} from './ads/AdRewards';
import { AD_REWARDS, AdPlacement } from './ads/placements';
import { platform } from '../platform/Platform';
import { DAILY_BONUS_JELLY } from '../domain/DailyService';
import { LUCKY_HATCHES, STAR_MAX_LEVEL, STAR_TRAITS, starTrait } from '../domain/RosterService';
import type { NamedBee } from '../domain/State';
import { legacyAura } from '../domain/World';
import { costMulFor } from '../domain/HiveService';
import { HIVE_NAME_MAX } from '../domain/HiveNames';
import { BEAR_DESTROY_CHANCE, POWER_PER_CYCLE } from '../domain/ThreatService';
import type { WatchResult } from './ads/AdService';
import { PresentationQueue } from './PresentationQueue';
import { browserEnvironment, isInputElement, isUiElement } from './ui/UiEnvironment';
import type { UiEnvironment, ResizeHandle } from './ui/UiEnvironment';

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
  hub: ['蜂巢', 'xf_nav_hive'], fields: ['花田', 'xf_flower_wild'],
  colonies: ['王国', 'xf_nav_swarm'],
  eco: ['生态', 'xf_nav_ecology'], evolution: ['进化', 'xf_nav_evolution'], swarm: ['分蜂', 'xf_nav_split'],
  resources: ['资源', 'xf_nav_resources'], codex: ['图鉴', 'xf_action_search'], settings: ['设置', 'xf_nav_settings']
};

/** 侧边栏分组：花田页把花田类排在前面，蜂巢页把蜂巢类排在前面 */
const NAV_FIELD = ['fields', 'eco'];
const NAV_HIVE = ['hub', 'build', 'colony', 'evolution', 'swarm', 'colonies'];
const NAV_GENERAL_TAIL = ['resources', 'codex', 'settings'];

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
/** 蜜蜂头像：普通蜜蜂用原工种形象，明星蜂换成金翅膀 + 特性配饰的那一版 */
function beePortrait(role: string, trait: string | undefined, alt = ''): string {
  const star = trait !== undefined && trait.length > 0;
  return artImage(star ? `star_${trait}` : `bee_${role}`, alt, star ? 'bee-portrait star' : 'bee-portrait');
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
/** 速度、倍率等小数：≥100 取整，≥1 保留一位，1 以下保留两位，末尾 0 去掉 */
function num1(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 10000) return formatBig(BigNum.of(value));
  const abs = Math.abs(value);
  const text = abs >= 100 ? value.toFixed(0) : (abs >= 1 ? value.toFixed(1) : value.toFixed(2));
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
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
/** 把提示文字归成一类：去掉引号里的名字和数字，只取开头几个字 */
function normalizeTopic(text: string): string {
  return text.replace(/[「“"（(][^」”"）)]*[」”"）)]/g, '').replace(/[0-9０-９.,，%+\-×]+/g, '#').slice(0, 6);
}
function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Complete shared interface and controller. DOM and Canvas hosts supply only platform primitives. */
export class GameUI {
  private screen: Screen = 'boot';
  private view: View = 'field';
  private panel = '';
  private legal: LegalKind = '';
  private privacyDeclined = false;
  private drawerOpen = false;
  private selectedCell = '';
  private selectedField = '';
  private placing = '';
  private movingCell = '';
  private upgradeBuilding = '';
  private evolutionTab = 'research';
  private talentBranch = 'breed';
  private codexTab = 'eco';
  /** 蜜蜂信息卡：名册编号，-1 表示没有打开 */
  private beeCard = -1;
  private eventModal = false;
  /** 已经自动弹过的季节事件（每个事件只自动弹一次） */
  private eventPromptKey = '';
  /** 取名弹窗：正在取名的蜂群编号、输入框里的文字、预设名序号 */
  private nameTarget = '';
  private nameDraft = '';
  private nameSeed = 0;
  private nameError = '';
  private rosterTab = 'all';
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
  private readonly presentations = new PresentationQueue();
  private banner = '';
  private bannerKind = '';
  private eventTitle = '';
  private eventText = '';
  private eventIcon = '';
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
  private resizeObserver: ResizeHandle | null = null;
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
  private recentBanners = new Map<string, number>();
  private lastThreatBanner = 0;
  /** 按住敌害时连续拍打 */
  private holdThreat = '';
  private lastSwatTick = 0;
  private swatted = false;
  private holdAcc = 0;
  private lastHoldTick = 0;
  /** 本次按下是否已经在花丛上采过蜜（按下即采一次，松手不再重复） */
  private holdCollected = false;
  private holdEnabledOnDown = false;
  /** 长按巢格、点未探明花田时显示的说明气泡 */
  private sceneTip: { title: string; lines: string[]; x: number; y: number; until: number } | null = null;
  private longPressed = false;
  /** 存档码弹窗：show 展示导出的码，paste 粘贴导入 */
  private saveCodeModal: { mode: 'show' | 'paste'; code: string; note: string } | null = null;
  private cloudBusy = false;
  /** 资源数字跳动：记录上次显示的值，一次性涨得多（采集、奖励）时让数字跳一下 */
  private resSeen: Record<string, { value: number; at: number; bumpUntil: number }> = {};
  private lastTapAt = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  /** 触屏点开面板后浏览器会补发一次 click，落在刚出现的遮罩上把面板又关掉；在此之前忽略遮罩点击 */
  private suppressScrimUntil = 0;
  /** 侧栏的上一级面板（返回键逐级退回） */
  private panelStack: string[] = [];
  private readonly drawerId = `browser-scene-${Math.random().toString(36).slice(2)}`;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly root: HTMLElement, private readonly session: GameSession,
    private readonly hostEnvironment?: UiEnvironment) {}

  private get environment(): UiEnvironment { return this.hostEnvironment ?? browserEnvironment(); }

  mount(): void {
    this.root.addEventListener('click', (event) => this.onClick(event));
    this.root.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement | null;
      if (target !== null && target.classList?.contains('name-input')) { this.nameDraft = target.value; this.nameError = ''; return; }
      this.onRange(event, false);
    });
    this.root.addEventListener('scroll', () => { this.lastScrollAt = Date.now(); }, { capture: true, passive: true });
    this.root.addEventListener('change', (event) => this.onRange(event, true));
    this.root.addEventListener('pointerdown', (event) => {
      this.presentations.tick(Date.now(), true);
      this.introGapUntil = Date.now() + 700;
      const target = event.target;
      if (isInputElement(target) && target.type === 'range') this.rangeActive = true;
    });
    this.environment.window.addEventListener('pointerup', () => {
      this.introGapUntil = Date.now() + 700;
      if (this.rangeActive) {
        this.rangeActive = false;
        this.refreshGame(true);
      }
    });
    this.environment.window.addEventListener('popstate', (event) => this.onPopState(event));
    this.unsubscribe = this.session.subscribeUi(() => this.onSessionTick());
    const target = this.environment.query('target') ?? '';
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
    this.environment.history.replaceState(this.historyState(), '', this.environment.location.href);
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
    if (push) this.environment.history.pushState(this.historyState(), '', this.environment.location.href);
    else this.environment.history.replaceState(this.historyState(), '', this.environment.location.href);
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
    this.environment.history.pushState(this.historyState(), '', this.environment.location.href);
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
          <div id="bloom-chip" class="bloom-wrap"></div>
          <div id="placing-bar" class="placing-wrap"></div>
        </div>
        <div id="field-mini" class="field-mini-wrap"></div>
        <div id="scene-tip" class="scene-tip-wrap"></div>
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
      if (this.session.renderer === null) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0012);
      if (this.view === 'field') this.session.renderer.zoomBy(factor);
      else this.session.renderer.zoomHiveBy(factor);
    }, { passive: false });
    this.resizeObserver = this.environment.observeResize(() => this.resizeCanvas());
    this.resizeObserver.observe(this.canvas);
    this.resizeCanvas();
    if (!this.environment.manualScene) this.session.addDrawer(this.drawerId, () => this.drawCanvas());
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
    const dpr = Math.min(2, Math.max(1, this.environment.window.devicePixelRatio || 1));
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

  /** Canvas hosts composite the shared game scene before painting the interface. */
  drawScene(): void { this.drawCanvas(); }

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
      this.longPressed = false; this.sceneTip = null;
      this.holdThreat = ''; this.swatted = false;
      const threatHit = this.session.renderer.hitThreat(point.x, point.y, this.canvasWidth, this.canvasHeight, this.view);
      if (threatHit.length > 0 && this.placing.length === 0 && this.movingCell.length === 0) {
        if (this.drawerOpen) this.closePanel(false);
        this.holdThreat = threatHit; this.swatted = true; this.lastSwatTick = this.downAt;
        this.swat(threatHit);
      } else if (this.placing.length === 0 && this.movingCell.length === 0 &&
        this.pickBee(this.session.renderer.hitBee(point.x, point.y, this.canvasWidth, this.canvasHeight, this.view))) {
        this.swatted = true;
      } else if (this.view === 'field') {
        const hit = this.session.renderer.hitField(point.x, point.y, this.canvasWidth, this.canvasHeight);
        this.holdField = hit.length > 0 && hit !== 'hive' ? hit : '';
        // 按在花丛上立刻采一次，按住不放则持续采集
        if (this.holdField.length > 0) {
          this.holdEnabledOnDown = this.engine().run.stats.manualCollects >= 2;
          if (this.drawerOpen) this.closePanel(false);
          this.collectFeedback(this.engine().collect(this.holdField, 1));
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
    if (this.pointers.size >= 2) {
      const points = [...this.pointers.values()];
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (this.pinchDistance > 0) {
        if (renderer.follow >= 0) renderer.stopFollow();
        if (this.view === 'field') renderer.zoomBy(distance / this.pinchDistance);
        else renderer.zoomHiveBy(distance / this.pinchDistance);
      }
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
    if (this.dragging) {
      if (renderer.follow >= 0) renderer.stopFollow();
      if (this.view === 'field') renderer.pan(dx, dy);
      else renderer.panHive(dx, dy);
    }
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
    this.holdThreat = '';
    if (this.swatted) { this.swatted = false; this.refreshGame(false); return; }
    if (event.type === 'pointercancel' || this.dragging || this.multiTouch) return;
    this.suppressScrimUntil = Date.now() + 450;
    if (this.longPressed) { this.longPressed = false; this.refreshGame(true); return; }
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

  /** 长按巢格约 0.45 秒：弹出这个格子的说明，松手后不再当作点击 */
  private longPressTick(): void {
    if (this.view !== 'hive' || this.longPressed || this.pointers.size !== 1 || this.dragging || this.multiTouch) return;
    if (Date.now() - this.downAt < 450 || this.placing.length > 0 || this.movingCell.length > 0) return;
    const renderer = this.session.renderer;
    if (renderer === null) return;
    const id = renderer.hitCell(this.downX, this.downY, this.canvasWidth, this.canvasHeight);
    const cell = id.length > 0 ? this.engine().hive.cell(id) : null;
    if (cell === null) return;
    const lines = this.engine().hive.explainCell(cell);
    this.longPressed = true;
    this.showSceneTip(lines[0] ?? '', lines.slice(1), this.downX, this.downY);
    this.session.audio.vibrate(15);
  }

  private showSceneTip(title: string, lines: string[], x: number, y: number): void {
    this.sceneTip = { title, lines, x, y, until: Date.now() + 6000 };
    this.refreshGame(false);
  }

  private renderSceneTip(): string {
    const tip = this.sceneTip;
    if (tip === null || Date.now() > tip.until || this.drawerOpen) { this.sceneTip = null; return ''; }
    const width = Math.min(280, this.canvasWidth - 24);
    const left = Math.max(12, Math.min(this.canvasWidth - width - 12, tip.x - width / 2));
    const below = tip.y < this.canvasHeight * 0.45;
    const top = below ? tip.y + 34 : Math.max(12, tip.y - 34 - (40 + tip.lines.length * 38));
    return `<button type="button" class="scene-tip" data-action="close-tip" style="left:${Math.round(left)}px;top:${Math.round(top)}px;width:${Math.round(width)}px"><b>${h(tip.title)}</b>${tip.lines.map((line) => `<small>${h(line)}</small>`).join('')}</button>`;
  }

  /** 点中了一只蜜蜂：打开它的信息卡；在花田上就跟着它飞 */
  private pickBee(id: number): boolean {
    if (id < 0 || this.engine().roster.get(id) === null) return false;
    if (this.drawerOpen) this.closePanel(false);
    this.openBee(id);
    this.session.audio.play('ui_tap');
    return true;
  }

  private openBee(id: number): void {
    const renderer = this.session.renderer;
    const bee = this.engine().roster.get(id);
    if (bee === null) return;
    this.beeCard = id;
    this.selectedField = '';
    if (renderer === null) return;
    renderer.highlight = -1;
    if ((bee.r === Role.Forager || bee.r === Role.Scout) && renderer.canFollow(id)) {
      this.view = 'field';
      renderer.startFollow(id);
    } else if (bee.r === Role.House || bee.r === Role.Guard) {
      renderer.stopFollow();
      this.view = 'hive';
      renderer.highlight = id;
    } else {
      renderer.stopFollow();
    }
    this.refreshGame(true);
  }

  private closeBee(): void {
    this.beeCard = -1;
    this.session.renderer?.stopFollow();
    if (this.session.renderer !== null) this.session.renderer.highlight = -1;
    this.refreshGame(true);
  }

  /** 拍打敌害：飘出伤害数字；补刀击退时提示奖励 */
  private swat(id: string): void {
    const result = this.engine().swatThreat(id);
    if (result.code === 'THREAT_COOLDOWN') return;
    if (!result.ok) { this.holdThreat = ''; return; }
    const killed = result.message.startsWith('亲手击退');
    // 补刀击退：奖励数字直接飘在敌害身上，不再另弹提示条
    this.session.renderer?.swatFx(id, killed ? result.message.replace('亲手击退！', '击退 ') : result.message, killed);
    this.session.audio.play('ui_tap');
    this.session.audio.vibrate(killed ? 30 : 10);
    if (killed) this.holdThreat = '';
  }

  private holdTick(): void {
    if (this.holdThreat.length > 0 && this.pointers.size === 1 && !this.dragging && !this.multiTouch) {
      const now = Date.now();
      if (now - this.downAt >= 250 && now - this.lastSwatTick >= 200) { this.lastSwatTick = now; this.swat(this.holdThreat); }
      return;
    }
    this.longPressTick();
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
      this.collectFeedback(e.collect(this.holdField, 1));
    }
  }

  /** 采集只在失败或采到蜜流花时提示，避免连续点击刷屏 */
  private collectFeedback(result: CmdResult): void {
    if (!result.ok) this.feedback(result);
    else if (result.message.startsWith('采到蜜流花')) { this.showToast(result.message); this.session.audio.play('ui_claim_reward'); }
  }

  private onTapField(id: string): void {
    if (this.drawerOpen) this.closePanel(false);
    if (id.length === 0) {
      this.selectedField = '';
      // 点到王国地图上的其它蜂巢：切换过去经营
      const other = this.session.renderer?.hitRealmHive(this.downX, this.downY, this.canvasWidth, this.canvasHeight) ?? '';
      if (other.length > 0) { this.confirmSwitchHive(other); return; }
      const fog = this.session.renderer?.hitFog(this.downX, this.downY, this.canvasWidth, this.canvasHeight) ?? '';
      if (fog.length > 0) {
        const e = this.engine();
        this.showSceneTip('还没探明的花田', [
          e.w.role(Role.Scout) > 0 ? '侦察蜂正在附近寻找花源，找到并跳完摇摆舞后，这里会变成可以采集的花田。'
            : '需要侦察蜂来探明。建好侦察蜂巢房并培养侦察蜂后，它们会在虚线圈内寻找新花田。',
          '升级侦察蜂巢房的“侦察范围”可以探到更远的花田。'
        ], this.downX, this.downY);
        return;
      }
      this.refreshGame(true); return;
    }
    if (id === 'hive') { this.enterHive(); return; }
    this.collectFeedback(this.engine().collect(id, 1));
    this.selectedField = id;
    this.refreshGame(true);
  }

  private onTapCell(id: string): void {
    if (this.drawerOpen) this.closePanel(false);
    const e = this.engine();
    if (this.movingCell.length > 0) {
      const cell = id.length > 0 ? e.hive.cell(id) : null;
      if (cell === null || !cell.unlocked) {
        this.showToast('请选择一个已经解锁的格子', true);
      } else {
        const result = e.swapCells(this.movingCell, id);
        this.feedback(result);
        if (result.ok) { this.selectedCell = id; this.movingCell = ''; }
      }
      this.refreshGame(true);
      return;
    }
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
    // 熊来袭是紧急事件：不等玩家关掉面板，直接弹出（广告、法律条款、确认框、拖动中除外）
    const bearUrgent = bear !== null && bear.phase === 'warning' && !this.session.ads.busy && this.legal.length === 0 &&
      this.offlineReport === null && this.confirmState === null && this.pointers.size === 0 && !this.rangeActive;
    if (bear !== null && bearUrgent) {
      const key = `${bear.eventId}:${bear.postponed}`;
      if (key !== this.bearPromptKey) {
        this.bearPromptKey = key;
        if (this.panel.length > 0) this.closePanel(false);
        this.drawerOpen = false;
        this.placing = '';
        this.movingCell = '';
        this.bearModal = true;
      }
    }
    if (bear === null || bear.phase !== 'warning') this.bearModal = false;
    if (this.toastText.length > 0 && now >= this.toastUntil) this.toastText = '';
    let notice = this.session.popNotice();
    while (notice !== null) {
      if (notice.kind === 'error') {
        // 毁巢、坠落这类重大损失每次都要让玩家看到
        if (notice.text.includes('熊')) this.showEvent('蜂巢被熊摧毁', notice.text, 'xf_enemy_bear', 6000);
        else this.showBanner(notice.text, notice.kind);
      } else if (notice.kind === 'threat' && notice.text.includes('熊')) {
        // 熊有专门的强制弹窗
      } else if (this.allowAuto(this.noticeTopic(notice))) {
        if (notice.kind === 'season' && this.engine().state.meta.settings.eventAnimations) {
          this.showEvent(seasonName(this.engine().run.season.season), notice.text,
            seasonIcon(this.engine().run.season.season), 2600);
        } else this.showBanner(notice.text, notice.kind);
      }
      notice = this.session.popNotice();
    }
    const renderer = this.session.renderer;
    if (renderer !== null) {
      renderer.selectedCell = this.selectedCell;
      renderer.selectedField = this.selectedField;
      renderer.placing = this.placing;
      renderer.focus = now < this.focusUntil ? this.focusTarget : this.autoFocus();
      const banners = renderer.takeBanners();
      banners.forEach((text) => { if (this.allowAuto(`fx:${normalizeTopic(text)}`)) this.showBanner(text, 'milestone'); });
    }
    this.syncPresentation();
    // 取名：新手交接后的第一个蜂巢、每次分蜂出来的新蜂巢
    const pendingName = (this.engine().state.meta.namePending ?? [])[0];
    if (pendingName !== undefined && this.nameTarget.length === 0 && !this.automaticPresentationBlocked() &&
      this.presentations.empty && this.session.guide().seen('handover')) {
      this.openNaming(pendingName);
    }
    // 季节事件：玩家空闲时自动弹出一次；“稍后再说”后只保留顶部事件条
    const seasonEvent = this.engine().events.active();
    if (seasonEvent !== null && seasonEvent.key !== this.eventPromptKey && !this.automaticPresentationBlocked() &&
      this.presentations.empty && this.engine().events.view() !== null) {
      this.eventPromptKey = seasonEvent.key;
      // 只有第一次季节事件自动弹出，之后只留顶部事件条
      if (this.allowAuto('auto:seasonEvent')) {
        this.eventModal = true;
        this.session.audio.play('codex_new');
      }
    }
    if (!this.automaticPresentationBlocked() && this.presentations.empty) {
      const topic = this.session.guide().pendingIntro();
      if (topic !== null) {
        this.introId = topic.id;
        this.introReplay = false;
        this.session.audio.play('codex_new');
      }
    }
  }

  /** 提示类别：消息自带类别优先，否则按文字推断（去掉数字和名字） */
  private noticeTopic(notice: GameMessage): string {
    return notice.topic !== undefined && notice.topic.length > 0 ? notice.topic : `${notice.kind}:${normalizeTopic(notice.text)}`;
  }

  /**
   * 自动弹窗只在第一次出现时弹：同类提示弹过一次后，之后只进消息记录（顶部事件条、角标照常）。
   * 新手阶段（引导没结束或正式四季还没开始）不受限制，多给一点引导。
   */
  private allowAuto(topic: string): boolean {
    const e = this.engine();
    const meta = e.state.meta;
    if (!Array.isArray(meta.popupsSeen)) meta.popupsSeen = [];
    const seen = meta.popupsSeen.includes(topic);
    if (!seen) {
      meta.popupsSeen.push(topic);
      if (meta.popupsSeen.length > 400) meta.popupsSeen.splice(0, meta.popupsSeen.length - 400);
      e.saveRequested = true;
    }
    // 只有第一次游玩、正式四季开始之前算新手季节（之后的新蜂群、重开的蜂巢不算）
    const novice = !meta.tutorialDone || (!e.run.season.formal && meta.totalWinters === 0 && meta.swarmCount === 0);
    return novice || !seen;
  }

  private showBanner(text: string, kind: string): void {
    const now = Date.now();
    // 同一句话 3 分钟内只弹一次；敌害出现 1 分钟内最多弹一次（顶部红色计数和地图上的血条已经在提示）
    const last = this.recentBanners.get(text);
    if (last !== undefined && now - last < 180000) return;
    if (kind === 'threat' && !text.includes('熊') && now - this.lastThreatBanner < 60000) return;
    this.recentBanners.set(text, now);
    if (this.recentBanners.size > 80) this.recentBanners.delete(this.recentBanners.keys().next().value as string);
    if (kind === 'threat') this.lastThreatBanner = now;
    this.presentations.enqueue({ key: `banner:${kind}:${text}`, text, kind, createdAt: now,
      ttl: kind === 'threat' ? 12000 : kind === 'warn' ? 20000 : 30000,
      duration: kind === 'threat' || kind === 'warn' ? 4000 : 3000 });
  }

  private automaticPresentationBlocked(): boolean {
    return this.pointers.size > 0 || this.rangeActive || this.panel.length > 0 || this.drawerOpen ||
      this.placing.length > 0 || this.movingCell.length > 0 || this.introId.length > 0 ||
      this.offlineReport !== null || this.confirmState !== null || this.legal.length > 0 ||
      this.boostModal || this.swarmBonus > 0 || this.bearModal || this.eventModal || this.nameTarget.length > 0 || this.session.ads.busy ||
      Date.now() < this.introGapUntil || Date.now() < this.toastUntil;
  }

  private syncPresentation(): void {
    const item = this.presentations.tick(Date.now(), this.automaticPresentationBlocked());
    this.banner = item && !item.title ? item.text : '';
    this.bannerKind = item?.kind ?? '';
    this.eventTitle = item?.title ?? '';
    this.eventText = item?.text ?? '';
    this.eventIcon = item?.icon ?? '';
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
    this.presentations.enqueue({ key: `event:${title}:${text}`, title, text, icon: eventIcon, kind: 'season', duration,
      createdAt: Date.now(), ttl: 25000 });
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
    // 提示 id 与 GameConfig.TUTORIAL 的步骤 id 一致（原先写的是旧 id，引导高亮从未生效）
    const item = guide.hints(1)[0];
    if (item === undefined) return '';
    if (item.id === 'tap') return this.view === 'field' ? 'field' : '';
    if (['egg', 'house', 'forager', 'scout'].includes(item.id)) return this.view === 'field' ? 'hiveIcon' : '';
    if (item.action.startsWith('build:')) return this.view === 'field' ? 'hiveIcon' : 'hive';
    return '';
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
    // 花田页、蜂巢页的侧边栏用两套外观
    drawer?.classList.toggle('view-field', this.view === 'field');
    drawer?.classList.toggle('view-hive', this.view !== 'field');
    scrim?.classList.toggle('visible', this.drawerOpen);
    this.setHtml('#top-bar', this.renderTopBar());
    this.setHtml('#prod-strip', this.renderProdStrip());
    this.setHtml('#hint-line', this.renderHintLine());
    this.setHtml('#placing-bar', this.renderPlacingBar());
    this.setHtml('#field-mini', this.beeCard >= 0 ? this.renderBeeCard() : this.renderFieldMini());
    this.setHtml('#bloom-chip', this.renderBloomChip());
    this.setHtml('#scene-tip', this.renderSceneTip());
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
      handle.innerHTML = `${icon(this.view === 'field' ? 'xf_flower_wild' : 'xf_nav_comb')}<span>${this.drawerOpen ? '›' : '‹'}</span>${badge > 0 ? `<b>${badge}</b>` : ''}`;
      handle.classList.toggle('view-field', this.view === 'field');
      handle.classList.toggle('view-hive', this.view !== 'field');
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

  private rateOf(res: string): number {
    const rate = this.engine().rateView;
    if (res === Res.Nectar) return rate.nectarIn + rate.manualIn - rate.nectarUse;
    if (res === Res.Honey) return rate.honeyIn - rate.honeyUse - rate.upkeep;
    if (res === Res.Wax) return rate.waxIn;
    return rate.jellyIn;
  }

  private renderTopBar(): string {
    const e = this.engine();
    const season = e.run.season;
    const threats = e.threats.activeList().length;
    const hiveFull = e.hive.isAtCapacity() && e.run.hive.fallAt > 0;
    const winterRisk = season.formal && [SeasonId.Autumn, SeasonId.WinterPrep].includes(season.season as SeasonId) &&
      e.w.econ.num(Res.Honey) < e.season.winterNeed();
    const alert = hiveFull
      ? `<button class="status-alert" data-action="open-panel" data-id="swarm" title="蜂巢已达上限，必须及时分蜂">${icon('xf_nav_split')}<b>!</b></button>`
      : threats > 0
      ? `<button class="status-alert" data-action="open-panel" data-id="eco">${icon('xf_threat_danger')}<b>${threats}</b></button>`
      : (season.starving || winterRisk
        ? `<button class="status-alert" data-action="open-panel" data-id="eco">${icon(season.starving ? 'xf_status_insufficient' : 'xf_season_winter_prep')}</button>` : '');
    const now = Date.now();
    const resources = this.resourceList().map((res) => {
      const full = e.w.econ.fillRatio(res) >= 0.95;
      const rate = this.resourceRate(res);
      const value = e.w.econ.num(res);
      const seen = this.resSeen[res] ?? { value, at: now, bumpUntil: 0 };
      const flow = Math.max(0, this.rateOf(res)) * Math.max(0.25, (now - seen.at) / 1000);
      if (value - seen.value >= Math.max(1, flow * 3)) seen.bumpUntil = now + 450;
      seen.value = value; seen.at = now; this.resSeen[res] = seen;
      return `<div class="resource-chip${full ? ' full' : ''}${now < seen.bumpUntil ? ' bump' : ''}">${icon(resIcon(res), resName(res))}<span><b>${formatBig(e.w.econ.amount(res))}</b>${rate.length > 0 ? `<small>${h(rate)}</small>` : ''}</span></div>`;
    }).join('');
    const boost = this.session.ads.boostSpeed();
    const boostChip = boost > 1
      ? `<button class="boost-chip active" data-action="open-boost">⚡${boost}× <small>${clock(this.session.ads.boostRemainingSec())}</small></button>`
      : `<button class="boost-chip" data-action="open-boost">⚡加速</button>`;
    return `${boostChip}<button class="season-chip" data-action="open-panel" data-id="eco">${icon(seasonIcon(season.season), seasonName(season.season))}<span><b>${h(seasonName(season.season))}</b>${season.formal ? `<small>${formatDuration(e.season.remaining())}</small>` : ''}</span></button>${this.renderKingdomChip()}${alert}<button class="resource-scroll" data-action="open-resources">${resources}</button>`;
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
    return `<button type="button" class="prod-strip" data-action="open-panel" data-id="${action}">${flow}${this.renderWinterRow()}${chips.length > 0 ? `<div class="prod-chips">${chips.join('')}</div>` : ''}</button>`;
  }

  /** 入秋后在产线条里显示越冬储备：距冬天多久、还差多少蜂蜜 */
  private renderWinterRow(): string {
    const e = this.engine();
    const season = e.run.season;
    if (!season.formal) return '';
    const s = season.season as SeasonId;
    const have = e.w.econ.num(Res.Honey);
    if (s === SeasonId.Autumn || s === SeasonId.WinterPrep) {
      const need = e.season.winterNeed();
      const toWinter = e.season.remaining() + (s === SeasonId.Autumn ? e.season.duration(SeasonId.WinterPrep) : 0);
      const ratio = need > 0 ? Math.min(1, have / need) : 1;
      const short = Math.max(0, need - have);
      return `<div class="winter-row${short > 0 ? ' short' : ''}">${icon('xf_season_winter_prep')}<span class="winter-bar"><i style="width:${Math.round(ratio * 100)}%"></i><span>距冬天 ${clock(toWinter)} · 过冬需 ${num1(need)} 蜂蜜 · ${short > 0 ? `还差 ${num1(short)}` : '储备已够'}</span></span></div>`;
    }
    if (s === SeasonId.Winter) {
      const use = e.rateView.upkeep;
      const last = use > 0.001 ? have / use : Infinity;
      const remain = e.season.remaining();
      const ok = last >= remain;
      return `<div class="winter-row${ok ? '' : ' short'}">${icon('xf_season_winter')}<span class="winter-bar"><i style="width:${Math.round(Math.min(1, last / Math.max(1, remain)) * 100)}%"></i><span>冬季剩余 ${clock(remain)} · 储备${Number.isFinite(last) ? `约够 ${clock(last)}` : '充足'}${ok ? '' : ' · 不够过冬'}</span></span></div>`;
    }
    return '';
  }

  private visibleHints(): Hint[] {
    const guide = this.session.guide();
    const hints = guide.hints(2);
    // “新事物”会自己弹出介绍卡，提示行不再重复显示同一件事
    return guide.inTutorial() ? hints : hints.filter((item) => (item.kind === 'warn' || item.kind === 'new') && !item.id.startsWith('intro_'));
  }

  private renderHintLine(): string {
    const hints = this.visibleHints();
    if (hints.length === 0 || hints[0].id === this.hiddenHint) return '';
    const item = hints[0];
    return `<div class="hint-line ${h(item.kind)}"><button class="hint-main" data-action="run-hint" data-id="${h(item.action)}">${icon(item.icon)}<span>${h(item.text)}</span>${hints.length > 1 ? `<b>+${hints.length - 1}</b>` : ''}<i>›</i></button><button class="hint-close" data-action="hide-hint" data-id="${h(item.id)}" aria-label="隐藏提示">${icon('xf_action_close')}</button></div>`;
  }

  private renderPlacingBar(): string {
    if (this.movingCell.length > 0) {
      return `<div class="placing-bar">${icon('xf_action_refresh')}<span>选择任意已解锁格子：空格会移动，已有巢房会互换</span>${button('cancel-move-cell', '取消')}</div>`;
    }
    if (this.placing.length === 0) return '';
    const def = this.engine().w.bldDef(this.placing);
    return `<div class="placing-bar">${icon(bldIcon(this.placing))}<span>点一个发光的空格，放置「${h(def.name)}」${['nursery', 'brewery', 'storage', 'guardRoom', 'evolution'].includes(this.placing) ? '；格子上的绿色字是放在那里的相邻加成' : ''}</span>${button('cancel-place', '取消')}</div>`;
  }

  /** 蜜流花提示：点一下镜头移过去 */
  private renderBloomChip(): string {
    const e = this.engine();
    const bloom = e.map.activeBloom();
    if (this.placing.length > 0) return '';
    const special = this.renderEventChip();
    if (special.length > 0) return special;
    if (bloom === null) {
      if (!springSupplyWanted(e) || !this.session.ads.check(AdPlacement.SpringSupply, 1).ok) return '';
      return `<button type="button" class="bloom-chip spring-chip" data-action="ad-spring">${icon('xf_season_spring')}<span><b>春季补给</b><small>熬过了冬天！看个广告领取 ${num1(springSupplyAmount(e))} 蜂蜜</small></span><i>领取 ›</i></button>`;
    }
    return `<button type="button" class="bloom-chip" data-action="goto-bloom" data-id="${h(bloom.fieldId)}">${icon('xf_status_rare')}<span><b>蜜流花开了</b><small>点中它直接得约 ${num1(e.map.bloomReward())} 蜂蜜 · 还剩 ${Math.ceil(e.map.bloomRemaining())} 秒</small></span><i>去采 ›</i></button>`;
  }

  /** 蜜蜂信息卡：名字、出生季节、效率与按工种区分的工作记录；明星蜂可以升级 */
  private renderBeeCard(): string {
    const e = this.engine();
    const bee = e.roster.get(this.beeCard);
    const renderer = this.session.renderer;
    if (bee === null) { this.beeCard = -1; return this.renderFieldMini(); }
    const following = renderer !== null && renderer.follow === bee.id;
    const visible = following && renderer !== null && renderer.followPos() !== null;
    const injured = e.roster.isInjured(bee);
    const region = e.w.cfg.regions.find((r) => r.id === bee.z);
    const trait = bee.t === undefined ? null : starTrait(bee.t);
    let status = injured ? '受伤休养中，过一会儿就好' : '';
    if (!injured && following) status = visible ? '镜头正跟着它飞' : '它飞进蜂巢或花丛里了，等它出来';
    if (!injured && !following && bee.r === Role.Forager) status = '在花田与蜂巢之间往返运蜜';
    if (!injured && !following && bee.r === Role.Scout) status = '在虚线圈里寻找新花田';
    if (!injured && !following && bee.r === Role.House) status = '在酿蜜房和储蜜格之间忙碌';
    if (!injured && !following && bee.r === Role.Guard) status = '在守卫巢房旁巡逻';
    const stats = e.roster.statLines(bee).map((line) => `<span><small>${h(line.label)}</small><b>${h(line.value)}</b></span>`).join('');
    let starHtml = '';
    if (trait !== null) {
      const lv = bee.lv ?? 1;
      const cost = e.roster.upgradeCost(bee);
      starHtml = `<p class="bee-star">★ 明星蜂「${h(trait.name)}」Lv${lv}：全巢${h(trait.desc)} +${h(e.roster.bonusText(trait, lv))}</p>${lv < STAR_MAX_LEVEL ? button('bee-upgrade', `升到 Lv${lv + 1}（${costStr(cost)}）`, { id: String(bee.id), primary: true, disabled: !e.w.econ.canAfford(cost) }) : '<p class="muted">已经满级</p>'}`;
    }
    const canFollow = (bee.r === Role.Forager || bee.r === Role.Scout) && renderer !== null;
    const followBtn = canFollow ? (following ? button('bee-unfollow', '停止跟随') : button('bee-follow', '跟随它飞', { id: String(bee.id) })) : '';
    return `<section class="bee-card"><div class="bee-head">${beePortrait(bee.r, bee.t, bee.n)}<span><b>${h(bee.n)}${trait !== null ? ' ★' : ''}</b><small>${h(e.w.roleDef(bee.r).name)} · ${h(e.roster.birthText(bee))}${region !== undefined && bee.z !== e.run.regionId ? ` · 来自${h(region.name)}` : ''}</small></span><button type="button" class="round-btn" data-action="bee-close" aria-label="关闭">${icon('xf_action_close')}</button></div>${status.length > 0 ? `<p class="bee-status">${h(status)}</p>` : ''}<div class="bee-stats">${stats}</div>${starHtml}<div class="choice-row">${followBtn}${button('open-panel', '蜂群名册', { id: 'roster' })}</div></section>`;
  }

  /** 王国等级小标：点开任务页 */
  private renderKingdomChip(): string {
    const e = this.engine();
    if (!e.state.meta.tutorialDone) return '';
    const k = e.kingdom.state();
    const ratio = Math.min(1, k.xp / Math.max(1, e.kingdom.need(k.level)));
    return `<button class="season-chip kingdom-chip" data-action="open-panel" data-id="tasks" title="王国等级">${icon('xf_building_queen', '王国')}<span><b>Lv${k.level}</b><small>${Math.floor(ratio * 100)}%</small></span></button>`;
  }

  /** 顶部事件条：熊 > 保卫战 > 季节事件 > 蜂后的心愿 > 蜜流花 > 春季补给 */
  private renderEventChip(): string {
    const e = this.engine();
    const bear = e.threats.pendingBear();
    if (bear !== null && (bear.phase === 'active' || bear.phase === 'warning')) {
      const left = Math.max(0, Math.ceil(bear.endsAt - e.run.time));
      const hp = Math.max(0, Math.round(bear.hp / Math.max(1, bear.maxHp) * 100));
      const text = bear.phase === 'active' ? `正在抢蜜！熊还剩 ${hp}% 体力 · ${left} 秒内赶走它` : `正在接近蜂巢 · ${left} 秒后到达`;
      return `<button type="button" class="bloom-chip raid-chip" data-action="${bear.phase === 'active' ? 'goto-bear' : 'open-bear'}">${icon('xf_enemy_bear')}<span><b>熊来袭</b><small>${h(text)}</small></span><i>${bear.phase === 'active' ? '拍它 ›' : '应对 ›'}</i></button>`;
    }
    const raid = e.threats.raidView();
    if (raid !== null) {
      const text = raid.phase === 'warn'
        ? `胡蜂窝来袭！${Math.ceil(raid.remaining)} 秒后第一波到达`
        : `第 ${raid.wave}/${raid.waves} 波 · 还剩 ${raid.left} 只${raid.boss ? '（胡蜂王）' : ''} · ${clock(raid.remaining)}`;
      return `<button type="button" class="bloom-chip raid-chip" data-action="goto-raid">${icon('xf_enemy_wasp')}<span><b>蜂巢保卫战</b><small>${h(text)}</small></span><i>迎战 ›</i></button>`;
    }
    const ev = e.events.view();
    if (ev !== null) {
      return `<button type="button" class="bloom-chip event-chip" data-action="open-event">${icon(ev.icon)}<span><b>${h(ev.title)}</b><small>季节事件 · 点开做选择 · 还剩 ${clock(ev.remaining)}</small></span><i>选择 ›</i></button>`;
    }
    const ch = e.run.season.challenge;
    if (ch !== undefined) {
      const done = Math.min(ch.target, e.run.stats.manualCollects - ch.start);
      return `<button type="button" class="bloom-chip event-chip" data-action="goto-field">${icon('xf_nav_queen')}<span><b>蜂后的心愿 ${done}/${ch.target}</b><small>亲手采蜜 · 还剩 ${Math.ceil(Math.max(0, ch.until - e.run.time))} 秒</small></span><i>去采 ›</i></button>`;
    }
    return '';
  }

  private renderEventOverlay(): string {
    const e = this.engine();
    const ev = e.events.view();
    if (ev === null) { this.eventModal = false; return ''; }
    const options = ev.options.map((opt) => opt.ad
      ? `<div class="event-option">${this.adButton('ad-event', h(opt.label), AdPlacement.SeasonEvent, { id: opt.id, primary: false })}<small>${h(opt.detail)}</small></div>`
      : `<div class="event-option">${button('event-choose', opt.label, { id: opt.id, primary: opt === ev.options[0] })}${opt.detail.length > 0 ? `<small>${h(opt.detail)}</small>` : ''}</div>`).join('');
    return `<div class="modal-layer"><section class="modal-card event-card"><div class="heading-line">${icon(ev.icon)}<h2>${h(ev.title)}</h2></div><p>${h(ev.text)}</p><div class="choice-stack">${options}</div>${button('event-later', '稍后再说')}<p class="muted">不选的话，这件事会在 ${clock(ev.remaining)} 后自然过去。</p></section></div>`;
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
    if (e.state.meta.swarmCount > 0 || e.state.colonies.length > 0) out.push('colonies');
    if (e.w.unlocked('t_build_storage')) out.push('resources');
    if (e.w.unlocked('t_first_egg')) out.push('codex');
    out.push('settings');
    if (e.w.unlocked('t_first_nectar')) out.push('hub');
    if (e.run.map.fields.some((f) => f.discovered)) out.push('fields');
    const groups = this.navGroups(out);
    return ['tasks', ...groups[0].items, ...groups[1].items, ...groups[2].items];
  }

  /** 侧边栏三组：当前页面所属的一组在前（花田页：花田组；蜂巢页：蜂巢组），通用功能在最后 */
  private navGroups(available: string[]): Array<{ id: string; label: string; items: string[] }> {
    const field = { id: 'field', label: '花田', items: NAV_FIELD.filter((k) => available.includes(k)) };
    const hive = { id: 'hive', label: '蜂巢', items: NAV_HIVE.filter((k) => available.includes(k)) };
    const general = { id: 'general', label: '通用', items: NAV_GENERAL_TAIL.filter((k) => available.includes(k)) };
    return this.view === 'field' ? [field, hive, general] : [hive, field, general];
  }

  private navBadge(key: string): boolean {
    const e = this.engine();
    if (key === 'tasks') return e.daily.claimable() > 0 || this.session.guide().hints(3).some((item) => item.kind === 'warn' || item.kind === 'new');
    if (key === 'build') return e.hive.buildingOptions().some((def) => e.w.count(def.id) === 0 &&
      e.hive.buildingAvailable(def.id) && e.w.econ.canAfford(e.hive.buildCost(def.id)));
    if (key === 'eco') return e.threats.activeList().length > 0 || e.run.season.starving;
    if (key === 'swarm') return e.swarmPreview().ready || e.run.colony.youngQueens > 0;
    return false;
  }

  private badgeCount(): number { return this.dockItems().filter((key) => this.navBadge(key)).length; }

  /** 打开侧边栏时默认的面板：花田页看花田一览，蜂巢页看蜂巢 */
  private defaultPanel(): string {
    return this.view === 'field' && this.dockItems().includes('fields') ? 'fields' : 'hub';
  }

  private renderDrawerNav(): string {
    const items = this.dockItems();
    const item = (key: string, group: string): string => {
      const [label, itemIcon] = NAV[key];
      return `<button type="button" class="nav-item nav-${group}${this.panel === key ? ' active' : ''}" data-action="open-panel" data-id="${key}">${icon(itemIcon)}<span>${h(label)}</span>${this.navBadge(key) ? '<i></i>' : ''}</button>`;
    };
    const groups = this.navGroups(items).filter((g) => g.items.length > 0)
      .map((g) => `<p class="nav-group nav-group-${g.id}">${h(g.label)}</p>${g.items.map((k) => item(k, g.id)).join('')}`).join('');
    return `${item('tasks', 'general')}${groups}`;
  }

  private panelFrame(title: string, frameIcon: string, body: string): string {
    return `<section class="panel-frame"><header>${frameIcon.length > 0 ? icon(frameIcon) : ''}<h2>${h(title)}</h2></header><div class="panel-scroll">${body}</div></section>`;
  }

  private renderPanel(): string {
    if (this.panel === 'hub') return this.renderHubPanel();
    if (this.panel === 'fields') return this.renderFieldsPanel();
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
    if (this.panel === 'colonies') return this.renderColoniesPanel();
    if (this.panel === 'resources') return this.renderResourcePanel();
    if (this.panel === 'codex') return this.renderCodexPanel();
    if (this.panel === 'settings') return this.renderSettingsPanel();
    if (this.panel === 'roster') return this.renderRosterPanel();
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
    const queen = panelCard(`<div class="card-head large-icon">${icon('xf_nav_queen')}<div><h3>蜂后</h3><p>${h(`孵化新卵消耗 ${costStr(e.colony.eggCost())}${e.run.colony.layCooldown > 0 ? ` · 休息 ${Math.ceil(e.run.colony.layCooldown)} 秒` : ''}`)}</p><small>${h(e.run.colony.plan.on ? `繁育计划 · ${e.colony.planStatus()}` : (e.colony.planUnlocked() ? '繁育计划已解锁：在蜂后详情里开启' : '手动孵化，亲自选择工种分化'))}</small></div>${button('lay', '孵化新卵', { primary: true, disabled: !e.colony.canLay().ok })}</div>${roles.length > 0 ? `<div class="quick-row"><span>培养</span>${roleButtons}</div>` : ''}<button class="text-link" data-action="open-panel" data-id="queen">蜂后详情、分化与蜂后室升级 ›</button>`);
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
      const statIcon = track.id === 'scout.quality' ? 'xf_stat_scout_stock' : `xf_stat_${track.id.replace('.', '_')}`;
      const rangeNote = track.id === 'scout.range' ? `<em class="key-note">当前探索圈半径 ${Math.round(preview.cur)}，升级后 ${Math.round(preview.next)}；圈外花丛需继续升级后才能发现</em>` : '';
      const topUp = maxed || preview.affordable ? 0 : honeyTopUp(e, preview.costs);
      const topUpButton = topUp > 0 ? `<div class="topup-row">${this.adButton('ad-topup', `补齐 ${topUp} 蜂蜜并升级`, AdPlacement.HoneyTopUp, { id: track.id, value: topUp, primary: false })}</div>` : '';
      return panelCard(`<div class="card-head">${icon(statIcon)}<div><h3>${h(preview.name)}</h3><p>${h(value)}</p><small>${h(`${delta}升级消耗 ${costStr(preview.costs)}`)}</small>${rangeNote}${preview.keyNote.length > 0 ? `<em class="key-note">关键节点 ${h(preview.keyNote)}</em>` : ''}</div>${button('upgrade', '升级', { id: track.id, primary: true, disabled: maxed || !preview.affordable })}</div>${topUpButton}`);
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
    return this.panelFrame('蜂后与幼虫', 'xf_nav_queen', `<p>蜂群 ${e.w.population()} / ${e.w.popCap()}（成年 ${e.w.adults()}，幼虫 ${colony.larvae}，孵化中 ${e.w.inHatch()}）</p>${this.renderBreedPlan()}<div class="action-line">${button('lay', '孵化新卵', { primary: true, disabled: !canLay.ok })}<span>孵化新卵消耗 ${h(costStr(e.colony.eggCost()))}${colony.layCooldown > 0 ? ` · 休息 ${Math.ceil(colony.layCooldown)} 秒` : ''}</span></div>${!canLay.ok ? `<p class="warning">${h(canLay.message)}</p>` : ''}<p class="muted">每次点击孵化获得幼虫，然后选择工种分化。新卵费用随累计孵化次数递增。开启繁育计划后蜂后会自动繁育（离线也会），手动孵化和分化随时可以插队。</p><p class="muted">${icon('xf_status_rare')} 每孵化一只，有 ${pct(e.roster.starChance())} 的概率额外诞生一只明星蜂${(colony.luckyHatch ?? 0) > 0 ? `（幸运孵化还剩 ${colony.luckyHatch} 只）` : ''}${(e.kingdom.state().starEggs ?? 0) > 0 ? ` · 明星蜂卵 ${e.kingdom.state().starEggs} 颗，下次必出` : ''}。</p>${(colony.luckyHatch ?? 0) <= 0 ? this.adButton('ad-lucky', `幸运孵化：接下来 ${LUCKY_HATCHES} 只更容易出明星蜂`, AdPlacement.LuckyHatch, { primary: false }) : ''}<hr><h3 class="section-title">选择幼虫分化工种</h3>${roleCards}${e.w.unlocked('t_survive_winter') || e.state.meta.swarmCount > 0 ? this.renderQueenRearCard() : ''}<hr><h3 class="section-title">孵化队列 ${colony.batches.filter((batch) => batch.started).length} / ${e.colony.hatchSlots()}</h3>${batches}<hr><h3 class="section-title">蜂后室升级</h3>${this.renderUpgradeList(Bld.Queen)}`);
  }

  /** 繁育计划卡片：开关、各工种比例、保留蜂蜜 */
  private renderBreedPlan(): string {
    const e = this.engine();
    const plan = e.run.colony.plan;
    const unlocked = e.colony.planUnlocked();
    const head = `<div class="setting-row plan-head">${icon('xf_status_automation')}<span><b>繁育计划</b><small>${h(e.colony.planStatus())}</small></span>${unlocked ? this.toggleButton('breed-plan', plan.on) : `<em class="muted">未解锁</em>`}</div>`;
    if (!unlocked || !plan.on) return panelCard(head);
    const roles = ALL_ROLES.filter((role) => e.colony.roleAvailable(role));
    const total = roles.reduce((sum, role) => sum + (plan.weights[role] ?? 0), 0);
    const sliders = roles.map((role) => this.range('plan-weight', role, plan.weights[role] ?? 0, 0, 10, 1,
      `${e.w.roleDef(role).name} ${total > 0 ? pct((plan.weights[role] ?? 0) / total) : '0%'}`)).join('');
    const reserve = Math.round(plan.reserve * 100);
    return panelCard(`${head}<p class="muted">按比例补齐最缺的工种；只用计划自己产下的幼虫，你手动孵化的幼虫仍由你分化。入秋后自动多留越冬所需的蜂蜜。</p>${sliders}${this.range('plan-reserve', 'reserve', reserve, 0, 80, 5, `保留蜂蜜 ${reserve}%`)}`);
  }

  private toggleButton(key: string, on: boolean): string {
    return `<button type="button" class="switch ${on ? 'on' : 'off'}" role="switch" aria-checked="${on}" data-action="toggle-setting" data-id="${h(key)}"><span></span></button>`;
  }

  private range(action: string, id: string, value: number, min: number, max: number, step: number, label: string): string {
    return `<label class="range-row"><span>${h(label)}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" style="--range-fill:${100 * (value - min) / (max - min || 1)}%" data-range="${h(action)}" data-id="${h(id)}" aria-label="${h(label)}"><output>${h(value)}</output></label>`;
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
    const stars = e.roster.stars();
    const rosterCard = e.roster.list().length === 0 ? '' : panelCard(`<div class="card-head">${icon('xf_nav_comb')}<div><h3>蜂群名册</h3><p>${e.roster.list().length} 只有名字的蜜蜂${stars.length > 0 ? ` · 明星蜂 ${stars.length} 只` : ''}</p><small>${h(stars.slice(0, 3).map((b) => `★${b.n}`).join('　') || '每只蜜蜂都有自己的名字、出生季节和工作记录；点地图上飞行的蜜蜂也能看到')}</small></div>${button('open-panel', '查看', { id: 'roster', primary: true })}</div>`);
    return this.panelFrame('蜂群管理', 'xf_nav_swarm', `${panelCard(`<h3>成年蜂 ${e.w.adults()} · 幼虫 ${colony.larvae} · 孵化中 ${e.w.inHatch()} · 总占用 ${e.w.population()}/${e.w.popCap()}</h3><small>${h(winter)}</small>`)}${rosterCard}${roles.length === 0 ? `${artImage('state_no_tasks', '暂无工种', 'empty-art')}<p class="muted">建造工种巢房后，可以在这里管理蜂群。</p>` : roleCards}${idle}${injuredTotal > 0 ? `<p class="muted">${icon('xf_status_injured')} ${injuredTotal} 只蜜蜂受伤休养中，会逐渐恢复</p>` : ''}<h3 class="section-title">采集路线策略</h3><div class="choice-row">${strategyButtons}</div><p class="muted">安全近路减少受伤；高产远路收益更高但更危险。</p>${e.colony.roleAvailable(Role.House) && e.w.unlocked('t_build_storage') ? `<h3 class="section-title">巢内工蜂分工：筑巢 ${wax}%，酿蜜 ${100 - wax}%</h3>${this.range('wax-share', 'wax', wax, 0, 100, 5, '筑巢比例')}<p class="muted">筑巢消耗蜂蜜产出蜂蜡；酿蜜把花蜜加工为蜂蜜。</p>` : ''}${e.colony.roleAvailable(Role.Guard) ? `<h3 class="section-title">守卫优先区域</h3><div class="choice-row">${guards}</div>` : ''}${e.colony.lifespanWarning() ? '<p class="warning">生态模式预警：工蜂老化速度快于补员，请手动孵化并分化新工蜂。</p>' : ''}`);
  }

  /** 蜂群名册：按工种筛选；明星蜂排在前面，其余按工作量排序 */
  private renderRosterPanel(): string {
    const e = this.engine();
    const tabs = [['all', '全部'], ['star', '明星蜂'], [Role.Forager, '采集蜂'], [Role.Scout, '侦察蜂'], [Role.House, '巢内工蜂'], [Role.Guard, '守卫蜂']]
      .map(([id, label]) => button('roster-tab', label, { id, primary: this.rosterTab === id })).join('');
    const all = e.roster.list();
    const list = all.filter((b: NamedBee) => this.rosterTab === 'all' || (this.rosterTab === 'star' ? b.t !== undefined : b.r === this.rosterTab))
      .slice().sort((x: NamedBee, y: NamedBee) => Number(y.t !== undefined) - Number(x.t !== undefined) || y.a - x.a || y.e - x.e);
    const shown = list.slice(0, 60);
    const rows = shown.map((b: NamedBee) => {
      const trait = b.t === undefined ? null : starTrait(b.t);
      const main = e.roster.statLines(b)[1];
      return `<button type="button" class="roster-row${trait !== null ? ' star' : ''}" data-action="bee-open" data-id="${b.id}">${beePortrait(b.r, b.t, b.n)}<span><b>${h(b.n)}${trait !== null ? ` ★${h(trait.name)} Lv${b.lv ?? 1}` : ''}</b><small>${h(e.w.roleDef(b.r).name)} · ${h(e.roster.birthText(b))} · 效率 ${b.e}%${main !== undefined ? ` · ${h(main.label)} ${h(main.value)}` : ''}</small></span><i>›</i></button>`;
    }).join('');
    const more = list.length > shown.length ? `<p class="muted">只显示前 ${shown.length} 只（共 ${list.length} 只）</p>` : '';
    const empty = list.length === 0 ? `<p class="muted">${this.rosterTab === 'star' ? `还没有明星蜂。孵化时有 ${pct(e.roster.starChance())} 的概率诞生；王国升级会送明星蜂卵。` : '这里还没有蜜蜂。'}</p>` : '';
    return this.panelFrame('蜂群名册', 'xf_nav_comb', `<p class="muted">每只蜜蜂的名字都不一样。点一只查看它的出生季节、效率和工作记录；采集蜂和侦察蜂可以跟着它飞。</p><div class="tab-row">${tabs}</div>${empty}${rows}${more}`);
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
      const topUp = available && free > 0 && !can ? honeyTopUp(e, e.hive.buildCost(def.id)) : 0;
      const topUpButton = topUp > 0 ? `<div class="topup-row">${this.adButton('ad-topup-build', `补齐 ${topUp} 蜂蜜`, AdPlacement.HoneyTopUp, { id: def.id, value: topUp, primary: false })}</div>` : '';
      return panelCard(`<div class="card-head${unlocked ? '' : ' locked'}">${icon(bldIcon(def.id))}<div><h3>${h(unlocked ? def.name : `${def.name}（未开放）`)}</h3><p>${h(def.desc)}</p><small class="${can ? 'ok' : 'warning-text'}">${h(line)}</small></div>${available ? button('start-place', '放置', { id: def.id, primary: true, disabled: !can }) : ''}</div>${topUpButton}`);
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
      return this.panelFrame('建造巢房', 'xf_action_build', `${button('start-move-cell', '与其他已解锁格子换位', { id: cell.cellId })}<p class="muted">空格也能参与换位：选择后再点一个已有巢房，即可把巢房移动到这里。</p><hr>${options || '<p class="muted">目前没有可建造的巢房。</p>'}`);
    }
    const def = e.w.bldDef(cell.building);
    const notes = e.hive.describeCell(cell).map((note) => `<li>${h(note)}</li>`).join('');
    const demolish = cell.building === Bld.Queen ? '' : button('confirm-demolish', `${icon('xf_action_delete')} 拆除`, { danger: true });
    const move = button('start-move-cell', '换格子', { id: cell.cellId, primary: true });
    return this.panelFrame(def.name, bldIcon(def.id), `<p>${h(def.desc)}</p>${notes.length > 0 ? `<ul class="detail-list">${notes}</ul>` : ''}<div class="choice-row">${move}${demolish}</div><p class="muted">换格子不会消耗资源；目标有巢房时会直接交换，目标为空时会移动过去。</p><hr><h3 class="section-title">属性升级（作用于该工种的全部蜜蜂）</h3>${this.renderUpgradeList(def.id)}`);
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
      `花蜜存量 ${Math.floor(field.stock)} / ${Math.floor(e.map.maxStock(field))} · ${e.map.recoveryRemaining(field) > 0 ? `重新开花剩余 ${Math.ceil(e.map.recoveryRemaining(field))} 秒` : `恢复 ${num1(e.map.regen(field))}/秒`} · 品质 ×${num1(def.yieldMul * e.w.attrs.get('scout.quality'))}`
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

  /** 花田一览：本蜂巢已知的花田、存量、驻守与敌害，以及采集路线策略 */
  private renderFieldsPanel(): string {
    const e = this.engine();
    const known = e.run.map.fields.filter((f) => f.discovered)
      .sort((a, b) => Number(b.home) - Number(a.home) || a.dist - b.dist);
    const threats = e.threats.activeList();
    const rows = known.map((f) => {
      const def = e.w.flower(f.flower);
      const max = e.map.maxStock(f);
      const ratio = Math.min(1, f.stock / Math.max(1, max));
      const poll = e.run.colony.pollinators[f.fieldId] ?? 0;
      const danger = threats.some((t) => t.targetId === f.fieldId) ? ' · ⚠ 有敌害' : '';
      const alloc = e.w.alloc.find((a) => a.fieldId === f.fieldId);
      const state = !f.home && !e.map.intelValid(f) ? ' · 信息过期' : '';
      return `<div class="field-row"><span>${icon(flowerIcon(f.flower))}<b>${h(def.name)}${f.home ? '（巢旁）' : ''}</b><span class="daily-bar"><i style="width:${Math.round(ratio * 100)}%"></i></span><small>存量 ${Math.floor(f.stock)}/${Math.floor(max)} · 采集蜂 ${Math.round(alloc?.bees ?? 0)}${poll > 0 ? ` · 驻守 ${poll}` : ''}${danger}${state}</small></span>${button('open-field', '查看', { id: f.fieldId })}</div>`;
    }).join('');
    const strategy = e.run.colony.forageStrategy;
    const strategyButtons = [
      [ForageStrategy.Safe, '安全近路'], [ForageStrategy.Balanced, '均衡'], [ForageStrategy.Rich, '高产远路']
    ].map(([id, label]) => button('set-strategy', label, { id, primary: strategy === id })).join('');
    const idle = e.w.forageIdle >= 1 ? `<p class="warning">${Math.floor(e.w.forageIdle)} 只采集蜂没有可去的花田${e.run.realm !== undefined ? '：领地里的花被采得太快，可以升级花丛、种新花，或往别的种区分蜂' : ''}</p>` : '';
    return this.panelFrame('花田一览', 'xf_flower_wild', `<p class="muted">已发现 ${known.length} 片花田 · 采集蜂 ${e.w.role(Role.Forager)} 只 · 驻守授粉 ${e.map.pollinatorTotal()} 只</p>${idle}${rows}<hr><h3 class="section-title">采集路线策略</h3><div class="choice-row">${strategyButtons}</div><p class="muted">安全近路减少受伤；高产远路收益更高但更危险。点「查看」可以安排驻守授粉。</p>`);
  }

  /** 授粉成长进度 */
  private pollProgress(field: FlowerField): string {
    const e = this.engine();
    const def = e.w.flower(field.flower);
    if (def.next.length === 0) return '<p class="muted">已经是最高级的花田，驻守只会加快恢复。</p>';
    const need = e.map.growthNeeded(field);
    const ratio = Math.min(1, field.growth / Math.max(0.001, need));
    return `<div class="daily-task"><span><b>成长为${h(e.w.flower(def.next).name)}</b><span class="daily-bar"><i style="width:${Math.round(ratio * 100)}%"></i></span><small>${Math.round(ratio * 100)}%</small></span></div>`;
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
    return this.panelFrame(def.name, flowerIcon(field.flower), `${expired ? `<p class="warning">${icon('xf_field_expired')} 信息已过期</p>` : ''}${withered ? `<p class="muted">${icon('xf_field_withered')} ${e.run.season.season === SeasonId.Winter ? '冬季休眠：花蜜几乎不再恢复' : '花蜜快被采空了，可以等待恢复或寻找更多花源'}</p>` : ''}${this.fieldLines(field).map((line) => `<p>${h(line)}</p>`).join('')}${button('collect-field', e.map.recoveryRemaining(field) > 0 ? `恢复中 ${Math.ceil(e.map.recoveryRemaining(field))}秒` : '采集一次', { primary: true, disabled: e.map.recoveryRemaining(field) > 0 })}${pollUnlocked ? `<hr><h3 class="section-title">${icon('xf_talent_e_pollen')} 授粉特化：驻守 ${poll} 只采集蜂</h3><div class="poll-row">${button('poll-step', '−', { id: field.fieldId, value: poll - 1, disabled: poll <= 0 })}${this.range('pollinators', field.fieldId, poll, 0, maxPoll, 1, '驻守采集蜂')}${button('poll-step', '+', { id: field.fieldId, value: poll + 1, disabled: poll >= maxPoll })}</div>${this.pollProgress(field)}<p class="muted">驻守的采集蜂不运蜜，但会提高花田恢复速度并让它成长为更高级的花田（会吸引更强敌害）。最多派出能干活的采集蜂的一半。</p>` : ''}`);
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
      const bearActions = event.type === 'bear'
        ? `<div class="choice-row">${event.phase === 'active' ? button('goto-bear', '去拍走它', { primary: true }) : button('bear-choice', '迎战', { id: event.eventId, value: 'defend', primary: true })}</div>${this.adButton('ad-bear-aid', '请邻巢援军', AdPlacement.BearAid, { id: event.eventId, primary: false })}` : '';
      const loot = e.threats.rewardFor(event.type, false).filter((r) => r.amount > 0).map((r) => `${num1(r.amount)} ${resName(r.res)}`).join('、');
      const goBtn = event.phase === 'active' && event.type !== 'bear'
        ? button('goto-threat', event.type === 'moth' ? '进蜂巢拍走它' : '去拍走它', { id: event.eventId, primary: true }) : '';
      const killed = (event.killed ?? 0) > 0 ? ` · 已咬死 ${event.killed} 只` : '';
      return panelCard(`<div class="card-head">${icon(threatIcon(event.type))}<div><h3>${h(def.name)} @ ${h(where)}</h3><p>${h(phase)} · 剩余 ${Math.max(0, Math.ceil(event.hp))}/${Math.ceil(event.maxHp)}${h(killed)}</p><small>${h(`击退奖励约 ${loot}，亲手击退再多 50%`)}</small></div></div>${goBtn}${bearActions}`, true);
    }).join('');
    const injured = e.w.injured(Role.Forager) + e.w.injured(Role.House);
    let threatSection = '<p class="muted">建成第一个功能建筑后，敌害会开始低频出现；新手阶段结束后会咬死蜜蜂，并且每个四季轮回都更强。</p>';
    if (e.run.threats.enabled) {
      const dv = e.threats.defenseView();
      const lost = e.run.stats.beesLost ?? 0;
      const lethalLine = dv.lethal
        ? `<p class="muted">亲手拍一下 = 一只守卫蜂的攻击：${num1(e.threats.swatDamage())} 伤害（升级守卫巢房的攻击效率、巡逻范围会一起变强）</p><p class="${dv.mitig > 0.6 ? 'warning' : 'muted'}">敌害强度 ×${num1(dv.power)}（每个四季轮回 +${Math.round(POWER_PER_CYCLE * 100)}%）· 守卫全力出动时伤亡降到 ${pct(dv.mitig)}${lost > 0 ? ` · 本蜂群累计牺牲 ${lost} 只` : ''}</p><p class="muted">新手结束后，敌害会咬死蜜蜂：胡蜂、蛛网咬采集蜂，蜡螟毁幼虫，熊先打守卫。守卫蜂越多、攻击效率越高，伤亡越少。</p>`
        : '<p class="muted">新手阶段敌害只会让蜜蜂受伤；新手结束后会开始咬死蜜蜂。</p>';
      const bearLine = e.threats.bearEligible()
        ? `<p class="muted">熊：建成采集蜂巢房后不定时出没（冬季将至和冬天都在冬眠）。赶走它有蜂王浆；赶不走 ${Math.round(BEAR_DESTROY_CHANCE * 100)}% 整个蜂巢被掀翻、其余时候上缴蜂蜜。</p>` : '';
      threatSection = `<h3 class="section-title">${icon('xf_status_danger')} 敌害</h3><p>${h(guardLine)}</p>${lethalLine}${bearLine}${threats.length > 1 ? `<p class="warning">同时存在 ${threats.length} 个敌害，守卫会分区，单个目标获得的攻击力下降。</p>` : ''}${injured > 0 ? `<p class="muted">${icon('xf_status_injured')} 受伤休养中的工蜂 ${injured} 只，会逐渐恢复。</p>` : ''}${(e.run.threats.streak ?? 0) > 0 ? `<p class="ok">连续击退 ${e.run.threats.streak} 次 · 再击退 ${5 - (e.run.threats.streak ?? 0) % 5} 次额外得 1 蜂王浆</p>` : ''}${threats.length === 0 ? `${artImage('state_no_threats', '没有威胁', 'empty-art')}<p class="ok">目前没有威胁</p>` : threatCards}<p class="muted">新手结束后每隔几分钟出现一只，夏季最多、冬季很少。点地图上的敌害可以亲手驱赶，奖励随蜂巢产量增长；有敌害自己溜走会中断连胜。离线期间不会生成新敌害、不会死蜂，也不会发生熊袭击。</p>`;
    }
    const starving = season.starving ? `<p class="warning">${icon('xf_status_stopped')} ${season.starveSeconds >= 150 ? '严重饥饿：蜂群正在缓慢减员' : (season.starveSeconds >= 60 ? '持续饥饿：产卵与孵化受限' : '部分蜜蜂因缺蜜暂停工作')}</p>` : '';
    const timed = e.events.effects();
    const timedHtml = timed.length === 0 ? '' : `<h3 class="section-title">${icon('xf_card_season')} 进行中的季节效果</h3>${timed.map((fx) => `<p class="${fx.mul >= 1 ? 'ok' : 'warning'}">${h(fx.label)}：${h(e.w.cfg.stats.find((st) => st.id === fx.stat)?.name ?? fx.stat)} ×${fx.mul} · 还剩 ${clock(fx.until - e.run.time)}</p>`).join('')}`;
    const raidState = e.run.threats.raid;
    const raidLine = e.run.season.cycleIndex < 1 && raidState === undefined ? '<p class="muted">蜂巢保卫战：度过第一个冬天后，每个秋天会有胡蜂窝来袭。</p>'
      : `<p class="muted">蜂巢保卫战：每个秋天一次${raidState !== undefined ? ` · 本轮${raidState.cycle === e.run.season.cycleIndex ? (raidState.phase === 'won' ? '已胜利' : raidState.phase === 'lost' ? '没守住' : raidState.phase === 'skipped' ? '错过了' : '进行中') : '还没开始'}` : ''} · 累计胜利 ${e.state.meta.raidWins ?? 0} 次</p>`;
    return this.panelFrame('四季与防御', 'xf_nav_ecology', `<div class="heading-line">${icon(seasonIcon(season.season))}<h3>${h(seasonLine)}</h3></div>${effects.map((line) => `<p>${h(line)}</p>`).join('')}${timedHtml}${raidLine}${starving}${supply}${collapsed}<hr>${threatSection}`);
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
        const max = e.prog.researchMax(def);
        const can = hasEvolution && level < max && e.w.econ.canAfford(cost);
        return panelCard(`<div class="card-head">${icon(researchIcon(def.id))}<div><h3>${h(def.name)}</h3><p>${h(def.desc)}</p><small>${level >= max ? `Lv${level}（满级${def.id !== 'r_offline' ? '，王国每 10 级上限 +1' : ''}）` : `Lv${level}/${max} · ${costStr(cost)}`}</small></div>${button('research', '研究', { id: def.id, primary: true, disabled: !can })}</div>`);
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
    return this.panelFrame('进化腔', 'xf_nav_evolution', `${tabs}<h3 class="section-title">可用传承点 ${inheritance.available} / 累计 ${inheritance.totalPoints}</h3><p class="ok">传承加成：每个累计传承点让全巢产量 +2%，当前 +${Math.round(legacyAura(inheritance.totalPoints) * 100)}%（不需要投入，自动生效）。</p><p class="muted">传承天赋永久作用于之后所有种区；每条路线投入足够点数后开放改变规则的关键能力。</p><div class="tab-row">${branchButtons}</div>${talents}<hr><h3 class="section-title">天赋预设</h3>${presets}${button('confirm-reset-talents', resetLabel, {})}`);
  }

  /** 新蜂后分化卡片：分蜂面板与蜂后面板共用 */
  private renderQueenRearCard(): string {
    const e = this.engine();
    const colony = e.run.colony;
    const sc = e.w.cfg.swarm;
    const chance = Math.round(e.colony.queenChance() * 100);
    const fails = colony.queenFails ?? 0;
    const can = e.colony.canRearQueen();
    const waiting = colony.youngQueens > 0 ? `<p class="ok">${icon('xf_status_complete')} 已有 ${colony.youngQueens} 只新蜂后在等待带队</p>` : '';
    const reason = !can.ok && colony.youngQueens < sc.queenMaxWaiting ? `<p class="muted">${h(can.message)}</p>` : '';
    return panelCard(`<div class="heading-line">${icon('xf_building_queen')}<h3>分化新蜂后</h3></div>${waiting}<p>选一只幼虫，喂 ${sc.queenJelly} 蜂王浆把它培育成新蜂后。这次成功率 <b>${chance}%</b>；每失败一次 +${Math.round(sc.queenFailStep * 100)}%，失败返还一半蜂王浆，幼虫仍留作普通幼虫。${fails > 0 ? `已连续失败 ${fails} 次。` : ''}</p><small class="muted">需要：1 只幼虫（现有 ${colony.larvae}）· ${sc.queenJelly} 蜂王浆（现有 ${Math.floor(e.w.econ.num(Res.Jelly))}）</small>${reason}<div class="choice-row">${colony.larvae <= 0 ? button('lay', '先孵化一枚新卵', { disabled: !e.colony.canLay().ok }) : ''}${button('rear-queen', '分化新蜂后', { primary: true, disabled: !can.ok })}</div>`);
  }

  private renderSwarmPanel(): string {
    const e = this.engine();
    const region = e.w.region();
    const preview = e.swarmPreview(this.swarmTarget);
    const local = e.localPreview();
    const regions = e.prog.zoneTargets();
    if (!regions.some((item) => item.id === this.swarmTarget)) this.swarmTarget = '';
    const here = e.prog.regionColonies();
    const conditions = preview.conditions.map((condition: SwarmCondition) => `<p class="condition ${condition.met ? 'met' : ''}">${condition.met ? '✓' : '○'} ${h(condition.label)}　${Math.floor(condition.current)} / ${condition.target}</p>`).join('');
    const sources = preview.sources.map((source) => `<p>${h(source.label)} <b>${source.points >= 0 ? '+' : ''}${source.points}</b></p>`).join('');
    const localSources = local.sources.filter((source) => source.points !== 0).map((source) => `<p>${h(source.label)} <b>${source.points >= 0 ? '+' : ''}${source.points}</b></p>`).join('');
    const regionCards = regions.map((item) => {
      const mastery = e.w.cfg.achievements.find((a) => a.id === `a_${item.id}`);
      const masteryDone = mastery !== undefined && e.state.meta.achievements.includes(mastery.id);
      const need = e.prog.zoneColoniesNeeded(item);
      const open = here >= need;
      const gate = `<small class="${open ? 'ok' : 'warning'}">${open ? '✓' : '🔒'} 开启条件：${h(region.name)}有 ${need} 个蜂群（现在 ${here} 个）</small>`;
      const rare = e.w.flower(item.rareFlower);
      return `<button type="button" class="region-card${this.swarmTarget === item.id ? ' selected' : ''}${open ? '' : ' locked'}" data-action="swarm-target" data-id="${h(item.id)}">${artImage(`region_${regionArt(item.id)}`, item.name)}<span><b>${h(item.name)}</b><em>难度 ${'★'.repeat(item.difficulty + 1)} · 新巢成本 ×${costMulFor(item.difficulty)} · 难度传承点 +${item.difficulty * 4}</em>${gate}<small>${h(item.desc)}</small><small>${h(item.rule)}</small><small>专属稀有花：${h(rare.name)}</small>${mastery !== undefined ? `<small>${masteryDone ? '✓ ' : ''}专属成就「${h(mastery.name)}」：${h(mastery.desc)}</small>` : ''}</span></button>`;
    }).join('');
    const illustration = e.state.meta.swarmCount > 0 && e.run.time < 300 ? 'illustration_split_arrive'
      : (preview.ready ? 'illustration_split_depart' : 'illustration_split_prepare');
    const fallWarning = e.run.hive.fallAt > 0
      ? `<p class="warning">${icon('xf_status_danger')} 蜂巢已达扩建上限，预计最迟 ${formatDuration(e.hive.fallRemaining())} 内掉落。分蜂（原地或远征都行）能给蜂巢减压、重新计算期限。</p>` : '';
    const points = e.state.meta.inheritance.totalPoints;
    const legacyNow = Math.round(legacyAura(points) * 100);
    const legacyNext = Math.round(legacyAura(points + preview.total) * 100);
    const queenCard = this.renderQueenRearCard();
    const localCard = panelCard(`<div class="heading-line">${icon('xf_nav_swarm')}<h3>原地分蜂 · ${h(region.name)}</h3></div><p>只需要一只新蜂后：她带走当前蜂巢一半的资源和人口，在附近建立新蜂群（明星蜂优先跟随）。新蜂巢落在同一张地图上、离这里不太近的地方，领地可以和这里重叠。它会继承这座蜂巢内两圈的巢房布局、一半的属性等级和繁育比例，之后托管运转。你继续经营当前蜂巢。</p><p class="${here >= 2 ? 'ok' : 'muted'}">${h(region.name)}现在有 ${here} 个蜂群${regions.length > 0 ? ` · 远征最容易的种区需要 ${Math.min(...regions.map((item) => e.prog.zoneColoniesNeeded(item)))} 个` : ''}</p>${local.total > 0 ? `<h3 class="section-title">原地分蜂可得传承点 ${local.total}</h3>${localSources}` : '<p class="muted">原地分蜂只结算生态目标、累计产量和剩余资源的传承点；这个蜂群目前没有可领取的。</p>'}${button('confirm-local-swarm', local.ready ? '原地分蜂' : '需要一只新蜂后', { primary: true, disabled: !local.ready })}`);
    return this.panelFrame('分蜂迁徙', 'xf_nav_split', `${artImage(illustration, '分蜂迁徙', 'wide-art')}${fallWarning}<p class="ok">传承加成：现在全巢产量 +${legacyNow}%，远征分蜂后 +${legacyNext}%（每个累计传承点 +2%，永久有效）。</p><p class="muted">本巢成本倍率 ×${e.hive.constructionCostMul()}：新巢成本只看种区难度，不再逐代翻倍。</p>${queenCard}${localCard}<hr><h3 class="section-title">远征新种区（种区分蜂）</h3><p class="muted">种区像副本：出发地的蜂群数量够了才能开启（最少 2 个，难度越高越多），还要达成蜂群发展条件。</p>${conditions}<hr><h3 class="section-title">预计获得传承点 ${preview.total}</h3>${sources}<hr><div class="two-column"><div><h3>新巢重建</h3><ul class="reset-list">${preview.resets.map((item) => `<li>${h(item)}</li>`).join('')}</ul></div><div><h3>共同保留</h3><ul class="keep-list">${preview.keeps.map((item) => `<li>${h(item)}</li>`).join('')}</ul></div></div><hr><h3 class="section-title">选择新种区</h3>${regionCards}${button('confirm-swarm', this.swarmTarget.length === 0 ? '先选择一个种区' : '远征分蜂', { primary: true, disabled: !preview.ready || this.swarmTarget.length === 0 })}`);
  }

  private renderColoniesPanel(): string {
    const e = this.engine();
    const choices = this.session.colonyChoices();
    const region = e.run.regionId;
    const runOf = (id: string) => (id === e.state.activeColonyId ? e.run : e.state.colonies.find((c) => c.id === id)?.run);
    const card = (choice: (typeof choices)[number]): string => {
      const run = runOf(choice.id);
      const sameMap = run !== undefined && run.regionId === region && run.realm !== undefined;
      const kind = run?.realm === undefined ? '' : (run.realm.daughter ? '分巢' : '原始蜂巢');
      const status = choice.active ? '正在亲手经营' : (sameMap ? '在同一张王国地图上托管，实时运转' : '离开期间按离线收益继续经营');
      const look = sameMap && !choice.active ? button('look-hive', '在地图上看', { id: choice.id }) : '';
      return panelCard(`<div class="card-head">${icon(run?.realm?.daughter === true ? 'xf_nav_swarm' : 'xf_nav_hive')}<div><h3>${h(choice.name)}${choice.active ? '（当前）' : ''}</h3><p>${h(choice.region)}${kind.length > 0 ? ` · ${kind}` : ''} · 成年蜂 ${choice.bees} · 蜂蜜 ${h(choice.honey)}</p><small>${h(status)}</small></div><div class="button-pair">${look}${button('rename-colony', '改名', { id: choice.id })}${choice.active ? '' : button('switch-colony', '切换', { id: choice.id, primary: true })}</div></div>`);
    };
    const here = choices.filter((c) => runOf(c.id)?.regionId === region);
    const away = choices.filter((c) => runOf(c.id)?.regionId !== region);
    return this.panelFrame('我的王国', 'xf_nav_swarm', `<p class="muted">同一种区的蜂巢都在同一张地图上：每个蜂巢只采自己领地里的花，领地重叠处的花田两边平分。不在经营的蜂巢会托管运转（自动繁育、建造和升级）。点地图上的其它蜂巢也能切换过去。</p><h3 class="section-title">${h(e.w.region().name)} · ${here.length} 座蜂巢</h3>${here.map(card).join('')}${away.length > 0 ? `<h3 class="section-title">其它种区</h3>${away.map(card).join('')}` : ''}`);
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

  /** 王国等级：经验条、下一级奖励、经验从哪里来 */
  private renderKingdomCard(): string {
    const e = this.engine();
    if (!e.state.meta.tutorialDone) return '';
    const k = e.kingdom.state();
    const need = e.kingdom.need(k.level);
    const ratio = Math.min(1, k.xp / Math.max(1, need));
    const next = e.kingdom.rewardFor(k.level + 1);
    const eggs = k.starEggs > 0 ? `<p class="ok">还有 ${k.starEggs} 颗明星蜂卵：下次孵化必出明星蜂</p>` : '';
    return panelCard(`<div class="heading-line">${icon('xf_building_queen')}<h3>王国 Lv${k.level}</h3></div><span class="daily-bar"><i style="width:${Math.round(ratio * 100)}%"></i></span><small>${Math.floor(k.xp)} / ${need} 经验 · 下一级奖励：${h(e.kingdom.rewardText(next))}</small>${eggs}<small class="muted">孵化、升级、击退敌害、发现花田、过冬、完成目标等都会积累经验 · 每 10 级研究上限 +1</small>`);
  }

  /** 种区篇章：当前目标 + 进度，完成的折叠显示 */
  private renderChapterCard(): string {
    const e = this.engine();
    if (!e.state.meta.tutorialDone) return '';
    const v = e.kingdom.chapter();
    const cur = v.current;
    const curHtml = cur === null ? '<p class="ok">本种区篇章全部完成！可以分蜂去下一个种区了。</p>'
      : `<div class="daily-task"><span><b>${v.index + 1}. ${h(cur.name)}</b><span class="daily-bar"><i style="width:${Math.round(Math.min(1, v.progress / Math.max(1, cur.target)) * 100)}%"></i></span><small>${h(cur.desc)} · ${num1(v.progress)} / ${num1(cur.target)} · 奖励 ${h(cur.reward.map((r) => `${r.amount} ${resName(r.res)}`).join('、'))}</small></span></div>`;
    const done = v.done.map((d) => `<span class="chapter-done">${icon('xf_status_complete')}${h(d.name)}</span>`).join('');
    const next = v.upcoming.slice(0, 2).map((d) => `<small class="muted">接下来：${h(d.name)} · ${h(d.desc)}</small>`).join('');
    return panelCard(`<div class="heading-line">${icon('xf_nav_split')}<h3>种区篇章 · ${h(v.region)}「${h(v.title)}」 ${v.index}/${v.total}</h3></div>${curHtml}${next}${done.length > 0 ? `<div class="chapter-row">${done}</div>` : ''}`);
  }

  /** 每日签到 + 3 个每日目标 + 全勤奖励 */
  private renderDailyCard(): string {
    const e = this.engine();
    const daily = e.daily;
    const d = daily.state;
    const next = daily.nextStreak();
    const days = Array.from({ length: 7 }, (_v, i) => {
      const day = i + 1;
      const reward = daily.signReward(day);
      const done = daily.canSign() ? day < next : day <= d.streak;
      const today = daily.canSign() && day === next;
      return `<span class="sign-day${done ? ' done' : ''}${today ? ' today' : ''}">${icon(resIcon(reward.res))}<b>${reward.res === Res.Jelly ? `×${reward.amount}` : num1(reward.amount)}</b><small>第${day}天</small></span>`;
    }).join('');
    const sign = daily.canSign()
      ? button('daily-sign', `签到领取第 ${next} 天奖励`, { primary: true })
      : `<p class="muted">今天已签到 · 连续 ${d.streak} 天，明天再来</p>`;
    const tasks = d.tasks.map((task, index) => {
      const done = task.progress >= task.target;
      const ratio = Math.min(1, task.progress / Math.max(1, task.target));
      return `<div class="daily-task${task.claimed ? ' claimed' : ''}"><span><b>${h(daily.taskText(task))}</b><span class="daily-bar"><i style="width:${Math.round(ratio * 100)}%"></i></span><small>${num1(Math.floor(task.progress))} / ${num1(task.target)} · 奖励 ${num1(task.reward)} 蜂蜜</small></span>${task.claimed ? `<em>已领取</em>` : button('daily-claim', '领取', { id: String(index), primary: done, disabled: !done })}</div>`;
    }).join('');
    const allClaimed = d.tasks.length > 0 && d.tasks.every((task) => task.claimed);
    const bonus = d.bonusClaimed ? '<p class="ok">今日目标全部完成，明天见！</p>'
      : `<div class="compact-row">${icon('xf_res_jelly')}<span><b>全部完成再得 ${DAILY_BONUS_JELLY} 蜂王浆</b><small>领取完上面 3 个目标后可以领取</small></span>${button('daily-bonus', '领取', { primary: allClaimed, disabled: !allClaimed })}</div>`;
    return panelCard(`<div class="heading-line">${icon('xf_card_updated')}<h3>每日签到</h3></div><div class="sign-row">${days}</div>${sign}<hr><h3 class="section-title">${icon('xf_nav_tasks')} 今日目标</h3>${tasks}${bonus}`);
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
    return this.panelFrame('任务', 'xf_nav_tasks', `${this.renderKingdomCard()}${this.renderChapterCard()}${this.renderDailyCard()}<h3 class="section-title">现在可以做的</h3>${hintCards}${colonyTaskHtml}<hr><h3 class="section-title">目标</h3>${tasks}${topics}`);
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
      a_winters_5: 'badge_winter', a_regions_3: 'badge_regions', a_codex_flowers: 'badge_flowers',
      a_meadow: 'badge_flowers', a_alpine: 'badge_winter', a_rainy: 'badge_flowers', a_drought: 'badge_winter',
      a_rooftop: 'badge_bee_city', a_all_regions: 'badge_regions', a_raid: 'badge_bear', a_kingdom_10: 'badge_bee_city'
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
    const tabs = [['eco', '生态观察'], ['bees', '明星蜂'], ['flowers', '花种'], ['threats', '敌害'], ['ach', '成就'], ['stats', '统计'], ['msg', '消息']]
      .map(([id, label]) => button('codex-tab', label, { id, primary: this.codexTab === id })).join('');
    let body = '';
    if (this.codexTab === 'eco') {
      const known = (unlock: string): boolean => unlock === 'codex_3' ? e.state.meta.codexFlowers.length >= 3 : e.w.taskDone(unlock);
      const count = ECO_NOTES.filter((note) => known(note.unlockTask)).length;
      body = `<p class="muted">跟随游玩解锁 · ${count} / ${ECO_NOTES.length}</p>${ECO_NOTES.map((note) => {
        const open = known(note.unlockTask);
        return panelCard(`<div class="card-head ${open ? '' : 'locked'}">${icon(open ? this.ecoIcon(note.id) : 'xf_flower_unknown')}<div><h3>${h(open ? note.title : '继续经营，解锁观察')}</h3>${open ? `<p>${h(note.fact)}</p><small class="link-color">${h(note.gameLink)}</small>` : '<p class="muted">完成新的蜂群行动后，这条生态关系会在这里出现。</p>'}</div></div>`);
      }).join('')}<p class="fine-print">知识内容为科普摘要；游戏数值为玩法抽象，不用于真实养蜂决策。</p>`;
    } else if (this.codexTab === 'bees') {
      const codex = e.state.meta.starCodex ?? [];
      const owned = e.roster.stars();
      const cards = STAR_TRAITS.map((t) => {
        const known = codex.includes(t.id);
        const mine = owned.filter((b) => b.t === t.id);
        const best = mine.slice().sort((x, y) => (y.lv ?? 1) - (x.lv ?? 1))[0];
        return `<div class="codex-row ${known ? '' : 'locked'}">${known ? beePortrait(t.role, t.id, t.name) : icon('xf_flower_unknown')}<span><b>${h(known ? `${t.name} · ${e.w.roleDef(t.role).name}` : '？？？')}</b><small>${h(known ? `全巢${t.desc} +${e.roster.bonusText(t, 1)}起，每级再加${t.op === 'pct' ? `${Math.round(t.per * 100)}%` : `${t.per * 100}%`}${mine.length > 0 ? ` · 拥有 ${mine.length} 只，最高 Lv${best?.lv ?? 1}（${best?.n ?? ''}）` : ' · 当前蜂群里没有'}` : `${e.w.roleDef(t.role).name}的明星特性，尚未遇到`)}</small></span>${best !== undefined ? button('bee-open', '看看', { id: String(best.id) }) : ''}</div>`;
      }).join('');
      const fame = [Role.Forager, Role.Scout, Role.House, Role.Guard].map((role) => {
        const top = e.roster.topBy(role, 1)[0];
        if (top === undefined) return '';
        const line = e.roster.statLines(top)[1];
        return `<div class="codex-row">${icon(roleIcon(role))}<span><b>${h(e.w.roleDef(role).name)}之星：${h(top.n)}</b><small>${h(line === undefined ? '' : `${line.label} ${line.value}`)} · 效率 ${top.e}%</small></span>${button('bee-open', '看看', { id: String(top.id) })}</div>`;
      }).join('');
      body = `<p class="muted">已收集 ${codex.length} / ${STAR_TRAITS.length} 种明星特性。孵化时有 ${pct(e.roster.starChance())} 的概率诞生明星蜂，同一种特性的第二只起只按 25% 生效。</p>${cards}${fame.length > 0 ? `<hr><h3 class="section-title">本蜂群劳动之星</h3>${fame}` : ''}`;
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
        `王国 Lv${e.kingdom.state().level} · 保卫战胜利 ${meta.raidWins ?? 0} 次 · 起过名字的蜜蜂 ${meta.nameSeq ?? 0} 只`,
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
    const orientation = `<div class="setting-row">${icon('xf_action_refresh')}<span><b>屏幕方向</b><small>自动跟随手机姿态：横握显示横屏，竖握显示竖屏</small></span><b class="ok">自动</b></div>`;
    return this.panelFrame('设置', 'xf_nav_settings', `<h3 class="section-title">音画</h3>${orientation}${toggleRow('music', '背景音乐', '', settings.music, 'xf_action_music')}${toggleRow('sfx', '音效', '', settings.sfx, 'xf_action_sound')}${this.range('volume', 'musicVolume', settings.musicVolume, 0, 100, 5, `音乐音量 ${settings.musicVolume}%`)}${this.range('volume', 'effectsVolume', settings.effectsVolume, 0, 100, 5, `音效音量 ${settings.effectsVolume}%`)}${toggleRow('vibration', '振动', '浏览器和设备支持时使用', settings.vibration, 'xf_action_vibration')}${toggleRow('particles', '粒子特效', '关闭可降低功耗', settings.particles, 'xf_status_rare')}${toggleRow('reduceMotion', '减少动态效果', '降低动画速度与天气粒子', settings.reduceMotion, 'xf_action_pause')}${toggleRow('eventAnimations', '事件动画', '敌害与季节更替的非阻塞通告', settings.eventAnimations, 'xf_card_alarm')}${toggleRow('lowPower', '省电模式', '画面降为 30 帧、使用半尺寸美术', this.session.lowPower, 'xf_action_low_power')}<hr><h3 class="section-title">玩法</h3><div class="setting-row"><span><b>花潮加速</b><small>${this.session.ads.boostSpeed() > 1 ? `${this.session.ads.boostSpeed()}× 进行中，剩余 ${clock(this.session.ads.boostRemainingSec())}` : `看 1 个广告 2×，看 2 个广告 4×，持续 ${AD_REWARDS.boostMinutes} 分钟`}</small></span>${button('open-boost', '⚡ 加速')}</div>${toggleRow('ecoMode', '生态模式（工蜂寿命）', '开启后工蜂会自然老化，需要手动孵化并分化补员', settings.ecoMode, 'xf_nav_ecology')}<h3 class="section-title">蜂巢外观</h3><div class="skin-grid">${skins}</div><hr><h3 class="section-title">${icon('xf_action_help')} 帮助与说明</h3><div class="choice-row">${button('open-legal', '玩法帮助', { id: 'help' })}${button('open-legal', '隐私政策', { id: 'privacy' })}${button('open-legal', '用户协议', { id: 'agreement' })}</div><hr>${this.renderSaveBackup()}<h3 class="section-title">数据与隐私</h3><p class="muted">进度保存在本设备。清除进度会重新开始；删除全部数据会同时清除设置与隐私同意记录。</p><div class="choice-row">${button('confirm-reset-progress', '清除游戏进度', { danger: true })}${button('confirm-delete-all', `${icon('xf_action_delete')} 删除全部数据`, { danger: true })}</div><div class="about-row">${artImage('logo_mark', '小峰大业')}${artImage('app_icon', '应用图标')}<span><b>小峰大业</b><small>版本 0.5.1</small></span>${button('save-now', `${icon('xf_status_save')} 立即保存`)}</div><div class="choice-row home-row">${button('exit-home', `${icon('xf_action_back')} 保存并返回首页`)}</div>`);
  }

  /** 设置页“存档备份”：存档码导出导入、云存档、撤销导入 */
  private renderSaveBackup(): string {
    const cloud = platform().cloud;
    const cloudRow = cloud === undefined ? '' : `<div class="setting-row">${icon('xf_status_save')}<span><b>${h(cloud.label)}</b><small>把进度存到云端，换设备后下载恢复</small></span><div class="button-pair">${button('cloud-upload', '上传', { disabled: this.cloudBusy })}${button('cloud-download', '下载', { disabled: this.cloudBusy })}</div></div>`;
    const undo = this.session.hasBeforeImport() ? `<div class="setting-row">${icon('xf_action_refresh')}<span><b>撤销上次导入</b><small>回到导入存档码之前的进度</small></span>${button('save-undo-import', '恢复')}</div>` : '';
    return `<h3 class="section-title">${icon('xf_status_save')} 存档备份</h3><p class="muted">进度保存在本机。换手机、清除缓存或卸载前，先导出存档码保存好（发给自己或存进备忘录），在新设备上导入就能接着玩。</p><div class="choice-row">${button('save-export', '导出存档码', { primary: true })}${button('save-import', '导入存档码')}</div>${cloudRow}${undo}<hr>`;
  }

  private renderSaveCodeOverlay(): string {
    const modal = this.saveCodeModal!;
    const canType = !this.environment.manualScene;
    if (modal.mode === 'show') {
      const box = canType ? `<textarea class="save-code" readonly>${h(modal.code)}</textarea>` : `<p class="save-code-preview">${h(modal.code.slice(0, 48))}…（共 ${modal.code.length} 个字符）</p>`;
      return `<div class="modal-layer"><section class="modal-card save-code-card"><h2>${icon('xf_status_save')} 存档码</h2><p>${h(modal.note)}</p>${box}<div class="choice-row">${button('save-code-copy', '再复制一次')}${button('save-code-close', '完成', { primary: true })}</div></section></div>`;
    }
    const input = canType ? `<textarea id="save-code-input" class="save-code" placeholder="把以 XFDY1- 开头的存档码粘贴到这里"></textarea>` : '';
    return `<div class="modal-layer"><section class="modal-card save-code-card"><h2>${icon('xf_status_save')} 导入存档码</h2><p>${h(modal.note)}</p>${input}<div class="choice-row">${button('save-code-close', '取消')}${canType ? button('save-code-submit', '导入', { primary: true }) : button('save-import', '从剪贴板导入', { primary: true })}</div></section></div>`;
  }

  private async exportSaveCode(): Promise<void> {
    const code = this.session.exportSaveCode();
    if (code.length === 0) return;
    const copied = (await platform().clipboard?.write(code)) ?? false;
    this.saveCodeModal = { mode: 'show', code, note: copied ? '已经复制到剪贴板。请粘贴到备忘录或发给自己保存好，换设备时在“导入存档码”里粘贴。' : '没能自动复制，请长按下面的文字全选复制后保存好。' };
    this.session.audio.play(copied ? 'ui_confirm' : 'ui_error');
    this.refreshGame(true);
  }

  private async importSaveCode(): Promise<void> {
    const text = (await platform().clipboard?.read()) ?? null;
    if (text !== null && text.includes('XFDY1-')) { this.confirmImport(text); return; }
    this.saveCodeModal = { mode: 'paste', code: '', note: this.environment.manualScene
      ? '剪贴板里没有找到存档码。请先完整复制以 XFDY1- 开头的存档码，再点“从剪贴板导入”。'
      : '把之前导出的存档码粘贴到下面，然后点“导入”。' };
    this.refreshGame(true);
  }

  private confirmImport(code: string): void {
    const checked = this.session.checkSaveCode(code);
    if (!checked.ok || checked.state === null) { this.showToast(checked.message, true); return; }
    const state = checked.state;
    const where = `${state.run.regionId === this.engine().run.regionId ? '' : '其他种区 · '}蜂群 ${Object.values(state.run.colony.roles).reduce((a, b) => a + b, 0)} 只 · 已分蜂 ${state.meta.swarmCount} 次`;
    this.saveCodeModal = null;
    this.requestConfirm('导入存档', `存档码里的进度：${where}。导入后会替换当前进度（当前进度会自动留一份，可以在设置里撤销）。`, '导入', () => {
      const ok = this.session.importSaveState(state);
      this.showToast(ok ? '存档已导入' : '导入失败，请重试', !ok);
      this.panel = ''; this.drawerOpen = false; this.view = 'field';
      this.render();
    }, false);
  }

  private async cloudAction(upload: boolean): Promise<void> {
    if (this.cloudBusy) return;
    this.cloudBusy = true; this.refreshGame(true);
    try {
      if (upload) {
        const r = await this.session.cloudUpload();
        this.showToast(r.message || (r.ok ? '已上传到云存档' : '上传失败'), !r.ok);
      } else {
        const r = await this.session.cloudDownload();
        if (!r.ok || r.state === null) this.showToast(r.message || '云端没有可用的存档', true);
        else {
          const state = r.state;
          this.requestConfirm('使用云存档', `云端存档保存于 ${new Date(r.savedAt).toLocaleString()}。使用后会替换当前进度（当前进度会自动留一份，可以撤销）。`, '使用云存档', () => {
            const ok = this.session.importSaveState(state);
            this.showToast(ok ? '已恢复云存档' : '恢复失败，请重试', !ok);
            this.render();
          }, false);
        }
      }
    } finally {
      this.cloudBusy = false; this.refreshGame(true);
    }
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
    const e = this.engine();
    const tribute = Math.round(e.threats.bearTribute());
    const seconds = Math.max(0, Math.ceil(event.endsAt - e.run.time));
    const guards = e.w.active(Role.Guard);
    const stakes = e.state.meta.tutorialDone
      ? `<p class="warning">赶不走它的话：${Math.round(BEAR_DESTROY_CHANCE * 100)}% 会把整个蜂巢掀翻（这个蜂群从零开始），${100 - Math.round(BEAR_DESTROY_CHANCE * 100)}% 蜜蜂上缴约 ${num1(tribute)} 蜂蜜。</p>`
      : '<p class="muted">新手阶段熊只会抢走一点蜂蜜。</p>';
    const swat = num1(e.threats.swatDamage());
    const tip = guards > 0 ? `守卫蜂 ${guards} 只会集结到巢门，你也可以直接点熊拍打（按住连拍，每下 ${swat} 伤害，和一只守卫蜂一样）。熊有 ${Math.ceil(event.maxHp)} 体力。` : `还没有守卫蜂：只能靠你点熊拍打（按住连拍，每下 ${swat} 伤害）。熊有 ${Math.ceil(event.maxHp)} 体力，快去培养守卫蜂吧。`;
    return `<div class="modal-layer threat-layer"><section class="modal-card bear-card">${artImage('badge_bear', '熊来袭', 'bear-badge')}<h2>${icon('xf_enemy_bear')} 熊来袭</h2><p>熊循着蜜香靠近蜂巢，约 ${seconds} 秒后开始抢蜜。${h(tip)}</p>${stakes}<div class="choice-stack">${button('bear-choice', '迎战！去拍走它', { id: event.eventId, value: 'defend', primary: true })}${this.adButton('ad-bear-aid', '请邻巢援军赶走熊（不损失蜂蜜）', AdPlacement.BearAid, { id: event.eventId, primary: false })}${button('bear-close', '先准备一下')}</div></section></div>`;
  }

  private confirmSwitchHive(id: string): void {
    const choice = this.session.colonyChoices().find((c) => c.id === id);
    if (choice === undefined) return;
    this.requestConfirm(`去「${choice.name}」`, `${choice.region} · 成年蜂 ${choice.bees} · 蜂蜜 ${choice.honey}。切换后由你亲手经营它，当前蜂巢改为托管，继续在地图上自动运转。`, '切换过去', () => {
      if (!this.session.switchColony(id)) { this.showToast('蜂群切换失败', true); return; }
      this.selectedCell = ''; this.selectedField = ''; this.placing = ''; this.movingCell = '';
      this.view = 'field'; this.canvasFitted = false; this.closePanel(false);
      this.showToast(`现在经营「${choice.name}」`);
    }, false);
  }

  private openNaming(id: string): void {
    const e = this.engine();
    this.nameTarget = id;
    this.nameSeed = Math.floor(Math.random() * 360);
    const current = e.state.meta.colonyNames?.[id];
    this.nameDraft = current !== undefined && current.length > 0 && !/蜂群$/.test(current) ? current : e.suggestName(this.nameSeed);
    this.nameError = '';
    this.session.audio.play('ui_open_panel');
  }

  /** 取名弹窗：预设名可以“换一个”，也可以自己输入（抖音弹系统键盘） */
  private renderNameOverlay(): string {
    const e = this.engine();
    const id = this.nameTarget;
    const run = id === e.state.activeColonyId ? e.run : e.state.colonies.find((c) => c.id === id)?.run;
    const region = e.w.cfg.regions.find((r) => r.id === run?.regionId)?.name ?? '';
    const lead = id === 'colony-0' ? `这是你在${region}的第一座蜂巢，也是王国的起点。` : `新蜂后在${region}建立了一座新蜂巢。`;
    const keyboard = platform().textInput !== undefined;
    const field = keyboard
      ? `<button type="button" class="name-display" data-action="name-edit">${h(this.nameDraft)}<small>点这里输入</small></button>`
      : `<input class="name-input" type="text" maxlength="${HIVE_NAME_MAX}" value="${h(this.nameDraft)}" aria-label="蜂巢名字">`;
    return `<div class="modal-layer"><section class="modal-card name-card">${icon('xf_nav_hive')}<h2>给蜂巢起个名字</h2><p>${h(lead)}它会在地图上标出名字，之后也可以在侧边栏「王国」里改名。</p><div class="name-field">${field}${button('name-reroll', '换一个')}</div>${this.nameError.length > 0 ? `<p class="warning">${h(this.nameError)}</p>` : `<p class="muted">最多 ${HIVE_NAME_MAX} 个字</p>`}<div class="choice-row">${button('name-later', '以后再说')}${button('name-confirm', '就叫这个', { primary: true })}</div></section></div>`;
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
    this.syncPresentation();
    if (this.legal.length > 0) return this.renderLegalOverlay();
    if (this.saveCodeModal !== null && this.confirmState === null) return this.renderSaveCodeOverlay();
    if (this.confirmState !== null) {
      const state = this.confirmState;
      return `<div class="modal-layer"><section class="modal-card confirm-card">${icon(state.dangerous ? 'xf_status_danger' : 'xf_action_help')}<h2>${h(state.title)}</h2><p>${h(state.message)}</p><div class="choice-row">${button('confirm-cancel', '取消')}${button('confirm-accept', h(state.confirmLabel), { primary: !state.dangerous, danger: state.dangerous })}</div></section></div>`;
    }
    if (this.offlineReport !== null) return this.renderOfflineOverlay(this.offlineReport);
    if (this.swarmBonus > 0) return this.renderSwarmBonusOverlay();
    if (this.boostModal) return this.renderBoostOverlay();
    const bear = this.engine().threats.pendingBear();
    if (this.bearModal && bear !== null && bear.phase === 'warning') return this.renderBearOverlay(bear);
    if (this.nameTarget.length > 0) return this.renderNameOverlay();
    if (this.eventModal) {
      const html = this.renderEventOverlay();
      if (html.length > 0) return html;
    }
    if (this.introId.length > 0) {
      const topic = this.session.guide().topic(this.introId);
      if (topic !== null) return this.renderIntroOverlay(topic);
    }
    if (this.toastText.length > 0) return `<button class="toast" data-action="dismiss-toast">${h(this.toastText)}</button>`;
    if (this.banner.length > 0) return `<button class="event-banner ${h(this.bannerKind)}" data-action="banner-click">${icon(this.bannerIcon())}<span>${h(this.banner)}</span></button>`;
    if (this.eventTitle.length > 0) return `<button class="season-event" data-action="close-event">${icon(this.eventIcon)}<span><b>${h(this.eventTitle)}</b><small>${h(this.eventText)}</small></span></button>`;
    return '';
  }

  private onClick(event: Event): void {
    if (!(isUiElement(event.target))) return;
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
      case 'reload': this.environment.location.reload(); return;
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
      case 'save-export': void this.exportSaveCode(); return;
      case 'save-import': void this.importSaveCode(); return;
      case 'save-code-copy': {
        const code = this.saveCodeModal?.code ?? '';
        void platform().clipboard?.write(code).then((ok) => this.showToast(ok ? '已复制' : '复制失败，请手动全选复制', !ok));
        return;
      }
      case 'save-code-close': this.saveCodeModal = null; break;
      case 'save-code-submit': {
        const input = this.root.querySelector<HTMLTextAreaElement>('#save-code-input');
        const code = input?.value ?? '';
        if (code.trim().length === 0) { this.showToast('请先粘贴存档码', true); return; }
        this.confirmImport(code);
        break;
      }
      case 'save-undo-import': this.requestConfirm('撤销导入', '回到导入存档码之前的进度。', '恢复', () => {
        const ok = this.session.undoImport();
        this.showToast(ok ? '已恢复导入前的进度' : '没有可恢复的进度', !ok);
        this.render();
      }, false); return;
      case 'cloud-upload': void this.cloudAction(true); return;
      case 'cloud-download': void this.cloudAction(false); return;
      case 'daily-sign': this.feedback(e.dailySign()); if (e.state.meta.daily.signedDay === e.state.meta.daily.day) this.session.audio.play('ui_claim_reward'); this.session.saveNow(); break;
      case 'daily-claim': this.feedback(e.dailyClaim(Number(id))); this.session.saveNow(); break;
      case 'daily-bonus': this.feedback(e.dailyBonus()); this.session.saveNow(); break;
      case 'goto-bloom': this.goTo(`fieldId:${id}`, 'field'); return;
      case 'close-tip': this.sceneTip = null; break;
      case 'drawer-toggle': if (this.drawerOpen) this.closePanel(); else this.openPanel(this.panel || this.defaultPanel()); return;
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
      case 'start-move-cell': {
        const cell = e.hive.cell(id);
        if (cell === null || !cell.unlocked) return;
        this.movingCell = id; this.placing = ''; this.view = 'hive'; this.selectedCell = id;
        this.closePanel(false); this.refreshGame(true); return;
      }
      case 'cancel-move-cell': this.movingCell = ''; this.refreshGame(true); return;
      case 'focus-expand': this.focusTarget = 'expand'; this.focusUntil = Date.now() + 6000; this.view = 'hive'; this.closePanel(false); this.refreshGame(true); this.writeHistory(false); return;
      case 'enter-hive': this.view = 'hive'; this.placing = ''; this.closePanel(false); this.refreshGame(true); this.writeHistory(false); return;
      case 'lay': this.feedback(e.lay()); break;
      case 'hatch': this.feedback(e.differentiate(id, Number(value) || 1)); break;
      case 'rear-queen': {
        const chance = Math.round(e.colony.queenChance() * 100);
        this.requestConfirm('分化新蜂后', `将消耗 1 只幼虫和 ${costStr(e.colony.queenCost())}，这次成功率 ${chance}%。失败返还一半蜂王浆，幼虫仍留作普通幼虫，下次成功率 +${Math.round(e.w.cfg.swarm.queenFailStep * 100)}%。`, '确认分化', () => {
          this.feedback(e.differentiateQueen());
        }, false);
        return;
      }
      case 'open-field': {
        this.selectedField = id;
        this.openPanel('field', true, !inPanel);
        return;
      }
      case 'name-reroll': {
        this.nameSeed += 1;
        this.nameDraft = e.suggestName(this.nameSeed);
        this.nameError = '';
        const input = this.root.querySelector<HTMLInputElement>('.name-input');
        if (input !== null) input.value = this.nameDraft;
        break;
      }
      case 'name-edit': {
        const backend = platform().textInput;
        if (backend !== undefined) {
          void backend.prompt(this.nameDraft, HIVE_NAME_MAX).then((value) => {
            if (value !== null) { this.nameDraft = value; this.nameError = ''; }
            this.refreshGame(true);
          });
        }
        return;
      }
      case 'name-confirm': {
        const input = this.root.querySelector<HTMLInputElement>('.name-input');
        const raw = input !== null ? input.value : this.nameDraft;
        const result = e.renameColony(this.nameTarget, raw);
        if (result.ok) { this.nameTarget = ''; this.showToast(result.message); this.session.saveNow(); }
        else { this.nameError = result.message; this.session.audio.play('ui_error'); }
        break;
      }
      case 'name-later': e.skipName(this.nameTarget); this.nameTarget = ''; break;
      case 'rename-colony': this.openNaming(id); break;
      case 'look-hive': this.closePanel(false); this.goTo('field', 'field'); this.session.renderer?.lookAtHive(id); return;
      case 'poll-step': this.feedback(e.setPollinators(id, Number(value))); break;
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
        if (result.ok) {
          this.bearModal = false;
          this.closePanel(false);
          this.goTo('field', 'field');
          this.session.renderer?.lookAtThreat(id);
        }
        break;
      }
      case 'bear-close': this.bearModal = false; break;
      case 'open-bear': this.bearModal = true; this.closePanel(false); this.refreshGame(true); return;
      case 'goto-bear': {
        const bear = e.threats.pendingBear();
        this.closePanel(false);
        this.goTo('field', 'field');
        if (bear !== null) this.session.renderer?.lookAtThreat(bear.eventId);
        return;
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
      case 'confirm-local-swarm': this.confirmLocalSwarm(); return;
      case 'switch-colony': {
        if (!this.session.switchColony(id)) { this.showToast('蜂群切换失败', true); return; }
        this.selectedCell = ''; this.selectedField = ''; this.placing = ''; this.movingCell = '';
        this.view = 'field'; this.canvasFitted = false; this.closePanel(false);
        this.showToast('已切换蜂群，并结算离开期间的经营收益');
        return;
      }
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
      case 'ad-topup': {
        const amount = Number(value) || 0;
        this.runAd(AdPlacement.HoneyTopUp, 1, () => {
          grantHoneyTopUp(e, amount);
          this.feedback(e.upgrade(id));
        });
        return;
      }
      case 'ad-topup-build': {
        const amount = Number(value) || 0;
        this.runAd(AdPlacement.HoneyTopUp, 1, () => {
          grantHoneyTopUp(e, amount);
          this.showToast('蜂蜜已补齐，选一个空格放下吧');
          this.startPlacing(id);
        });
        return;
      }
      case 'ad-spring':
        this.runAd(AdPlacement.SpringSupply, 1, () => {
          const got = grantSpringSupply(e);
          this.showToast(got > 0 ? `春季补给：获得 ${Math.round(got)} 蜂蜜` : '这个春天已经领过补给了');
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
      case 'close-event': this.presentations.dismiss(); this.eventTitle = ''; break;
      case 'open-event': this.eventModal = true; this.closePanel(false); this.refreshGame(true); return;
      case 'event-later': this.eventModal = false; break;
      case 'event-choose': {
        const result = e.events.choose(id);
        this.feedback(result);
        if (result.ok) { this.eventModal = false; this.session.saveNow(); }
        break;
      }
      case 'ad-event':
        this.runAd(AdPlacement.SeasonEvent, 1, () => {
          const result = e.events.choose(id, true);
          this.showToast(result.message, !result.ok);
          this.eventModal = false;
        });
        return;
      case 'ad-lucky':
        this.runAd(AdPlacement.LuckyHatch, 1, () => {
          e.run.colony.luckyHatch = (e.run.colony.luckyHatch ?? 0) + LUCKY_HATCHES;
          this.showToast(`幸运孵化：接下来 ${LUCKY_HATCHES} 只幼虫更容易成为明星蜂`);
        });
        return;
      case 'goto-raid': {
        const live = e.threats.activeList().filter((t) => t.raid === true && t.phase === 'active');
        const target = live.find((t) => t.boss === true) ?? live[0];
        if (target !== undefined) { this.goTo(`fieldId:${target.targetId}`, 'field'); this.session.renderer?.lookAtThreat(target.eventId); }
        else this.goTo('field', 'field');
        return;
      }
      case 'goto-field': this.goTo('field', 'field'); return;
      case 'bee-close': this.closeBee(); return;
      case 'bee-open': this.closePanel(false); this.openBee(Number(id)); return;
      case 'bee-follow': {
        const renderer = this.session.renderer;
        const bee = Number(id);
        if (renderer !== null && renderer.canFollow(bee)) { this.view = 'field'; renderer.startFollow(bee); }
        else this.showToast('它现在在巢里或花丛里忙，等它飞出来再点「跟随」');
        this.refreshGame(true);
        return;
      }
      case 'bee-unfollow': this.session.renderer?.stopFollow(); this.refreshGame(true); return;
      case 'bee-upgrade': this.feedback(e.roster.upgradeStar(Number(id))); break;
      case 'roster-tab': this.rosterTab = id; break;
      case 'goto-threat': {
        const live = e.threats.activeList().find((t) => t.eventId === id);
        if (live !== undefined) {
          this.goTo(live.type === 'moth' ? 'hive' : `fieldId:${live.targetId}`, live.type === 'moth' ? 'hive' : 'field');
          if (live.type === 'wasp') this.session.renderer?.lookAtThreat(live.eventId);
        }
        return;
      }
      case 'banner-click': {
        const wasThreat = this.bannerKind === 'threat';
        const shouldOpenEco = wasThreat || this.bannerKind === 'warn';
        this.presentations.dismiss(); this.banner = '';
        // 敌害横幅：直接带玩家去敌害所在位置，方便点它；找不到再打开「生态」
        const live = wasThreat ? e.threats.activeList().filter((t) => t.phase === 'active' && t.type !== 'bear').pop() : undefined;
        if (live !== undefined) {
          this.goTo(live.type === 'moth' ? 'hive' : `fieldId:${live.targetId}`, live.type === 'moth' ? 'hive' : 'field');
          if (live.type === 'wasp') this.session.renderer?.lookAtThreat(live.eventId);
          return;
        }
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
    if (!isInputElement(event.target) || event.target.type !== 'range') return;
    const input = event.target;
    const kind = input.dataset.range ?? '';
    const id = input.dataset.id ?? '';
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) return;
    const min = Number(input.getAttribute('min') ?? 0), max = Number(input.getAttribute('max') ?? 100);
    input.setAttribute('style', `--range-fill:${100 * (value - min) / (max - min || 1)}%`);
    const output = input.closest('label')?.querySelector('output');
    if (output !== null && output !== undefined) output.textContent = `${value}`;
    const e = this.engine();
    if (kind === 'role-ratio') {
      e.setRatio(id, value); e.saveRequested = true;
    } else if (kind === 'plan-weight') {
      e.setPlanWeight(id, value);
    } else if (kind === 'plan-reserve') {
      e.setPlanReserve(value / 100);
      if (output !== null && output !== undefined) output.textContent = `${value}`;
    } else if (kind === 'wax-share') {
      e.setWaxShare(value / 100); e.saveRequested = true;
    } else if (kind === 'pollinators') {
      // 拖动过程中就生效：触屏松手时界面会先刷新，只靠 change 事件会丢失（安卓、抖音驻守不了的原因）
      const r = e.setPollinators(id, value);
      if (final || !r.ok) this.feedback(r);
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
    this.panel = key; this.drawerOpen = true; this.sceneTip = null;
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
    this.sceneTip = null;
    this.view = this.view === 'field' ? 'hive' : 'field';
    this.placing = ''; this.movingCell = '';
    this.panel = ''; this.drawerOpen = false;
    this.selectedCell = ''; this.selectedField = '';
    this.session.audio.play('ui_tab');
    this.refreshGame(true);
    this.writeHistory(false);
  }

  private startPlacing(building: string): void {
    this.sceneTip = null;
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
    this.placing = building; this.movingCell = '';
    this.view = 'hive';
    this.focusTarget = 'hive'; this.focusUntil = Date.now() + 6000;
    this.closePanel(false);
    this.refreshGame(true);
    this.writeHistory(false);
  }

  private cancelPlacing(): void {
    this.placing = ''; this.movingCell = '';
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
    if (showTarget && topic !== null && topic.focus.startsWith('panel:')) this.openPanel(topic.focus.substring(6));
    else if (showTarget && topic !== null) this.goTo(topic.focus, topic.view);
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
    const e = this.engine();
    const target = e.w.cfg.regions.find((region) => region.id === this.swarmTarget);
    if (target === undefined) return;
    if (!e.prog.zoneUnlocked(target)) {
      this.showToast(`去${target.name}要先在${e.w.region().name}有 ${e.prog.zoneColoniesNeeded(target)} 个蜂群：先原地分蜂`, true);
      return;
    }
    this.requestConfirm(`远征${target.name}`, `新蜂后将带走一半人口和当前资源前往${target.name}建立新巢（明星蜂优先跟随），你会跟着她过去；原蜂群保留另一半及现有建设。新巢成本倍率 ×${costMulFor(target.difficulty)}。`, '确认远征', () => {
      const points = e.swarmPreview(target.id).total;
      const result = e.swarm(target.id);
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

  private confirmLocalSwarm(): void {
    const e = this.engine();
    const local = e.localPreview();
    if (!local.ready) return;
    this.requestConfirm('原地分蜂', `新蜂后将带走当前蜂巢一半的人口和资源，在${e.w.region().name}同一张地图上建立新蜂巢（明星蜂优先跟随），并继承内两圈巢房布局和一半属性等级。你继续留在当前蜂巢，新蜂巢会托管运转，点地图上的它就能切换过去。${local.total > 0 ? `本次获得 ${local.total} 传承点。` : ''}`, '确认分蜂', () => {
      const points = local.total;
      const result = e.swarmLocal();
      this.feedback(result);
      if (result.ok) {
        this.session.saveNow();
        if (points > 0 && this.session.ads.remaining(AdPlacement.SwarmBonus) > 0) this.swarmBonus = swarmBonusPoints(points);
      }
    });
  }

  private toggleSetting(id: string): void {
    const e = this.engine();
    const settings = e.state.meta.settings;
    if (id === 'breed-plan') {
      this.feedback(e.setBreedPlan(!e.run.colony.plan.on));
      this.refreshGame(true);
      return;
    }
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
    this.presentations.clear(); this.banner = ''; this.eventTitle = ''; this.bearPromptKey = '';
    this.boostModal = false; this.swarmBonus = 0;
    this.panel = ''; this.legal = ''; this.drawerOpen = false; this.placing = '';
    this.selectedCell = ''; this.selectedField = ''; this.view = 'field';
    this.screen = keepSettings ? 'home' : 'privacy';
    this.privacyDeclined = false;
    this.render();
    this.writeHistory(true);
  }
}

