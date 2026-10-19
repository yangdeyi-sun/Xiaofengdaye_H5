/**
 * 平台抽象层。
 *
 * 游戏规则（domain/）与场景绘制（scene/）不直接调用任何浏览器或小游戏 API，
 * 所有与运行环境有关的能力都经过这里。H5 使用 WebPlatform，抖音 / TapTap 小游戏使用 MiniGamePlatform。
 * 新平台只需实现 Platform 接口，再在入口处调用 setPlatform()。
 */

/** 同步键值存储（浏览器 localStorage / 小游戏 setStorageSync） */
export interface KeyValueStore {
  /** 存储是否可用（隐私模式、权限拒绝时为 false） */
  probe(): boolean;
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

/** 单个声音实例（HTMLAudioElement / InnerAudioContext 的最小公共子集） */
export interface SoundHandle {
  volume: number;
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
  /** 停止并回到开头 */
  stop(): void;
  /** 播放结束或出错时回调一次 */
  onFinish(callback: () => void): void;
  /** 释放底层资源；小游戏的音频实例数量有限，用完必须释放 */
  dispose(): void;
}

export interface AudioBackend {
  create(path: string, loop: boolean): SoundHandle;
}

/** 可被 CanvasRenderingContext2D.drawImage 绘制的位图 */
export type DrawableImage = ImageBitmap;

export interface ImageLoader {
  load(path: string): Promise<DrawableImage>;
}

export type RewardedStatus = 'completed' | 'skipped' | 'unavailable';

export interface RewardedResult {
  status: RewardedStatus;
  /** 平台返回的说明，仅用于日志 */
  detail: string;
}

export interface AdBackend {
  /** 激励视频：只有 status === 'completed' 时才能发奖励 */
  showRewarded(placement: string): Promise<RewardedResult>;
  /** 插屏广告：返回是否真正展示 */
  showInterstitial(placement: string): Promise<boolean>;
}

/** 系统剪贴板：用于复制 / 粘贴存档码 */
export interface ClipboardBackend {
  write(text: string): Promise<boolean>;
  /** 读取失败（无权限、平台不支持）返回 null，界面会改用输入框 */
  read(): Promise<string | null>;
}

/**
 * 系统键盘输入（可选）。抖音小游戏是 Canvas 界面，没有原生输入框，需要用 tt.showKeyboard 弹出系统键盘；
 * 网页和安卓直接用页面里的输入框，不需要实现。
 */
export interface TextInputBackend {
  /** 弹出键盘，initial 为默认文字；玩家确认返回输入内容，取消返回 null */
  prompt(initial: string, maxLength: number): Promise<string | null>;
}

/**
 * 云存档后端（可选）。需要服务端或抖音云配合（登录换取玩家身份、按玩家保存一份存档）；
 * 未配置时游戏只提供本机存档 + 存档码，不会假装已经云同步。
 */
export interface CloudSaveBackend {
  /** 界面显示的名称，如“抖音云存档” */
  readonly label: string;
  upload(saveText: string): Promise<{ ok: boolean; message: string }>;
  download(): Promise<{ ok: boolean; message: string; saveText: string; savedAt: number }>;
}

export interface Platform {
  /** 'web' | 'douyin' | 'taptap' … */
  readonly name: string;
  readonly storage: KeyValueStore;
  readonly audio: AudioBackend;
  readonly images: ImageLoader;
  readonly ads: AdBackend;
  vibrate(ms: number): void;
  readonly clipboard?: ClipboardBackend;
  readonly cloud?: CloudSaveBackend;
  /** 系统键盘（Canvas 界面的平台需要） */
  readonly textInput?: TextInputBackend;
  /** 尝试固定屏幕方向；原生壳保证可用，普通浏览器受系统权限限制时返回 false。 */
  setOrientation?(orientation: 'auto' | 'landscape' | 'portrait'): Promise<boolean>;
  /** 单调时钟（毫秒） */
  perfNow(): number;
  requestFrame(callback: (now: number) => void): number;
  cancelFrame(handle: number): void;
  /** 游戏切到后台 / 回到前台 */
  onHide(callback: () => void): void;
  onShow(callback: () => void): void;
}

let current: Platform | null = null;

export function setPlatform(platform: Platform): void {
  current = platform;
}

export function platform(): Platform {
  if (current === null) throw new Error('平台尚未初始化：请先在入口调用 setPlatform()');
  return current;
}

export function hasPlatform(): boolean {
  return current !== null;
}
