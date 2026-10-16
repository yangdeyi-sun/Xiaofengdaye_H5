# HarmonyOS → H5 功能迁移对照

## 1. 对照范围

本文件说明 `xiaofengdaye` HarmonyOS 0.1 单机版到 `xiaofengdaye-h5` 的迁移关系。

“功能一致”指相同输入交给相同领域逻辑后，得到相同的资源、人口、建筑、季节、敌害、任务、研究、传承和分蜂结果。界面控件、文件系统、媒体播放和生命周期必须使用浏览器 API，因此实现方式不同。HarmonyOS 独有的系统集成单独列出，不用网页内的相似外观冒充系统能力。

本对照使用三种边界：

- **规则原样保留**：复用同一份领域或场景源码，不修改公式、数值、状态机、解锁条件和随机规则。
- **浏览器适配**：功能目的保留，但输入、界面、存储、音频或生命周期改由 Web API 完成。
- **平台不等价**：标准静态 H5 没有对应系统权限或账号能力，明确列为边界，不伪造成功状态。

相同 `SaveCodec` 只保证数据格式和迁移规则一致。HarmonyOS 存档位于应用私有目录，网页不能自行读取；本次没有增加存档导入导出，因此原设备上的既有存档不会自动进入 H5。

## 2. 防止逻辑漂移的做法

以下目录从原工程复制，文件内容保持一致，仅将 `.ets` 扩展名改为 `.ts`：

| 原工程 | H5 工程 | 内容 |
| --- | --- | --- |
| `entry/src/main/ets/common/` | `src/common/` | `BigNum`、随机数与校验和 |
| `entry/src/main/ets/domain/` | `src/domain/` | 配置、状态、经济、蜂群、蜂巢、地图、生产、季节、敌害、成长、存档、引导和引擎 |
| `entry/src/main/ets/scene/` | `src/scene/` | Canvas 场景、程序化回退绘制、图集清单与运行时 |
| `tools/sim/` | `src/sim/` | 69 项领域测试、四小时仿真和性能脚本 |
| `entry/src/main/ets/infrastructure/AudioCatalog.ets` | `src/infrastructure/AudioCatalog.ts` | 68 组声音事件、变体、音量、冷却和别名 |

其中 `common` 2 个、`domain` 14 个、`scene` 4 个，共 20 个核心文件。`npm run verify:core` 会逐字节比较这些文件与原 `.ets` 文件，发现文件增删或内容差异即失败。`npm test` 还会执行原 69 项领域测试和 15 项浏览器存档、时间与单写者适配检查。

浏览器界面和平台适配只能调用 `GameEngine` 已有命令，不在 UI 中复制经济公式或修改配置。以后同步原项目时，应整文件更新上述核心目录，并依次通过 `npm run verify:core`、`npm run check`、`npm test` 与 `npm run build`。

## 3. 单机玩法映射

