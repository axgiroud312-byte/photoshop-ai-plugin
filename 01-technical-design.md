# Photoshop AI 插件 v0.1 技术设计文档

> 此文件保留初始 v1.0 设计。2026-09-17 访谈新增 Cangyuan 全图像模型、文字生图、多候选选择、发布前目录更新与 30 元测试预算，详见 [当前范围](docs/plans/00-scope.md)。冲突部分以当前计划为准；未改动的宿主与像素要求继续有效。

**文档版本：** 1.0　 **编写日期：** 2026-09-17  
**状态：** 实施设计，尚未在 Photoshop 中开发或实测。  
**配套文件：** `02-ui-prototype-spec.md`、`03-interactive-prototype.html`

> v0.1 只交付「整层修改 → 结果预览 → 应用为新图层 → 单次撤销」。用户提出的选区修改、图层 + 指定蒙版修改保留在统一数据模型中，分别在 v0.2 / v0.3 实现。不要把预留接口、原型中的禁用入口或未来规划当成已实现功能。

---

## 1. 产品目标与边界

### 1.1 唯一核心用例

用户在 Photoshop 中选择一个受支持的像素图层，在插件里输入修改要求，调用用户配置的图像编辑模型，检查结果，再将结果作为新的像素图层放回源图层所在位置。源图层保留但隐藏；一次 Photoshop 撤销恢复到应用前状态。

**验收示例：** 选择「几何印花」图层 → 输入「保持构图，把配色改成暖橙和深蓝」→ 生成一张候选图 → 在面板切换原图 / 结果 → 应用 → 原层隐藏、新层显示 → 一次撤销恢复原层。

### 1.2 功能范围

| 能力 | v0.1 | 说明 |
|---|---|---|
| 单个像素图层整层编辑 | 实现 | 仅读取指定层，不发送整张 PSD |
| 自定义服务地址、模型、凭据 | 实现 | 首个真实适配器是 OpenAI Images Edits 协议；不是任意 API 通吃 |
| 提示词输入、单张结果 | 实现 | 不加入聊天历史、多轮 Agent 或批量候选 |
| 面板内预览、原图 / 结果切换 | 实现 | 应用前不改动 PSD |
| 新建结果层、隐藏原层 | 实现 | 原始像素不覆盖，原层不移动、不删除 |
| 一次应用对应一个历史步骤 | 实现 | 包含新层创建、写入、定位、显隐切换 |
| 取消、失败说明、手动重新生成 | 实现 | 不承诺上游已经取消计费 |
| 导出当前候选结果 PNG | 实现 | 冲突时也能保留结果，不强行写入文档 |
| 选区 / 蒙版编辑 | 预留 | 主面板入口禁用并标记版本 |
| Codex 登录、MCP、推理 Agent | 不实现 | 不属于本次图像编辑闭环；单独做后续后端适配 |
| 智能对象、文字层、形状层直接编辑 | 不实现 | 不自动栅格化、不自动合并 |
| 超分、扩图、多模型比较、长时任务历史 | 不实现 | 避免挤占回填正确性开发 |

### 1.3 支持矩阵与发布边界

**以下为项目选择，不是 Adobe 宣称的全部能力。** 先发布 Windows 开发测试版本；macOS 未经验证不标记支持。Photoshop 26.0 为候选最低版本，第一里程碑必须记录实际版本、系统版本与测试结果；不能只改 `minVersion` 就声称兼容。

v0.1 正式支持：单选、可见、未锁定、有非透明像素的普通像素图层；RGB、8 bit/channel、嵌入 sRGB 配置文件、方形像素文档；普通混合、100% 不透明度与填充；无图层样式、无像素/矢量蒙版、无剪贴关系。图层可以处于没有蒙版、样式、锁定等复杂属性的普通图层组内；必须保持同一父级和层叠位置。

**先阻止而不是悄悄改变：** 背景专用层、多选、文字/形状/智能对象/调整层、图层组本身、剪贴层与剪贴组基底、复杂祖先组、画板、快速蒙版状态、通道编辑状态、CMYK/Lab/灰度、16/32 位、未标记色彩配置、非方形像素。

用户提示应说明具体原因，例如「此层包含蒙版，v0.1 暂不支持直接编辑。请保留原稿，并自行准备普通像素副本」。不提供自动破坏原稿的“修复”。

图层越出画布的情况列为兼容性验证项。未通过完整像素读取和原位回写测试前，返回 `OUT_OF_CANVAS_UNSUPPORTED`；不得悄悄截断不可见内容。

## 2. 关键架构决定

