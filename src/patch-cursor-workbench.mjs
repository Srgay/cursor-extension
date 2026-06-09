import { copyFile, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkbenchPaths } from "./cursor-workbench-paths.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const guardSource = resolve(__dirname, "cursor-max-mode-guard.js");
const { workbenchDir, workbenchHtml, guardTarget, backupHtml } = resolveWorkbenchPaths();

const markerStart = "<!-- cursor-max-mode-guard:start -->";
const markerEnd = "<!-- cursor-max-mode-guard:end -->";
const injection = `${markerStart}
\t<script src="./cursor-max-mode-guard.js" defer></script>
\t${markerEnd}`;

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const html = await readFile(workbenchHtml, "utf8");

if (!(await exists(backupHtml))) {
  await writeFile(backupHtml, html);
}

await copyFile(guardSource, guardTarget);

let nextHtml = html;
if (!nextHtml.includes(markerStart)) {
  const needle = '<script src="./workbench.js" type="module"></script>';
  if (!nextHtml.includes(needle)) {
    throw new Error(`Cannot find workbench startup script in ${workbenchHtml}`);
  }
  nextHtml = nextHtml.replace(needle, `${needle}\n\t${injection}`);
}

if (nextHtml !== html) {
  await writeFile(workbenchHtml, nextHtml);
}

console.log(
  JSON.stringify(
    {
      patched: true,
      platform: process.platform,
      workbenchDir,
      workbenchHtml,
      backupHtml,
      guardTarget,
      alreadyPatched: html.includes(markerStart),
    },
    null,
    2
  )
);
