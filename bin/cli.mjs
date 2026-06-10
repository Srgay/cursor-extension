#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const PATCH = "src/shared/patch-cursor-workbench.mjs";
const UNPATCH = "src/shared/unpatch-cursor-workbench.mjs";
const INJECT = {
  max: "src/max-mode-guard/install-cursor-max-mode-guard.mjs",
  followup: "src/mcp-followup/install-cursor-mcp-followup.mjs",
  ime: "src/ime-enter-fix/install-cursor-ime-enter-fix.mjs",
};

const HELP = `cursor-extension — 本机 Cursor workbench 增强
（MAX Mode 守护 / MCP Follow-up 面板 / 输入法回车修复）

用法:
  npx @srgay/cursor-extension <命令> [参数]

命令:
  install               patch Cursor 的 workbench.html，随 Cursor 启动自动加载三个脚本（持久，推荐）
  uninstall             还原 install 的改动
  inject [target]       通过 CDP 临时注入（重启 Cursor 后失效）
                        target: max | followup | ime | all（默认 all）
  help                  显示本帮助

别名:
  patch = install        unpatch = uninstall

环境变量:
  CURSOR_WORKBENCH_DIR  手动指定 Cursor workbench 目录（install / uninstall）
  CURSOR_DEBUG_PORT     CDP 调试端口（inject，默认 9222）

示例:
  npx @srgay/cursor-extension install
  npx @srgay/cursor-extension uninstall
  npx @srgay/cursor-extension inject            # 注入全部三个
  npx @srgay/cursor-extension inject followup   # 只注入 MCP 面板

提示:
  - install 后需完整退出并重新打开 Cursor 才生效。
  - inject 需先用调试端口启动 Cursor，例如 macOS:
      open -na /Applications/Cursor.app --args --remote-debugging-port=9222
`;

function runScript(rel) {
  const result = spawnSync(process.execPath, [resolve(root, rel)], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

function runMany(rels) {
  for (const rel of rels) {
    const code = runScript(rel);
    if (code !== 0) return code;
  }
  return 0;
}

const [cmd, sub] = process.argv.slice(2);
let code = 0;

switch (cmd) {
  case "install":
  case "patch":
    code = runScript(PATCH);
    break;
  case "uninstall":
  case "unpatch":
    code = runScript(UNPATCH);
    break;
  case "inject": {
    const target = (sub || "all").toLowerCase();
    const list = target === "all" ? ["max", "followup", "ime"] : [target];
    const unknown = list.find((t) => !INJECT[t]);
    if (unknown) {
      console.error(`未知 inject 目标: ${unknown}（可选 max | followup | ime | all）`);
      code = 1;
      break;
    }
    code = runMany(list.map((t) => INJECT[t]));
    break;
  }
  case "help":
  case "--help":
  case "-h":
  case undefined:
    console.log(HELP);
    break;
  default:
    console.error(`未知命令: ${cmd}\n`);
    console.log(HELP);
    code = 1;
}

process.exit(code);
