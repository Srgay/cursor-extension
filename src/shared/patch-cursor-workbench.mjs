import { createHash } from "node:crypto";
import { copyFile, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkbenchPaths } from "./cursor-workbench-paths.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const guardSource = resolve(__dirname, "../max-mode-guard/cursor-max-mode-guard.js");
const followupSource = resolve(__dirname, "../mcp-followup/cursor-mcp-followup.js");
const imeFixSource = resolve(__dirname, "../ime-enter-fix/cursor-ime-enter-fix.js");
// 面板在浏览器环境无 fs，靠 WS run_command 读取 ui_settings.json；patch 时把占位符替换成真实绝对路径。
const settingsPath = join(homedir(), ".config", "mcp-feedback-enhanced", "ui_settings.json");
const {
  workbenchDir,
  workbenchHtml,
  guardTarget,
  followupTarget,
  imeFixTarget,
  backupHtml,
  productJson,
  backupProductJson,
} = resolveWorkbenchPaths();

const markerStart = "<!-- cursor-max-mode-guard:start -->";
const markerEnd = "<!-- cursor-max-mode-guard:end -->";
const injection = `${markerStart}
\t<script src="./cursor-max-mode-guard.js" defer></script>
\t${markerEnd}`;

const followupMarkerStart = "<!-- cursor-mcp-followup:start -->";
const followupMarkerEnd = "<!-- cursor-mcp-followup:end -->";
const followupInjection = `${followupMarkerStart}
\t<script src="./cursor-mcp-followup.js" defer></script>
\t${followupMarkerEnd}`;

const imeMarkerStart = "<!-- cursor-ime-enter-fix:start -->";
const imeMarkerEnd = "<!-- cursor-ime-enter-fix:end -->";
const imeInjection = `${imeMarkerStart}
\t<script src="./cursor-ime-enter-fix.js" defer></script>
\t${imeMarkerEnd}`;

function explainPermissionError(error) {
  if (error && error.code === "EPERM" && process.platform === "win32") {
    return [
      "Permission denied while patching Cursor.",
      "",
      `Target: ${workbenchDir}`,
      "",
      "Cursor is installed under a protected Windows directory, such as C:\\Program Files.",
      "Run PowerShell as Administrator and execute npm run patch again.",
      "",
      "Alternative:",
      '$env:CURSOR_WORKBENCH_DIR="C:\\Path\\To\\Cursor\\resources\\app\\out\\vs\\code\\electron-sandbox\\workbench"',
      "npm run patch",
    ].join("\n");
  }

  return null;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function checksumBase64NoPadding(content) {
  return createHash("sha256").update(content).digest("base64").replace(/=+$/, "");
}

async function updateProductChecksum() {
  if (!(await exists(productJson))) {
    return { updated: false, reason: "product.json not found" };
  }

  const productText = await readFile(productJson, "utf8");
  if (!(await exists(backupProductJson))) {
    await writeFile(backupProductJson, productText);
  }

  const product = JSON.parse(productText);
  product.checksums ||= {};

  const checksumKey = "vs/code/electron-sandbox/workbench/workbench.html";
  const htmlBuffer = await readFile(workbenchHtml);
  const checksum = checksumBase64NoPadding(htmlBuffer);
  const previous = product.checksums[checksumKey];

  product.checksums[checksumKey] = checksum;
  await writeFile(productJson, `${JSON.stringify(product, null, 2)}\n`);

  return {
    updated: previous !== checksum,
    key: checksumKey,
    previous,
    checksum,
    productJson,
    backupProductJson,
  };
}

async function main() {
  const html = await readFile(workbenchHtml, "utf8");

  if (!(await exists(backupHtml))) {
    await writeFile(backupHtml, html);
  }

  await copyFile(guardSource, guardTarget);

  // MCP 面板：不是单纯拷贝，需把 __MCP_SETTINGS_PATH__ 占位符替换成真实路径后再写入。
  const followupCode = (await readFile(followupSource, "utf8")).replace("__MCP_SETTINGS_PATH__", settingsPath);
  await writeFile(followupTarget, followupCode);

  // 输入法回车修复：无占位符，直接拷贝。
  await copyFile(imeFixSource, imeFixTarget);

  const needle = '<script src="./workbench.js" type="module"></script>';

  let nextHtml = html;
  if (!nextHtml.includes(markerStart)) {
    if (!nextHtml.includes(needle)) {
      throw new Error(`Cannot find workbench startup script in ${workbenchHtml}`);
    }
    nextHtml = nextHtml.replace(needle, `${needle}\n\t${injection}`);
  }
  if (!nextHtml.includes(followupMarkerStart)) {
    if (!nextHtml.includes(needle)) {
      throw new Error(`Cannot find workbench startup script in ${workbenchHtml}`);
    }
    nextHtml = nextHtml.replace(needle, `${needle}\n\t${followupInjection}`);
  }
  if (!nextHtml.includes(imeMarkerStart)) {
    if (!nextHtml.includes(needle)) {
      throw new Error(`Cannot find workbench startup script in ${workbenchHtml}`);
    }
    nextHtml = nextHtml.replace(needle, `${needle}\n\t${imeInjection}`);
  }

  if (nextHtml !== html) {
    await writeFile(workbenchHtml, nextHtml);
  }

  const productChecksum = await updateProductChecksum();

  console.log(
    JSON.stringify(
      {
        patched: true,
        platform: process.platform,
        workbenchDir,
        workbenchHtml,
        backupHtml,
        guardTarget,
        followupTarget,
        imeFixTarget,
        settingsPath,
        productChecksum,
        alreadyPatched: html.includes(markerStart),
        followupAlreadyPatched: html.includes(followupMarkerStart),
        imeFixAlreadyPatched: html.includes(imeMarkerStart),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(explainPermissionError(error) || (error && error.stack) || error);
  process.exitCode = 1;
});
