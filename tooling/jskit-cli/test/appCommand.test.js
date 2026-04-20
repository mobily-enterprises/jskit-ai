import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  lstat,
  readFile,
  readlink,
  writeFile
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCliRunner } from "../../testUtils/runCli.js";
import { withTempDir } from "../../testUtils/tempDir.mjs";

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
  scripts = {},
  jskitApp = false
} = {}) {
  await mkdir(appRoot, { recursive: true });
  await writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "tmp-app",
        version: "0.1.0",
        private: true,
        type: "module",
        scripts,
        dependencies,
        devDependencies
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  if (jskitApp) {
    await writeFile(
      path.join(appRoot, "app.json"),
      `${JSON.stringify({ name: "tmp-app" }, null, 2)}\n`,
      "utf8"
    );
  }
  await mkdir(path.join(appRoot, "node_modules", ".bin"), { recursive: true });
}

async function installFakeLocalJskit(appRoot, logPath) {
  const localBin = path.join(appRoot, "node_modules", ".bin", "jskit");
  await writeExecutable(
    localBin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const logPath = process.env.TEST_LOG_PATH;
fs.appendFileSync(logPath, ["local-jskit", ...process.argv.slice(2)].join(" ") + "\\n");
`
  );
  return localBin;
}

async function installFakeCommand(binDir, commandName, source) {
  const filePath = path.join(binDir, commandName);
  await writeExecutable(filePath, source);
  return filePath;
}

function buildTestEnv(binDir, logPath, extra = {}) {
  return {
    ...extra,
    TEST_LOG_PATH: logPath,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
  };
}

async function readLogLines(logPath) {
  const content = await readFile(logPath, "utf8");
  return content.split(/\r?\n/u).filter(Boolean);
}

function runGit(appRoot, args = []) {
  const result = spawnSync("git", Array.isArray(args) ? args : [], {
    cwd: appRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, String(result.stderr || ""));
}

async function initializeGitApp(appRoot) {
  runGit(appRoot, ["init"]);
  runGit(appRoot, ["config", "user.name", "JSKIT Test"]);
  runGit(appRoot, ["config", "user.email", "test@example.com"]);
  runGit(appRoot, ["add", "package.json"]);
  runGit(appRoot, ["commit", "-m", "Initial scaffold"]);
}

test("jskit app verify runs the baseline npm scripts and doctor in order", async () => {
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
      "npm run --if-present lint",
      "npm run --if-present test",
      "npm run --if-present test:client",
      "npm run --if-present build",
      "local-jskit doctor"
    ]);
  });
});

test("jskit app verify-ui runs the provided command and writes a matching UI verification receipt", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMinimalApp(appRoot, { jskitApp: true });
    await initializeGitApp(appRoot);

    await mkdir(path.join(appRoot, "src", "pages", "home", "contacts"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "contacts", "index.vue"),
      "<template><div>Contacts</div></template>\n",
      "utf8"
    );

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
      args: [
        "app",
        "verify-ui",
        "--command",
        "npm run e2e -- tests/e2e/contacts.spec.ts -g filters",
        "--feature",
        "contacts filters",
        "--auth-mode",
        "dev-auth-login-as"
      ],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.deepEqual(await readLogLines(logPath), [
      "npm run e2e -- tests/e2e/contacts.spec.ts -g filters"
    ]);

    const receipt = JSON.parse(await readFile(path.join(appRoot, ".jskit", "verification", "ui.json"), "utf8"));
    assert.equal(receipt.version, 1);
    assert.equal(receipt.runner, "playwright");
    assert.equal(receipt.feature, "contacts filters");
    assert.equal(receipt.command, "npm run e2e -- tests/e2e/contacts.spec.ts -g filters");
    assert.equal(receipt.authMode, "dev-auth-login-as");
    assert.deepEqual(receipt.changedUiFiles, ["src/pages/home/contacts/index.vue"]);
  });
});

test("jskit app verify-ui rejects generic package roots that are not JSKIT apps", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "package-only-root");

    await createMinimalApp(appRoot);
    await initializeGitApp(appRoot);
    await mkdir(path.join(appRoot, "src", "pages"), { recursive: true });
    await writeFile(path.join(appRoot, "src", "pages", "index.vue"), "<template />\n", "utf8");

    const result = runCli({
      cwd: appRoot,
      args: [
        "app",
        "verify-ui",
        "--command",
        "npm run e2e -- tests/e2e/example.spec.ts",
        "--feature",
        "example",
        "--auth-mode",
        "none"
      ]
    });

    assert.equal(result.status, 1, String(result.stdout || ""));
    assert.match(String(result.stderr || ""), /jskit app verify-ui only works in a JSKIT app root/);
  });
});

test("jskit app update-packages refreshes runtime and dev packages, then regenerates managed migrations", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMinimalApp(appRoot, {
      dependencies: {
        "@jskit-ai/shell-web": "0.x",
        vue: "^3.5.0"
      },
      devDependencies: {
        "@jskit-ai/jskit-cli": "0.x",
        vitest: "^4.0.0"
      }
    });
    await installFakeLocalJskit(appRoot, logPath);
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...args].join(" ") + "\\n");
if (args[0] === "view") {
  const packageName = args[args.length - 2];
  const versionMap = {
    "@jskit-ai/jskit-cli": "3.4.5",
    "@jskit-ai/shell-web": "7.8.9"
  };
  process.stdout.write((versionMap[packageName] || "1.2.3") + "\\n");
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["app", "update-packages"],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.deepEqual(await readLogLines(logPath), [
      "npm view @jskit-ai/shell-web version",
      "npm view @jskit-ai/jskit-cli version",
      "npm install --save-exact @jskit-ai/shell-web@7.x",
      "npm install --save-dev --save-exact @jskit-ai/jskit-cli@3.x",
      "local-jskit migrations changed"
    ]);
    assert.match(String(result.stdout || ""), /\[jskit:update\] generating managed migrations for changed packages\./);
  });
});

test("jskit app link-local-packages links local repo packages, refreshes bins, and clears Vite cache", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const repoRoot = path.join(cwd, "jskit-ai");

    await createMinimalApp(appRoot);
    await mkdir(path.join(appRoot, "node_modules", "@jskit-ai"), { recursive: true });
    await mkdir(path.join(appRoot, "node_modules", ".vite"), { recursive: true });
    await writeFile(path.join(appRoot, "node_modules", ".vite", "stale.txt"), "stale\n", "utf8");

    const shellWebRoot = path.join(repoRoot, "packages", "shell-web");
    await mkdir(shellWebRoot, { recursive: true });
    await writeFile(
      path.join(shellWebRoot, "package.json"),
      `${JSON.stringify({ name: "@jskit-ai/shell-web", version: "0.1.0" }, null, 2)}\n`,
      "utf8"
    );

    const cliRoot = path.join(repoRoot, "tooling", "jskit-cli");
    await mkdir(path.join(cliRoot, "bin"), { recursive: true });
    await writeFile(
      path.join(cliRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@jskit-ai/jskit-cli",
          version: "0.1.0",
          bin: {
            jskit: "./bin/jskit.js"
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(path.join(cliRoot, "bin", "jskit.js"), "#!/usr/bin/env node\n", "utf8");

    const result = runCli({
      cwd: appRoot,
      args: ["app", "link-local-packages", "--repo-root", repoRoot]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));

    const linkedShellWeb = path.join(appRoot, "node_modules", "@jskit-ai", "shell-web");
    const linkedCli = path.join(appRoot, "node_modules", "@jskit-ai", "jskit-cli");
    const jskitBin = path.join(appRoot, "node_modules", ".bin", "jskit");

    assert.equal((await lstat(linkedShellWeb)).isSymbolicLink(), true);
    assert.equal((await lstat(linkedCli)).isSymbolicLink(), true);
    assert.equal((await lstat(jskitBin)).isSymbolicLink(), true);
    assert.equal(await readlink(linkedShellWeb), shellWebRoot);
    assert.equal(await readlink(linkedCli), cliRoot);
    assert.equal(await readlink(jskitBin), "../@jskit-ai/jskit-cli/bin/jskit.js");

    await assert.rejects(lstat(path.join(appRoot, "node_modules", ".vite")), /ENOENT/);
  });
});

test("jskit app adopt-managed-scripts rewrites known scaffold values and preserves customized ones by default", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const packageJsonPath = path.join(appRoot, "package.json");

    await createMinimalApp(appRoot, {
      scripts: {
        verify: "npm run lint && npm run test && npm run test:client && npm run build && npx jskit doctor",
        "jskit:update": "echo keep-me",
        release: "bash ./scripts/release.sh"
      }
    });

    const result = runCli({
      cwd: appRoot,
      args: ["app", "adopt-managed-scripts"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    assert.equal(packageJson.scripts.verify, "jskit app verify && npm run --if-present verify:app");
    assert.equal(packageJson.scripts["jskit:update"], "echo keep-me");
    assert.equal(packageJson.scripts.devlinks, "jskit app link-local-packages");
    assert.equal(packageJson.scripts.release, "jskit app release");
    assert.match(String(result.stdout || ""), /kept customized script jskit:update: echo keep-me/);
  });
});

test("jskit app adopt-managed-scripts --force rewrites customized wrappers and removes legacy copied scripts", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const packageJsonPath = path.join(appRoot, "package.json");
    const legacyScriptPath = path.join(appRoot, "scripts", "release.sh");

    await createMinimalApp(appRoot, {
      scripts: {
        verify: "echo customized",
        "jskit:update": "echo customized",
        devlinks: "echo customized",
        release: "echo customized"
      }
    });
    await mkdir(path.dirname(legacyScriptPath), { recursive: true });
    await writeFile(legacyScriptPath, "#!/usr/bin/env bash\n", "utf8");

    const result = runCli({
      cwd: appRoot,
      args: ["app", "adopt-managed-scripts", "--force"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    assert.deepEqual(packageJson.scripts, {
      verify: "jskit app verify && npm run --if-present verify:app",
      "jskit:update": "jskit app update-packages",
      devlinks: "jskit app link-local-packages",
      release: "jskit app release"
    });
    await assert.rejects(lstat(legacyScriptPath), /ENOENT/);
  });
});

test("jskit app release runs the managed release flow when update-packages produces changes", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    const statePath = path.join(cwd, "git-state.json");
    const registryUrl = "https://registry.example.test";

    await createMinimalApp(appRoot, {
      dependencies: {
        "@jskit-ai/shell-web": "0.x"
      }
    });
    await installFakeLocalJskit(appRoot, logPath);
    await writeFile(statePath, JSON.stringify({ statusChecks: 0 }, null, 2), "utf8");

    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...args].join(" ") + "\\n");
if (args[0] === "view") {
  process.stdout.write("7.8.9\\n");
}
`
    );
    await installFakeCommand(
      binDir,
      "git",
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const statePath = process.env.TEST_GIT_STATE_PATH;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
fs.appendFileSync(process.env.TEST_LOG_PATH, ["git", ...args].join(" ") + "\\n");
if (args[0] === "status" && args[1] === "--porcelain") {
  if (state.statusChecks === 0) {
    state.statusChecks += 1;
    fs.writeFileSync(statePath, JSON.stringify(state));
    process.stdout.write("");
    process.exit(0);
  }
  state.statusChecks += 1;
  fs.writeFileSync(statePath, JSON.stringify(state));
  process.stdout.write(" M package.json\\n");
  process.exit(0);
}
if (args[0] === "rev-parse") {
  process.stdout.write("main\\n");
  process.exit(0);
}
fs.writeFileSync(statePath, JSON.stringify(state));
`
    );
    await installFakeCommand(
      binDir,
      "gh",
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG_PATH, ["gh", ...args].join(" ") + "\\n");
if (args[0] === "pr" && args[1] === "create") {
  process.stdout.write("https://github.com/example/example/pull/123\\n");
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["app", "release", "--registry", registryUrl],
      env: buildTestEnv(binDir, logPath, {
        TEST_GIT_STATE_PATH: statePath
      })
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const logLines = await readLogLines(logPath);
    const branchName = logLines[9].slice("git switch -c ".length);
    const releaseStamp = logLines[11].slice("git commit -m chore: release ".length);
    assert.deepEqual(logLines, [
      "gh auth status",
      "git status --porcelain",
      "git rev-parse --abbrev-ref HEAD",
      "git fetch origin main",
      "git pull --ff-only origin main",
      `npm view --registry ${registryUrl} @jskit-ai/shell-web version`,
      `npm install --save-exact --registry ${registryUrl} @jskit-ai/shell-web@7.x`,
      "local-jskit migrations changed",
      "git status --porcelain",
      `git switch -c ${branchName}`,
      "git add -A",
      `git commit -m chore: release ${releaseStamp}`,
      `git push -u origin ${branchName}`,
      `gh pr create --base main --head ${branchName} --title Release ${releaseStamp} --body Automated release commit generated by \`jskit app release\`.`,
      "gh pr merge https://github.com/example/example/pull/123 --merge --delete-branch",
      "git switch main",
      "git pull --ff-only origin main"
    ]);
    assert.match(String(result.stdout || ""), /\[release\] created PR: https:\/\/github.com\/example\/example\/pull\/123/);
  });
});