| 编号 | 决定 | 原因 |
|---|---|---|
| ADR-01 | UXP + TypeScript 编译为插件 JavaScript | 插件负责宿主交互，不把它当作完整 Node.js 运行时 |
| ADR-02 | 独立本地 Node.js + TypeScript 服务 | 模型请求、PNG 编解码、限流和凭据与 PS 写操作分离 |
| ADR-03 | 首版采用 HTTP + 轮询 | 比流式会话 / MCP 更少状态与连接问题 |
| ADR-04 | 一个真实模型适配器 + 一个 Mock 适配器 | 先验证图层往返，再花钱验证模型 |
| ADR-05 | 完整替代层，而非透明贴片简单叠加 | 生成结果中的透明区域不会露出本应被移除的源内容 |
| ADR-06 | 生成与应用是两个动作 | 生成完成不自动改 PSD，用户可检查尺寸和效果 |
| ADR-07 | 不建立全局 AI Results 顶层组 | 移到顶层会改变层叠关系；结果放在源层正上方、同一父级 |
| ADR-08 | 首版不持久化模型密钥 | 密钥仅在本地服务内存中，重启重新填写；后续再接系统凭据库 |
| ADR-09 | 模型参数由能力表控制 | 不显示没有真实 API 对应项的 Strength、种子、负面词等控件 |

Adobe 的 Imaging API 提供像素读取与写入，Layer / Document DOM 提供层级、ID、可见性等宿主信息；文档改动需使用对应的模态执行与历史控制机制。[A1][A2][A3][A4]

### 2.1 模块架构

```text
Photoshop
  └─ UXP 插件
      ├─ UI：编辑 / 设置 / 结果 / 错误
      ├─ HostAdapter：读取源层、状态校验、事务应用
      ├─ TaskController：界面状态、锁定目标、取消
      └─ BridgeClient：鉴权 HTTP / 二进制上传下载 / 轮询
                     │ 127.0.0.1，仅本机
                     ▼
                Local Bridge
      ├─ 配置与能力校验
      ├─ 资产服务：RGBA → PNG，PNG → RGBA
      ├─ 任务控制：幂等、超时、取消、缓存
      ├─ 图像规范化：尺寸变换、Alpha 策略
      └─ ProviderAdapter
          ├─ mock-edit
          └─ openai-images-edit → 用户配置的图像编辑服务
```

只有 UXP 插件能改 Photoshop。本地服务不会接收或执行任意 PS 脚本，模型回复也不能成为可执行 JavaScript。

### 2.2 建议技术栈

插件：TypeScript、原生 HTML/CSS、轻量模块化 Store、UXP 原生能力。构建器只负责打包；`photoshop` 和 `uxp` 保持外部宿主模块，不安装伪造的浏览器替代实现。

本地服务：Node.js 22 作为项目基线，TypeScript、轻量 HTTP 服务、运行时 JSON Schema 校验、Sharp、文件缓存。首次构建冻结实际依赖和补丁版本。Sharp 支持原始像素输入和图像尺寸处理，可作为本项目 PNG 编解码与归一化实现基础。[A7][A8]

测试：单元测试覆盖纯函数和状态机；HTTP 契约测试覆盖任务和资产；浏览器测试只用于 UI；必须另有真实 Photoshop 集成测试。浏览器原型通过不等于 UXP 已兼容。

## 3. 工程组织

```text
photoshop-ai/
├─ apps/
│  ├─ plugin/
│  │  ├─ manifest.json
│  │  ├─ index.html
│  │  └─ src/
│  │     ├─ ui/                  # 页面、组件、样式、Store
│  │     ├─ host/
│  │     │  ├─ eligibility.ts    # 图层/文档资格检查
│  │     │  ├─ context.ts        # document/layer/session 身份
│  │     │  ├─ snapshot.ts       # 像素快照、指纹
│  │     │  ├─ geometry.ts       # 坐标与边界
│  │     │  ├─ apply.ts          # 单次事务
│  │     │  └─ history.ts        # 历史标记、撤销资格
│  │     ├─ bridge/              # 本地 HTTP 客户端
│  │     └─ tasks/               # 状态机与任务控制
│  └─ bridge/
│     └─ src/
│        ├─ server/             # HTTP、Token、Host 校验
│        ├─ assets/             # 二进制、缓存、大小限制
│        ├─ jobs/               # 单并发、幂等、取消
│        ├─ image/              # PNG、RGBA、resize、alpha
│        ├─ providers/          # mock / openai-images-edit
│        └─ config/             # 非敏感配置；凭据只在内存
├─ packages/
│  └─ contracts/                # DTO、错误码、Schema
├─ tests/
│  ├─ unit/
│  ├─ contract/
│  ├─ fixtures/                 # 棋盘、透明边缘、色块
│  └─ photoshop/                # 宿主人工/自动集成脚本
├─ docs/
└─ pnpm-lock.yaml
```

