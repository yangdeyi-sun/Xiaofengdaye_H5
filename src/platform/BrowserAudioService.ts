import { BGM_TRACKS, resolveCue, resolveKey } from '../infrastructure/AudioCatalog';
import type { SoundHandle } from './Platform';
import { platform } from './Platform';

/** 小游戏同时存在的音频实例数量有限，短音效并发上限 */
const MAX_SHOTS = 4;

/** 音乐、环境声、天气声的循环层，切换时交叉淡入淡出。底层播放器由平台层提供。 */
class LoopLayer {
  private audio: SoundHandle | null = null;
  private path = '';
  private revision = 0;
  private fading = false;
  private desiredVolume = 0;
  private readonly retiring = new Set<SoundHandle>();

  set(path: string, volume: number, active: boolean): void {
    const wanted = active ? path : '';
    this.desiredVolume = Math.max(0, Math.min(1, volume));
    if (wanted !== this.path) {
      const old = this.audio;
      const oldVolume = old?.volume ?? 0;
      this.revision++;
      const revision = this.revision;
      this.path = wanted;
      if (wanted.length === 0) {
        old?.dispose();
        this.retiring.forEach((audio) => audio.dispose());
        this.retiring.clear();
        this.audio = null;
        this.fading = false;
        return;
      }
      if (old !== null) this.retiring.add(old);
      const audio = platform().audio.create(wanted, true);
      audio.volume = 0;
      this.audio = audio;
      this.fading = true;
      void audio.play().catch(() => { /* A user gesture will retry playback. */ });
      let step = 0;
      const timer = setInterval(() => {
        if (revision !== this.revision) {
          clearInterval(timer);
          if (old !== null) { old.dispose(); this.retiring.delete(old); }
          return;
        }
        step++;
        audio.volume = this.desiredVolume * Math.min(1, step / 15);
        if (old !== null) old.volume = oldVolume * Math.max(0, 1 - step / 15);
        if (step >= 15) {
          clearInterval(timer);
          old?.dispose();
          if (old !== null) this.retiring.delete(old);
          this.fading = false;
        }
      }, 60);
      return;
    }
    if (this.audio !== null) {
      if (!this.fading) this.audio.volume = this.desiredVolume;
      if (active && this.audio.paused) void this.audio.play().catch(() => {});
    }
  }

  stop(): void {
    this.revision++;
    this.fading = false;
    this.audio?.dispose();
    this.retiring.forEach((audio) => audio.dispose());
    this.retiring.clear();
    this.audio = null;
    this.path = '';
  }
}

/**
 * 构建时由 scripts/build.mjs 注入实际存在的音频文件列表；缺少的文件直接静音，避免 404 和报错。
 * 在没有注入的环境（测试）中视为全部可用。
 */
declare const __AUDIO_FILES__: string[] | undefined;
const AVAILABLE: Set<string> | null = typeof __AUDIO_FILES__ !== 'undefined' ? new Set(__AUDIO_FILES__) : null;
function audioAvailable(path: string): boolean {
  return path.length > 0 && (AVAILABLE === null || AVAILABLE.has(path));
}

/**
 * 声音分层（0.3）：只有一首背景音乐 + 少量音效。
 * - 背景音乐：主页 / 游戏 / 冬季三选一；敌害来袭时只压低音量，不再切换成另一首曲子；
 * - 音效：界面、玩家动作、事件提示三类，同一时间最多播放 MAX_SHOTS 个；
 * - 不再播放环境声、天气声和蜜蜂自动行为的声音。
 */
export class BrowserAudioService {
  sfxOn = true;
  musicOn = true;
  vibrateOn = true;
  private foreground = false;
  private permitted = false;
  private musicPath = '';
  private duckUntil = 0;
  private musicVolume = 0.8;
  private effectsVolume = 0.75;
  private readonly music = new LoopLayer();
  private readonly shots = new Set<SoundHandle>();
  private readonly lastPlay = new Map<string, number>();
  private lastEventAt = 0;
  private released = false;

  unlock(): void {
    if (this.released) return;
    this.foreground = true;
    this.syncLayers();
  }

  play(name: string): void {
    if (this.released || !this.sfxOn || !this.foreground || !this.permitted) return;
    const cue = resolveCue(name);
    if (cue === null) return;
    const key = resolveKey(name);
    const file = cue.files[Math.floor(Math.random() * cue.files.length)];
    if (!audioAvailable(file)) return;
    const now = Date.now();
    const previous = this.lastPlay.get(key);
    if (previous !== undefined && now - previous < cue.cooldownMs) return;
    // 事件提示之间至少间隔 1.2 秒，避免换季、任务、成就同时响成一片
    if (cue.channel === 'event' && now - this.lastEventAt < 1200) return;
    if (this.shots.size >= MAX_SHOTS) return;
    this.lastPlay.set(key, now);
    if (cue.channel === 'event') {
      this.lastEventAt = now;
      // 事件提示响起时压低背景音乐
      this.duckUntil = now + 1800;
      this.syncLayers();
    }
    const audio = platform().audio.create(file, false);
    audio.volume = Math.max(0, Math.min(1, cue.volume * this.effectsVolume));
    this.shots.add(audio);
    const release = (): void => { this.shots.delete(audio); audio.dispose(); };
    audio.onFinish(release);
    void audio.play().catch(release);
  }

  /** weather === 'snow' 表示冬季，切换到冬季背景音乐；其余参数保留以兼容调用方 */
  setScene(screen: string, _region: string, _hive: boolean, weather: string): void {
    if (this.released) return;
    this.permitted = screen === 'home' || screen === 'game';
    let path = '';
    if (screen === 'home') path = BGM_TRACKS.home;
    else if (screen === 'game') path = weather === 'snow' ? BGM_TRACKS.winter : BGM_TRACKS.game;
    this.musicPath = audioAvailable(path) ? path : '';
    if (!this.permitted) this.stopShots();
    this.syncLayers();
  }

  /** ambient 参数已不再使用（环境声层已移除），保留签名兼容旧设置 */
  setVolumes(music: number, _ambient: number, effects: number): void {
    this.musicVolume = Math.max(0, Math.min(1, music));
    this.effectsVolume = Math.max(0, Math.min(1, effects));
    this.syncLayers();
  }

  setThreatLevel(_level: number): void { /* 敌害不再切换背景音乐 */ }
  setSfx(on: boolean): void { this.sfxOn = on; if (!on) this.stopShots(); this.syncLayers(); }
  setMusic(on: boolean): void { this.musicOn = on; this.syncLayers(); }
  resumeMusic(): void { if (!this.released) { this.foreground = true; this.syncLayers(); } }
  pauseMusic(): void { this.foreground = false; this.stopShots(); this.syncLayers(); }

  tick(): void {
    if (this.duckUntil > 0 && Date.now() >= this.duckUntil) {
      this.duckUntil = 0;
      this.syncLayers();
    }
  }

  vibrate(ms: number): void {
    if (!this.released && this.vibrateOn) platform().vibrate(ms);
  }

  private syncLayers(): void {
    if (this.released) return;
    const active = this.foreground && this.permitted;
    const duck = Date.now() < this.duckUntil ? 0.45 : 1;
    this.music.set(this.musicPath, 0.4 * this.musicVolume * duck, active && this.musicOn && this.musicPath.length > 0);
  }

  private stopShots(): void {
    this.shots.forEach((audio) => audio.dispose());
    this.shots.clear();
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.foreground = false;
    this.stopShots();
    this.music.stop();
  }
}
