# 抖音小游戏与 TapTap Android 发布

本工程不再维护鸿蒙发布目标。当前两端共用内核，分别构建可导入抖音开发者工具的小游戏目录和可安装的 Android APK。

## 当前可交付内容

| 目标 | 命令 | 产物 | 本机验证范围 |
| --- | --- | --- | --- |
| 抖音开发工具包 | `npm run build:douyin` | `dist-douyin/` | 无 DOM 启动、触摸繁育、前后台保存、包内格式、包体大小 |
| Android 试玩 APK | `npm run build:android` | `android/app/build/outputs/apk/debug/app-debug.apk` | APK 编译与开发签名；界面通过浏览器验证 |
| 抖音提交包 | `npm run build:douyin:release` | `dist-douyin/` | 先校验真实发布资料 |
| Android 提交 APK | `npm run build:android:release` | `android/app/build/outputs/apk/release/app-release.apk` | 先校验发布资料及外部签名配置 |

当前没有连接 Android 真机或抖音开发工具，不能把自动化和浏览器验证等同于平台真机验收，也尚未向平台提交审核。

## 填写发布资料

修改根目录 `release.config.json`：

- `publisher`：真实发布主体名称，展示在游戏隐私说明中。
- `supportEmail`：可以接收玩家反馈的真实邮箱。
- `applicationId`：最终 Android 包名，首次发布前确定，之后更新保持不变。
- `version` / `versionCode`：显示版本与递增的 Android 版本号。
- `douyinAppId`：自己在抖音开发者后台创建的小游戏 AppID。
- `douyinRewardedAdUnitId` / `douyinInterstitialAdUnitId`：可选；不填时不展示真实广告，也不发放观看奖励。

运行 `npm run release:check` 可一次看到两端缺少的信息。后台账号资料、商店文案、截图以及后台要求的其他材料，需要在开发者后台完成；此命令不代表已通过平台审核。

## 抖音

1. 在抖音开发者平台创建小游戏，获得 AppID，填入配置。
2. 构建 `dist-douyin/`，用官方开发者工具导入该目录。
3. 在模拟器和真机验证首次同意、采集、酿蜜、手动孵化/分化、建造、恢复倒计时、前后台存档、重新打开和完整发展流程。
4. 接广告时用真实广告位验证完整观看、中途关闭、无填充和异常，不以本地模拟结果代替。
5. 使用开发者工具上传版本，再在后台按账号当前要求提交测试/审核。

当前使用非分包方式，构建器按20 MB总包限制检查。为兼容平台文件列表，原有 WebP 资产仅在小游戏构建中转换为 PNG，图集尺寸和裁切坐标保持一致；浏览器和 Android 继续使用原 WebP。

官方资料：[开发指南及运行环境、包结构、体积与格式限制](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/dev-guide/bytedance-mini-game)。

## TapTap Android

Android 固定使用网页的 `BrowserUI`、`styles.css` 和原有面板/交互布局。构建后直接读取 APK 校验这三个入口文件与网页一致，小游戏 Canvas 预览不会被打包。

1. 安装 Android SDK 与 JDK，打开 `android/` 或运行构建命令。
2. 先安装 debug APK 检查离线游玩、声音开关、锁屏/后台、退出保存、强制停止后重新打开、升级保留存档及不同屏幕的安全区域。
3. 正式版使用自己长期保管的发布密钥，通过 `XF_KEYSTORE_PATH`、`XF_KEYSTORE_PASSWORD`、`XF_KEY_ALIAS`、`XF_KEY_PASSWORD` 环境变量提供。
4. 运行正式构建；用 Android SDK 的 `apksigner verify` 检查签名，把 release APK 上传到自己 TapTap 游戏后台。
5. 商店里的包名与 APK 包名保持一致；后续更新沿用原签名并递增 `versionCode`。

debug 包带 `.debug` 包名后缀，数据与正式版分别存储。测试 APK 不能作为正式签名的替代品。未配置正式密钥时不会冒用开发签名生成商店版。

当前 Android 版没有第三方广告 SDK、账号或云存档，也不需要联网加载游戏资源。需要广告变现时另行接入 SDK 并验证，已有桥接协议在 `src/platform/web/NativeBridgeAds.ts`。

官方资料：[TapTap 创建和管理游戏](https://developer.taptap.cn/docs/store/release/publish/create-game/)、[Android 官方本地 WebView 内容加载方式](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)。
