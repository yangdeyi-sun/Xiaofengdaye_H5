# 广告与多平台接入说明（0.2.0）

本版本做了三件事：

1. **平台抽象层**：存储、音频、图片、振动、帧循环、前后台和广告都从 `src/platform/Platform.ts` 走，游戏规则不再直接调用浏览器 API。
2. **广告系统**：6 个激励视频点位和 1 个插屏点位，统一经过 `AdService`。底层广告 SDK 可替换为抖音、TapTap 或原生 APK 广告。
3. **包体瘦身**：音频从 WAV/OGG 转成 MP3，从约 15MB 降到约 6.3MB；构建时排除音频母带和商店宣传图。

`src/common`、`src/domain` 和 `src/scene` 一个字节都没有改，`npm run verify:core` 仍然可以对照原版。

---

## 一、代码结构

```text
src/platform/
├─ Platform.ts              平台接口：KeyValueStore / AudioBackend / ImageLoader / AdBackend / Platform
├─ web/
│  ├─ WebPlatform.ts        浏览器实现；默认使用测试广告
│  └─ NativeBridgeAds.ts    原生 App（WebView 壳）广告桥接
├─ minigame/
│  ├─ MiniGameApi.ts        小游戏宿主 API 类型（tt / tap / wx 通用形态）
│  ├─ MiniGamePlatform.ts   小游戏实现：setStorageSync、InnerAudioContext、createImage、激励视频、插屏
│  └─ adUnits.ts            ← 在这里填各平台后台的广告位 ID
├─ BrowserSaveRepository.ts 存档（底层存储改由平台提供）
├─ BrowserAudioService.ts   分层音频（底层播放器改由平台提供）
└─ BrowserArt.ts            美术加载（底层加载器改由平台提供）

src/app/ads/
├─ placements.ts            ← 点位、每日次数、冷却、奖励倍率、插屏节奏（调参只改这里）
├─ AdService.ts             统一的观看流程：次数上限、冷却、只在看完后发奖、暂停游戏、打点
└─ AdRewards.ts             各点位的奖励发放（资源统一走 EconomyService.add）
```

## 二、广告点位

| 点位 id | 位置 | 玩家看到的按钮 | 奖励 | 每日上限 |
|---|---|---|---|---|
| `offline_double` | 离线归来弹窗 | 收益翻倍 | 离线收益再发一份（受仓库容量限制，溢出进缓冲） | 4 |
| `flower_boost` | 顶栏 ⚡ / 设置 | 开启 2× / 连看 2 个开启 4× | 游戏速度 2× 或 4×，持续 10 分钟 | 8 条广告 |
| `bear_aid` | 熊来袭弹窗、生态面板 | 请邻巢援军 | 熊直接离开，不扣蜂蜜 | 3 |
| `winter_supply` | 生态面板（储备不够过冬或饥饿时出现） | 领取紧急补给 | 蜂蜜容量的 30%（至少 80） | 2，冷却 5 分钟 |
| `colony_revive` | 生态面板（蜂群衰败时出现） | 免费重振蜂群 | 等同“消耗 1 传承重启”，但不扣传承点 | 1 |
| `swarm_bonus` | 分蜂完成后弹窗 | 传承点 +N | 额外获得本次传承点的 50%（向上取整） | 3 |
| 插屏 `winter_survived` | 熬过冬天时 | — | — | 首次游戏 15 分钟内不出；间隔 ≥ 3 分钟；看完激励视频 90 秒内不出；每天 ≤ 6 次 |

**4× 加速**需要连看两个广告：看完第一个先给 2×，看完第二个升为 4×。第二个没看完时保留 2×。

规则：
- 只有平台回报“完整观看”才计数、才发奖。中途关闭或无广告时只提示，不扣除任何东西。
- 广告播放期间暂停游戏模拟和音乐，玩家不会因为看广告错过敌害或季节。
- 原来设置里免费的 1×/2×/4× 速度已经取消，速度只来自花潮加速。旧存档里的 `gameSpeed` 字段保留但不再生效。
- 广告记录单独保存在 `xiaofengdaye.h5.ads`，不改动原版存档结构；跨天自动重置每日次数。

调整数值时只改 `src/app/ads/placements.ts`。

## 三、各平台怎么接广告 SDK

所有平台都只需要实现同一个接口（`src/platform/Platform.ts`）：

```ts
interface AdBackend {
  showRewarded(placement: string): Promise<{ status: 'completed' | 'skipped' | 'unavailable'; detail: string }>;
  showInterstitial(placement: string): Promise<boolean>;
}
```

### 1. 抖音小游戏

已经实现，在 `MiniGamePlatform` 里调用 `tt.createRewardedVideoAd` / `tt.createInterstitialAd`：

- 每个广告位只创建一次实例，`onClose` 里 `isEnded === true` 才算看完；
- `show()` 失败时先 `load()` 再试一次，仍失败返回“暂无广告”。

接入步骤：

1. 在抖音开放平台开通流量主，创建激励视频广告位和插屏广告位；
2. 把广告位 ID 填进 `src/platform/minigame/adUnits.ts` 的 `DOUYIN_AD_UNITS`。可以每个点位一个 ID，也可以只填 `rewardedDefault` 共用一个；
3. 在小游戏入口文件中：