## 4. 核心数据契约

以下为项目接口，不是 Photoshop / OpenAI 的原生类型。宿主 ID 使用 `number`；任务、资产和会话 ID 使用随机字符串。`documentId` 只在文档当前打开生命周期内有效，不能依靠文件名或图层名称重新绑定任务。[A3][A4]

```ts
export type EditMode = 'layer' | 'selection' | 'mask';
export type AlphaPolicy = 'preserve-source' | 'use-model';
export type AssetId = string;
export type JobId = string;
export type Sha256 = string;

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SourceSnapshot {
  photoshopSessionId: string;
  documentOpenToken: string;
  documentId: number;
  layerId: number;
  parentLayerId: number | null;
  sourceRect: PixelRect;
  documentSize: { width: number; height: number };
  documentProfile: 'sRGB IEC61966-2.1';
  sourcePixelHash: Sha256;
  structureHash: Sha256;
  historyStateId: number | null;
  sourceWasVisible: true;
  capturedAt: string;
}

export interface ImageAsset {
  id: AssetId;
  width: number;
  height: number;
  channels: 4;
  componentSize: 8;
  colorProfile: 'sRGB IEC61966-2.1';
  alphaMode: 'straight';
  byteLength: number;
  sha256: Sha256;
}

export interface CreateEditJob {
  clientRequestId: string;
  mode: EditMode; // v0.1 运行时仅允许 layer
  sourceAssetId: AssetId;
  maskAssetId?: AssetId; // v0.1 出现此字段即拒绝
  providerConfigId: string;
  providerConfigRevision: number;
  prompt: string;
  alphaPolicy: AlphaPolicy;
  outputCount: 1;
  options: Record<string, string | number | boolean>;
}

export interface GeometryMapping {
  sourceWidth: number;
  sourceHeight: number;
  requestWidth: number;
  requestHeight: number;
  contentRect: PixelRect; // 等比缩放后的内容在请求图里的位置
  scaleX: number;
  scaleY: number; // 记录取整后的真实比例，不假设两者完全相等
  returnedWidth: number;
  returnedHeight: number;
}

export interface EditResult {
  jobId: JobId;
  resultAssetId: AssetId; // 已规范化为源矩形大小的 RGBA
  exportAssetId: AssetId; // PNG 文件
  previewAssetId: AssetId;
  geometry: GeometryMapping;
  providerRequestId?: string;
  warnings: string[];
}
```

源快照留在插件本地，后端只接收完成任务所需的资产和参数。模型服务不需要 PSD 文件路径、图层树、图层 ID 或其他图层内容。

`structureHash` 包括源层类型、父级、相邻层、剪贴关系、透明度、样式/蒙版标记、祖先组影响与文档尺寸/色彩信息。历史 ID 仅作快速信号；不能把“历史没变”当成完整一致性证明。

## 5. 图层读取与一致性

### 5.1 读取步骤

1. 确认恰好一个目标层，通过资格检查。
2. 获取 `documentId + layerId`，建立本次文档打开令牌，读取整数化 `boundsNoEffects`。
3. 记录读取前结构与历史标记；请求该图层完整分辨率像素，不读取合成画布。
4. 读取后再次检查结构和历史；变化则丢弃本次读取，提示重试，不发送不一致快照。
5. 将返回数据统一为 straight RGBA8；无 Alpha 的 RGB 数据补 255。
6. 计算源像素指纹，上传到本地服务，释放 PhotoshopImageData。

完整源素材采用 `getPixels`，显式传 `documentID`、`layerID`、`componentSize: 8`、`applyAlpha: false`。不要使用 JPEG 预览作为模型源图；预览编码和保留透明度的素材导出是两条管线。[A1]

### 5.2 两个必须实现的边界

**实际返回边界。** `getPixels` 可能裁掉没有像素的区域。以返回边界为准，将像素放回本次确定的源矩形坐标，缺失边缘补透明；不能把请求的边界误认为返回数组一定覆盖的边界。[A1]

**缓存层级。** 使用缩略图尺寸读取时，返回坐标可能属于缓存层级。v0.1 正式编辑读取不使用 `targetSize` 降采样，并验证返回 `level === 0`；未满足则失败，不猜坐标。小尺寸缩略图只能用于 UI，不能参与回填坐标计算。[A1]

### 5.3 任务身份与冲突策略

