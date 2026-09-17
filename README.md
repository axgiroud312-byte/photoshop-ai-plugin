# Photoshop AI Plugin

面向 Windows Photoshop 的 AI 图层编辑与文字生图插件，首版接入沧元算力（Cangyuan）的图像模型。

## 当前状态

项目正在建立工程与验收流程，尚未发布可用插件。根目录两份 v1.0 文档是初始设计，后续确认的范围以 `docs/plans/` 为准。

目标流程：选择模型与修改要求 → 生成候选 → 选择一张并预览 → 确认后应用为 Photoshop 新图层。

整层编辑保留并隐藏原层；文字生图保留已有图层显隐。Photoshop 的真实图层往返、透明边缘、位置和单步撤销是首个开发里程碑。

## 资料

- [初始技术设计](01-technical-design.md)
- [初始 UI 规范](02-ui-prototype-spec.md)
- [当前开发计划](docs/plans/README.md)
- [模型能力与接口证据](docs/plans/02-cangyuan.md)
- [开发任务与依赖](docs/plans/01-roadmap.md)
- [验收与 30 元测试预算](docs/plans/03-validation.md)

请通过 GitHub Issues 跟踪开发与实际验证状态。用户 PSD、API Key、本地缓存与私有测试记录不会提交到仓库。
