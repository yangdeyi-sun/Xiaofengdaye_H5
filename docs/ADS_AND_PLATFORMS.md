# 平台与广告

当前只维护抖音小游戏、TapTap Android APK，共用游戏内核；浏览器提供开发预览。

## 抖音

- 独立入口：`src/app/minigame/douyin.ts`，通过 `tt.createCanvas`、触摸事件和 `MiniGamePlatform` 接入。
- 画面与菜单不使用 DOM，已有美术转换为 PNG，低尺寸图集在包内。
- 存档使用 `tt.getStorageSync/setStorageSync`，声音使用 `createInnerAudioContext`，图片使用 `createImage`。
- `release.config.json` 的 `douyinRewardedAdUnitId` 与 `douyinInterstitialAdUnitId` 注入发布包。
- 没填广告 ID、SDK 报错、未完整观看都不会产生奖励。开发工具预览不能替代平台真机测试。

## Android

`android/` 内置 H5 资源，以 `https://appassets.androidplatform.net/assets/index.html` 加载。禁止任意外部导航、文件访问和明文流量，当前不申请网络权限。存档位于应用 WebView 的本地存储，应用退出保存并释放写入租约；崩溃重启可以接管本进程遗留的租约。

当前不包含第三方广告 SDK。`NativeBridgeAds.ts` 保留接入协议，接入真实广告后必须同时更新原生依赖、网络权限、隐私披露和真机验证。原生层回调 `window.__xfAdCallback(requestId, status)`；只有 `completed` 才能发奖。

## 开发与正式行为

- 普通 `npm run build` 可保留开发占位流程，`?ads=mock` 可验证倒计时。
- `build:release`、Android 和抖音构建禁用占位自动奖励；发布构建不能通过 URL 参数重新开启模拟广告。
- 广告统一由 `AdService` 管理每日次数、冷却、并发和加速记录。
- 看广告时暂停经营与声音，完整回调后才发奖，中途关闭保留此前真实完成的部分。
- 基础经营不依赖广告。

## 激励视频点位

| 点位 | id | 何时出现 | 奖励 | 每日上限 |
|---|---|---|---|---|
| 离线收益翻倍 | `offline_double` | 回来时的收益报告 | 离线收益再给一份 | 4 |
| 花潮加速 | `flower_boost` | 顶部“加速” | 2× / 4× 10 分钟 | 8 |
| 邻巢援军 | `bear_aid` | 熊来袭 | 熊直接离开 | 3 |
| 紧急补给 | `winter_supply` | 入冬前蜂蜜不够 | 蜂蜜容量 30% | 2 |
| 蜂群重振 | `colony_revive` | 蜂群衰败 | 免费重启 | 1 |
| 分蜂加成 | `swarm_bonus` | 分蜂完成 | 传承点 +50% | 3 |
| 春季补给 | `spring_supply` | 熬过冬天后的春季，每轮四季一次（画面上方的绿色提示） | 蜂蜜容量 25%（至少 100） | 3 |
| 补齐差额 | `honey_topup` | 升级或建造只差蜂蜜、差额不超过所需的 40% | 补上差额并立即升级 / 进入放置 | 6（冷却 60 秒） |

广告位 ID 填在 `src/platform/minigame/adUnits.ts`，没单独填的点位用 `release.config.json` 里的默认激励视频广告位。

## 剪贴板与云存档

- 存档码（设置 → 存档备份）：抖音用 `tt.setClipboardData / tt.getClipboardData`，网页和安卓用系统剪贴板；读不到剪贴板时网页端提供粘贴框。存档码自带校验，导入前会自动保留一份当前进度，可以撤销。
- 云存档：`Platform.cloud`（`CloudSaveBackend`）是预留接口。需要先开通抖音云或自建服务（用 `tt.login` 换取玩家身份，按玩家保存一份存档），在 `douyin.ts` 创建 `MiniGamePlatform` 时传入 `cloud`，设置页才会出现“上传 / 下载”。不要用排行榜用的 `setUserCloudStorage` 存档：容量太小，而且好友可以读取。

官方参考见 [发布说明](RELEASE.md)。
