# Seagull Mobile Reverse

[简体中文](README.md) | [English](README.en.md)

Seagull 是基于 [Pi SDK](https://github.com/earendil-works/pi) 和 Electron 的移动应用分析工作台。它把 CASE、独立 WORK、Pi Agent、Skills、JADX/IDA/Frida MCP、证据产物与集成终端组织到同一个可恢复的桌面环境中。

## 主要能力

- 使用 CASE 管理同一目标的输入材料、工作记录、产物和历史会话。
- 每个 WORK 拥有独立目录、Pi 会话、分析流程和持久化消息队列。
- 支持反混淆、分析报告、参数回溯、算法还原、数据收集、运行诊断、协议还原、版本对比、应用重构和应用开发。
- 接入 JADX、IDA、Frida MCP，并可在界面中单独检测目标工具是否就绪。
- 内置逆向、Frida、Unidbg、Android 开发和运行诊断 Skills，并支持搜索及安装第三方 Skill。
- 集成基于 xterm.js 与 ConPTY 的多标签终端，支持全局和 CASE 快捷命令。
- 支持图片、源码、日志、PDF、Word、Excel、压缩包等材料作为 Pi 对话附件。
- CASE/WORK 切换不会中断后台任务；繁忙会话支持消息排队、排序、编辑和删除。

## 环境要求

- Windows 10/11
- Node.js 20 或更高版本
- 可选：JADX、IDA、Frida、ADB、Unidbg 和 Android SDK
- 一个 OpenAI-compatible Chat Completions API

## 安装

```powershell
npm install --ignore-scripts
```

如果 Electron 尚未下载运行时：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/' # GitHub 下载较慢时可选
node .\node_modules\electron\install.js
```

## 启动桌面工作台

```powershell
npm run app:dev
```

首次启动后，在“模型设置”中填写 API Host、API Key 和模型 ID，并选择结果输出目录。输出目录采用以下结构：

```text
<输出目录>/
  <CASE>/
    state.json
    inputs/
    tasks/<WORK>/
    projects/<WORK>/
    .sessions/works/<WORK>/
```

没有 APK 时也可以通过“创建 CASE”使用源码目录、ADB 设备应用、SO/DEX、日志、PCAP 或文档作为输入材料。

## Pi CLI 扩展

项目也可以作为 Pi 扩展单独运行：

```powershell
npm run check
pi install -l .
Copy-Item .pi\mobile-reverse.example.json .pi\mobile-reverse.json
pi
```

如果没有全局安装 Pi：

```powershell
npm run pi
```

常用命令：

```text
/reverse-case-new demo C:\samples\app.apk
/reverse-case-use demo
/reverse-case-status
/mcp-status
/skill:android-recon
```

MCP 工具注册为 `<server>__<tool>`，例如 `jadx__search_method`。CASE 激活期间的调用结果会写入对应证据和命令日志。

## 开发与验证

```powershell
npm run check
npm test
npm run app:build
npm run smoke
```

预览生产构建：

```powershell
npm run app:preview
```

## 安全说明

Pi 扩展、MCP 服务、终端命令和生成的分析脚本都以当前用户权限运行。未知 APK、Frida 脚本、Native 样本和 Unidbg 工作负载应放在专用虚拟机或隔离环境中执行。不要把 API Key 写入共享配置、日志或版本库。

## 许可证

[MIT](LICENSE)
