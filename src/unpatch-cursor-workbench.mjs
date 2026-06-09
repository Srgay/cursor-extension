import { copyFile, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolveWorkbenchPaths } from "./cursor-workbench-paths.mjs";

const { workbenchDir, workbenchHtml, guardTarget, backupHtml } = resolveWorkbenchPaths();

const markerStart = "<!-- cursor-max-mode-guard:start -->";
const markerEnd = "<!-- cursor-max-mode-guard:end -->";

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

if (await exists(backupHtml)) {
  await copyFile(backupHtml, workbenchHtml);
} else {
  const html = await readFile(workbenchHtml, "utf8");
  const pattern = new RegExp(`\\n?\\t?${markerStart}[\\s\\S]*?${markerEnd}`, "m");
  await writeFile(workbenchHtml, html.replace(pattern, ""));
}

await rm(guardTarget, { force: true });

console.log(
  JSON.stringify(
    {
      unpatched: true,
      platform: process.platform,
      workbenchDir,
      workbenchHtml,
      backupHtmlFound: await exists(backupHtml),
      guardRemoved: guardTarget,
    },
    null,
    2
  )
);
