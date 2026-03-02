import { spawnSync } from "node:child_process";
import process from "node:process";

function createCliRunner(cliPath) {
  const resolvedPath = String(cliPath || "").trim();
  if (!resolvedPath) {
    throw new TypeError("cliPath is required to run a CLI test helper.");
  }

  return function runCli({ cwd, args = [], input = undefined } = {}) {
    return spawnSync(process.execPath, [resolvedPath, ...args], {
      cwd,
      encoding: "utf8",
      input
    });
  };
}

export { createCliRunner };