生成开始后目标固定。用户切换图层不重定向任务；切换文档也不重定向。UI 同时显示“任务目标”和必要时的“当前选择与任务不同”提示。

应用前检查：目标文档仍是同一打开实例；目标层仍存在、资格仍通过；父级/结构未变；源矩形、像素 hash、Alpha、文档尺寸与色彩设置未变。

如果其他无关图层改变，但目标像素及其相关结构完全不变，可允许应用。若无法证明无关，保守阻止。

冲突只给两个选择：导出候选 PNG；重新读取当前目标并新建任务。**不提供“无视冲突覆盖”**。关闭再打开同名 PSD、PS 重启、插件会话丢失后，旧任务都不自动重新绑定。

## 6. 图像处理、坐标与透明度

### 6.1 四种空间

| 空间 | 含义 |
|---|---|
| 文档空间 | Photoshop 画布像素坐标，源矩形起点 `(left, top)` |
| 源图空间 | 本次导出的矩形，左上角 `(0, 0)` |
| 请求空间 | 按模型规格等比缩放、必要时补边后的图像 |
| 返回空间 | 模型真实返回的像素尺寸，不盲信请求尺寸 |

v0.1 不扩展源矩形。源区域外不能生成新内容，极长宽比不等于已支持桌布扩图。

### 6.2 尺寸变换

对源图 `W × H` 和适配器选择的请求画布 `Tw × Th`：等比 contain，得到整数内容尺寸 `Cw × Ch`；记录补边 `px, py` 和实际 `scaleX=Cw/W`、`scaleY=Ch/H`。

模型返回 `Rw × Rh` 时，先要求返回宽高比与请求一致，容差作为项目常量 `0.5%`。不一致返回 `OUTPUT_GEOMETRY_MISMATCH`，不静默拉伸。

请求像素中的内容矩形映射到返回图，再去除补边，并统一重采样到精确 `W × H`。写回使用原始 `(left, top)`。禁止依赖图片 DPI 或导入对话框的自动缩放。

例：源区域位于 `(240, 180)`，尺寸 `1200 × 800`；模型输出 `1536 × 1024`。最终回写仍为 `1200 × 800`，左上角仍是 `(240, 180)`。把结果放大回源尺寸不等于得到更多细节，UI 要在降采样时提示质量限制。

### 6.3 Alpha 策略

| 策略 | 实际行为 | UI 文案 |
|---|---|---|
| preserve-source | 规范化结果颜色使用模型输出，最终 Alpha 恢复为源 Alpha；不是再乘一次 | 保持原图透明轮廓 |
| use-model | 使用经过规范化的模型 RGBA | 使用生成结果透明度 |

默认 `preserve-source`，适合印花换色和材质修改。用户要改变轮廓、去除主体形成透明洞，应选择 `use-model`；该项只在适配器验证支持透明输出时开放。

若模型无法输入透明图层，不自动铺白底，明确阻止或要求用户选择已验证服务。若模型没有颜色可供恢复到原 Alpha 范围，返回需要检查的警告并阻止自动应用，不从透明黑像素猜颜色。

缩放 RGBA 时测试预乘/非预乘转换和边缘色晕。用于源一致性校验的 hash 只清零 `A=0` 像素不可见 RGB 后计算规范化指纹；源资产保留原始字节，不做有损编码。

### 6.4 输入输出限额（项目初始值）

单层最多 16,777,216 像素，RGBA 最多 64 MiB；任一边不超过 8192 px。返回编码图最大 32 MiB，并在解码前后检查尺寸、通道数与资源限制。并发仅 1 个任务。实际模型输入上限取项目限额与适配器限额较小值。

这些是资源保护策略，不是模型或 Adobe 的固有限制。遇到超限不自动降低原稿质量；提示在副本中裁切/缩小，或等待后续分块处理版本。

## 7. 模型接入

### 7.1 能力表

```ts
export interface ProviderCapabilities {
  edits: boolean;
  inputAlpha: boolean;
  outputAlpha: boolean;
  masks: boolean;
  cancelUpstream: boolean;
  allowedSizes: string[];
  allowedQuality: string[];
  maxInputBytes: number;
  maxInputPixels: number;
  responseKinds: Array<'base64' | 'url'>;
}
```

v0.1 实现 `mock-edit` 和 `openai-images-edit`。OpenAI 官方 Image API 提供编辑路径；配置兼容端点时必须验证 multipart 上传、字段、模型权限与返回结构，只有聊天接口兼容不代表图像编辑兼容。[A6]

