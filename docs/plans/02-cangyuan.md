# Cangyuan 图像模型能力与接口依据

采集日期：2026-09-17。状态：公开协议核查，全部模型的真实调用仍未验证。当前表不是运行时授权列表。

候选构建刷新（2026-09-17T09:35:12.958Z）：公开定价图像模型变为 26 个；`midjourney-1k` 与 `midjourney-2k` 已从公开定价和模型文档消失，不再列入 v0.1 发布清单。适配器代码仍保留 Midjourney 家族规则，若目录再次出现可重新纳入。详见 [截止点记录](../validation/2026-09-17-catalog-cutoff.md)。

## 数据来源与判定

- [公开定价接口](https://direct-api.cangyuansuanli.cn/api/pricing)：早间快照 28 个图像模型条目；候选构建刷新后 26 个。未使用 Key。
- [官方文档目录](https://direct-api.cangyuansuanli.cn/docs-static/manifest.json)：早间 30 个图像模型文档；刷新后不再包含 Midjourney。
- [模型发现](https://direct-api.cangyuansuanli.cn/docs-static/capabilities/models.md)：当前 Token 可见性通过带凭据的 `GET /v1/models` 验证。无凭据实测返回 401。
- 下表精确 ID 链接指向本轮逐一读取的官方模型 JSON。

公开目录、模型文档、当前 Key 可见性、实现状态、实测状态应分别存储。不能把界面能选择一个 ID 当成模型已验证。发布前更新目录并纳入新增项；当前表不是范围冻结。

## 当前 28 个模型

文生图在下表模型中均有声明。编辑列指官方参考图/编辑声明，不承诺模型严格保留源构图或像素。首版只用一个源图层，不把参考图上限直接变成多图工作流。

| 精确模型 ID / 官方文档 | 家族 | 图层编辑/参考图 | 参考图上限 | 参数和差异 |
|---|---|---|---|---|
| [doubao-seedream-5-0-pro](https://direct-api.cangyuansuanli.cn/docs-static/models/doubao-seedream-5-0-pro.json) | Seedream | 声明支持 | 10 | output_format |
| [gemini-3-pro-image-preview](https://direct-api.cangyuansuanli.cn/docs-static/models/gemini-3-pro-image-preview.json) | Gemini | 声明支持 | 9（定价） | quality=1k/2k/4k；比例 size |
| [gemini-3.1-flash-image-preview](https://direct-api.cangyuansuanli.cn/docs-static/models/gemini-3.1-flash-image-preview.json) | Gemini | 声明支持 | 9（定价） | quality=1k/2k/4k；比例 size |
| [gpt-image-2](https://direct-api.cangyuansuanli.cn/docs-static/models/gpt-image-2.json) | GPT Image | 声明支持 | 9 | 模型页无 mask |
| [gpt-image-2-1k](https://direct-api.cangyuansuanli.cn/docs-static/models/gpt-image-2-1k.json) | GPT Image | 声明支持 | 9 | 固定档 quality；n=1 |
| [gpt-image-2-2k](https://direct-api.cangyuansuanli.cn/docs-static/models/gpt-image-2-2k.json) | GPT Image | 声明支持 | 9 | 固定档 quality；n=1 |
| [gpt-image-2-4k](https://direct-api.cangyuansuanli.cn/docs-static/models/gpt-image-2-4k.json) | GPT Image | 声明支持 | 9 | 固定档 quality；n=1 |
| [gpt-image-2.5](https://direct-api.cangyuansuanli.cn/docs-static/models/gpt-image-2.5.json) | GPT Image | 声明支持 | 9 | 模型页声明 mask |
| [gpt-image-2.5-flare](https://direct-api.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare.json) | GPT Image | 声明支持 | 9 | 模型页声明 mask |
| [gpt-image-2.5-flare-1k](https://direct-api.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare-1k.json) | GPT Image | 声明支持 | 9 | 固定档 quality；n=1 |
| [gpt-image-2.5-flare-2k](https://direct-api.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare-2k.json) | GPT Image | 声明支持 | 9 | 固定档 quality；n=1 |
| [gpt-image-2.5-flare-4k](https://direct-api.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare-4k.json) | GPT Image | 声明支持 | 9 | 固定档 quality；n=1 |
| [gpt-image-2.5-sunburst](https://direct-api.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-sunburst.json) | GPT Image | 声明支持 | 9 | 模型页声明 mask |
| [gpt-image-2.5-sunburst-1k](https://direct-api.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-sunburst-1k.json) | GPT Image | 声明支持 | 9 | 固定档 quality；n=1 |
| [gpt-image-2.5-sunburst-2k](https://direct-api.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-sunburst-2k.json) | GPT Image | 声明支持 | 9 | 固定档 quality；n=1 |
| [gpt-image-2.5-sunburst-4k](https://direct-api.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-sunburst-4k.json) | GPT Image | 声明支持 | 9 | 固定档 quality；n=1 |
| [grok-imagine-image](https://direct-api.cangyuansuanli.cn/docs-static/models/grok-imagine-image.json) | Grok | 声明支持 | 1 | 无 mask |
| [grok-imagine-image-2.0](https://direct-api.cangyuansuanli.cn/docs-static/models/grok-imagine-image-2.0.json) | Grok | 资料冲突 | 0 / 1 | 定价称仅文生图，模型页列 images |
| [grok-imagine-image-lite](https://direct-api.cangyuansuanli.cn/docs-static/models/grok-imagine-image-lite.json) | Grok | 不支持 | 0 | 仅文生图 |
| [grok-imagine-image-sale](https://direct-api.cangyuansuanli.cn/docs-static/models/grok-imagine-image-sale.json) | Grok | 声明支持 | 1 | 仅 1:1 |
| [midjourney-1k](https://direct-api.cangyuansuanli.cn/docs-static/models/midjourney-1k.json) | Midjourney | 按 reference 路由 | edit 4 / editor 1 | n=1；四候选；Relax/Fast |
| [midjourney-2k](https://direct-api.cangyuansuanli.cn/docs-static/models/midjourney-2k.json) | Midjourney | 按 reference 路由 | edit 4 / editor 1 | n=1；四候选；Relax/Fast |
| [nano-banana-pro-1k](https://direct-api.cangyuansuanli.cn/docs-static/models/nano-banana-pro-1k.json) | Nano Banana | 声明支持 | 9 | 模型页无 mask；无 quality |
| [nano-banana-pro-2k](https://direct-api.cangyuansuanli.cn/docs-static/models/nano-banana-pro-2k.json) | Nano Banana | 声明支持 | 9 | 模型页无 mask；无 quality |
| [nano-banana-pro-4k](https://direct-api.cangyuansuanli.cn/docs-static/models/nano-banana-pro-4k.json) | Nano Banana | 声明支持 | 9 | 模型页无 mask；无 quality |
| [nano-banana2-1k](https://direct-api.cangyuansuanli.cn/docs-static/models/nano-banana2-1k.json) | Nano Banana | 声明支持 | 9 | 模型页无 mask；无 quality |
| [nano-banana2-2k](https://direct-api.cangyuansuanli.cn/docs-static/models/nano-banana2-2k.json) | Nano Banana | 声明支持 | 9 | 模型页无 mask；无 quality |
| [nano-banana2-4k](https://direct-api.cangyuansuanli.cn/docs-static/models/nano-banana2-4k.json) | Nano Banana | 声明支持 | 文档9 / 定价16 | 模型页无 mask；无 quality |

另外，[nano-banana-pro](https://direct-api.cangyuansuanli.cn/docs-static/models/nano-banana-pro.json) 和 [flux-pro-2](https://direct-api.cangyuansuanli.cn/docs-static/models/flux-pro-2.json) 仅在本轮文档目录出现，未在定价目录出现。先记录为“仅文档出现”，待 Token 列表/平台确认后判断是否纳入在线模型，不自造可用状态。

## Cangyuan 适配器与原设计的区别

依据[统一图像契约](https://direct-api.cangyuansuanli.cn/docs-static/capabilities/image.md)和[任务生命周期](https://direct-api.cangyuansuanli.cn/docs-static/capabilities/task-lifecycle.md)：

- 网关基地址默认为 `https://direct-api.cangyuansuanli.cn`，该适配器路径包含 `/v1`。统一移除基地址末尾的一个 `/v1`，防止重复拼接。
- 文生图 `POST /v1/images/generations`；通常编辑 `POST /v1/images/edits`。
- JSON 请求使用 `model,prompt,n,size,response_format,async` 及模型页允许的字段；`images` 为 HTTPS URL 数组。不能直接当 OpenAI multipart 文件协议使用。
- 新调用用 `async:true`。状态为 `queued/in_progress/completed/failed`，保留实际提交路径和任务 ID，沿该路径轮询。
- 轮询建议 5–10 秒；断连后继续查询已有 ID，不重新提交已受理任务。没有 ID 且是否受理未知时进入 UNKNOWN。
- 后端 READY 仅表示候选可用，应用成功由 Photoshop 插件独立报告。

## 模型差异

- Gemini 的 `quality` 表达输出档位；GPT 固定档的 `quality` 是另一套枚举，两者不能共享一个固定菜单。
- Nano Banana 固定档不额外发送 quality。Seedream 的 output_format 按文档使用。
- Midjourney 的 `reference=image/style/edit/moodboard` 走 generations；`reference=editor` 走 edits。整图改材质可用 editor 且不传 mask，仍须实测。
- Midjourney 的 n=1 仍产生四张候选。文档例子不足以确认是四个 URL 还是一张宫格；接收结构要记录真实响应后实现。默认 Relax，不能暗加 `--fast`。
- 首版选区/蒙版编辑仍不开放；模型声明支持 mask 不等于产品已实现蒙版工作流。

## 本地源图与输入传递

依据[素材文档](https://direct-api.cangyuansuanli.cn/docs-static/capabilities/assets.md)，参考素材使用匿名可读取的 HTTPS 地址；本地文件先直传对象存储的方案需要 Presigned URL。没有公开的完整签名申请/上传接口合同，`/v1/files` 未实现。

28 份当前模型文档没有发现明确允许 Data URI/base64 的声明；Midjourney 明确排除 Data URI。用户要求原图保留本地或使用生成素材，没有授权第三方托管。

[#7](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/7) 先核实服务是否另有文件上传、multipart 或内嵌输入协议，并在项目 Key 就绪后用最小本地 fixture 验证。无凭据时的 401 不能证明某种输入可用或不可用。若最终只能 URL 且无官方上传路径，就保持编辑传输阻碍，不自动购买存储或上传第三方。

## 已发现的协议冲突

| 项目 | 冲突 | 暂行处理 |
|---|---|---|
| grok-imagine-image-2.0 | 定价描述/参考上限为仅文生图，模型页列参考图编辑 | 文字生图可规划；编辑标为待验证 |
| GPT Image 2 / Nano Banana mask | 部分定价标可用，模型页明确不支持 | 首版本就不开放 mask；不发送 |
| nano-banana2-4k | 定价参考上限16，模型页9 | 当前单源图工作流无需高上限；保守按9记录 |
| GPT 透明背景 | 定价 UI 有 transparent，但逐模型字段表不列 background | 不自动发送；透明输出能力未知 |

“恢复源 Alpha”是本地像素策略，不等于模型能保持输入透明像素或生成透明 PNG。透明输入/输出均须逐模型记录真实证据后开放相应选项。

## 预算

公开定价原始数值不是经过本项目账号核对的人民币账单。实际组、币种/扣费单位、参数档位和 UNKNOWN 任务均影响预算核算。真实测试总上限 30 元，执行方式见 [验收计划](03-validation.md)。
