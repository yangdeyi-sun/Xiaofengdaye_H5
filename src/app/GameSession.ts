import { BigNum, formatBig, formatDuration } from '../common/BigNum';
import { hashSeed } from '../common/Rng';
import { DEFAULT_CONFIG, validateConfig } from '../domain/GameConfig';
import { GameEngine } from '../domain/GameEngine';
import { Guide } from '../domain/Guide';
import { createInitialState, createRun } from '../domain/NewGame';
import { cloneState, decodeEnvelope, encodeEnvelope } from '../domain/SaveCodec';
import { rebindRun, syncRealm } from '../domain/RealmService';
import { decodeSaveCode, encodeSaveCode } from '../common/SaveCode';
import type { GameMessage, GameState, OfflineReport } from '../domain/State';
import { ALL_RES, Res, Role, SeasonId } from '../domain/Types';
import type { FxEvent } from '../domain/World';
import { SceneRenderer } from '../scene/SceneRenderer';
import { ArtEnv } from '../scene/Art';
import { Sprites } from '../scene/Sprites';
import { BrowserArt } from '../platform/BrowserArt';
import { BrowserAudioService } from '../platform/BrowserAudioService';
import { BrowserSaveRepository } from '../platform/BrowserSaveRepository';
import { TimeService } from '../platform/TimeService';
import { platform } from '../platform/Platform';
import { AdService } from './ads/AdService';

/** 隐私政策版本；改版后玩家会被重新要求同意 */
export const PRIVACY_VERSION = '2026-10-16';
/** 离开超过这个秒数，回来时弹出“离开期间收益” */
export const AWAY_REPORT_SEC = 30;

const SEASON_NAMES: Record<string, string> = {
  tutorial: '新手春季', spring: '春季', summer: '夏季', autumn: '秋季', winterPrep: '冬季将至', winter: '冬季'
};
/** 玩家本地日期 YYYY-MM-DD：每日签到与目标按本地零点刷新 */
export function localDay(at: number = TimeService.now()): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function seasonName(id: string): string { return SEASON_NAMES[id] ?? id; }

export interface StatusCardData {
  honey: string;
  honeyPct: number;
  bees: string;
  season: string;
  countdown: string;
  alert: string;
  updated: string;
}

export interface ColonyChoice {
  id: string;
  name: string;
  region: string;
  active: boolean;
  bees: number;
  honey: string;
}

export class GameSession {
  eng: GameEngine | null = null;
  renderer: SceneRenderer | null = null;
  readonly repo = new BrowserSaveRepository();
  readonly audio = new BrowserAudioService();
  /** 所有广告点位统一经过 AdService；底层 SDK 由平台层提供 */
  readonly ads = new AdService(platform().ads, platform().storage);
  /** 广告播放期间暂停模拟，玩家看广告不会错过敌害或冬季 */
  private adPaused = false;
  status = 'boot';
  bootError = '';
  pendingOffline: OfflineReport | null = null;
  recoveredNotice = '';
  persistenceError = '';
  private guideInst: Guide | null = null;
  private raf = 0;
  private last = 0;
  private uiTimer = 0;
  private saveTimer = 0;
  private requestSaveAt = 0;
  private seenMessageId = 0;
  private notices: GameMessage[] = [];
  private overflowOn = false;
  private checkpointCycle = -1;
  private lowPowerOn = false;
  private frameSkip = 0;
  private audioScreen = 'boot';
  private audioView = 'field';
  private readonly drawers = new Map<string, () => void>();
  private readonly uiListeners = new Set<() => void>();
  private awaySince = 0;
  private awayStart: Record<string, BigNum> = {};
  private awayAdults = 0;
  private awayPriorReport: OfflineReport | null = null;

  constructor() {
    this.ads.onAdStart = () => {
      this.adPaused = true;
      this.audio.pauseMusic();
    };
    this.ads.onAdEnd = () => {
      this.adPaused = false;
      this.last = platform().perfNow();
      if (this.raf !== 0) this.audio.resumeMusic();
    };
    // 广告打点：接入平台数据分析（如 tt.reportAnalytics）时在这里转发
    this.ads.onEvent = (event) => console.info('[ad]', event.type, event.placement, event.detail);
  }