**Base URL 语义固定为 API 根路径**，编辑路径固定拼接 `images/edits`，防止出现 `/v1/v1` 或重复 `images/edits`。设置页展示计算后的最终端点。未知协议直接提示不支持，不猜接口。

参数白名单由适配器决定；没有对应能力的质量、尺寸、背景、强度等参数不发送。不写死某个模型为所有服务均可用。

### 7.2 两级验证

“检查配置”：检查格式、地址、安全规则、适配器字段；可用时发不计费的鉴权/能力探测。结果最多是“配置格式有效”或“鉴权通过”，不能显示“生图可用”。

“发送测试图”：用户明确确认后发送非敏感小测试图，才把该配置标记“图像编辑已验证”。说明可能计费。模型配置或关键参数改变后验证标记失效。

### 7.3 取消与重复计费

每次创建使用唯一 `clientRequestId`，同一 ID 与同一请求摘要只返回同一任务；同一 ID 携带不同内容返回 409。禁止双击创建两次上游请求。

应用 SDK 的自动重试需关闭或审计。收到超时且无法确认上游状态时进入 `UNKNOWN`，不自动重发付费生成；用户手动重试必须提示“上一请求可能仍在处理，重新发送可能产生额外费用”。

“取消”保证的是插件不再应用该任务、停止可取消的网络请求。上游是否停止由适配器返回，不能保证退款，也不能把关闭面板当成取消成功。

## 8. 本地 HTTP 契约

### 8.1 服务边界

建议固定监听 `127.0.0.1:47833`，端口为项目约定。禁止监听 `0.0.0.0`。所有业务请求使用本机随机 Bearer Token；Token 与 API Key 分开。

首次启动本地服务输出本次运行的随机配对 Token，用户粘贴到插件设置中；v0.1 仅保存在插件会话内存。模型 Key 通过已鉴权通道提交后仅存本地服务内存；设置回读只返回 `hasCredential`，不回显原值。

### 8.2 API 列表

| 方法与路径 | 作用 | 关键规则 |
|---|---|---|
| GET `/v1/health` | 协议版本、bridgeSessionId、就绪状态 | 不回显路径、Token 或密钥 |
| GET `/v1/provider-config` | 读取非敏感配置与验证状态 | 只有一套活动配置 |
| PUT `/v1/provider-config` | 保存配置/可选凭据 | 生成中禁改；版本号递增 |
| POST `/v1/provider-config/check` | 格式/鉴权检查 | 返回检查级别，不谎称生图成功 |
| POST `/v1/provider-config/test-edit` | 显式付费兼容性测试 | 测试素材，不上传当前 PSD |
| POST `/v1/assets` | 建立资产上传记录 | JSON：尺寸、格式、预期字节数 |
| PUT `/v1/assets/:id/raw` | 上传原始 RGBA | octet-stream，严格长度校验 |
| GET `/v1/assets/:id/meta` | 读取资产元数据 | 必须属于当前会话 |
| GET `/v1/assets/:id/raw` | 下载回填 RGBA | octet-stream，验证长度/hash |
| GET `/v1/assets/:id/png` | 导出 PNG | Blob/文件输出，不公开永久 URL |
| GET `/v1/assets/:id/preview` | 面板低分辨率预览 | 可烘焙棋盘底；不供正式回填 |
| POST `/v1/jobs` | 创建生成任务 | 202；单并发；幂等键 |
| GET `/v1/jobs/:id` | 查询状态/结果 | 活跃时每 1 秒轮询 |
| POST `/v1/jobs/:id/cancel` | 取消意图 | 重复请求安全 |
| DELETE `/v1/jobs/:id` | 丢弃未应用结果及可清理缓存 | 不删除 PSD 内图层 |

所有 JSON 错误统一形态：

```json
{
  "error": {
    "code": "OUTPUT_GEOMETRY_MISMATCH",
    "message": "返回图像比例与请求不一致，未写入 Photoshop。",
    "retryable": false,
    "jobId": "job_example",
    "requestId": "req_example"
  }
}
```

PS 图层 ID 等身份信息只在插件维护。服务接收的是不透明资产 ID，不接受用户传入任意本地文件路径。

### 8.3 后端与插件状态分离

后端：`QUEUED → RUNNING → DOWNLOADING → NORMALIZING → READY`，错误进入 `FAILED`，不确定进入 `UNKNOWN`，取消进入 `CANCELLED`。用户取消与晚到结果竞争时，已确认取消的任务不得重新变成 READY。

插件：`EMPTY / DRAFT → CAPTURING → GENERATING → RESULT_READY → VALIDATING → APPLYING → APPLIED`。旁路状态：`CANCELLED、ERROR、CONFLICT、DISCONNECTED`。

