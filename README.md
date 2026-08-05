# pi-mobile-reverse

Android reverse-engineering workflow package for [Pi](https://github.com/earendil-works/pi). It connects existing Jadx, IDA, and Frida MCP servers, exposes their remote tools to Pi, and preserves calls as case evidence.

## Install

```powershell
npm install --ignore-scripts
npm run check
pi install -l .
```

If Pi is only installed as this project's development dependency, launch it without changing `PATH`:

```powershell
npm run pi
```

To make the plain `pi` command available in every terminal, install the CLI globally and reopen the terminal:

```powershell
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.83.0
```

Copy the example configuration and replace commands/paths with the actual MCP server locations:

```powershell
Copy-Item .pi\mobile-reverse.example.json .pi\mobile-reverse.json
pi
```

Configuration lookup order is `.pi/mobile-reverse.json`, then the untracked `.pi/mcp.local.json`. HTTP uses Streamable HTTP; stdio launches the configured server as a child process.

## Use

```text
/reverse-case-new demo C:\samples\app.apk
/mcp-status
/skill:android-recon
```

Discovered MCP tools are registered as `<server>__<tool>`, for example `jadx__search_method`. Every MCP result called while a case is active is written beneath `.pi/cases/<id>/evidence/`; `state.json` and `commands.jsonl` provide resumable state and an audit trail.

Useful commands:

- `/reverse-case-new <id> [target]`
- `/reverse-case-use <id>`
- `/reverse-case-status`
- `/mcp-status`

## Desktop workbench

The Electron application embeds Pi through its SDK in a separate Node worker process. The renderer receives only typed IPC events and cannot access Node.js, MCP credentials, or the filesystem directly.

Install Electron's runtime after the dependency-only install (the project otherwise uses `--ignore-scripts`):

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/' # optional when GitHub downloads are slow
node .\node_modules\electron\install.js
```

Run the development workbench:

```powershell
npm run app:dev
```

Build and preview the production bundles:

```powershell
npm run app:build
npm run app:preview
```

The first release implements APK selection, case creation, Pi session persistence, MCP status, workflow progress, streamed agent/tool events, structured evidence inspection, logs, prompt steering, and abort.

## Security

Pi extensions and MCP servers execute with the launching user's permissions. Run untrusted APKs, generated Frida code, and Unidbg workloads in a dedicated VM or container. Keep secrets in environment variables or `.pi/mcp.local.json`, never in the shared example configuration.

## Verify

```powershell
npm run check
npm test
npm run smoke
```
