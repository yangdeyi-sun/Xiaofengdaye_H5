import { AUDIO_ALIASES, AUDIO_CUES } from '../infrastructure/AudioCatalog';

class LoopLayer {
  private audio: HTMLAudioElement | null = null;
  private path = '';
  private revision = 0;
  private fading = false;
  private desiredVolume = 0;
  private readonly retiring = new Set<HTMLAudioElement>();

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
        old?.pause();
        this.retiring.forEach((audio) => audio.pause());
        this.retiring.clear();
        this.audio = null;
        this.fading = false;
        return;
      }
      if (old !== null) this.retiring.add(old);
      const audio = new Audio(`./${wanted}`);
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = 0;
      this.audio = audio;
      this.fading = true;
      void audio.play().catch(() => { /* A user gesture will retry playback. */ });
      let step = 0;
      const timer = window.setInterval(() => {
        if (revision !== this.revision) {
          window.clearInterval(timer);
          if (old !== null) { old.pause(); this.retiring.delete(old); }
          return;
        }
        step++;
        audio.volume = this.desiredVolume * Math.min(1, step / 15);
        if (old !== null) old.volume = oldVolume * Math.max(0, 1 - step / 15);
        if (step >= 15) {
          window.clearInterval(timer);
          old?.pause();
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
    this.audio?.pause();
    this.retiring.forEach((audio) => audio.pause());
    this.retiring.clear();
    this.audio = null;
    this.path = '';
  }
}

export class BrowserAudioService {
  sfxOn = true;
  musicOn = true;
  vibrateOn = true;
  private foreground = false;
  private permitted = false;
  private musicPath = '';
  private normalMusicPath = '';
  private ambiencePath = '';
  private weatherPath = '';
  private threatLevel = 0;
  private duckUntil = 0;
  private musicVolume = 0.8;
  private ambientVolume = 0.65;
  private effectsVolume = 0.75;
  private readonly music = new LoopLayer();
  private readonly ambience = new LoopLayer();
  private readonly weather = new LoopLayer();
  private readonly shots = new Set<HTMLAudioElement>();
  private readonly lastPlay = new Map<string, number>();
  private readonly lastVariant = new Map<string, number>();
  private lastCombatPlay = 0;
  private released = false;

  unlock(): void {
    if (this.released) return;
    this.foreground = true;
    this.syncLayers();
  }

  play(name: string): void {
    if (this.released || !this.sfxOn || !this.foreground || !this.permitted) return;
    const key = AUDIO_ALIASES[name] ?? name;
    const cue = AUDIO_CUES[key];
    if (cue === undefined) return;
    const now = Date.now();
    if (key.startsWith('alert_')) {
      this.duckUntil = now + 2200;
      this.syncLayers();
    }
    const combat = ['guard_attack', 'bee_hurt', 'wasp_attack', 'web_trap', 'web_clear', 'moth_chew_loop', 'bear_step', 'bear_swipe'].includes(key);
    if (combat && now - this.lastCombatPlay < 450) return;
    const highFrequency = ['collect_flower', 'queen_lay_egg', 'hatch_shell', 'forager_pickup', 'forager_deliver'].includes(key);
    const cooldown = highFrequency ? Math.max(180, cue.cooldownMs) : cue.cooldownMs;
    const previous = this.lastPlay.get(key);
    if (previous !== undefined && now - previous < cooldown) return;
    let variant = Math.floor(Math.random() * cue.files.length);
    if (cue.files.length > 1 && variant === this.lastVariant.get(key)) variant = (variant + 1) % cue.files.length;
    this.lastPlay.set(key, now);
    this.lastVariant.set(key, variant);
    if (combat) this.lastCombatPlay = now;
    const audio = new Audio(`./${cue.files[variant]}`);
    audio.volume = Math.max(0, Math.min(1, cue.volume * this.effectsVolume));
    this.shots.add(audio);
    const release = (): void => { this.shots.delete(audio); };
    audio.addEventListener('ended', release, { once: true });
    audio.addEventListener('error', release, { once: true });
    void audio.play().catch(release);
  }

  setScene(screen: string, region: string, hive: boolean, weather: string): void {
    if (this.released) return;
    this.permitted = screen === 'home' || screen === 'game';
    const safeRegion = ['meadow', 'alpine', 'rainy', 'drought', 'rooftop'].includes(region) ? region : 'meadow';
    this.normalMusicPath = `audio/v1/music/bgm_${screen === 'home' ? 'home' : safeRegion}.ogg`;
    this.musicPath = screen === 'game' && this.threatLevel > 0
      ? `audio/v1/music/bgm_${safeRegion === 'drought' ? 'alpine' : 'drought'}.ogg`
      : this.normalMusicPath;
    const ambience = hive || screen === 'home' ? 'hive' : (safeRegion === 'rainy' ? 'wetland' : safeRegion);
    this.ambiencePath = `audio/v1/ambience/amb_${ambience}.ogg`;
    this.weatherPath = screen === 'game' && !hive && ['rain', 'snow', 'autumn'].includes(weather)
      ? `audio/v1/weather/weather_${weather}.ogg` : '';
    if (!this.permitted) this.stopShots();
    this.syncLayers();
  }

  setVolumes(music: number, ambient: number, effects: number): void {
    this.musicVolume = Math.max(0, Math.min(1, music));
    this.ambientVolume = Math.max(0, Math.min(1, ambient));
    this.effectsVolume = Math.max(0, Math.min(1, effects));
    this.syncLayers();
  }

  setThreatLevel(level: number): void { this.threatLevel = Math.max(0, Math.floor(level)); }
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
    if (!this.released && this.vibrateOn && 'vibrate' in navigator) navigator.vibrate(ms);
  }

  private syncLayers(): void {
    if (this.released) return;
    const active = this.foreground && this.permitted;
    const duck = Date.now() < this.duckUntil ? 0.42 : 1;
    this.music.set(this.musicPath, 0.4 * this.musicVolume * duck, active && this.musicOn);
    this.ambience.set(this.ambiencePath, 0.28 * this.ambientVolume * duck, active && this.sfxOn);
    this.weather.set(this.weatherPath, 0.24 * this.ambientVolume * duck, active && this.sfxOn && this.weatherPath.length > 0);
  }

  private stopShots(): void {
    this.shots.forEach((audio) => { audio.pause(); audio.currentTime = 0; });
    this.shots.clear();
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.foreground = false;
    this.stopShots();
    this.music.stop();
    this.ambience.stop();
    this.weather.stop();
  }
}
