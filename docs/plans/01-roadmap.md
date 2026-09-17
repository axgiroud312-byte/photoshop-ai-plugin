# 路线图与 Issue 开发顺序

所有编号链接均为已创建的真实 GitHub Issue。原始 M0–M5 出口条件继续有效，Cangyuan 全模型和文字生图增量已经计入。

## 里程碑

| 阶段 | 出口条件 |
|---|---|
| M0 宿主基础 | 真实 UXP 可调用；RGBA 经本地 Mock 往返；同父级非零坐标回写；选区恢复；一次撤销 |
| M1 界面 | 整层编辑、文字生图、候选单选、设置和错误状态在真实 UXP 中工作 |
| M2 图像处理 | PNG/RGBA、精确位置尺寸、透明边缘及候选规范化测试通过 |
| M3 Cangyuan | 模型能力、输入传递、逐模型协议、异步任务和计费约束完成 |
| M4 应用安全 | 指纹、冲突、故障回滚、幂等应用与撤销资格通过 |
| M5 交付 | 最新目录已验收，30 元内的模型证据和真实宿主记录齐备，安装及使用步骤可复现 |

## Issue 清单

| Issue | 工作 | 阶段 | 依赖 |
|---|---|---|---|
| [#1](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/1) | 仓库、当前计划、Issue 工作流 | 初始化 | 用户已确认需求 |
| [#2](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/2) | 接通 UXP 开发通道并核实真实 Photoshop 宿主 | M0 | #1 |
| [#3](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/3) | 建立 TypeScript 工程、二进制本地桥接与 Mock 往返 | M0 | #1 |
| [#4](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/4) | 验证非零坐标图层原样写回与单步撤销 | M0 | [#2](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/2)、[#3](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/3) |
| [#5](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/5) | 实现图像尺寸映射、透明度策略与候选规范化 | M2 | [#4](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/4) |
| [#6](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/6) | 接入 Cangyuan 全图像模型发现、能力表与动态目录 | M3 | [#4](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/4) |
| [#7](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/7) | 验证本地图层文件直传 Cangyuan 的实际输入契约 | M3 | #1 |
| [#8](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/8) | 实现 Cangyuan 异步生图、编辑、计费上限和任务恢复规则 | M3 | [#6](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/6)、[#7](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/7)、[#5](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/5) |
| [#9](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/9) | 实现整层编辑、文字生图、候选选择与设置面板 | M1 | [#4](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/4)、[#3](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/3) |
| [#10](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/10) | 完成源状态指纹、事务回滚、幂等应用和撤销资格 | M4 | [#5](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/5)、[#9](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/9) |
| [#11](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/11) | 执行真实 Photoshop 与发布前全部模型验收 | M5 | [#8](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/8)、[#10](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/10)、[#9](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/9) |
| [#12](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/12) | 交付开发安装包、启动入口、运行说明与发布检查 | M5 | [#11](https://github.com/axgiroud312-byte/photoshop-ai-plugin/issues/11) |

用户最新要求先开发、后真机验收：M0 改为发布/宿主验收前置条件，不再阻止后续代码实施。表中依赖继续约束验收与关闭 Issue；可在模拟宿主和本地合同测试下先开发相关模块。#7 没有 Key 或文件直传证据时保持未完成，不影响免费工程验证。

## 提交与关联

- 分支：`feat/2-host-environment`、`feat/3-mock-bridge`、`docs/1-project-plan`。
- 提交：`feat: add local RGBA roundtrip (refs #3)`。
- 部分实现 PR 用 `Refs #3`，完整通过后才用 `Closes #3`。
- Issue 更新记录“实际完成、证据、未通过项、下一步”。原始测试报告放本地，公开摘要去掉凭据、私有路径和用户画面。
- 合并条件：相关自动检查通过，涉及宿主的改动还有真实 Photoshop 证据。编译成功不等于 Issue 的验收已完成。

## 发布前的模型变化

发布候选阶段重新获取公开目录、逐模型契约和当前 Key 可见列表，与开发基线比较。新增图像模型、路由变化和参数变化须补充 Issue/现有验收项，并完成相关实现与回归后才能发布。若新增模型权限不足或协议不明，明确保留发布阻碍，不静默从“全部”中删除。
