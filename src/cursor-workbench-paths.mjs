import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const relativeWorkbenchPath = "resources/app/out/vs/code/electron-sandbox/workbench";

function windowsLocalAppData() {
  return process.env.LOCALAPPDATA || resolve(homedir(), "AppData/Local");
}

function defaultWorkbenchDir() {
  if (process.platform === "darwin") {
    return "/Applications/Cursor.app/Contents/Resources/app/out/vs/code/electron-sandbox/workbench";
  }

  if (process.platform === "win32") {
    const candidates = [
      resolve(windowsLocalAppData(), "Programs/Cursor", relativeWorkbenchPath),
      resolve("C:/Program Files/cursor", relativeWorkbenchPath),
      resolve("C:/Program Files/Cursor", relativeWorkbenchPath),
    ];

    return candidates.find((path) => existsSync(resolve(path, "workbench.html"))) || candidates[0];
  }

  throw new Error(
    "Unsupported platform. Set CURSOR_WORKBENCH_DIR to Cursor's workbench directory."
  );
}

export function resolveWorkbenchPaths() {
  const workbenchDir = process.env.CURSOR_WORKBENCH_DIR || defaultWorkbenchDir();

  return {
    workbenchDir,
    workbenchHtml: resolve(workbenchDir, "workbench.html"),
    guardTarget: resolve(workbenchDir, "cursor-max-mode-guard.js"),
    backupHtml: resolve(workbenchDir, "workbench.html.cursor-max-guard.bak"),
  };
}
