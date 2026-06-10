# Cursor Extension

一组本机 Cursor workbench 增强脚本，包含三部分：

1. **MAX Mode 守护**：保持 `MAX Mode` 关闭，并在彩色 `MAX` 标记出现且聊天框有内容时阻止发送。
2. **MCP Follow-up 面板**：在 Cursor 聊天框上方注入一个 MCP 反馈面板，连接 `mcp-feedback-enhanced` 的 WebSocket，让你直接在 Cursor 里回复 `interactive_feedback`，并支持端口自动扫描与自定义。
3. **输入法回车修复**：修复用中文输入法（拼音/注音等）组字时，按回车上屏候选词会被 Cursor 误当成「提交」的问题（含自带的 AskQuestion「Other」输入框）。

## 安装与使用（npx）

无需克隆仓库，直接用 `npx` 运行（需 Node.js ≥ 20）：

```bash
# 持久安装：patch Cursor 的 workbench.html，随 Cursor 启动自动加载三个脚本（推荐）
npx @srgay/cursor-extension install

# 还原安装
npx @srgay/cursor-extension uninstall

# CDP 临时注入（需先用调试端口启动 Cursor；重启 Cursor 后失效）
npx @srgay/cursor-extension inject            # 注入全部三个
npx @srgay/cursor-extension inject followup   # 只注入某一个：max | followup | ime | all

# 查看帮助
npx @srgay/cursor-extension help
```

- `install` 后需**完整退出并重新打开 Cursor** 才生效。
- Cursor 更新可能覆盖 `workbench.html`，功能失效时重新执行 `install`。
- 自定义 Cursor 安装目录：设置环境变量 `CURSOR_WORKBENCH_DIR`。
- `inject` 自定义调试端口：设置环境变量 `CURSOR_DEBUG_PORT`（默认 `9222`）。
- MCP 面板配置读写所用的 python 命令：默认按平台自动探测（`python` / `py` / `python3`），可用环境变量 `CURSOR_MCP_PYTHON` 强制指定（某些 Windows 环境用得上）。

> 说明：下文「推荐方式 / 备用方式」里的 `npm run patch`、`npm run inject` 等是**本仓库源码开发**用法；最终用户用上面的 `npx` 命令即可，二者等价。

## 功能：MAX Mode 守护

- 检测彩色 `MAX` badge。
- 点击 badge 打开模型菜单。
- 只在菜单里的精确 `MAX Mode` 行是 `aria-checked="true"` 时点击关闭。
- 如果彩色 `MAX` 存在且聊天框有内容，显示 50px 红色渐变边框。
- 同一条件下禁用 `.send-with-mode` 发送控件，并拦截点击发送和回车发送。
- 脚本加载成功后，在 Cursor 右下角短暂显示 `Cursor Extension loaded`。

## 推荐方式：随 Cursor 启动加载

Patch Cursor 的 `workbench.html`，让三个脚本（**MAX Mode 守护**、**MCP Follow-up 面板**、**输入法回车修复**）都随 Cursor 启动自动加载，**无需调试端口、无需每次手动注入**：

```bash
npm run patch
```

Patch 行为：

- 注入 `<script src="./cursor-max-mode-guard.js">`、`<script src="./cursor-mcp-followup.js">`、`<script src="./cursor-ime-enter-fix.js">` 到 `workbench.html`（各自带注释标记，便于幂等与回退）。
- 把 `cursor-mcp-followup.js` 拷入 workbench 目录时，按当前系统替换其中的路径/命令占位符：配置路径 `~/.config/mcp-feedback-enhanced/ui_settings.json`（Windows 为 `C:/Users/<你>/.config/...`，统一用正斜杠），以及读取命令（Mac/Linux 用 `cat`、Windows 用 `python -X utf8` 读取）与写入用的 python 命令名（面板借 WS `run_command` 读写该文件，实现常用提示词与自动提交配置的查看/编辑）。
- 同步更新 Cursor `product.json` 里的 `workbench.html` checksum，避免 Cursor 把这次修改识别为安装损坏。

> 注意：占位符在 patch 时按当前用户主目录与操作系统写死。若更换用户/主目录或操作系统，重新执行 `npm run patch`。

然后完整退出 Cursor，再重新打开 Cursor。

恢复：

```bash
npm run unpatch
```

Cursor 更新后可能会覆盖 `workbench.html`，如果功能失效，重新执行 `npm run patch`。

默认路径：

