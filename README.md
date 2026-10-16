# 小峰大业

蜜蜂主题单机经营游戏，当前发布目标：**抖音小游戏**与 **TapTap Android APK**。浏览器版用于开发与试玩。不再构建鸿蒙版本，也不要求与另一套源码一致。

游戏规则、资源经济、新手引导与存档由同一份 TypeScript 内核维护。前期按“改善酿蜜 → 补足采集 → 扩充花源”推进，孵化和分化由玩家主动决定。

## 开发与验证

需要 Node.js 18+、npm；抖音素材转换另需 Python 3 与 Pillow（`python -m pip install Pillow`）。

```powershell
npm ci
npm run dev
```

浏览器和 Android 使用同一套网页布局：`http://127.0.0.1:4173/`。开发服务器不热更新，改动后运行构建并刷新。

只有显式运行 `npm run dev:douyin` 时，才额外提供 `/canvas-preview.html` 作为抖音 Canvas 开发预览；该页面不会进入 Android 安装包。

```powershell
npm run check
npm test
npm run test:release
npm run sim
npm run build:release
```

- `test` 验证核心规则和浏览器适配。
- `test:release` 构建并执行真正的抖音入口，故意不提供 DOM，检查隐私确认、触摸、存档、生命周期、广告隔离、包内格式。
- `sim` 模拟主动孵化、分化与全局发展，包含越冬和分蜂。
- `build:release` 生成 `dist/`，正式构建没有真实广告时不会模拟观看完成。

## 抖音小游戏

```powershell
npm run build:douyin
```

生成 `dist-douyin/`，包含 `game.js`、`game.json`、`project.config.json` 和包内 PNG 美术。使用抖音开发者工具导入该目录，填写自己创建的 AppID，进行模拟器与真机预览。竖屏 Canvas 界面支持花田采集、蜂巢建造/扩建/升级、手动繁育、分工、授粉、任务、敌害、研究、分蜂、传承和存档。

发布资料放在 `release.config.json`。填写完成后：

```powershell
npm run build:douyin:release
```

未配置广告位时显示暂无广告，不扣资源、不发观看奖励。当前包使用半尺寸图集并转换为抖音支持的 PNG，不需要资源 CDN；构建器超过20 MB会失败。

## TapTap Android

APK 内置完整浏览器界面和全部游戏资源，使用 Android WebView 本地 HTTPS 资源加载，不需要联网才能经营。最低 Android 8.0（API 26），编译/目标 SDK 36，JDK 17+，Gradle Wrapper 8.13。

1. 安装 Android SDK Platform 36、Build Tools、Platform Tools。
2. 用 Android Studio 打开 `android/`，由 IDE 配置 SDK；或在 `android/local.properties` 填入 `sdk.dir=你的SDK路径`。
3. Windows 下构建可安装测试包：

```powershell
npm run build:android
```

构建后会校验真实 APK：入口、JavaScript 和 CSS 必须与网页完全相同，禁止混入小游戏 Canvas 预览。

产物：`android/app/build/outputs/apk/debug/app-debug.apk`。测试包名带 `.debug` 后缀，便于与正式版共存；测试包使用开发签名，**不是提交商店的正式签名包**。

正式版填写发布主体、联系邮箱、最终包名和版本号，再设置自己保管的签名环境变量：

```powershell
$env:XF_KEYSTORE_PATH='你的发布密钥文件绝对路径'
$env:XF_KEYSTORE_PASSWORD='你的密钥库密码'
$env:XF_KEY_ALIAS='你的密钥别名'
$env:XF_KEY_PASSWORD='你的密钥密码'
npm run build:android:release
```

正式 APK：`android/app/build/outputs/apk/release/app-release.apk`。密钥和密码不应提交到仓库；应用更新必须沿用同一包名和签名、递增 `versionCode`。

当前 Android 包未集成第三方广告 SDK；广告不可用不会影响基础经营。需要广告变现时，再按广告服务官方文档接原生 SDK 和已有 `XFNativeAds` 桥接协议，不能使用网页占位奖励代替真实广告。

## 提交发布

```powershell
npm run release:check
```

该命令列出缺少的真实发布信息；不代替平台审核。完整步骤及官方文档链接见 [发布说明](docs/RELEASE.md)。平台后台的游戏资料、主体资料、所需资质和真机审核由对应开发者账号提交。

## 目录

- `src/domain`：游戏规则、经济、成长和存档。
- `src/scene`：两端共用的地图、蜂巢和动画渲染。
- `src/app/BrowserUI.ts`：完整 H5 / Android 界面。
- `src/app/minigame`：无 DOM Canvas 界面、抖音入口和浏览器预览。
- `src/platform`：存储、声音、美术、广告和生命周期适配。
- `android`：TapTap APK 工程、离线资源加载和原生生命周期。
- `release.config.json`：两端发布资料与版本信息。

存档保存在当前设备，支持备份和入冬前恢复点。两个平台的存档独立，没有账号和跨设备云存档。当前未交付运行时 MP3 音频，缺失音频会静音跳过，制作清单见 [音频计划](docs/AUDIO_PLAN.md)。