后端的 READY 只代表图片准备好，不代表 PSD 已修改。APPLIED 是插件读取宿主状态并完成事务后才可报告的状态。

## 9. Photoshop 事务应用

### 9.1 为什么隐藏原层

把一个透明结果简单叠到仍可见的源层上，透明部分会露出源内容，无法真正删除内容。因此本版本采用完整替代层：结果层显示，源层保留但隐藏。

结果层与源层同父级，紧贴其上；不移动到文档顶层，不把其他层卷入新建组。

### 9.2 应用步骤

**模态范围外：** 下载候选 RGBA，检查 hash/尺寸/字节长度，准备图片缓冲，初步验证目标；模型请求和文件网络下载不能放进 PS 修改事务。

**模态范围内：** 再次解析目标 ID，检查资格与源像素/结构指纹；开始历史合并；新建隐藏像素层；用 `createImageDataFromBuffer` / `putPixels` 写入精确尺寸像素；按源坐标放置；确保同父级和正确顺序；命名；最后显示结果并隐藏源层；恢复用户进入事务前的选区、通道和激活状态；提交历史。

`putPixels` 的目标必须是像素层，定位使用 `targetBounds.left/top`；尺寸由图像缓冲决定，不由 `targetBounds.width/height` 负责缩放。[A1]

名称建议：`AI · 源图层名 · 01`，序号按父级中现有结果递增。只在插件本地记录来源映射；不往 PSD 层名里塞 Key、完整提示词或文件路径。

### 9.3 事务伪代码

```ts
// 设计伪代码。host.*、validate* 均为本项目待实现封装，不能直接复制当完整插件。
await ps.core.executeAsModal(async (ctx) => {
  const source = await host.resolveTarget(snapshot);
  await validateSourceInsideModal(source, snapshot, ctx);
  const savedUi = await host.captureUiState();
  const suspension = await ctx.hostControl.suspendHistory({
    documentID: snapshot.documentId,
    name: 'AI 编辑：应用结果'
  });
  try {
    const output = await host.createHiddenSiblingPixelLayer(source);
    await host.writeRgbaAt(output, preparedRgba, snapshot.sourceRect);
    await host.verifyPlacement(output, snapshot);
    await host.showResultAndHideSource(output, source);
    await host.restoreUiState(savedUi);
    if (ctx.isCancelled) throw new Error('USER_CANCELLED');
    await ctx.hostControl.resumeHistory(suspension, true);
  } catch (error) {
    // 若宿主已经取消模态，清理 API 可能也被拒绝。
    // 不吞掉异常；剩余暂停历史由宿主异常退出语义回滚。
    if (!ctx.isCancelled) {
      try { await ctx.hostControl.resumeHistory(suspension, false); }
      catch (rollbackError) { reportRollbackFailure(rollbackError); }
    }
    throw error;
  }
}, { commandName: 'AI 编辑：应用结果' });
```

Adobe 文档说明历史暂停可合并文档变化，`resumeHistory(..., false)` 用于回滚，模态异常退出也有暂停历史的回滚语义。应通过实际故障注入验证，不把伪代码当成已经覆盖所有宿主异常。[A2]

**重要：** 活跃选区可能影响某些宿主命令。资格层与 HostAdapter 必须验证显式像素写入是否受选区影响；必要时在同一事务里保存并暂时清除选区，再完整恢复。不能因为整层模式就让选区意外裁剪结果。

### 9.4 撤销和再次应用

一次应用只产生一个历史步骤，撤销恢复新层不存在、源层原显隐、其他图层不变。生成、预览、设置不应新增 PSD 历史步骤。

面板“撤销本次应用”只有在当前历史顶端仍是本次 AI 步骤时可用。用户后来画笔修改后，此按钮禁用，提示使用 Photoshop 历史面板；不能盲目调用一次 Undo 撤回别人的操作。

同一结果只能应用一次。只有确认本次历史步骤已被撤销并且源状态恢复，才允许重新应用；应用操作本身不重新调用模型、不重复收费。

事务成功但面板通知丢失时，通过本会话记录的 `applyId + resultLayerId + historyMarker` 调和状态。不得由于 UI 没收到成功就再次建层。

## 10. 权限、隐私与缓存

UXP Manifest 显式申请本机网络权限及用户选择文件所需权限；不申请整盘 `fullAccess`。Manifest v5 对网络和文件权限有明确声明要求。[A5]

本地服务校验 Token、Host、请求来源与内容类型。不存在 Origin 的宿主请求仍必须通过 Token 与本机 Host 验证；来自普通网页的请求不能靠宽松 CORS 放行。不要把安全性建立在“本机端口别人访问不到”的假设上。

