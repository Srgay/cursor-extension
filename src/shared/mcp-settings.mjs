import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

// MCP Follow-up 面板运行在浏览器环境（无 fs），通过现有 WS 的 run_command 读/写 ui_settings.json。
// 服务端（mcp-feedback-enhanced）以 shell=False + shlex.split(POSIX) 执行命令，因此：
//   - 路径里的反斜杠会被 shlex 与 Python 字面量双重转义 → Windows 统一改用正斜杠；
//   - Windows 没有 cat / 不一定有 python3 → 读取改用探测到的 python，并用 -X utf8 规避编码问题。
// 这里在注入脚本（Node 侧、与 Cursor/MCP 同机）按平台生成真实路径与命令，替换面板里的占位符。

// 探测可用的 python 命令名：优先环境变量 CURSOR_MCP_PYTHON，其次按平台候选逐一 `--version` 验证。
function detectPython() {
  const override = process.env.CURSOR_MCP_PYTHON;
  if (override && override.trim()) return override.trim();

  const isWin = process.platform === "win32";
  const candidates = isWin ? ["python", "py", "python3"] : ["python3", "python"];
  for (const cmd of candidates) {
    try {
      const result = spawnSync(cmd, ["--version"], { stdio: "ignore" });
      if (!result.error && result.status === 0) return cmd;
    } catch {
      // 忽略，尝试下一个候选
    }
  }
  return isWin ? "python" : "python3";
}

// 生成面板占位符的真实取值：配置文件绝对路径、python 命令名、完整读取命令。
export function buildMcpFollowupReplacements() {
  const isWin = process.platform === "win32";

  // 与 mcp-feedback-enhanced 一致：~/.config/mcp-feedback-enhanced/ui_settings.json（无平台分支）。
  let settingsPath = join(homedir(), ".config", "mcp-feedback-enhanced", "ui_settings.json");
  if (isWin) settingsPath = settingsPath.replace(/\\/g, "/");

  const pyCmd = detectPython();

  // 读取命令：Mac/Linux 用现成的 cat；Windows 无 cat，用 python 的 UTF-8 模式读取。
  const readCmd = isWin
    ? `${pyCmd} -X utf8 -c "print(open('${settingsPath}').read())"`
    : `cat ${settingsPath}`;

  return { settingsPath, pyCmd, readCmd };
}

// 把面板源码里的占位符替换为真实取值。用函数式替换以避免 $ 等特殊字符被当作替换模式。
export function applyMcpFollowupReplacements(code) {
  const { settingsPath, pyCmd, readCmd } = buildMcpFollowupReplacements();
  return code
    .replace("__MCP_SETTINGS_PATH__", () => settingsPath)
    .replace("__MCP_READ_CMD__", () => readCmd)
    .replace("__MCP_PY__", () => pyCmd);
}
