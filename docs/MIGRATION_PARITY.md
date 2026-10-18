# 当前平台结构

本工程已独立维护，不再依赖旁边的鸿蒙工程，也不再执行源码逐字节一致性检查。历史迁移仅作为来源记录。

| 层 | 抖音小游戏 | TapTap Android |
| --- | --- | --- |
| 规则与存档 | `src/domain` | 同一份内核 |
| 地图与蜂巢 | `SceneRenderer` | 同一渲染器 |
| 界面 | 共用完整版 `GameUI` + `styles.css`，`FullCanvasUI` 画布宿主，无 DOM | 同一份 `GameUI` + `styles.css`，离线 WebView |
| 图片与声音 | `MiniGamePlatform` | `WebPlatform` |
| 存储 | `tt` 本地存储 | 应用 WebView 本地存储 |
| 前后台 | `tt.onHide/onShow` | Activity 转发 `pagehide/pageshow` |
| 广告 | 抖音广告 API，需真实广告位 | 尚未接 SDK，暂无广告 |
| 构建 | `npm run build:douyin` | `npm run build:android` |

验证由类型检查、核心测试、平台测试、无 DOM 发布入口测试、整局模拟和两端真机测试负责，不要求与旧工程行为一致。前期玩法见 [主动发展流程](PROGRESSION_FLOW.md)，上架步骤见 [发布说明](RELEASE.md)。
