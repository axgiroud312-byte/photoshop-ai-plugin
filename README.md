# Photoshop AI Plugin

面向 Windows Photoshop 的 UXP Manifest v5 插件：整层编辑与文字生图，本地 Node 服务转发沧元算力（Cangyuan）图像模型。选区编辑是 v0.2，蒙版编辑是 v0.3。

## 当前状态

- 本地 Mock 服务、资产管线、动态模型目录、任务状态机、模拟宿主应用和 UXP 面板代码已经集成。
- 默认 Mock 下可重复跑通两条用户流程（生成候选 → 单选 → 导出/应用合同）。这不是真实 Photoshop 或真实模型验收。
- 真实 UXP 加载与真实 Cangyuan 付费调用仍开放跟踪；没有项目 Key 时不会发起付费请求。
- 仓库公开，当前不加开源许可证。

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm plugin:build
pnpm bridge
```

安装、配对和卸载见 [用户说明](docs/user/安装与使用.md)。开发命令与证据分层见 [开发者说明](docs/development/developer.md)。

## 资料

- [初始技术设计](01-technical-design.md)
- [初始 UI 规范](02-ui-prototype-spec.md)
- [当前开发计划](docs/plans/README.md)
- [模型能力与接口证据](docs/plans/02-cangyuan.md)
- [开发任务与依赖](docs/plans/01-roadmap.md)
- [验收与 30 元测试预算](docs/plans/03-validation.md)
- [运行本地 Mock](docs/development/local-mock.md)
- [v0.1 测试矩阵](docs/validation/2026-09-17-v01-matrix.md)

请通过 GitHub Issues 跟踪开发与实际验证状态。用户 PSD、API Key、本地缓存与私有测试记录不会提交到仓库。
