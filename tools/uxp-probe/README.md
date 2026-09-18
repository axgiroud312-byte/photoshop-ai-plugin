# UXP 宿主探针（Issue #2）

这是只读开发探针，不是可生成图片的产品插件。加载后读取宿主版本和 Imaging API 是否存在，结果在面板显示，并写到插件自身数据目录的 `host-probe.json`。

## 本机启动

在项目目录打开 PowerShell：

```powershell
./scripts/devtools.ps1 -Action Install
./scripts/devtools.ps1 -Action Enable
./scripts/devtools.ps1 -Action Start
```

Enable 可能出现 Windows 管理员授权。开发者模式需要用户完成系统授权；取消后先停止此流程，不绕过授权。

保持 Start 所在窗口运行，在另一个 PowerShell 窗口执行：

```powershell
./scripts/devtools.ps1 -Action Apps
./scripts/devtools.ps1 -Action LoadProbe
```

也可以使用已安装的 Adobe UXP Developer Tool，Add Plugin 选择本目录 `manifest.json` 后 Load。确保 Photoshop 已开启其“编辑 → 首选项 → 增效工具 → 启用开发者模式”；如提示重启，先自行保存工作。

## 解释结果

`runtime=UXP-plugin` 且 `requiredApisPresent=true` 说明只读插件/API 通道已可用。它不等于像素往返、网络权限或事务已经测试。#4 才验证原位回填和单步撤销。

当前 `minVersion` 来自候选最低版本，未宣称 Photoshop 26 的实际兼容性。探针尚待真实加载。

## 依据

- [Adobe 开发工具设置](https://developer.adobe.com/uxp/guides/how-to/developer-tools/)
- [Adobe CLI 源码和说明](https://github.com/adobe-uxp/devtools-cli)
- [Adobe Imaging API](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/imaging)

CLI 1.2.0 的 helper 将安装所需的 tar 放在开发依赖，直接 npm 安装失败。本项目脚本先补齐依赖再运行 Adobe 自带安装步骤；安装仅位于 Git 忽略的 `.local/uxp-tools`。