- macOS: `/Applications/Cursor.app/Contents/Resources/app/out/vs/code/electron-sandbox/workbench`
- Windows: 优先自动探测 `%LOCALAPPDATA%\Programs\Cursor\resources\app\out\vs\code\electron-sandbox\workbench`
- Windows: 如果用户目录不存在，会尝试 `C:\Program Files\cursor\resources\app\out\vs\code\electron-sandbox\workbench`

如果 Cursor 安装在其它目录，可以手动指定：

```bash
CURSOR_WORKBENCH_DIR="/path/to/workbench" npm run patch
```

Windows PowerShell:

```powershell
$env:CURSOR_WORKBENCH_DIR="C:\Path\To\Cursor\resources\app\out\vs\code\electron-sandbox\workbench"
npm run patch
```

如果 Windows 报 `EPERM: operation not permitted`，说明 Cursor 安装在 `C:\Program Files` 等受保护目录。请用管理员身份打开 PowerShell 后重新执行：

```powershell
npm run patch
```

## 备用方式：临时注入

临时注入适合调试脚本，不推荐作为日常使用方式。它需要用调试端口启动 Cursor：

```bash
open -na /Applications/Cursor.app --args --remote-debugging-port=9222
```

然后在本项目根目录执行：

```bash
npm run inject
```

## MCP Follow-up 面板

在 Cursor 聊天输入框**上方**注入一个 MCP 反馈面板，连接 `mcp-feedback-enhanced` 的 WebSocket（`ws://127.0.0.1:{port}/ws`），让你直接在 Cursor 内回复 `interactive_feedback` 调用，无需切到独立的 WebUI。

### 功能

- 注入到聊天框上方，样式贴合 Cursor 原生输入框。
- 自动扫描端口 `8765–8769`，识别正在监听的 MCP 服务（连得上或返回 `4004 无 session` 即视为活跃）。
- 端口下拉：动态填充扫描到的活跃端口，末尾提供「自定义端口…」可手动输入任意端口。
- 下拉展开时每项显示「状态 · 项目名」（如 `Port 8766 · waiting · my-project`），收起时只显示「Port X · 状态」以贴合宽度，避免与右侧项目名重复。
- 放大镜按钮可随时重新扫描。
- 持续保持为 WebSocket「最后连接」（每 3 秒重连 + 输入框聚焦时重连），确保始终能收到当前会话并成功提交反馈。
- 底部「常用提示词」下拉：一键把 `ui_settings.json` 里的提示词追加到输入框；旁边刷新按钮可重新拉取配置。
- 齿轮按钮展开**配置抽屉**：
  - **常用提示词**增删改（写回 `ui_settings.json`，删除带二次确认）。
  - **自动提交**配置：启用开关、超时（秒）、选择提示词，状态实时回显。
  - **自动提交运行时**：仅在「等待反馈」时倒计时，输入框右侧显示 `自动提交 m:ss` 小标签；到点自动以所选提示词发送（走与手动一致的重连抢占）。用户输入/手动插入提示词/手动发送/点击倒计时/会话离开等待态，本轮即取消自动提交。
- 配置读写均借现有 WebSocket 的 `run_command` 完成（Mac/Linux 读用 `cat`，Windows 读用 `python -X utf8`；写入两平台都用 python base64 解码落盘），不依赖本地文件系统访问或 CORS。服务端以 `shell=False` + `shlex.split` 执行命令，故 Windows 路径统一用正斜杠以规避转义。

### 加载方式

- **推荐：随 Cursor 启动加载**（持久，不依赖调试端口）。执行 `npm run patch` 后完整重启 Cursor 即可，详见上文「推荐方式」。
- **备用：CDP 临时注入**（适合调试脚本，重启 Cursor 后失效）。先用调试端口启动 Cursor：

```bash
open -na /Applications/Cursor.app --args --remote-debugging-port=9222
```

然后在本项目根目录执行：

```bash
npm run inject:followup
```

> CDP 注入是临时的，**重启 Cursor 后需要重新执行**；`install-cursor-mcp-followup.mjs` 会在注入时按平台替换路径/命令占位符（详见 `src/shared/mcp-settings.mjs`）。

### 端口扫描与自定义

- 面板安装时自动扫描一次 `8765–8769`。
- 点击放大镜按钮可手动重扫。
- 在端口下拉里选择「自定义端口…」，就地输入端口号回车即可连接；输入框失焦或按 `Esc` 会回退到第一个可用端口。

### 查看状态

在 Cursor DevTools/CDP 里执行：

