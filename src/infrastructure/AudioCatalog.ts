/**
 * 音频目录（0.3 重新划分）。
 *
 * 原则：同一时刻只有“一首背景音乐 + 少量必要音效”，不再叠加环境声、天气声和自动行为音效。
 *
 * 四类声音：
 *   1. 背景音乐 bgm     —— 同时只播一首：主页 / 游戏中 / 冬季
 *   2. 界面 ui          —— 玩家点按钮的反馈：轻点、确认、错误、领奖
 *   3. 玩家动作 action  —— 只给玩家亲手做的事：采蜜、建造/扩建、升级/研究
 *   4. 事件提示 event   —— 需要玩家注意的少数时刻：换季、敌害来袭、击退、任务/成就、分蜂、离线归来
 *
 * 蜜蜂自动产卵、孵化、运蜜、酿蜜、战斗细节等“背景里一直在发生的事”不再出声。
 *
 * 文件放在 public/audio/v2/<类别>/ 下；缺少的文件会被自动跳过（静音），不会报错。
 * 需要制作的文件清单见 docs/AUDIO_PLAN.md。
 */
export type AudioChannel = 'ui' | 'action' | 'event';

export class AudioCue {
  files: string[];
  volume: number;
  cooldownMs: number;
  channel: AudioChannel;
  constructor(files: string[], volume: number, cooldownMs: number, channel: AudioChannel) {
    this.files = files; this.volume = volume; this.cooldownMs = cooldownMs; this.channel = channel;
  }
}

const V = 'audio/v2';

/** 背景音乐：同一时刻只播一首 */
export const BGM_TRACKS = {
  home: `${V}/bgm/bgm_home.mp3`,
  game: `${V}/bgm/bgm_game.mp3`,
  winter: `${V}/bgm/bgm_winter.mp3`
};

export const AUDIO_CUES: Record<string, AudioCue> = {
  // 界面
  ui_tap: new AudioCue([`${V}/ui/ui_tap.mp3`], 0.45, 80, 'ui'),
  ui_confirm: new AudioCue([`${V}/ui/ui_confirm.mp3`], 0.55, 120, 'ui'),
  ui_error: new AudioCue([`${V}/ui/ui_error.mp3`], 0.55, 300, 'ui'),
  ui_reward: new AudioCue([`${V}/ui/ui_reward.mp3`], 0.7, 300, 'ui'),
  // 玩家动作
  act_collect: new AudioCue([`${V}/action/act_collect.mp3`], 0.4, 160, 'action'),
  act_build: new AudioCue([`${V}/action/act_build.mp3`], 0.65, 400, 'action'),
  act_upgrade: new AudioCue([`${V}/action/act_upgrade.mp3`], 0.6, 300, 'action'),
  // 事件提示
  evt_season: new AudioCue([`${V}/event/evt_season.mp3`], 0.6, 3000, 'event'),
  evt_threat: new AudioCue([`${V}/event/evt_threat.mp3`], 0.7, 4000, 'event'),
  evt_victory: new AudioCue([`${V}/event/evt_victory.mp3`], 0.6, 2000, 'event'),
  evt_achieve: new AudioCue([`${V}/event/evt_achieve.mp3`], 0.65, 1500, 'event'),
  evt_swarm: new AudioCue([`${V}/event/evt_swarm.mp3`], 0.7, 5000, 'event'),
  evt_offline: new AudioCue([`${V}/event/evt_offline.mp3`], 0.6, 5000, 'event')
};

/**
 * 旧声音名 → 新分类。值为空字符串表示该行为不再出声。
 * 游戏代码和场景里仍然用旧名字调用，这里统一转换，未列出的名字一律静音。
 */
export const AUDIO_ALIASES: Record<string, string> = {
  // 界面
  tap: 'ui_tap', ui_tap_soft: 'ui_tap', ui_tab: 'ui_tap', ui_select: 'ui_tap', ui_open_panel: 'ui_tap',
  ui_close_panel: '', ui_toggle: 'ui_tap', ui_toggle_on: 'ui_tap', ui_toggle_off: 'ui_tap', ui_cancel: 'ui_tap',
  ui_save_ok: 'ui_confirm', ui_delete_warning: 'ui_error', ui_claim_reward: 'ui_reward',
  egg: 'ui_confirm',
  // 玩家动作
  collect: 'act_collect', collect_flower: 'act_collect',
  build: 'act_build', build_room: 'act_build', expand: 'act_build', expand_hex: 'act_build', build_room_finish: '',
  upgrade: 'act_upgrade', upgrade_normal: 'act_upgrade', upgrade_key: 'act_upgrade', research_complete: 'act_upgrade',
  talent_invest: 'act_upgrade', talent_keystone: 'act_upgrade',
  // 事件提示
  season: 'evt_season', season_spring: 'evt_season', season_summer: 'evt_season', season_autumn: 'evt_season',
  season_winter: 'evt_season', season_winter_warning: 'evt_season', spring: 'evt_season', winter_survived: 'evt_season',
  alert: 'evt_threat', alert_wasp: 'evt_threat', alert_web: 'evt_threat', alert_moth: 'evt_threat', alert_bear: 'evt_threat',
  victory: 'evt_victory', victory_wasp: 'evt_victory', victory_web: 'evt_victory', victory_moth: 'evt_victory',
  victory_bear: 'evt_victory',
  task: 'evt_achieve', task_complete: 'evt_achieve', milestone: 'evt_achieve', automation_milestone: 'evt_achieve',
  achievement_unlock: 'evt_achieve',
  swarm: 'evt_swarm', swarm_depart: 'evt_swarm', swarm_arrive: '',
  offline_return: 'evt_offline'
  // 其余（产卵、孵化、运蜜、酿蜜、筑蜡、摇摆舞、发现花田、战斗细节、溢出提醒等）不出声
};

/** 把调用名解析成新目录里的音效；返回 null 表示静音 */
export function resolveCue(name: string): AudioCue | null {
  const direct = AUDIO_CUES[name];
  if (direct !== undefined) return direct;
  const alias = AUDIO_ALIASES[name];
  if (alias === undefined || alias.length === 0) return null;
  return AUDIO_CUES[alias] ?? null;
}

/** 与 resolveCue 对应的标准名（用于冷却计时） */
export function resolveKey(name: string): string {
  return AUDIO_CUES[name] !== undefined ? name : (AUDIO_ALIASES[name] ?? '');
}
