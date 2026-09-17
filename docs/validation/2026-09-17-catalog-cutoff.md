# 发布前模型目录截止点（候选构建）

- UTC：`2026-09-17T09:35:12.958Z`
- 本地：`2026/9/17 17:35:12`（Asia/Shanghai）
- 来源：现场刷新 `GET https://direct-api.cangyuansuanli.cn/api/pricing` + 对应 `docs-static/models/*.json`（无 Key 列表）
- 公开定价图像模型：26
- 仅文档出现：`nano-banana-pro`、`flux-pro-2`
- 相对 2026-09-17 早间快照删除：`midjourney-1k`、`midjourney-2k`（公开定价与模型文档均不再出现；适配器代码保留，目录不再列出）
- `releaseBlocked`：否（26+2 均已进入适配表；真实调用与人民币计价仍未验证）
- 基线文件 SHA-256：`4e01d5a8ee1ed38ac35f8ea696959a29fe00657283d8822e47636b2d17696051`
- 此截止点之后新出现的图像模型应开新 Issue；若正式发布尚未发生，则重新刷新并阻断过期候选。

本截止点只冻结“发现到的图像模型清单”，不把 Mock 或静态适配写成真实调用通过。 Midjourney 已从公开目录消失，不计入 v0.1 发布清单，也不假装已实测。