test("jskit app adopt-managed-scripts resolves the JSKIT app root from nested local package directories", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const nestedPackageRoot = path.join(appRoot, "packages", "main");
    const rootPackageJsonPath = path.join(appRoot, "package.json");
    const nestedPackageJsonPath = path.join(nestedPackageRoot, "package.json");

    await createMinimalApp(appRoot, {
      scripts: {
        verify: "npm run lint && npm run test && npm run test:client && npm run build && npx jskit doctor"
      }
    });
    await mkdir(path.join(appRoot, ".jskit"), { recursive: true });
    await writeFile(path.join(appRoot, ".jskit", "lock.json"), "{\n  \"lockVersion\": 1,\n  \"installedPackages\": {}\n}\n", "utf8");
    await mkdir(nestedPackageRoot, { recursive: true });
    await writeFile(
      nestedPackageJsonPath,
      `${JSON.stringify(
        {
          name: "@local/main",
          version: "0.1.0",
          private: true,
          type: "module"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const result = runCli({
      cwd: nestedPackageRoot,
      args: ["app", "adopt-managed-scripts"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const rootPackageJson = JSON.parse(await readFile(rootPackageJsonPath, "utf8"));
    const nestedPackageJson = JSON.parse(await readFile(nestedPackageJsonPath, "utf8"));
    assert.equal(rootPackageJson.scripts.verify, "jskit app verify && npm run --if-present verify:app");
    assert.equal(nestedPackageJson.name, "@local/main");
    assert.equal(nestedPackageJson.scripts, undefined);
  });
});

test("jskit app release --dry-run validates preconditions and stops before mutating git state", async () => {
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
if (args[0] === "status") {
  process.stdout.write("");
}
if (args[0] === "rev-parse") {
  process.stdout.write("main\\n");
}
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
    assert.match(String(result.stdout || ""), /dry-run mode: would sync main, run jskit app update-packages, and open a PR if changes appear/);
  });
});
