# 本地 Mock 验证：2026-09-17

对应 [Issue #3](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/3)。真实 Photoshop 加载与远端模型调用不在本报告范围。

| 检查 | 实际结果 |
|---|---|
| 环境 | Windows；Node.js 24.14.0；pnpm 10.33.0 |
| 冻结依赖重装 | `pnpm install --frozen-lockfile --offline` 通过 |
| TypeScript 编译与 HTTP 合同测试 | `pnpm test`：12/12 通过 |
| 实际 CLI 启动 | 127.0.0.1:47833 健康检查通过；无远端模型入口 |
| 同一服务连续二进制往返 | 20 次，每次与原始 RGBA 逐字节相同 |
| 测试图片生成 | 67 × 43 PNG/RGBA；可重复生成 |
| PNG 独立解码 | Windows System.Drawing：宽高正确，Alpha 值包含 0、127、255 |
| PNG 视觉检查 | 色块、透明洞和半透明条纹可见 |
| 正常退出 | Ctrl+C 后本地会话文件已移除 |
| 素材来源 | 本地程序生成，无用户原稿 |
| 模型费用 | 0 元 |

RGBA SHA-256：`9e65ab61c66f96b9c271efbf482856163e5bdc4763a63ff490881e8b8d396e64`。

初次测试发现 Node.js 的 fetch 会规范化 Host，不能用它构造错误 Host 测试；改为直接 HTTP 请求后验证真实拒绝行为。编译配置显式启用 Node.js 类型，依赖版本已冻结。以上均不证明 UXP 的网络头、图层位置或历史行为。
