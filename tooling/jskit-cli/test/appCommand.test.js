import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCliRunner } from "../../testUtils/runCli.js";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import {
  findRangeIntersectionVersion,
  formatElapsedTime,
  resolveRequiredDirectPeerUpdates,
  runWithProgress
} from "../src/server/commandHandlers/appCommands/updatePackages.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function writeExecutable(filePath, source) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, source, "utf8");
  await chmod(filePath, 0o755);
}

async function createMinimalApp(appRoot, {
  dependencies = {},
  devDependencies = {},
  scripts = {}
} = {}) {
  await mkdir(path.join(appRoot, "node_modules", ".bin"), { recursive: true });
  await writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify({
      name: "tmp-app",
      version: "0.1.0",
      private: true,
      type: "module",
      scripts,
      dependencies,
      devDependencies
    }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(path.join(appRoot, "app.json"), "{\n  \"name\": \"tmp-app\"\n}\n", "utf8");
}

async function installFakeLocalJskit(appRoot, logPath) {
  await writeExecutable(
    path.join(appRoot, "node_modules", ".bin", "jskit"),
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(logPath)}, ["local-jskit", ...process.argv.slice(2)].join(" ") + "\\n");
`
  );
}

async function installFakeCommand(binDir, name, source) {
  await writeExecutable(path.join(binDir, name), source);
}

function buildTestEnv(binDir, logPath, extra = {}) {
  return {
    ...process.env,
    ...extra,
    PATH: `${binDir}:${process.env.PATH || ""}`,
    TEST_LOG_PATH: logPath
  };
}

async function readLogLines(logPath) {
  try {
    return (await readFile(logPath, "utf8")).trim().split("\n").filter(Boolean);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

test("jskit app verify checks each generated intent before normal app verification", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createMinimalApp(appRoot);
    await installFakeLocalJskit(appRoot, logPath);
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["app", "verify"],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.deepEqual(await readLogLines(logPath), [
      "local-jskit migrations sync --check",
      "local-jskit ci generate --check",
      "npm run --if-present lint",
      "npm run --if-present test",
      "npm run --if-present test:client",
      "npm run --if-present build",
      "local-jskit doctor"
    ]);
  });
});

test("jskit app verify forwards --against to doctor", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createMinimalApp(appRoot);
    await installFakeLocalJskit(appRoot, logPath);
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["app", "verify", "--against", "origin/main"],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.equal((await readLogLines(logPath)).at(-1), "local-jskit doctor --against origin/main");
  });
});

test("jskit app update-packages writes exact root versions then runs explicit projection commands", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createMinimalApp(appRoot, {
      dependencies: { "@jskit-ai/shell-web": "0.1.1" },
      devDependencies: { "@jskit-ai/jskit-cli": "0.1.1" }
    });
    await installFakeLocalJskit(appRoot, logPath);
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...args].join(" ") + "\\n");
const versions = {
  "@jskit-ai/jskit-cli": "3.4.5",
  "@jskit-ai/shell-web": "7.8.9"
};
if (args[0] === "view") {
  const selector = args[1];
  if (args.at(-1) === "--json") {
    process.stdout.write(JSON.stringify({ peerDependencies: {} }) + "\\n");
  } else {
    process.stdout.write(versions[selector] + "\\n");
  }
  process.exit(0);
}
if (args[0] === "install" && !args.includes("--dry-run")) {
  const packageJsonPath = path.join(process.cwd(), "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const section = args.includes("--save-dev") ? "devDependencies" : "dependencies";
  for (const value of args) {
    if (!value.startsWith("@jskit-ai/")) continue;
    const splitAt = value.lastIndexOf("@");
    packageJson[section] ||= {};
    packageJson[section][value.slice(0, splitAt)] = value.slice(splitAt + 1);
  }
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\\n");
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["app", "update-packages"],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(packageJson.dependencies["@jskit-ai/shell-web"], "7.8.9");
    assert.equal(packageJson.devDependencies["@jskit-ai/jskit-cli"], "3.4.5");
    assert.deepEqual((await readLogLines(logPath)).slice(-2), [
      "local-jskit migrations sync",
      "local-jskit ci generate"
    ]);
  });
});

test("jskit app update-packages --dry-run changes no files and invokes no projection commands", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createMinimalApp(appRoot, {
      dependencies: { "@jskit-ai/shell-web": "0.1.1" }
    });
    const originalPackageJson = await readFile(path.join(appRoot, "package.json"), "utf8");
    await installFakeLocalJskit(appRoot, logPath);
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...args].join(" ") + "\\n");
if (args[0] === "view") {
  process.stdout.write(args.at(-1) === "--json" ? JSON.stringify({ peerDependencies: {} }) + "\\n" : "7.8.9\\n");
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["app", "update-packages", "--dry-run"],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.equal(await readFile(path.join(appRoot, "package.json"), "utf8"), originalPackageJson);
    assert.equal((await readLogLines(logPath)).some((line) => line.startsWith("local-jskit ")), false);
    assert.match(String(result.stdout || ""), /migration sync, and CI sync were not run/u);
  });
});

test("required peer reconciliation selects a compatible direct range", () => {
  const updates = resolveRequiredDirectPeerUpdates({
    createCliError: (message) => new Error(message),
    packageJson: {
      devDependencies: { eslint: "^9.0.0" }
    },
    packageManifests: new Map([
      ["@jskit-ai/config-eslint", { peerDependencies: { eslint: "^10.8.0" } }]
    ])
  });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].name, "eslint");
  assert.equal(updates[0].targetRange, "^10.8.0");
  assert.equal(findRangeIntersectionVersion(["^10.0.0", ">=10.8.0 <11"]).version, "10.8.0");
});

test("formatElapsedTime keeps updater progress concise", () => {
  assert.equal(formatElapsedTime(0), "under 1s");
  assert.equal(formatElapsedTime(19_900), "19s");
  assert.equal(formatElapsedTime(60_000), "1m");
  assert.equal(formatElapsedTime(125_000), "2m 5s");
});

test("runWithProgress reports heartbeat and completion while preserving failures", async () => {
  const messages = [];
  await runWithProgress(
    () => new Promise((resolve) => setTimeout(resolve, 30)),
    {
      activity: "testing a long update",
      progressIntervalMs: 5,
      stdout: { write(message) { messages.push(String(message).trim()); } },
      step: "Step 1/3"
    }
  );
  assert.ok(messages.some((message) => message.includes("is still running")));
  assert.match(messages.at(-1), /^\[jskit:update\] Step 1\/3 complete in /u);

  await assert.rejects(
    runWithProgress(
      async () => { throw new Error("update failed"); },
      { activity: "failure", progressIntervalMs: 5, stdout: { write() {} }, step: "Step 3/3" }
    ),
    /update failed/u
  );
});

test("jskit app release --dry-run validates release preconditions without mutating git", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createMinimalApp(appRoot);
    await installFakeCommand(
      binDir,
      "git",
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG_PATH, ["git", ...args].join(" ") + "\\n");
if (args[0] === "rev-parse") process.stdout.write("main\\n");
`
    );
    await installFakeCommand(
      binDir,
      "gh",
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["gh", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["app", "release", "--dry-run"],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.deepEqual(await readLogLines(logPath), [
      "gh auth status",
      "git status --porcelain",
      "git rev-parse --abbrev-ref HEAD"
    ]);
  });
});