服务商 URL 默认仅允许 HTTPS。返回图片 URL 限制允许的下载域、重定向次数、体积和超时；阻止私网、环回、link-local、云元数据地址与 DNS 重绑定，不把源 API Key 转发给 CDN。v0.1 不支持任意 URL 抓取和自定义脚本式适配器。

远端请求只包含选中的图层图像、提示词、必要模型参数。UI 在第一次发送前显示实际服务域名。文档名、路径、其他图层、配对 Token 和日志不发送给模型。

缓存建议：本机私有目录，容量上限 512 MiB；完成或失败任务最多保存 24 小时，正常退出清理会话文件，异常遗留启动时清理。删除结果前确认，正在使用的资产不能被回收。缓存图片没有承诺加密，应在设置页明示；密钥和配对 Token 永不写入图片元数据和普通日志。

本地服务或插件重启后不自动恢复可应用任务，不提供长期历史功能。保留的孤儿缓存只做清理，不自动重新绑定 PSD。

## 11. 错误处理表

| 错误码 | 用户看到什么 | 后续动作 |
|---|---|---|
| NO_DOCUMENT | 请先打开一个 Photoshop 文档 | 打开文档后刷新 |
| INVALID_LAYER_SELECTION | 请只选择一个普通像素图层 | 不发请求 |
| UNSUPPORTED_LAYER / DOCUMENT | 显示具体不支持属性 | 不转换原稿 |
| EMPTY_LAYER | 当前图层没有可编辑像素 | 重新选择 |
| BRIDGE_OFFLINE / UNAUTHORIZED | 本地服务未连接 / 配对无效 | 进入设置 |
| IMAGE_EDIT_UNVERIFIED | 当前配置尚未验证图像编辑 | 显式测试或继续并承认未验证 |
| PROVIDER_AUTH / QUOTA / RATE_LIMIT | 分别显示密钥、额度、限流问题 | 不自动重复付费请求 |
| REQUEST_STATUS_UNKNOWN | 上游状态不确定 | 查询或用户确认重试 |
| OUTPUT_INVALID / GEOMETRY_MISMATCH | 无有效图片 / 比例不匹配 | 不写入 PSD |
| SOURCE_CHANGED / TARGET_CLOSED | 原目标已变化 / 文档已关闭 | 导出结果或重新读取 |
| HOST_BUSY | Photoshop 正在处理其他命令 | 保留结果，仅重新应用 |
| WRITEBACK_FAILED | 应用失败；报告回滚结果 | 保留候选，不重新生成 |
| USER_CANCELLED | 已停止本插件等待；上游可能仍计费 | 不自动应用晚到结果 |

## 12. 测试与完成定义

### 12.1 先做 Mock，再接真实模型

Mock 必须提供：原样返回、明显色块变换、透明洞、固定失败、比例异常、慢响应、取消后晚到响应。它是测试适配器，不是成品模型。

### 12.2 最小验收矩阵

| 编号 | 测试 | 通过标准 |
|---|---|---|
| T01 | 非零坐标原样往返 | 原始尺寸与起点完全一致，无新增边缘像素 |
| T02 | 透明/半透明边缘 | 无白边黑边；Alpha 策略结果符合定义 |
| T03 | 透明洞，use-model | 原层隐藏，洞中只显示其他底层，不出现旧主体 |
| T04 | 原层完整性 | 原像素、层级不变，仅按设计改变显隐 |
| T05 | 已有选区 | 整层结果不被意外裁剪，选区原样恢复 |
| T06 | 不同组内源层 | 结果同父级相邻，不改变其他组 |
| T07 | 切换图层/文档 | 不改错目标；无需依赖当前选择 |
| T08 | 等待时涂改/移动源层 | 阻止应用，保留候选 |
| T09 | 关闭重开同名 PSD | 不复用旧 ID 自动写入 |
| T10 | 一次撤销/重做 | 图层数、显隐、像素和相关状态正确 |
| T11 | 应用后另有编辑 | 专用撤销按钮禁用，不撤销后续用户操作 |
| T12 | 创建层/写入/显隐阶段故障 | 回滚后无孤儿层、无隐藏原稿残留 |
| T13 | 双击生成、刷新轮询 | 最多一次上游请求 |
| T14 | 超时且上游已接单 | UNKNOWN，不静默重试 |
| T15 | 用户取消后结果晚到 | 不显示可应用的有效任务 |
| T16 | 返回比例/体积/格式异常 | 拒绝写入，不占满内存 |
| T17 | 内存释放 | 反复 20 次，无持续未释放资产增长 |
| T18 | Token 和 Key 泄漏检查 | 普通日志、配置文件和导出 PNG 中均无敏感值 |
| T19 | 非敏感配置检查 | 不宣称已完成真实生图测试 |
| T20 | 不支持的图层 | UI、接口均明确拒绝，PSD 不变 |

