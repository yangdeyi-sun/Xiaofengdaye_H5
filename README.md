# 小峰大业 H5

《小峰大业》的独立静态 H5 版本。工程从同级目录 `../xiaofengdaye` 的 HarmonyOS 0.1 单机版迁移而来，全部新文件位于本目录，原 HarmonyOS 工程保持不变。

迁移遵循一个原则：游戏规则继续使用原实现，只有界面和平台接入改为浏览器实现。`src/common`、`src/domain`、`src/scene` 的 20 个核心文件与原 `.ets` 文件逐字节一致，仅将扩展名改为 `.ts`；数值配置、经济公式、状态机、存档结构和 Canvas 场景逻辑没有重新编写。浏览器差异集中在 `src/app`、`src/platform`、`index.html` 与 `styles.css`。

功能迁移明细及平台边界见 [docs/MIGRATION_PARITY.md](docs/MIGRATION_PARITY.md)。

0.2.0 起加入平台抽象层与可选激励视频广告，为上架抖音 / TapTap 小游戏做准备，详见 [docs/ADS_AND_PLATFORMS.md](docs/ADS_AND_PLATFORMS.md)。

0.3.0 修复新手节奏、换季弹窗图片、蜂巢图标被遮挡、侧边栏跳回顶部等问题，并重新划分音频，详见 [docs/CHANGELOG_0.3.md](docs/CHANGELOG_0.3.md)；音频制作清单见 [docs/AUDIO_PLAN.md](docs/AUDIO_PLAN.md)。

## 环境要求

- Node.js 18 或更高版本
- npm
- 支持 ES Module、Canvas 2D、WebP、`createImageBitmap`、`localStorage` 和 HTML Audio 的现代浏览器

推荐使用最新版 Chrome、Edge 或 Firefox。Safari 和 iOS 浏览器需要重点验证 OGG Vorbis 长音轨和振动能力；这些能力是否可用由浏览器与设备决定。

## 安装

在 PowerShell 中运行：

```powershell
cd D:\xiaofengdaye\xiaofengdaye-h5
npm ci
```

`npm ci` 会按 `package-lock.json` 安装确定版本；需要更新依赖锁文件时才使用 `npm install`。工程没有运行时第三方依赖，`typescript` 用于严格类型检查，`esbuild` 用于构建应用、领域测试和仿真工具。

## 本地运行

```powershell
npm run dev
```

命令会先重新构建，再启动本地静态服务器。默认地址：

```text
http://127.0.0.1:4173
```

如需修改端口：

```powershell
$env:PORT=8080
npm run dev
```

请通过 HTTP 地址访问。不要直接双击 `index.html` 或使用 `file://` 打开，因为浏览器可能阻止美术和音频资源加载。

开发服务器不会热更新。修改源码后需要停止并重新运行 `npm run dev`，或者另开终端执行 `npm run build` 后刷新页面。

## 检查、测试与构建

```powershell
npm run verify:core
npm run check
npm test
npm run sim
npm run perf
npm run build
```

| 命令 | 作用 | 成功基线 |
| --- | --- | --- |
| `npm run verify:core` | 逐字节比较 H5 与 HarmonyOS 的 `common/domain/scene` 核心源码 | 输出“核心源码一致” |
| `npm run check` | 以严格模式检查全部 H5 TypeScript | 无类型错误 |
| `npm test` | 先执行从原工程原样复制的领域测试，再检查存档、时间、单写者、广告服务与广告奖励 | `70 passed, 0 failed`，随后 `34 browser adapter checks passed` |
| `npm run sim` | 运行原版四小时整局仿真 | 完成节奏与不变量检查 |
| `npm run perf` | 运行原版 10000 只逻辑蜜蜂性能脚本 | 脚本正常结束 |
| `npm run build` | 清空并重新生成生产目录 `dist/` | 生成入口、脚本、样式和素材，并打印包体大小 |
| `npm run build:release` | 压缩代码、不带 sourcemap 的发布构建 | 同上 |
| `npm run audio` | 把 `public/audio` 的 WAV/OGG 母带转成 MP3（需 ffmpeg） | 输出转码数量 |

`sim` 与 `perf` 是补充验证，不替代浏览器交互验收。改动任何核心规则、配置或存档代码后，至少应依次运行 `verify:core`、`check`、`test` 和 `build`。

建议在交付前再做一轮浏览器人工验证：

