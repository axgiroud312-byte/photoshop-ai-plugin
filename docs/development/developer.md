# 开发者说明

## 结构

- `apps/plugin`：UXP Manifest v5 面板。`photoshop` / `uxp` 保持外部模块，由 `pnpm plugin:build` 打成 `apps/plugin/main.js`。
- `apps/demo`：同一套 UI 的浏览器包，强制标注 DEMO / 模拟宿主。
- `apps/bridge`：仅监听 `127.0.0.1:47833` 的本地服务。负责资产、模型目录、任务、预算、Mock 与 Cangyuan Provider。
- `packages/contracts`：协议版本 `photoshop-ai/0.1`、错误码、RGBA 合同。
- `packages/image`：AssetStore、几何、Alpha、独立 PNG 编解码。
- `packages/catalog`：Cangyuan 图像模型目录；基线在 `packages/catalog/data/baseline-input.json`。
- `packages/host`：宿主适配器接口、资格检查、快照、应用事务；`MockHost` 供离线测试。
- `packages/panel-store`：面板纯函数状态。

## 常用命令

在干净检出上：

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm fixtures
pnpm plugin:build
pnpm pack:dev
pnpm docs:links
pnpm bridge
```

需要 Node.js 24 与 pnpm 10.33.0。`sharp` 与 `esbuild` 必须允许构建脚本（`package.json` 的 `pnpm.onlyBuiltDependencies`）。

## 安全边界

- 校验 Host、Origin、Token、Content-Type、长度、像素与下载上限。
- 拒绝网页 `http(s)` Origin；允许缺 Origin、`uxp://`、`plugin://`。
- API Key 只进进程内存；开发机可从被 Git 忽略的项目 `.env` 读取。日志与配置回读不得包含 Key。
- 真实付费调用在人民币计价未核对前一律 `COST_UNKNOWN`。公开 `model_price` 不是人民币。
- 本地图层直传 Cangyuan 未证实前，真实整层编辑被 `SOURCE_UPLOAD_UNVERIFIED` 阻止。

## 证据分层

| 层级 | 能证明什么 |
|---|---|
| Node/Mock | 合同、状态机、图像管线、模拟宿主应用 |
| 浏览器 Demo | 面板布局和文案，不能代替 UXP |
| 真实 UXP | 指定 Photoshop 版本中的加载与图层行为 |
| 真实模型 | 指定 Key、模型、参数的一次付费/免费真实返回 |

Issue 只有在对应层级证据齐全时才能 `Closes`。部分实现用 `Refs`。

## 模型目录

基线采集于 `2026-09-17T09:35:12.958Z`：公开定价 26 个图像模型，另有 `nano-banana-pro`、`flux-pro-2` 仅文档出现。相对早间快照，`midjourney-1k` / `midjourney-2k` 已从公开目录删除。发布前在已启动的服务上调用 `POST /v1/models/refresh`，对比 `unadaptedIds` 与 `releaseBlocked`。新增未知家族会阻止发布，不能静默忽略。

## 打包

`pnpm pack:dev` 生成 `artifacts/photoshop-ai-<version>-<git>.zip` 和 `.sha256`。包内只有插件文件、版本清单和用户安装说明。