原样往返用规范化源 hash 和像素差分验收；完全透明位置的不可见 RGB 不用于判失败，Alpha 与可见像素必须匹配。模型内容质量和工程像素精度分开评价。

### 12.3 里程碑及依赖

| 里程碑 | 交付物 | 出口条件 |
|---|---|---|
| M0 宿主探针 | UXP 读取、原位回写、单步历史、二进制通信小样 | T01/T04/T05/T10；记录版本与内存 |
| M1 交互骨架 | 编辑页、设置页、错误状态、Mock 流程 | 未调用模型也可完整演示 |
| M2 图像管线 | Alpha、尺寸映射、资产 API | T02/T03/T16 |
| M3 模型适配 | 一套真实配置、测试图、任务轮询 | 单层真实生成，取消/超时正确 |
| M4 应用安全 | 指纹、冲突、故障回滚、幂等应用 | T06–T15 |
| M5 发布验证 | 开发安装包、本地服务启动脚本、运行说明 | 全部必测项通过，无密钥泄漏 |

按出口条件推进，不按未经验证的“六周全部完成”承诺推进。M0 未通过，不先堆 UI 功能或接更多模型。

## 13. 后续选区和蒙版扩展契约

统一 `EditMode`，但 v0.1 运行时 schema 拒绝 `selection` 与 `mask`。未来仍走同一任务服务，不为三种模式复制三套生成后端。

v0.2：用真正的选区像素作为灰度编辑遮罩，不把矩形 bounds 当选区形状。上下文范围与可修改范围分开。

v0.3：输入源层 + 用户指定的蒙版资产；支持图层蒙版和外部灰度文件后，必须预览确认其语义。统一内部语义为 `M=1/白色=允许修改，M=0/黑色=保护`；这是编辑遮罩，不等同于“源图层可见性蒙版”。对要求透明区域代表修改的模型，适配器显式反转为对应 Alpha。

精确保护由程序保证。对 `M=0` 区域直接复制源像素字节；羽化区域使用预乘 Alpha 合成，不简单叠加到仍可见的原层。设颜色为 C、Alpha 为 A，则在线性颜色空间中：

```text
Aout = (1-M) × As + M × Ag
Pout = (1-M) × As × Cs + M × Ag × Cg
Cout = Pout / Aout （Aout > 0；否则为 0）
```

形成完整替代层后再隐藏源层，才能允许局部删除产生透明洞。需要可调蒙版时，再设计完整结果组内的互补蒙版结构，不能未经验证承诺简单贴片就足够。

OpenAI 的蒙版编辑文档说明蒙版用于引导，模型不一定精确遵守形状；因此严格范围保护必须是合成规则，而不是提示词口号。[A6]

## 14. 实施启动说明

交给开发者或编码 Agent 的第一条任务：

> 按本设计建立 workspace，只实现 M0：在 Photoshop 读取受支持的单个像素层，通过 Mock 原样回传，在同一父级原位新增结果层并隐藏原层，一次撤销完整恢复。先完成非零坐标、透明边缘、已有选区三个测试。暂时不接真实模型，不实现选区/蒙版入口，不增加 Agent 功能。

只有此闭环通过后，才按 M1 → M5 推进。UI 以配套原型规范为验收依据，HTML 演示不作为生产 UXP 源代码直接照搬。

## 15. 官方依据与查阅记录

查阅日期：2026-09-17。API 能力以各链接的当前官方文档为依据；版本范围、限额、状态机与 UI 均为本项目设计选择。发布前重新核对使用到的 API 和服务商字段。

- [A1] Adobe — Imaging API： https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/imaging
- [A2] Adobe — ExecuteAsModal / History： https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/executeasmodal
- [A3] Adobe — Layer： https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/layer
- [A4] Adobe — Document： https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/document
- [A5] Adobe — Manifest v5： https://developer.adobe.com/photoshop/uxp/2022/guides/uxp-guide/uxp-misc/manifest-v5/
- [A6] OpenAI — Image generation / editing： https://developers.openai.com/api/docs/guides/image-generation
- [A7] Sharp — Constructor / raw input： https://sharp.pixelplumbing.com/api-constructor/
- [A8] Sharp — Resize： https://sharp.pixelplumbing.com/api-resize/