1. 首次隐私确认、首页、新游戏、继续游戏、手动保存、自动保存、刷新恢复和清除数据。
2. 手动采集、采集策略、产卵、培养取消、四类工蜂分配、自动产卵、自动培养和生态模式。
3. 六边形蜂巢的建造、扩建、拆除、巢房升级、属性升级、相邻加成与锁定条件。
4. 侦察状态机、摇摆舞、花田分配、采集路线、授粉成长、四季、越冬与蜂群衰败恢复。
5. 胡蜂、蜘蛛网、蜡螟、熊、守卫优先区域，以及熊事件的防守、交付蜂蜜和稍后处理。
6. 主支线任务、四季蜂群任务、生态观察、花种/敌害图鉴、成就、统计、消息和引导回看。
7. 当前种区研究、三系传承天赋、预设、重置、分蜂预览、五个种区和永久继承内容。
8. 花田与蜂巢 Canvas 的点击、拖动、缩放、选中，以及桌面和手机横竖屏布局。
9. 音乐、环境声、天气声、短音效、分层音量、振动、粒子、事件动画、减少动态效果、省电模式、游戏速度和皮肤。
10. 页面切到后台再返回时只结算一次离线收益；主档损坏时回退备份；蜂群衰败时可读入冬前恢复点。

## 生产部署

`npm run build` 后，将 `dist/` 的内容部署到任意静态 Web 服务。生产环境建议使用 HTTPS，以获得一致的移动浏览器媒体与设备 API 行为。

资源路径为相对路径，可以部署在站点根目录或子目录。每次发布必须连同 `dist/art`、`dist/audio` 和 `dist/media` 一起上传，不能只替换 `app.js`。

## 目录结构

```text
xiaofengdaye-h5/
├─ index.html                 HTML 入口
├─ styles.css                响应式界面样式
├─ package.json              开发命令与两项开发依赖
├─ scripts/
│  ├─ build.mjs              esbuild 构建与静态资源复制
│  ├─ dev.mjs                构建后启动本地 HTTP 服务
│  ├─ test.mjs               构建并运行领域测试
│  ├─ test-platform.mjs      构建并运行浏览器适配检查
│  ├─ run-sim.mjs            构建并运行原版仿真/性能入口
│  └─ verify-core-parity.mjs 逐字节检查核心源码一致性
├─ src/
│  ├─ common/                大数、随机数与校验和；原逻辑直拷
│  ├─ domain/                完整游戏领域层；原逻辑直拷
│  ├─ scene/                 Canvas 场景与图集运行时；原逻辑直拷
│  ├─ app/                   浏览器会话、页面入口、法律文案与交互界面
│  ├─ platform/              浏览器存档、音频、美术和时间适配
│  ├─ infrastructure/        原音频事件目录
│  └─ sim/                   原 69 项测试、整局仿真与性能脚本
├─ public/
│  ├─ art/v1/                完整及低分辨率 WebP 美术
│  ├─ audio/v1/              117 个运行声音文件
│  └─ media/                 界面 SVG 图标
├─ docs/
│  └─ MIGRATION_PARITY.md    功能迁移对照与平台边界
└─ dist/                     可部署构建产物，可随时由源码重新生成
```

## 本地数据与浏览器限制

存档保存在当前站点来源的 `localStorage` 中，并保留主档、备份、损坏副本和入冬前恢复点。清除浏览器站点数据、使用无痕模式，或者更换协议、域名或端口，都可能让原存档不可见或被删除。当前版本没有账号、服务器、导入导出或跨设备云存档。

H5 继续使用原 `SaveCodec`，表示存档数据结构与校验/迁移规则一致，不表示网页能直接读取 HarmonyOS 应用私有目录。既有 HarmonyOS 存档不会自动出现在浏览器中。

浏览器通常会在第一次用户操作前阻止声音播放，游戏会在首次交互后启用音频。`navigator.vibrate` 在 iOS 和部分桌面浏览器不可用，无法振动时不影响游戏规则。运行时音频统一使用 MP3，放在 `public/audio/v2/`（见 docs/AUDIO_PLAN.md）；缺少的文件会被静音跳过。WAV/OGG 母带不会进入构建产物。

## H5 平台边界

H5 版保留单机经营与长期成长玩法，但静态网页无法等价提供 HarmonyOS 系统级服务卡片和华为账号接续：

- 状态摘要可在游戏页面内展示，不能作为 HarmonyOS 桌面服务卡片安装、由系统定时刷新或通过 FormKit 深链回应用。
- 存档只保存在当前浏览器，不能调用华为应用接续，也不会通过华为账号在手机、平板或折叠屏之间迁移。
- 振动、后台运行、音频焦点和存储持久性受浏览器限制。
- 普通网页不能可靠关闭并非由脚本打开的标签页；拒绝隐私条款时会阻止进入游戏，由用户自行关闭页面。

0.1 迁移严格保持原单机范围。0.2.0 新增了可选的激励视频广告（H5 中为测试广告），以及“花潮加速”等广告奖励，原设置中的免费 1×/2×/4× 游戏速度已取消；仍然没有联机、排行榜、内购、账号、云存档或游戏数据上传功能。
