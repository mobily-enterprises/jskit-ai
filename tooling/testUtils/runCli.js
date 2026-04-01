import { spawnSync } from "node:child_process";
import process from "node:process";

function createCliRunner(cliPath) {
  const resolvedPath = String(cliPath || "").trim();
  if (!resolvedPath) {
    throw new TypeError("cliPath is required to run a CLI test helper.");
  }

  return function runCli({ cwd, args = [], input = undefined, env = {} } = {}) {
    const baseEnv = {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      CLICOLOR: "0",
      CLICOLOR_FORCE: "0"
    };

    return spawnSync(process.execPath, [resolvedPath, ...args], {
      cwd,
      encoding: "utf8",
      input,
      env: {
        ...baseEnv,
        ...env
      }
    });
  };
}

export { createCliRunner };
