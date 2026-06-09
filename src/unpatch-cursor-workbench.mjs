import { copyFile, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolveWorkbenchPaths } from "./cursor-workbench-paths.mjs";

const {
  workbenchDir,
  workbenchHtml,
  guardTarget,
  backupHtml,
  productJson,
  backupProductJson,
} = resolveWorkbenchPaths();

const markerStart = "<!-- cursor-max-mode-guard:start -->";
const markerEnd = "<!-- cursor-max-mode-guard:end -->";

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
    const pattern = new RegExp(`\\n?\\t?${markerStart}[\\s\\S]*?${markerEnd}`, "m");
    await writeFile(workbenchHtml, html.replace(pattern, ""));
  }

  await rm(guardTarget, { force: true });

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