| 原功能 | H5 落点 | 迁移状态与说明 |
| --- | --- | --- |
| 隐私确认、隐私政策、用户协议和玩法帮助 | `src/app/content.ts`、`src/app/BrowserUI.ts` 与 DOM 弹层 | 文案随 H5 存储说明调整；拒绝后不进入游戏。普通网页不能可靠关闭用户自行打开的标签页 |
| 首页、新游戏、继续游戏和启动错误 | `src/app/main.ts`、`src/app/BrowserUI.ts` 与 DOM/CSS 页面 | 浏览器界面重建；启动顺序仍为配置校验、读档、迁移和离线结算 |
| 花田/蜂巢主视图、资源顶栏、功能导航与响应式布局 | `src/app/BrowserUI.ts`、`styles.css` | ArkUI 改为 DOM/CSS；玩法入口、锁定条件和领域命令保持一致 |
| 固定步长模拟与游戏速度 | `src/domain/GameEngine.ts`、`src/app/GameSession.ts` | 领域逻辑原样保留；浏览器用 `requestAnimationFrame` 驱动，并限制单帧补算时长 |
| 花蜜、蜂蜜、蜂蜡、蜂王浆与大数 | `src/common/BigNum.ts`、`src/domain/World.ts` | 原样保留 |
| 手动采集、采集策略和资源分配 | `GameEngine.collect/setStrategy/setRatio` 与 H5 控件 | 原样调用领域命令 |
| 蜂后产卵、幼虫队列、孵化取消与工种分化 | `ColonyService` 与蜂后/蜂群面板 | 原样保留，包括费用、冷却、槽位和退款规则 |
| 自动产卵、自动孵化、生态模式与紧急补员 | `ColonyService`、存档设置与设置面板 | 原样保留 |
| 六边形蜂巢、建造、扩建、拆除、升级和相邻加成 | `HiveService`、蜂巢 Canvas 与建造面板 | 原样保留；Canvas 命中结果交给原领域命令校验 |
| 侦察蜂状态机、摇摆舞、花田发现、路线、授粉与花田成长 | `MapService`、花田 Canvas 与花田面板 | 原样保留 |
| 酿蜜、筑蜡、产能、容量和溢出缓冲 | `ProductionService`、资源面板 | 原样保留 |
| 新手季、春夏秋冬、冬储、饥饿和首冬保护 | `ProductionService`、`GameSession` 与生态面板 | 原样保留；页面后台暂停后由离线逻辑补算 |
| 蜂群衰败、消耗传承点重启和读取入冬前快照 | `GameSession`、生态面板与浏览器恢复点 | 恢复规则保留；入冬前恢复点改存浏览器本地存储 |
| 胡蜂、蜘蛛网、蜡螟、熊、守卫分配和事件选择 | `ThreatService` 与敌害面板 | 原样保留 |
| 主支线目标、四季蜂群任务、手动领奖 | `ProgressionService` 与任务面板 | 完成、封顶和领奖规则原样保留 |
| 花种/敌害图鉴、生态观察、成就和皮肤解锁 | `ProgressionService`、`src/app/content.ts` 与图鉴面板 | 领域进度原样保留；生态说明内容随 H5 页面展示 |
| 统计、分蜂历史、消息中心和重要通告 | 存档状态、`GameSession` 与记录/通告层 | 数据原样读取；DOM 重建展示与关闭交互 |
| 建筑升级、当前种区研究 | `HiveService`、`ProgressionService` 与升级/进化面板 | 原样保留 |
| 传承点、三系天赋、预设和重置 | `ProgressionService` 与进化面板 | 原样保留 |
| 分蜂预览、事务快照、五个种区与长期继承 | `GameEngine.swarm`、`ProgressionService` 与分蜂面板 | 原样保留；分蜂前仍先写快照 |
| 新事物介绍、顶部提示、聚焦引导与已读回看 | `Guide` 与 H5 引导/任务层 | 主题触发、目标定位和已读状态原样保留 |
| 花田/蜂巢实时场景、图集动画与程序化回退 | `SceneRenderer`、`Sprites`、`BrowserArt` | 场景代码原样保留；位图改为浏览器异步加载 |
| 拖动、缩放、选中花田/巢房 | H5 Pointer Events、Wheel 与 `SceneRenderer` 相机 | 手势层重写；只改变输入适配，不改变命令规则 |
| 音乐、音效、三类音量与振动设置 | 原设置状态与 `BrowserAudioService` | 设置值和声音事件保留；播放权限受浏览器策略限制 |
| 粒子、事件动画、减少动态效果、省电模式、速度和皮肤 | 原设置状态、`GameSession`、`SceneRenderer` 与 `Sprites` | 原设置含义保留；省电模式继续使用 30 帧策略和半尺寸图集 |
| 立即保存、清除游戏进度和删除全部数据 | `GameSession`、`BrowserSaveRepository` 与设置面板 | 保留确认流程；删除范围限定为 `xiaofengdaye.h5.*` 本地键 |

## 4. 存档与生命周期映射

| HarmonyOS 实现 | H5 实现 | 等价程度 |
| --- | --- | --- |
| 应用文件目录的 `save.json` | `localStorage` 的主存档键 | 相同 `SaveCodec`、版本号、校验和与迁移规则 |
| `save.bak` | `localStorage` 备份键 | 写新主档前保存上一主档 |
| 损坏存档副本 | 带时间戳的 `corrupt.*` 键 | 尽力保留；若浏览器存储已满，可能无法写入副本 |
| `save.tmp` 写入、`fsync`、备份、原子替换 | 先写 `temporary` 键并解码校验，再备份当前主档、写入主档、再次解码校验，成功后删除 `temporary` | 保留“先验证、再备份、再替换”的顺序；浏览器没有文件级 `fsync` 与原子重命名，因此保证弱于原生文件系统 |
| `save.winter.json` | `localStorage` 入冬恢复点键 | 保留蜂群崩溃恢复流程 |
| 每 30 秒及关键操作自动保存 | `GameSession` 自动保存 | 保留 |
| UIAbility 前后台回调 | `visibilitychange`、`pagehide` 等页面生命周期 | 后台前保存，回到前台只结算一次离线收益 |
| 设备时间回拨/大幅跳变检测 | `src/platform/TimeService.ts` | 保留回拨归零和超长离线封顶规则 |
| 清除进度、删除全部数据 | H5 设置面板与 `BrowserSaveRepository.wipe()` | 只删除 `xiaofengdaye.h5.*` 命名空间数据 |

网页存档绑定站点来源。更换协议、域名或端口会形成另一份存储；清除站点数据、使用无痕窗口、浏览器回收存储或站点达到配额，都可能让存档不可见或无法写入。H5 没有读取 HarmonyOS 应用私有存档的权限，也没有加入导入导出；这些都属于本次平台边界。

## 5. 美术、声音与设备反馈

