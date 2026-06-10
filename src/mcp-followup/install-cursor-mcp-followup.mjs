import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMcpFollowupReplacements } from "../shared/mcp-settings.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.CURSOR_DEBUG_PORT || "9222");
const sourcePath = resolve(__dirname, "cursor-mcp-followup.js");

if (typeof WebSocket !== "function") {
  throw new Error("This script needs Node.js with global WebSocket support. Use Node.js 20 or newer.");
}

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

function pickWorkbenchTarget(targets) {
  return targets.find((target) => {
    return target.type === "page" && typeof target.url === "string" && target.url.includes("workbench.html");
  });
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;

  const opened = new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener("open", resolveOpen, { once: true });
    ws.addEventListener("error", rejectOpen, { once: true });
  });

  function call(method, params = {}) {
    return new Promise((resolveCall, rejectCall) => {
      const msgId = ++id;
      const timer = setTimeout(() => rejectCall(new Error(`CDP call timed out: ${method}`)), 5000);

      function onMessage(event) {
        const data = JSON.parse(event.data);
        if (data.id !== msgId) return;

        clearTimeout(timer);
        ws.removeEventListener("message", onMessage);
        if (data.error) {
          rejectCall(new Error(JSON.stringify(data.error)));
        } else {
          resolveCall(data.result);
        }
      }

      ws.addEventListener("message", onMessage);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  return { ws, opened, call };
}

const targets = await json(`http://127.0.0.1:${port}/json/list`);
const target = pickWorkbenchTarget(targets);

if (!target) {
  throw new Error(
    `Cursor workbench target was not found on port ${port}. Start Cursor with: open -na /Applications/Cursor.app --args --remote-debugging-port=${port}`
  );
}

// 面板运行在浏览器环境（无 fs），改用 WS run_command 读写 ui_settings.json；
// 这里在 Node 侧按平台把占位符替换成真实路径与命令（Windows 用正斜杠 + python，详见 shared/mcp-settings.mjs）。
const source = applyMcpFollowupReplacements(await readFile(sourcePath, "utf8"));
const client = connect(target.webSocketDebuggerUrl);

await client.opened;
await client.call("Runtime.enable");

const result = await client.call("Runtime.evaluate", {
  expression: source,
  returnByValue: true,
  awaitPromise: true,
});

client.ws.close();

if (result.exceptionDetails) {
  throw new Error(result.exceptionDetails.text || "Injection failed");
}

console.log(JSON.stringify(result.result?.value || result.result || {}, null, 2));