```ts
import { setPlatform } from './platform/Platform';
import { MiniGamePlatform } from './platform/minigame/MiniGamePlatform';
import { DOUYIN_AD_UNITS } from './platform/minigame/adUnits';

declare const tt: import('./platform/minigame/MiniGameApi').MiniGameApi;
setPlatform(new MiniGamePlatform({ name: 'douyin', api: tt, adUnits: DOUYIN_AD_UNITS, assetBase: '' }));
// 之后创建 GameSession，与 H5 相同
```

`assetBase` 留空表示读包内资源；填 CDN 地址（以 `/` 结尾）则从远程加载。CDN 域名需要在抖音后台配置为合法域名。

### 2. TapTap 小游戏

TapTap 小游戏的广告接口和抖音、微信是同一形态，使用同一个 `MiniGamePlatform`：

```ts
setPlatform(new MiniGamePlatform({ name: 'taptap', api: tap, adUnits: TAPTAP_AD_UNITS }));
```

TapTap 的全局对象名和广告位申请流程请以 TapTap 开发者文档为准，广告位 ID 填进 `TAPTAP_AD_UNITS`。如果个别接口名不同，只需要在 `MiniGameApi` 上做一层转接。

### 3. Android APK（WebView 壳 + 原生广告 SDK）

适用于把 H5 打包成 APK 上架 TapTap，在原生层接穿山甲 / GroMore / TapADN。`WebPlatform` 启动时检测到 `window.XFNativeAds` 就自动改走原生广告，否则用测试广告。

原生层要做两件事：

1. 向 WebView 注入 `XFNativeAds`，提供两个方法：
   - `showRewarded(requestId, placement)`
   - `showInterstitial(requestId, placement)`
2. 广告结束后执行回调：
   `window.__xfAdCallback(requestId, 'completed' | 'skipped' | 'unavailable' | 'shown')`

Android（Kotlin）示意：

```kotlin
class XFNativeAds(private val activity: Activity, private val web: WebView) {
    @JavascriptInterface
    fun showRewarded(requestId: String, placement: String) {
        activity.runOnUiThread {
            // 用广告 SDK 加载并展示激励视频；在 onRewardVerify / onReward 回调里视为看完
            AdSdk.showRewarded(activity, placementToCodeId(placement),
                onReward = { callback(requestId, "completed") },
                onClosedWithoutReward = { callback(requestId, "skipped") },
                onError = { callback(requestId, "unavailable") })
        }
    }

    @JavascriptInterface
    fun showInterstitial(requestId: String, placement: String) {
        activity.runOnUiThread {
            AdSdk.showInterstitial(activity, interstitialCodeId,
                onShown = { callback(requestId, "shown") },
                onError = { callback(requestId, "unavailable") })
        }
    }

    private fun callback(id: String, status: String) = activity.runOnUiThread {
        web.evaluateJavascript("window.__xfAdCallback && window.__xfAdCallback('$id','$status')", null)
    }
}
// webView.addJavascriptInterface(XFNativeAds(this, webView), "XFNativeAds")
```

原生层 90 秒内没有回调时，游戏按“暂无广告”处理，界面不会卡住。

### 4. 广告占位与 H5 测试广告

**占位（默认）**：还没接入任何广告 SDK 时，点广告按钮直接发放奖励，并提示“广告位占位，已直接发放”。在小游戏平台上，`adUnits.ts` 里留空的点位也按占位处理。**正式上线前务必填好广告位 ID**，否则奖励等于免费领取。

**测试弹层**：网址加 `?ads=mock` 时，用倒计时弹层模拟激励视频：
- 默认 5 秒，倒计时结束前关闭等于“没看完”；
- `?adtime=1`：倒计时改为 1 秒；
- `?ads=none`：模拟“暂无广告”。

## 四、打点

`GameSession` 里 `ads.onEvent` 目前只把广告事件打印到控制台：`request`、`complete`、`skip`、`unavailable`、`interstitial`，每条都带点位 id。

接入平台数据分析时，在这里转发即可，例如抖音的 `tt.reportAnalytics(event.type, { placement: event.placement })`。上线后至少要看两个数：每个点位的完成率，以及人均每日观看次数。

## 五、包体

| | 改造前 | 现在 |
|---|---|---|
| 音频 | 约 15MB（WAV + OGG） | 约 6.3MB（MP3） |
| 商店宣传图 | 打进包 | 构建时排除 |

`npm run build` 结束时会打印各部分体积，总包超过 20MB 会给出警告。

目前美术里完整版和 `low/` 低清版两套都会打包。上小游戏时建议只留一套在包内，另一套和背景音乐放 CDN。抖音的限制是主包 4MB、总包 20MB。

修改音频母带后运行 `npm run audio` 重新转码（需要安装 ffmpeg）。

## 六、还没做的事

- **小游戏 UI**：`BrowserUI.ts` 仍是 DOM 界面，抖音 / TapTap 小游戏没有 DOM。这一层需要用 Cocos Creator 或纯 Canvas 重写。平台层、广告层和全部游戏规则都可以直接复用。
- **联系方式和主体**：`src/app/content.ts` 里的联系邮箱 `xiaofengdaye.support@example.com` 和主体名称需要换成真实信息，再提交审核。
- **广告位 ID**：`adUnits.ts` 里还全是空字符串，需要在平台后台创建后填入。