  get ready(): boolean { return this.eng !== null; }
  get lowPower(): boolean { return this.lowPowerOn; }
  set lowPower(value: boolean) { this.lowPowerOn = value; Sprites.lowOnly = value; }
  engine(): GameEngine { return this.eng as GameEngine; }

  guide(): Guide {
    const engine = this.engine();
    if (this.guideInst === null || this.guideInst.eng !== engine) this.guideInst = new Guide(engine);
    return this.guideInst;
  }

  init(): void {
    if (this.eng !== null) return;
    const errors = validateConfig(DEFAULT_CONFIG);
    if (errors.length > 0) console.error('配置校验失败', errors);
    ArtEnv.fontUnit = 'px';
    ArtEnv.fontFamily = '"Noto Sans SC", "Microsoft YaHei", sans-serif';
    Sprites.src = new BrowserArt();
    Sprites.atlasCropEnabled = true;
    Sprites.bitmapState = 0;
    if (!this.repo.available) {
      this.bootError = '浏览器禁止使用本地存储，无法安全保存游戏进度。请允许此站点保存数据后重试。';
      this.status = 'error';
      return;
    }
    if (!this.repo.claimWriter()) {
      this.bootError = '小峰大业已在另一个标签页中运行。为保护存档，请关闭其他标签页后重试。';
      this.status = 'error';
      return;
    }
    let state: GameState | null = null;
    const loaded = this.repo.load();
    if (loaded.result.ok && loaded.result.state !== null) {
      state = loaded.result.state;
      if (loaded.recoveredFromBackup) this.recoveredNotice = '主存档损坏，已自动恢复到最近一次备份。';
    } else if (loaded.result.error === 'NEWER_SCHEMA') {
      this.bootError = '存档来自更新版本，请更新游戏后继续。现有存档未被修改。';
      this.status = 'error';
      return;
    } else if (loaded.result.error !== 'NO_SAVE' && loaded.result.error.length > 0) {
      this.recoveredNotice = '存档无法读取，已创建新的蜂巢；损坏内容已单独保留。';
    }
    const isNew = state === null;
    if (state === null) {
      const now = TimeService.now();
      const playerId = `p${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
      state = createInitialState(DEFAULT_CONFIG, playerId, now, hashSeed(playerId));
    }
    this.useState(state);
    if (!isNew) this.settleOffline();
    this.engine().ensureDay(localDay());
    this.status = 'ready';
    this.saveNow();
  }

  applySettings(): void {
    if (this.eng === null || this.renderer === null) return;
    const settings = this.eng.state.meta.settings;
    this.renderer.particlesOn = settings.particles;
    this.renderer.reduceMotion = settings.reduceMotion;
    Sprites.lowOnly = this.lowPower;
    Sprites.frozen = settings.reduceMotion;
    this.audio.setSfx(settings.sfx);
    this.audio.vibrateOn = settings.vibration;
    this.audio.setMusic(settings.music);
    this.audio.setVolumes(settings.musicVolume / 100, settings.ambientVolume / 100, settings.effectsVolume / 100);
    // 默认固定竖屏，并应用玩家在设置中保存的横/竖屏选择。
    const orientation = settings.orientation === 'landscape' ? 'landscape' : 'portrait';
    settings.orientation = orientation;
    void platform().setOrientation?.(orientation);
  }

  async setOrientation(orientation: 'auto' | 'landscape' | 'portrait'): Promise<boolean> {
    if (this.eng === null) return false;
    this.eng.state.meta.settings.orientation = orientation;
    this.eng.saveRequested = true;
    const applied = await (platform().setOrientation?.(orientation) ?? Promise.resolve(false));
    this.saveNow();
    return applied;
  }

  colonyChoices(): ColonyChoice[] {
    const engine = this.engine();
    const state = engine.state;
    const active: ColonyChoice = {
      id: state.activeColonyId, name: engine.colonyName(state.activeColonyId, engine.run.regionId), region: engine.w.region().name,
      active: true, bees: engine.w.adults(), honey: formatBig(engine.w.econ.amount(Res.Honey))
    };
    const inactive = state.colonies.map((slot) => {
      const region = DEFAULT_CONFIG.regions.find((item) => item.id === slot.run.regionId)?.name ?? slot.run.regionId;
      const bees = Object.values(slot.run.colony.roles).reduce((sum, value) => sum + Math.max(0, value), 0);
      return { id: slot.id, name: state.meta.colonyNames?.[slot.id] ?? slot.name, region, active: false, bees, honey: formatBig(slot.run.res[Res.Honey]) };
    });
    return [active, ...inactive];
  }

  /** 保存当前蜂群并切入目标蜂群；目标离开期间的生产按离线规则一次性补算。 */
  switchColony(id: string): boolean {
    if (this.eng === null || id === this.eng.state.activeColonyId) return false;
    const state = this.eng.state;
    const index = state.colonies.findIndex((slot) => slot.id === id);
    if (index < 0) return false;
    const now = TimeService.now();
    const target = state.colonies[index];
    state.colonies.splice(index, 1);
    state.colonies.push({
      id: state.activeColonyId, name: this.eng.colonyName(state.activeColonyId, state.run.regionId), run: state.run, lastActiveAt: now
    });
    state.activeColonyId = target.id;
    state.run = target.run;
    state.lastSavedAt = now;
    this.useState(state);
    const elapsed = Math.max(0, (now - target.lastActiveAt) / 1000);
    if (elapsed >= 5) {
      const report = this.engine().settleOffline(elapsed, `colony:${target.id}:${target.lastActiveAt}`, '');
      if (report !== null && report.credited >= AWAY_REPORT_SEC) this.pendingOffline = report;
    }
    this.saveNow();
    return true;
  }

  start(): void {
    if (this.raf !== 0 || this.eng === null) return;
    this.last = platform().perfNow();
    const loop = (now: number): void => {
      this.raf = platform().requestFrame(loop);
      this.frame(now);
    };
    this.raf = platform().requestFrame(loop);
    if (!this.adPaused) this.audio.resumeMusic();
  }

  stop(): void {
    if (this.raf !== 0) platform().cancelFrame(this.raf);
    this.raf = 0;
    this.audio.pauseMusic();
  }

  /** 同一张王国地图上、不在经营的蜂巢：后台托管实时运转 */
  private bg: GameEngine[] = [];
  private bgKey = '';
  private bgState: GameState | null = null;

  /** 当前种区的其它蜂巢有变化（分蜂、切换、读档）时重建托管引擎 */
  private refreshBackground(): void {
    const engine = this.eng;
    if (engine === null) return;
    const state = engine.state;
    const region = state.run.regionId;
    const slots = state.colonies.filter((slot) => slot.run.regionId === region && slot.run.realm !== undefined);
    const key = `${state.activeColonyId}|${slots.map((slot) => slot.id).join(',')}`;
    if (key === this.bgKey && this.bgState === state && this.bg.every((e, i) => e.run === slots[i]?.run)) return;
    this.bgKey = key;
    this.bgState = state;
    this.bg = slots.map((slot) => GameEngine.background(DEFAULT_CONFIG, state, slot.id, slot.run));
  }

  /** 后台蜂巢跟着实时推进，然后把各蜂巢对共用花田的采集合并 */
  private tickRealm(dt: number): void {
    const engine = this.eng;
    if (engine === null) return;
    this.refreshBackground();
    if (this.bg.length === 0) return;
    const now = TimeService.now();
    const state = engine.state;
    this.bg.forEach((e) => {
      e.advance(dt);
      const slot = state.colonies.find((c) => c.run === e.run);
      if (slot !== undefined) slot.lastActiveAt = now;
    });
    syncRealm(state, state.run.regionId);
  }

  /** 离开一段时间回来：后台蜂巢也按离线规则补算 */
  private settleRealmOffline(elapsedSec: number, id: string): void {
    this.refreshBackground();
    if (this.eng === null || this.bg.length === 0) return;
    this.bg.forEach((e, i) => e.settleOffline(elapsedSec, `${id}:bg${i}`, ''));
    syncRealm(this.eng.state, this.eng.state.run.regionId);
  }

  private frame(now: number): void {
    const engine = this.eng;
    const renderer = this.renderer;
    if (engine === null || renderer === null) return;
    const dt = Math.min(0.25, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    // 游戏速度只来自“花潮加速”广告奖励；设置里的旧速度字段不再生效
    const speed = this.adPaused ? 0 : this.ads.boostSpeed();
    try {
      if (speed > 0) {
        engine.advance(dt * speed);
        this.tickRealm(dt * speed);
      }
      if (engine.run.season.season === SeasonId.WinterPrep && engine.run.season.cycleIndex !== this.checkpointCycle) {
        this.checkpointCycle = engine.run.season.cycleIndex;
        this.saveWinterCheckpoint();
      }
      this.dispatchFx(engine.w.fx);
      renderer.update(dt);
      const cues = renderer.takeCues();
      if (this.audioScreen === 'game') cues.forEach((cue) => this.audio.play(cue));
      this.frameSkip = (this.frameSkip + 1) % 2;
      if (!this.lowPower || this.frameSkip === 0) this.drawers.forEach((draw) => draw());
    } catch (error) {
      console.error('游戏循环异常', error);
    }
    this.uiTimer += dt;
    if (this.uiTimer >= 0.25) {
      this.uiTimer = 0;
      engine.ensureDay(localDay());
      this.collectNotices();
      this.refreshAudioScene();
      this.audio.tick();
      this.watchOverflow();
      this.uiListeners.forEach((listener) => listener());
    }
    this.saveTimer += dt;
    if (this.saveTimer >= 30 || (engine.saveRequested && Date.now() - this.requestSaveAt > 2000)) {
      this.saveTimer = 0;
      this.requestSaveAt = Date.now();
      engine.saveRequested = false;
      this.saveNow();
    }
  }

  subscribeUi(listener: () => void): () => void {
    this.uiListeners.add(listener);
    return () => this.uiListeners.delete(listener);
  }
  addDrawer(id: string, draw: () => void): void { this.drawers.set(id, draw); }
  removeDrawer(id: string): void { this.drawers.delete(id); }

  setAudioContext(screen: string, view: string): void {
    this.audioScreen = screen;
    this.audioView = view;
    this.refreshAudioScene();
  }

  private refreshAudioScene(): void {
    if (this.eng === null) return;
    const season = this.eng.run.season.season;
    let weather = '';
    if (season === SeasonId.Winter) weather = 'snow';
    else if (season === SeasonId.Autumn) weather = 'autumn';
    else if (season === SeasonId.Spring && this.eng.w.regionSeasonFly() < 0.95) weather = 'rain';
    this.audio.setThreatLevel(this.eng.threats.activeList().length);
    this.audio.setScene(this.audioScreen, this.eng.run.regionId, this.audioView === 'hive', weather);
  }

  private dispatchFx(events: FxEvent[]): void {
    if (this.audioScreen !== 'game') return;
    events.forEach((event) => {
      if (event.kind === 'collect') this.audio.play('collect');
      else if (event.kind === 'egg') this.audio.play('egg');
      else if (event.kind === 'hatch') {
        this.audio.play('hatch');
        const role = DEFAULT_CONFIG.roles.find((item) => item.name === event.text);
        if (role !== undefined) setTimeout(() => this.audio.play(`role_${role.id}`), 260);
      } else if (event.kind === 'dance') this.audio.play('dance');
      else if (event.kind === 'reveal') {
        const flower = DEFAULT_CONFIG.flowers.find((item) => item.name === event.text);
        this.audio.play(flower?.rare ? 'rare_field_reveal' : 'field_reveal');
      } else if (event.kind === 'build' || event.kind === 'expand') {
        this.audio.play(event.kind); this.audio.vibrate(20);
        if (event.kind === 'build') setTimeout(() => this.audio.play('build_room_finish'), 700);
      } else if (event.kind === 'upgrade') {
        const research = DEFAULT_CONFIG.research.find((item) => event.text.startsWith(item.name));
        this.audio.play(research === undefined ? 'upgrade_normal' : 'research_complete');
      } else if (event.kind === 'season') {
        const season = this.engine().run.season.season;
        this.audio.play(season === SeasonId.WinterPrep ? 'season_winter_warning' : `season_${season === SeasonId.Tutorial ? SeasonId.Spring : season}`);
      }
      else if (event.kind === 'spring') {
        this.audio.play('winter_survived');
        // 熬过冬天是天然的断点，按节奏规则尝试展示插屏
        void this.ads.maybeInterstitial('winter_survived');
      }
      else if (event.kind === 'victory') { this.audio.play(`victory_${this.enemyAudioKey(event.text)}`); this.audio.vibrate(30); }
      else if (event.kind === 'task' || event.kind === 'milestone' || event.kind === 'bloom') this.audio.play(event.kind);
      else if (event.kind === 'swarm') { this.audio.play('swarm_depart'); this.audio.vibrate(60); setTimeout(() => this.audio.play('swarm_arrive'), 2600); }
      if (event.kind === 'swarm') this.renderer?.onMessage('swarmDepart');
    });
  }

  private enemyAudioKey(text: string): string {
    if (text.includes('熊')) return 'bear';
    if (text.includes('蜡螟')) return 'moth';
    if (text.includes('蛛')) return 'web';
    return 'wasp';
  }

  private collectNotices(): void {
    if (this.eng === null) return;
    this.eng.state.messages.forEach((message) => {
      if (message.id < this.seenMessageId) return;
      if (this.audioScreen === 'game') {
        if (message.kind === 'codex') this.audio.play('codex_new');
        else if (message.kind === 'key') this.audio.play('upgrade_key');
        else if (message.kind === 'special') this.audio.play('talent_keystone');
        else if (message.kind === 'warn' && (message.text.includes('熊抢走') || message.text.includes('上缴'))) this.audio.play('threat_lost');
        else if (message.kind === 'error' && message.text.includes('熊')) { this.audio.play('threat_lost'); this.audio.vibrate(120); }
        else if (message.kind === 'info' && message.text.includes('交付了')) this.audio.play('bear_honey_pay');
      }
      if (['threat', 'warn', 'milestone', 'rare', 'achievement', 'swarm', 'key', 'season', 'error'].includes(message.kind)) {
        this.notices.push(message);
        if (message.kind === 'threat' && this.audioScreen === 'game') { this.audio.play(`alert_${this.enemyAudioKey(message.text)}`); this.audio.vibrate(40); }
        if (message.kind === 'achievement' && this.audioScreen === 'game') this.audio.play('achievement_unlock');
        if (message.kind === 'achievement' || message.kind === 'key') this.renderer?.onMessage(message.kind);
      }
    });
    this.notices.sort((a, b) => this.noticePriority(b) - this.noticePriority(a));
    this.seenMessageId = this.eng.state.nextMessageId;
  }

  private noticePriority(message: GameMessage): number {
    if (message.kind === 'threat' && message.text.includes('熊')) return 40;
    if (message.kind === 'season' && message.text.includes('冬')) return 30;
    if (message.kind === 'threat') return 20;
    if (message.kind === 'season') return 10;
    return 5;
  }
  popNotice(): GameMessage | null { return this.notices.shift() ?? null; }

  private watchOverflow(): void {
    if (this.eng === null) return;
    const honey = this.eng.run.overflow[Res.Honey];
    const nectar = this.eng.run.overflow[Res.Nectar];
    const active = (honey?.toNumber() ?? 0) >= 1 || (nectar?.toNumber() ?? 0) >= 1;
    if (active && !this.overflowOn && this.eng.w.unlocked('t_build_storage')) {
      if (this.audioScreen === 'game') this.audio.play('overflow_warning');
      this.renderer?.onMessage('overflow');
    }
    this.overflowOn = active;
  }

  settleOffline(): void {
    if (this.eng === null) return;
    const state = this.eng.state;
    const elapsed = TimeService.offlineElapsed(state.lastSavedAt, DEFAULT_CONFIG.economy.maxOfflineDays);
    // 短暂切到后台也照常结算，避免这几秒的经营凭空消失；离开 30 秒以上才弹出收益报告
    if (elapsed.elapsedSec < 5 && elapsed.anomaly.length === 0) return;
    const report = this.eng.settleOffline(elapsed.elapsedSec, `${state.lastSavedAt}`, elapsed.anomaly);
    this.settleRealmOffline(elapsed.elapsedSec, `${state.lastSavedAt}`);
    state.lastSavedAt = TimeService.now();
    if (report !== null && (report.credited >= AWAY_REPORT_SEC || report.anomaly.length > 0)) this.pendingOffline = report;
    this.seenMessageId = state.nextMessageId;
    this.saveNow();
  }

  dismissOffline(): void { this.pendingOffline = null; }

  /** 玩家离开经营画面（回到首页）时记下资源，回来时汇总这段时间蜂巢的收益 */
  beginAway(): void {
    if (this.eng === null || this.awaySince > 0) return;
    this.awaySince = TimeService.now();
    this.awayStart = {};
    ALL_RES.forEach((res) => { this.awayStart[res] = this.engine().w.econ.amount(res); });
    this.awayAdults = this.engine().w.adults();
    this.awayPriorReport = this.pendingOffline;
  }

  endAway(): void {
    if (this.eng === null || this.awaySince <= 0) return;
    const engine = this.engine();
    const elapsed = Math.max(0, (TimeService.now() - this.awaySince) / 1000);
    const start = this.awayStart;
    const prior = this.awayPriorReport;
    this.awaySince = 0;
    this.awayStart = {};
    this.awayPriorReport = null;
    if (elapsed < AWAY_REPORT_SEC && prior === null) return;
    const gains: Record<string, string> = {};
    ALL_RES.forEach((res) => {
      // 首次打开时已结算的离线收益发生在 awayStart 之前；必须合并，不能被首页收益覆盖。
      // 首页期间发生的后台结算已包含在当前库存差额中，不能重复累加。
      gains[res] = engine.w.econ.amount(res).sub(start[res] ?? BigNum.of(0))
        .add(BigNum.parse(prior?.gains[res] ?? '0')).serialize();
    });
    const prev = this.pendingOffline;
    const notes = prev === null ? [] : prev.notes.filter((line) => !line.startsWith('蜂群增加了'));
    if (engine.w.adults() > this.awayAdults) notes.push(`蜂群增加了 ${engine.w.adults() - this.awayAdults} 只`);
    const truncated = (prior?.truncated ?? 0) + (prev !== null && prev !== prior ? prev.truncated : 0);
    const totalElapsed = elapsed + (prior?.elapsed ?? 0);
    this.pendingOffline = {
      settlementId: `away:${Math.round(totalElapsed)}:${engine.state.lastSavedAt}`, elapsed: totalElapsed, credited: Math.max(0, totalElapsed - truncated),
      truncated, gains, seasonsPassed: prev === null ? [] : prev.seasonsPassed, notes, anomaly: prev === null ? '' : prev.anomaly
    };
  }

  saveNow(): boolean {
    if (this.eng === null) return false;
    const state = this.eng.state;
    state.lastSavedAt = TimeService.now();
    state.lastTrustedTime = state.lastSavedAt;
    const saved = this.repo.save(encodeEnvelope(state, DEFAULT_CONFIG.configVersion, state.lastSavedAt));
    if (!saved) {
      this.persistenceError = this.repo.ownsWriter()
        ? '浏览器无法写入本地存储。为避免进度丢失，游戏已暂停；请检查站点存储权限和可用空间。'
        : '当前标签页失去了存档写入权。为保护进度，游戏已暂停，请关闭其他标签页后刷新。';
      this.status = 'error';
      this.bootError = this.persistenceError;
      this.stop();
      this.uiListeners.forEach((listener) => listener());
    }
    return saved;
  }

  private writeSnapshot(snapshot: GameState): void {
    snapshot.lastSavedAt = TimeService.now();
    this.repo.save(encodeEnvelope(snapshot, DEFAULT_CONFIG.configVersion, snapshot.lastSavedAt));
  }

  private saveWinterCheckpoint(): void {
    if (this.eng === null) return;
    const snapshot = cloneState(this.eng.state);
    snapshot.lastSavedAt = TimeService.now();
    this.repo.saveCheckpoint(encodeEnvelope(snapshot, DEFAULT_CONFIG.configVersion, snapshot.lastSavedAt));
  }

  private useState(state: GameState): void {
    this.eng = new GameEngine(DEFAULT_CONFIG, state);
    this.eng.onBeforeSwarm = (snapshot) => this.writeSnapshot(snapshot);
    this.renderer = new SceneRenderer(this.eng);
    this.guideInst = null;
    this.seenMessageId = state.nextMessageId;
    this.notices = [];
    this.applySettings();
    this.eng.ensureDay(localDay());
  }

  recoverColonyWithPoint(): boolean {
    if (this.eng === null || this.eng.state.meta.inheritance.available < 1) return false;
    const state = cloneState(this.eng.state);
    state.meta.inheritance.available -= 1;
    const old = state.run;
    state.run = createRun(DEFAULT_CONFIG, old.regionId, old.regionIndex, hashSeed(`${state.meta.playerId}:recover:${Date.now()}`), 2);
    rebindRun(state, DEFAULT_CONFIG, old, state.run, state.activeColonyId);
    state.run.res[Res.Honey] = state.run.res[Res.Honey].addN(80);
    state.run.res[Res.Nectar] = state.run.res[Res.Nectar].addN(80);
    this.useState(state);
    this.saveNow();
    return true;
  }

  /** 广告奖励：免费重振蜂群（不消耗传承点） */
  reviveColonyFree(): boolean {
    if (this.eng === null || !this.eng.run.colony.collapsed) return false;
    this.eng.state.meta.inheritance.available += 1;
    if (this.recoverColonyWithPoint()) return true;
    this.eng.state.meta.inheritance.available -= 1;
    return false;
  }

  // ---------------- 存档码 / 云存档 ----------------
  /** 导出当前进度为存档码（先保存一次，保证是最新进度） */
  exportSaveCode(): string {
    if (this.eng === null) return '';
    this.saveNow();
    return encodeSaveCode(encodeEnvelope(this.eng.state, DEFAULT_CONFIG.configVersion, TimeService.now()));
  }

  /** 校验存档码；成功时返回解出的存档，失败返回原因 */
  checkSaveCode(code: string): { ok: boolean; message: string; state: GameState | null } {
    const text = decodeSaveCode(code);
    if (text === null) return { ok: false, message: '这不是小峰大业的存档码，请完整复制以 XFDY1- 开头的整串文字', state: null };
    return this.checkSaveText(text);
  }

  private checkSaveText(text: string): { ok: boolean; message: string; state: GameState | null } {
    const decoded = decodeEnvelope(text);
    if (!decoded.ok || decoded.state === null) {
      const reason: Record<string, string> = {
        NEWER_SCHEMA: '这个存档来自更新的版本，请先更新游戏',
        CHECKSUM: '存档码不完整或被改动过，请重新复制',
        EMPTY: '存档码不完整，请重新复制'
      };
      return { ok: false, message: reason[decoded.error] ?? '存档码无法读取，请重新复制', state: null };
    }
    return { ok: true, message: '', state: decoded.state };
  }

  /** 用存档替换当前进度；导入前的进度单独保留一份，可以撤销 */
  importSaveState(state: GameState): boolean {
    if (this.eng === null) return false;
    const current = this.eng.state;
    this.repo.saveBeforeImport(encodeEnvelope(current, DEFAULT_CONFIG.configVersion, TimeService.now()));
    // 保留本机的隐私同意与设置，避免导入后被要求重新同意
    state.meta.settings.privacyAccepted = current.meta.settings.privacyAccepted;
    state.meta.settings.privacyVersion = current.meta.settings.privacyVersion;
    // 导入时不结算离线收益，防止“导出-等待-导入”反复刷离线奖励
    state.lastSavedAt = TimeService.now();
    this.useState(state);
    this.pendingOffline = null;
    this.awaySince = 0;
    return this.saveNow();
  }

  hasBeforeImport(): boolean { return this.repo.loadBeforeImport().ok; }

  undoImport(): boolean {
    const decoded = this.repo.loadBeforeImport();
    if (!decoded.ok || decoded.state === null || this.eng === null) return false;
    decoded.state.lastSavedAt = TimeService.now();
    this.useState(decoded.state);
    this.repo.clearBeforeImport();
    return this.saveNow();
  }

  /** 云存档：上传当前进度 */
  async cloudUpload(): Promise<{ ok: boolean; message: string }> {
    const cloud = platform().cloud;
    if (cloud === undefined || this.eng === null) return { ok: false, message: '当前平台还没有开通云存档' };
    this.saveNow();
    return cloud.upload(encodeEnvelope(this.eng.state, DEFAULT_CONFIG.configVersion, TimeService.now()));
  }

  /** 云存档：下载并校验，交给界面确认后再导入 */
  async cloudDownload(): Promise<{ ok: boolean; message: string; state: GameState | null; savedAt: number }> {
    const cloud = platform().cloud;
    if (cloud === undefined) return { ok: false, message: '当前平台还没有开通云存档', state: null, savedAt: 0 };
    const got = await cloud.download();
    if (!got.ok) return { ok: false, message: got.message, state: null, savedAt: 0 };
    const checked = this.checkSaveText(got.saveText);
    return { ok: checked.ok, message: checked.message, state: checked.state, savedAt: got.savedAt };
  }

  restoreWinterCheckpoint(): boolean {
    if (this.eng === null) return false;
    const decoded = this.repo.loadCheckpoint();
    if (!decoded.ok || decoded.state === null) return false;
    decoded.state.meta = cloneState(this.eng.state).meta;
    this.useState(decoded.state);
    this.saveNow();
    return true;
  }

  resetProgress(keepSettings: boolean): void {
    if (this.eng === null) return;
    const settings = this.eng.state.meta.settings;
    this.repo.wipe();
    const now = TimeService.now();
    const playerId = `p${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const state = createInitialState(DEFAULT_CONFIG, playerId, now, hashSeed(playerId));
    if (keepSettings) state.meta.settings = settings;
    this.useState(state);
    this.pendingOffline = null;
    this.awaySince = 0;
    this.awayPriorReport = null;
    this.saveNow();
  }

  deleteAllData(): void { this.repo.wipe(); }
  onBackground(): void { this.saveNow(); this.stop(); }
  ensureWriter(): boolean {
    if (this.repo.ownsWriter() || this.repo.claimWriter()) return true;
    this.persistenceError = '检测到另一个正在运行的小峰大业标签页。为避免存档冲突，本标签页已暂停。';
    this.status = 'error';
    this.bootError = this.persistenceError;
    this.stop();
    this.uiListeners.forEach((listener) => listener());
    return false;
  }
  onForeground(): boolean {
    if (this.eng === null || !this.ensureWriter()) return false;
    this.settleOffline();
    this.start();
    return true;
  }
  dispose(): void { this.saveNow(); this.stop(); this.audio.release(); this.repo.releaseWriter(); }

  statusCard(): StatusCardData {
    const engine = this.engine();
    const season = engine.run.season;
    let alert = '';
    const honeyPct = Math.round(engine.w.econ.fillRatio(Res.Honey) * 100);
    if (engine.run.hive.fallAt > 0) alert = `蜂巢已达上限，请在${formatDuration(engine.hive.fallRemaining())}内分蜂`;
    else if (honeyPct >= 95) alert = '储蜜格快满了，快来收蜜';
    else if (season.season === SeasonId.WinterPrep || (season.season === SeasonId.Autumn && engine.season.remaining() < 90)) alert = '冬季即将到来，检查储备';
    else if (engine.threats.pendingBear() !== null) alert = '熊正在接近蜂巢！';
    else if (engine.swarmPreview().ready) alert = '分蜂条件已达成';
    else if (engine.threats.activeList().length > 0) alert = '敌害出现，守卫蜂需要支援';
    const date = new Date();
    return {
      honey: formatBig(engine.w.econ.amount(Res.Honey)), honeyPct, bees: `${engine.w.adults()}`,
      season: seasonName(season.season), countdown: season.formal ? `${formatDuration(engine.season.remaining())}后换季` : '',
      alert, updated: `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')} 更新`
    };
  }

  roleName(role: string): string { return DEFAULT_CONFIG.roles.find((item) => item.id === role)?.name ?? role; }
  roleOrder(): string[] { return [Role.Scout, Role.Forager, Role.House, Role.Guard]; }
}
