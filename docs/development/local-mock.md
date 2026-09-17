# M0 本地像素往返

对应 [Issue #3](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/3)。本页只验证本地服务，不代表 Photoshop 插件或 Cangyuan 已验收。

## 启动

在项目目录执行，需要 Node.js 24 和 pnpm 10.33.0：

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm fixtures
pnpm bridge
```

服务只监听 `127.0.0.1:47833`。按 Ctrl+C 停止；正常停止会删除本次会话文件。若端口被占用，启动失败，不自动结束其他进程。

会话 Token 随启动重新生成，保存在 Git 忽略的 `.local/bridge-session.local.json`；不要把这个文件或完整请求头发到 GitHub。Token 不是 Cangyuan Key，此版本不会读取模型 Key，也没有远端生成入口。Windows 文件访问权限继承项目目录，Token 不对本机同一用户下的恶意程序提供隔离。

完整本地服务在同一端口提供健康检查、配置、模型目录、资产与任务 API；`POST /v1/mock/roundtrip` 仍保留，供 M0 二进制往返回归。完整安装见 [用户说明](../user/安装与使用.md)。

## 探针协议

下面这条探针协议继续用于 M0 回归，也是最终服务的一部分。

- 请求都需要 `Authorization: Bearer <当前会话 Token>`。
- `GET /v1/health` 返回协议版本、活动请求数和 `remoteGenerationEnabled: false`，不返回 Token。
- `POST /v1/mock/roundtrip?mode=identity` 收发紧密排列的 RGBA8 二进制。
- 类型为 `application/octet-stream`，宽高分别放在 `x-image-width`、`x-image-height`，`Content-Length` 必须等于宽 × 高 × 4。
- `mode` 支持 `identity`、`invert`、`failure`、`slow` 和 `late`。`invert` 只反转 RGB；其他模式用于成功、失败、超时与取消边界测试。
- 响应包含宽高与 `x-pixel-sha256`，仅接受一个活动像素请求。拒绝错误 Host、网页 Origin、Token、长度、类型、尺寸和模式。
- 取消后晚到的数据被丢弃，不产生成功结果；这是本地探针行为，不意味着上游模型退款或取消成功。

UXP 的实际请求头和发送二进制行为须在 #4 中实测；不能用 Node.js 的网络行为代替。

## 测试素材

`pnpm fixtures` 生成 `.local/fixtures/rgba-checker.png`、同名 `.raw` 和 `.json`。素材固定为 67 × 43 像素，带色块、透明洞、半透明条纹和非零 RGB 的透明像素；元数据建议放在文档 `(17, 23)` 处测试。它是可重复的工程素材，不是 AI 生图，不会产生模型费用。

已有测试覆盖认证、Host/Origin、逐字节往返、Alpha、尺寸/长度/类型、失败、单并发、取消和晚到响应。服务测试不能证明图层位置、图层组关系、选区恢复或 Photoshop 单步撤销。