| 原能力 | H5 映射 | 说明 |
| --- | --- | --- |
| HarmonyOS ImageSource / ImageBitmap | `fetch` + `createImageBitmap` | 保留完整和 `low/` 半尺寸图集及程序化绘制回退 |
| ArkUI Canvas | 浏览器 Canvas 2D | `SceneRenderer` 使用双方共有的绘图子集 |
| SoundPool 短音效 | `HTMLAudioElement` 一次性声部 | 保留声音键、随机变体、冷却与战斗限流 |
| AVPlayer 音乐/环境/天气三层 | 三个循环 `HTMLAudioElement` | 保留场景切换、分层音量和告警 Ducking；浏览器循环接缝需实机验证 |
| 音频焦点和应用前后台静音 | 用户手势解锁、页面可见性与 `pause()` | 浏览器禁止自动播放时，在第一次交互后启用声音 |
| HarmonyOS 振动服务 | `navigator.vibrate` | 支持时使用；iOS 与部分桌面浏览器不提供该能力 |

运行素材完整复制为：

- `public/art/v1/`：336 个美术与清单文件，包含低分辨率图集。
- `public/audio/v1/`：117 个运行声音文件。
- `public/media/`：143 个界面 SVG 图标。

15 个音乐、环境和天气长音轨使用 OGG Vorbis，102 个短音效使用 WAV。当前 H5 包没有添加替代音频编码；不支持 OGG 的浏览器会缺少长音轨，因此 Safari/iOS 必须列入目标设备实测。

## 6. 无法一比一迁移的 HarmonyOS 能力

### 6.1 服务卡片

HarmonyOS 版本使用 FormKit 与桌面服务卡片展示蜂蜜、蜂群、季节倒计时和告警，并可由系统刷新和深链回应用。

标准 H5 无权创建 HarmonyOS 桌面服务卡片。H5 会保留同一组状态数据用于页面内展示，但它不是桌面组件，也没有系统级定时刷新、卡片安装或 FormKit 深链。只有另行开发 PWA 小组件、原生壳或对应系统扩展，才可能提供接近的系统体验；这些不在本次转换范围内。

### 6.2 华为应用接续

HarmonyOS 版本可通过系统接续，把会话交给登录同一华为账号的另一台华为设备。纯静态 H5 没有该 API，也没有华为账号身份、可信云端或分布式数据同步权限，因此不能等价实现跨设备接续。

当前存档只存在当前浏览器的当前站点来源中，不自动上传、同步或跨设备迁移。继承存档结构中的 `continuation` 字段只用于格式兼容，不表示 H5 已提供接续能力。实现真正接续需要新增身份、后端存储、冲突合并、隐私与安全设计；本次没有擅自加入这些系统。

### 6.3 其他系统差异

- 浏览器可能暂停后台页面，后台期间不持续跑帧；回到前台后由原离线结算逻辑补算。
- 浏览器音频、振动、持久存储和全屏行为受用户设置及权限策略控制。
- 浏览器通常禁止首次用户操作前自动播放声音；H5 在用户交互后解锁音频。OGG 长音轨和 `navigator.vibrate` 仍需按目标设备实测。
- 普通网页不能可靠关闭用户自行打开的标签页；玩家拒绝隐私条款时，H5 阻止进入游戏并提示关闭页面。
- 当前工程是普通静态站点，没有 Service Worker、离线安装包、后台同步或 PWA 系统组件；断网后是否还能打开取决于浏览器缓存，不能作为离线保证。
- H5 不生成 HAP，不使用 AGC 签名、HarmonyOS 权限或应用市场服务。

## 7. 明确未新增的功能

原 HarmonyOS 工程的联机功能开关处于关闭状态，本次迁移保持原产品范围，没有添加或伪造以下功能：

- 共生花谷、蜂王竞速、排行榜或花潮在线事件；
- 实名认证、防沉迷联网校验或任何账号体系；
- 内购、支付（0.2.0 起已加入可选的激励视频广告，见 [ADS_AND_PLATFORMS.md](ADS_AND_PLATFORMS.md)）；
- 云存档、跨设备自动同步；
- 行为分析、遥测上传或第三方追踪。

浏览器日志只写入本机开发者控制台，游戏代码只把游戏数据写入本地站点存储。部署站点的 Web 服务器或托管平台仍可能按其自身规则记录基础 HTTP 访问日志，正式发布时应在站点隐私说明中如实披露。

## 8. 验收基线

迁移版本至少需要满足以下门槛：

1. `npm run verify:core` 确认 20 个核心文件与 HarmonyOS 原版逐字节一致。
2. `npm run check` 无 TypeScript 错误。
3. `npm test` 输出 `69 passed, 0 failed` 和 `15 browser adapter checks passed`。
4. `npm run sim` 完成原版四小时整局仿真，`npm run perf` 正常结束。
5. `npm run build` 成功生成完整 `dist/`，其中包含入口、脚本、样式、336 个美术/清单文件、117 个声音文件和 143 个界面图标。
6. 新游戏与原版前四小时关键里程碑仍由原配置和领域逻辑驱动。
7. 刷新、后台恢复、损坏主档回退、入冬快照、传承点恢复和两种清档流程可用。
8. 所有原单机一级入口都有可操作的 H5 界面，动作失败原因和锁定条件仍由原领域层决定。
9. 桌面与手机至少各完成一次花田/蜂巢点击、拖动、缩放、横竖屏、音频、后台恢复和长时间运行检查。
10. 服务卡片与华为账号接续明确显示为 H5 平台边界，页面不出现会误导玩家的可用开关或成功提示。
