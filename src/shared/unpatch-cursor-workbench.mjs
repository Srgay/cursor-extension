import { copyFile, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolveWorkbenchPaths } from "./cursor-workbench-paths.mjs";

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
const followupMarkerStart = "<!-- cursor-mcp-followup:start -->";
const followupMarkerEnd = "<!-- cursor-mcp-followup:end -->";
const imeMarkerStart = "<!-- cursor-ime-enter-fix:start -->";
const imeMarkerEnd = "<!-- cursor-ime-enter-fix:end -->";

function explainPermissionError(error) {
  if (error && error.code === "EPERM" && process.platform === "win32") {
    return [
      "Permission denied while restoring Cursor.",
      "",
      `Target: ${workbenchDir}`,
      "",
      "Cursor is installed under a protected Windows directory, such as C:\\Program Files.",
      "Run PowerShell as Administrator and execute npm run unpatch again.",
      "",
      "Alternative:",
      '$env:CURSOR_WORKBENCH_DIR="C:\\Path\\To\\Cursor\\resources\\app\\out\\vs\\code\\electron-sandbox\\workbench"',
      "npm run unpatch",
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

async function main() {
  if (await exists(backupHtml)) {
    await copyFile(backupHtml, workbenchHtml);
  } else {
    const html = await readFile(workbenchHtml, "utf8");
    const guardPattern = new RegExp(`\\n?\\t?${markerStart}[\\s\\S]*?${markerEnd}`, "m");
    const followupPattern = new RegExp(`\\n?\\t?${followupMarkerStart}[\\s\\S]*?${followupMarkerEnd}`, "m");
    const imePattern = new RegExp(`\\n?\\t?${imeMarkerStart}[\\s\\S]*?${imeMarkerEnd}`, "m");
    await writeFile(
      workbenchHtml,
      html.replace(guardPattern, "").replace(followupPattern, "").replace(imePattern, "")
    );
  }

  await rm(guardTarget, { force: true });
  await rm(followupTarget, { force: true });
  await rm(imeFixTarget, { force: true });

  const backupProductJsonFound = await exists(backupProductJson);
  if (backupProductJsonFound) {
    await copyFile(backupProductJson, productJson);
  }

  console.log(
    JSON.stringify(
      {
        unpatched: true,
        platform: process.platform,
        workbenchDir,
        workbenchHtml,
        backupHtmlFound: await exists(backupHtml),
        guardRemoved: guardTarget,
        followupRemoved: followupTarget,
        imeFixRemoved: imeFixTarget,
        productJson,
        backupProductJsonFound,
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
