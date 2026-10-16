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

官方参考见 [发布说明](RELEASE.md)。
