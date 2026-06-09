# Cursor Extension

一个本机 Cursor workbench 扩展守护脚本，用来保持 `MAX Mode` 关闭，并在彩色 `MAX` 标记出现且聊天框有内容时阻止发送。

## 功能

- 检测彩色 `MAX` badge。
- 点击 badge 打开模型菜单。
- 只在菜单里的精确 `MAX Mode` 行是 `aria-checked="true"` 时点击关闭。
- 如果彩色 `MAX` 存在且聊天框有内容，显示 50px 红色渐变边框。
- 同一条件下禁用 `.send-with-mode` 发送控件，并拦截点击发送和回车发送。

## 推荐方式：随 Cursor 启动加载

Patch Cursor 的 `workbench.html`，让脚本随 Cursor 启动加载：

```bash
npm run patch
```

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

## 备用方式：临时注入

临时注入适合调试脚本，不推荐作为日常使用方式。它需要用调试端口启动 Cursor：

```bash
open -na /Applications/Cursor.app --args --remote-debugging-port=9222
```

然后在本项目根目录执行：

```bash
npm run inject
```

## 目录

- `src/cursor-max-mode-guard.js`: 注入到 Cursor workbench 页面的守护脚本。
- `src/patch-cursor-workbench.mjs`: patch Cursor 的 `workbench.html`。
- `src/unpatch-cursor-workbench.mjs`: 恢复 patch。
- `src/install-cursor-max-mode-guard.mjs`: 通过 CDP 临时注入。
- `src/cursor-workbench-paths.mjs`: macOS/Windows workbench 路径解析。

## 查看状态

在 Cursor DevTools/CDP 里执行：

```js
window.__cursorMaxModeGuard.status()
```

## 页面内卸载

```js
window.__cursorMaxModeGuard.uninstall()
```

## 校验

```bash
npm run check
```
