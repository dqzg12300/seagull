# Seagull Mobile Reverse

[简体中文](README.md) | [English](README.en.md)

Seagull is a Pi SDK and Electron-based mobile application analysis workbench. It brings CASE management, isolated WORK sessions, Pi Agent, Skills, JADX/IDA/Frida MCP tools, evidence artifacts, and an integrated terminal into one resumable desktop environment.

## Highlights

- Organize target inputs, work records, artifacts, and conversation history by CASE.
- Give every WORK its own directory, Pi session, workflow, and persistent prompt queue.
- Run deobfuscation, reporting, parameter tracing, algorithm recovery, data collection, runtime diagnostics, protocol recovery, version comparison, application reconstruction, and application development workflows.
- Connect JADX, IDA, and Frida MCP servers and check each target tool independently from the UI.
- Use bundled reverse-engineering, Frida, Unidbg, Android development, and runtime-diagnostics Skills; search for and install third-party Skills.
- Open multiple xterm.js/ConPTY terminal tabs with global and CASE-scoped quick commands.
- Attach images, source code, logs, PDFs, Word documents, spreadsheets, archives, and other materials to Pi conversations.
- Switch CASE or WORK without interrupting background execution. Busy sessions support queued prompts with reorder, edit, and delete controls.

## Requirements

- Windows 10/11
- Node.js 20 or newer
- Optional: JADX, IDA, Frida, ADB, Unidbg, and the Android SDK
- An OpenAI-compatible Chat Completions API

## Installation

```powershell
npm install --ignore-scripts
```

Install the Electron runtime if it has not been downloaded yet:

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/' # optional when GitHub downloads are slow
node .\node_modules\electron\install.js
```

## Start the desktop workbench

```powershell
npm run app:dev
```

On first launch, configure the API Host, API Key, model ID, and result output directory under Model settings. Results use this layout:

```text
<output root>/
  <CASE>/
    state.json
    inputs/
    tasks/<WORK>/
    projects/<WORK>/
    .sessions/works/<WORK>/
```

An APK is optional. The Create CASE wizard also accepts source directories, ADB-installed packages, SO/DEX files, logs, PCAPs, and documents.

## Pi CLI extension

The project can also run as a standalone Pi extension:

```powershell
npm run check
pi install -l .
Copy-Item .pi\mobile-reverse.example.json .pi\mobile-reverse.json
pi
```

If Pi is not installed globally:

```powershell
npm run pi
```

Useful commands:

```text
/reverse-case-new demo C:\samples\app.apk
/reverse-case-use demo
/reverse-case-status
/mcp-status
/skill:android-recon
```

MCP tools are registered as `<server>__<tool>`, for example `jadx__search_method`. Calls made while a CASE is active are persisted in its evidence and command logs.

## Development and verification

```powershell
npm run check
npm test
npm run app:build
npm run smoke
```

Preview production bundles with:

```powershell
npm run app:preview
```

## Security

Pi extensions, MCP servers, terminal commands, and generated analysis scripts run with the current user's permissions. Execute untrusted APKs, Frida scripts, native samples, and Unidbg workloads in a dedicated VM or isolated environment. Never commit API keys to shared configuration, logs, or source control.

## License

[MIT](LICENSE)
