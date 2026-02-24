import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
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

async function writeTextFile(cwd, relativePath, source) {
  const absolutePath = path.join(cwd, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, source, "utf8");
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
    echoArgs: "node -e \\\"console.log(process.argv.slice(1).join('|'))\\\""
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

test("cli executes builtin process-env guardrail", async () => {
  await withTempAppDir(
    `
export default {
  guardrails: {
    processEnv: {
      allowFiles: ["allowed.js"]
    }
  },
  tasks: {
    "lint:process-env": {
      builtin: "guardrails:process-env"
    }
  }
};
    `.trim(),
    async (cwd) => {
      await writeTextFile(cwd, "allowed.js", "console.log(process.env.ALLOWED || '');\n");
      await writeTextFile(cwd, "disallowed.js", "console.log(process.env.DISALLOWED || '');\n");

      const result = runCli({ cwd, args: ["lint:process-env"] });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Disallowed process\.env usage detected/);
      assert.match(result.stderr, /disallowed\.js/);
      assert.doesNotMatch(result.stderr, /Usage: jskit-app-scripts/);
    }
  );
});

test("cli executes builtin api-contracts guardrail for check and sync", async () => {
  await withTempAppDir(
    `
export default {
  tasks: {
    "docs:api-contracts": {
      builtin: "guardrails:api-contracts:sync"
    },
    "docs:api-contracts:check": {
      builtin: "guardrails:api-contracts:check"
    }
  }
};
    `.trim(),
    async (cwd) => {
      await writeTextFile(
        cwd,
        "server/modules/api/routes.js",
        `
export function buildDefaultRoutes() {
  return [
    { method: "GET", path: "/api/health" },
    { method: "POST", path: "/api/auth/login" }
  ];
}
`
      );

      await writeTextFile(
        cwd,
        "README.md",
        `
# Sample

<!-- API_CONTRACTS_START -->
- \`GET /api/health\`
<!-- API_CONTRACTS_END -->
`
      );

      const checkFail = runCli({ cwd, args: ["docs:api-contracts:check"] });
      assert.notEqual(checkFail.status, 0);
      assert.match(checkFail.stderr, /README API contracts are out of sync/);

      const syncResult = runCli({ cwd, args: ["docs:api-contracts"] });
      assert.equal(syncResult.status, 0, syncResult.stderr);

      const updatedReadme = await readFile(path.join(cwd, "README.md"), "utf8");
      assert.match(updatedReadme, /`GET \/api\/health`/);
      assert.match(updatedReadme, /`POST \/api\/auth\/login`/);

      const checkPass = runCli({ cwd, args: ["docs:api-contracts:check"] });
      assert.equal(checkPass.status, 0, checkPass.stderr);
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
