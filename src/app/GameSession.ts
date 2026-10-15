import { formatBig, formatDuration } from '../common/BigNum';
import { hashSeed } from '../common/Rng';
import { DEFAULT_CONFIG, validateConfig } from '../domain/GameConfig';
import { GameEngine } from '../domain/GameEngine';
import { Guide } from '../domain/Guide';
import { createInitialState, createRun } from '../domain/NewGame';
import { cloneState, encodeEnvelope } from '../domain/SaveCodec';
import type { GameMessage, GameState, OfflineReport } from '../domain/State';
import { Res, Role, SeasonId } from '../domain/Types';
import type { FxEvent } from '../domain/World';
import { SceneRenderer } from '../scene/SceneRenderer';
import { ArtEnv } from '../scene/Art';
import { Sprites } from '../scene/Sprites';
import { BrowserArt } from '../platform/BrowserArt';
import { BrowserAudioService } from '../platform/BrowserAudioService';
import { BrowserSaveRepository } from '../platform/BrowserSaveRepository';
import { TimeService } from '../platform/TimeService';

export const PRIVACY_VERSION = '2026-10-01';

const SEASON_NAMES: Record<string, string> = {
  tutorial: '新手春季', spring: '春季', summer: '夏季', autumn: '秋季', winterPrep: '冬季将至', winter: '冬季'
};
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

export class GameSession {
  eng: GameEngine | null = null;
  renderer: SceneRenderer | null = null;
  readonly repo = new BrowserSaveRepository();
  readonly audio = new BrowserAudioService();
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
    Sprites.src = new BrowserArt('./');
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
  }

  start(): void {
    if (this.raf !== 0 || this.eng === null) return;
    this.last = performance.now();
    const loop = (now: number): void => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
    this.audio.resumeMusic();
  }

  stop(): void {
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.audio.pauseMusic();
  }

  private frame(now: number): void {
    const engine = this.eng;
    const renderer = this.renderer;
    if (engine === null || renderer === null) return;
    const dt = Math.min(0.25, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const speed = [1, 2, 4].includes(engine.state.meta.settings.gameSpeed) ? engine.state.meta.settings.gameSpeed : 1;
    try {
      engine.advance(dt * speed);
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
      else if (event.kind === 'spring') this.audio.play('winter_survived');
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
        else if (message.kind === 'warn' && message.text.includes('熊抢走')) this.audio.play('threat_lost');
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
    if (elapsed.elapsedSec < 60 && elapsed.anomaly.length === 0) return;
    const report = this.eng.settleOffline(elapsed.elapsedSec, `${state.lastSavedAt}`, elapsed.anomaly);
    state.lastSavedAt = TimeService.now();
    if (report !== null && (report.credited >= 60 || report.anomaly.length > 0)) this.pendingOffline = report;
    this.seenMessageId = state.nextMessageId;
    this.saveNow();
  }

  dismissOffline(): void { this.pendingOffline = null; }

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
  }

  recoverColonyWithPoint(): boolean {
    if (this.eng === null || this.eng.state.meta.inheritance.available < 1) return false;
    const state = cloneState(this.eng.state);
    state.meta.inheritance.available -= 1;
    const old = state.run;
    state.run = createRun(DEFAULT_CONFIG, old.regionId, old.regionIndex, hashSeed(`${state.meta.playerId}:recover:${Date.now()}`), 2);
    state.run.res[Res.Honey] = state.run.res[Res.Honey].addN(80);
    state.run.res[Res.Nectar] = state.run.res[Res.Nectar].addN(80);
    this.useState(state);
    this.saveNow();
    return true;
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
    if (honeyPct >= 95) alert = '储蜜格快满了，快来收蜜';
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