```js
window.__cursorMcpFollowup.status()
```

返回挂载状态、当前连接端口、会话信息、扫描结果（`foundPorts`）、各端口项目名/状态等。

### 手动操作

```js
window.__cursorMcpFollowup.scan()         // 重新扫描端口
window.__cursorMcpFollowup.reconnect()    // 重连当前选中端口
window.__cursorMcpFollowup.remount()      // 重新挂载面板到聊天框上方
window.__cursorMcpFollowup.toggleConfig() // 展开/收起配置抽屉
window.__cursorMcpFollowup.uninstall()    // 卸载面板
```

### 可调参数

脚本顶部 `config` 可调整：

- `scanStart` / `scanCount`：扫描起始端口与数量（默认从 `8765` 起、共 `5` 个，即 `8765–8769`）。
- `probeTimeoutMs`：单端口探测超时（默认 `1200` ms）。
- `reconnectMs`：自动重连间隔（默认 `3000` ms）。

### 排障

- **面板没出现**：确认 Cursor 用 `--remote-debugging-port=9222` 启动且聊天侧边栏已打开；可执行 `window.__cursorMcpFollowup.remount()`。
- **一直显示 Offline**：对应端口当前没有活跃的 MCP 会话；点放大镜重扫，或确认 `mcp-feedback-enhanced` 已在该端口监听。
- **收不到会话 / 提交无效**：面板靠定期重连抢占「最后连接」；若 Cursor 自带 WebUI 同时连着，聚焦输入框会触发立即重连抢回当前会话。

## 功能：输入法回车修复

修复用中文输入法（拼音/注音等）**组字时按回车上屏候选词被误当成「提交」**的问题。典型场景是 Cursor 自带的 **AskQuestion「Other / 其他」自定义输入框**（`textarea.composer-questionnaire-toolbar-freeform-input`）。

原理：在 `window` 捕获阶段最早拦截「组字进行中的回车」（依据 `isComposing` / `keyCode 229` / `compositionstart~end` 跟踪），`stopImmediatePropagation` 阻止其到达应用级回车提交处理器；**不调用 `preventDefault`**，保证输入法正常上屏。组字结束后回车一切照旧；代码编辑器（Monaco）自行处理组字，已跳过避免误伤。

### 加载方式

- **推荐：随 Cursor 启动加载**，执行 `npm run patch` 后重启 Cursor（见上文「推荐方式」）。
- **备用：CDP 临时注入**（重启失效）：

```bash
open -na /Applications/Cursor.app --args --remote-debugging-port=9222
npm run inject:ime
```

### 查看状态 / 卸载

```js
window.__cursorImeEnterFix.status()    // 含 guardedCount（已拦截次数）/ lastGuardedTarget（最近被拦输入框）
window.__cursorImeEnterFix.uninstall() // 卸载
```

## 目录

按功能分组，每个功能自成一夹，共享工具单独放在 `src/shared/`：

- `src/max-mode-guard/` — MAX Mode 守护
  - `cursor-max-mode-guard.js`: 注入到 Cursor workbench 页面的守护脚本。
  - `install-cursor-max-mode-guard.mjs`: 通过 CDP 临时注入 MAX Mode 守护脚本。
- `src/mcp-followup/` — MCP Follow-up 面板
  - `cursor-mcp-followup.js`: MCP Follow-up 面板注入脚本。
  - `install-cursor-mcp-followup.mjs`: 通过 CDP 临时注入 MCP Follow-up 面板。
- `src/ime-enter-fix/` — 输入法回车修复
  - `cursor-ime-enter-fix.js`: 输入法组字回车修复脚本（全局生效）。
  - `install-cursor-ime-enter-fix.mjs`: 通过 CDP 临时注入输入法回车修复。
- `src/shared/` — 共享工具
  - `cursor-workbench-paths.mjs`: macOS/Windows workbench 路径解析。
  - `mcp-settings.mjs`: 按平台生成 MCP 面板的配置路径与读/写命令（探测 python，Windows 用正斜杠）。
  - `patch-cursor-workbench.mjs`: patch Cursor 的 `workbench.html`（注入全部三个脚本）。
  - `unpatch-cursor-workbench.mjs`: 恢复 patch。

## 查看状态（MAX Mode 守护）

在 Cursor DevTools/CDP 里执行：

```js
window.__cursorMaxModeGuard.status()
```

## 页面内卸载（MAX Mode 守护）

```js
window.__cursorMaxModeGuard.uninstall()
```

## 校验

```bash
npm run check
```
