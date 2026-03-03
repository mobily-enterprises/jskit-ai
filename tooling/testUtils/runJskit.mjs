import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const JSKIT_CLI_PATH = fileURLToPath(new URL("../jskit-cli/bin/jskit.js", import.meta.url));

function runJskit({ cwd, args = [], input = undefined } = {}) {
  return spawnSync(process.execPath, [JSKIT_CLI_PATH, ...args], {
    cwd,
    encoding: "utf8",
    input
  });
}

export { runJskit };
