import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit-app-scripts.js", import.meta.url));

async function withTempAppDir(configSource, run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "jskit-app-scripts-"));
  try {
    if (typeof configSource === "string") {
      await writeFile(path.join(tempDir, "app.scripts.config.mjs"), configSource, "utf8");
    }
    await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function runCli({ cwd, args = [] }) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8"
  });
}

test("cli executes object task with task-level env", async () => {
  await withTempAppDir(
    `
export default {
  tasks: {
    printEnv: {
      command: "node",
      args: ["-e", "console.log(process.env.TEST_APP_SCRIPTS_ENV || '')"],
      env: { TEST_APP_SCRIPTS_ENV: "ok" }
    }
  }
};
    `.trim(),
    async (cwd) => {
      const result = runCli({ cwd, args: ["printEnv"] });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /ok/);
    }
  );
});

test("cli executes string task and passes args after --", async () => {
  await withTempAppDir(
    `
export default {
  tasks: {
    echoArgs: "node -e \\"console.log(process.argv.slice(1).join('|'))\\""
  }
};
    `.trim(),
    async (cwd) => {
      const result = runCli({ cwd, args: ["echoArgs", "--", "alpha", "beta gamma"] });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /alpha\|beta gamma/);
    }
  );
});

test("cli fails fast for unknown task", async () => {
  await withTempAppDir(
    `
export default {
  tasks: {
    noop: {
      command: "node",
      args: ["-e", "console.log('noop')"]
    }
  }
};
    `.trim(),
    async (cwd) => {
      const result = runCli({ cwd, args: ["not-a-task"] });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Unknown task/);
    }
  );
});

test("cli fails when app config is missing", async () => {
  await withTempAppDir(null, async (cwd) => {
    const result = runCli({ cwd, args: ["dev"] });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing app\.scripts\.config\.mjs/);
  });
});
