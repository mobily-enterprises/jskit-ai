import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  lstat,
  readFile,
  writeFile
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCliRunner } from "../../testUtils/runCli.js";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { loadLockFile } from "../src/server/cliRuntime/appState.js";
import {
  collectChangedInstalledPackageIds,
  formatElapsedTime,
  reapplyChangedInstalledPackages,
  runWithProgress
} from "../src/server/commandHandlers/appCommands/updatePackages.js";
import { writeInstalledPackagesLock } from "./testLock.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);
const silentStream = { write() {} };

async function writeExecutable(filePath, source) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, source, "utf8");
  await chmod(filePath, 0o755);
}

async function createMinimalApp(appRoot, {
  dependencies = {},
  devDependencies = {},
  optionalDependencies = {},
  peerDependencies = {},
  scripts = {},
  jskitApp = false,
  workspaces
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
        devDependencies,
        optionalDependencies,
        peerDependencies,
        workspaces
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

async function installFakeLocalJskit(appRoot, logPath, packageVersions = {}) {
  const localBin = path.join(appRoot, "node_modules", ".bin", "jskit");
  await writeExecutable(
    localBin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const logPath = process.env.TEST_LOG_PATH || ${JSON.stringify(logPath)};
const args = process.argv.slice(2);
fs.appendFileSync(logPath, ["local-jskit", ...args].join(" ") + "\\n");
const packageVersions = ${JSON.stringify(packageVersions)};
if (args[0] === "update" && args[1] === "package" && packageVersions[args[2]]) {
  const lockPath = path.join(process.cwd(), ".jskit", "lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const requestedUpdates = packageVersions[args[2]];
  const updates = typeof requestedUpdates === "string"
    ? { [args[2]]: requestedUpdates }
    : requestedUpdates;
  for (const [packageId, version] of Object.entries(updates)) {
    lock.installedPackages[packageId].version = version;
  }
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\\n");
}
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

async function writeLegacyMainClientProvider(appRoot) {
  const providerPath = path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js");
  await mkdir(path.dirname(providerPath), { recursive: true });
  await writeFile(
    providerPath,
    `import MenuLinkItem from "/src/components/menus/MenuLinkItem.vue";
import TabLinkItem from "/src/components/menus/TabLinkItem.vue";

const mainClientComponents = [];

function registerMainClientComponent(token, resolveComponent) {
  mainClientComponents.push({ token, resolveComponent });
}

class MainClientProvider {
  static id = "local.main.client";

  register(app) {
    for (const { token, resolveComponent } of mainClientComponents) {
      app.singleton(token, resolveComponent);
    }
  }
}

export {
  MainClientProvider,
  registerMainClientComponent
};

registerMainClientComponent("local.main.ui.menu-link-item", () => MenuLinkItem);
registerMainClientComponent("local.main.ui.tab-link-item", () => TabLinkItem);
`,
    "utf8"
  );
  return providerPath;
}

async function writeLegacyCrudFormFields(appRoot) {
  const formFieldsPath = path.join(
    appRoot,
    "src",
    "pages",
    "admin",
    "contacts",
    "_components",
    "ContactAddEditFormFields.js"
  );
  await mkdir(path.dirname(formFieldsPath), { recursive: true });
  await writeFile(
    formFieldsPath,
    `const UI_CREATE_FORM_FIELDS = [];

// @jskit-contract crud.ui.form-fields.contacts.new.v1
void UI_CREATE_FORM_FIELDS;
// jskit:crud-ui-form-fields:new
UI_CREATE_FORM_FIELDS.push({
  "key": "firstName",
  "component": "text",
  "label": "First Name"
});

const UI_EDIT_FORM_FIELDS = [
  {
    "key": "existing",
    "component": "text"
  }
];

// @jskit-contract crud.ui.form-fields.contacts.edit.v1
void UI_EDIT_FORM_FIELDS;
// jskit:crud-ui-form-fields:edit
UI_EDIT_FORM_FIELDS.push({
  "key": "vetId",
  "component": "lookup",
  "label": "Vet"
});
UI_EDIT_FORM_FIELDS.push({
  "key": "existing",
  "component": "text"
});
Object.freeze(UI_CREATE_FORM_FIELDS);
Object.freeze(UI_EDIT_FORM_FIELDS);

export { UI_CREATE_FORM_FIELDS, UI_EDIT_FORM_FIELDS };
`,
    "utf8"
  );
  return formFieldsPath;
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
    assert.deepEqual(await readLogLines(logPath), [
      "npm run --if-present lint",
      "npm run --if-present test",
      "npm run --if-present test:client",
      "npm run --if-present build",
      "local-jskit doctor --against origin/main"
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

test("jskit app verify-ui can record committed UI changes against a base ref", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMinimalApp(appRoot, { jskitApp: true });
    await initializeGitApp(appRoot);
    runGit(appRoot, ["branch", "baseline"]);

    await mkdir(path.join(appRoot, "src", "pages", "home", "contacts"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "contacts", "index.vue"),
      "<template><div>Contacts</div></template>\n",
      "utf8"
    );
    runGit(appRoot, ["add", "src/pages/home/contacts/index.vue"]);
    runGit(appRoot, ["commit", "-m", "Add contacts page"]);

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
        "--against",
        "baseline",
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
    assert.equal(receipt.against, "baseline");
    assert.deepEqual(receipt.changedUiFiles, ["src/pages/home/contacts/index.vue"]);
  });
});

test("jskit app verify-ui fails when --against points at an unknown ref", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");

    await createMinimalApp(appRoot, { jskitApp: true });
    await initializeGitApp(appRoot);

    await mkdir(path.join(appRoot, "src", "pages", "home", "contacts"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "contacts", "index.vue"),
      "<template><div>Contacts</div></template>\n",
      "utf8"
    );

    const result = runCli({
      cwd: appRoot,
      args: [
        "app",
        "verify-ui",
        "--against",
        "missing-ref",
        "--command",
        "npm run e2e -- tests/e2e/contacts.spec.ts -g filters",
        "--feature",
        "contacts filters",
        "--auth-mode",
        "dev-auth-login-as"
      ]
    });

    assert.equal(result.status, 1, String(result.stdout || ""));
    assert.match(String(result.stderr || ""), /could not resolve changed UI files against "missing-ref"/);
  });
});

test("jskit app verify-ui records representative generated CRUD list, detail, and settings UI files", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMinimalApp(appRoot, { jskitApp: true });
    await initializeGitApp(appRoot);

    await mkdir(path.join(appRoot, "src", "pages", "home", "settings", "customers", "[customerId]"), {
      recursive: true
    });
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "settings", "customers", "index.vue"),
      "<template><div>Generated customers list with filters</div></template>\n",
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "settings", "customers", "[customerId]", "index.vue"),
      "<template><div>Generated customer detail</div></template>\n",
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "settings", "customers", "new.vue"),
      "<template><div>Generated customer create</div></template>\n",
      "utf8"
    );

    await installFakeCommand(
      binDir,
      "npx",
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npx", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );

    const result = runCli({
      cwd: appRoot,
      args: [
        "app",
        "verify-ui",
        "--command",
        "npx playwright test tests/e2e/generated-crud-ui.spec.ts -g hierarchy",
        "--feature",
        "generated crud hierarchy",
        "--auth-mode",
        "none"
      ],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.deepEqual(await readLogLines(logPath), [
      "npx playwright test tests/e2e/generated-crud-ui.spec.ts -g hierarchy"
    ]);

    const receipt = JSON.parse(await readFile(path.join(appRoot, ".jskit", "verification", "ui.json"), "utf8"));
    assert.equal(receipt.runner, "playwright");
    assert.equal(receipt.feature, "generated crud hierarchy");
    assert.equal(receipt.command, "npx playwright test tests/e2e/generated-crud-ui.spec.ts -g hierarchy");
    assert.deepEqual(receipt.changedUiFiles, [
      "src/pages/home/settings/customers/[customerId]/index.vue",
      "src/pages/home/settings/customers/index.vue",
      "src/pages/home/settings/customers/new.vue"
    ]);
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

test("jskit app update-packages hands control to the latest installed CLI", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMinimalApp(appRoot, {
      devDependencies: {
        "@jskit-ai/jskit-cli": "1.2.3"
      }
    });
    const installedCliRoot = path.join(appRoot, "node_modules", "@jskit-ai", "jskit-cli");
    await mkdir(installedCliRoot, { recursive: true });
    await writeFile(
      path.join(installedCliRoot, "package.json"),
      `${JSON.stringify({ name: "@jskit-ai/jskit-cli", version: "1.2.3" }, null, 2)}\n`,
      "utf8"
    );
    await writeExecutable(
      path.join(appRoot, "node_modules", ".bin", "jskit"),
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(
  process.env.TEST_LOG_PATH,
  ["local-jskit", process.env.JSKIT_UPDATE_PACKAGES_BOOTSTRAPPED, ...process.argv.slice(2)].join(" ") + "\\n"
);
`
    );
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...args].join(" ") + "\\n");
if (args[0] === "view") {
  process.stdout.write("1.2.4\\n");
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
      "npm view @jskit-ai/jskit-cli version",
      "npm install --save-dev --save-exact @jskit-ai/jskit-cli@1.2.4",
      "local-jskit 1 app update-packages"
    ]);
    assert.match(String(result.stdout || ""), /bootstrapping @jskit-ai\/jskit-cli@1\.2\.4/u);
    assert.match(String(result.stdout || ""), /handing the update to the current local CLI/u);
  });
});

test("jskit app update-packages updates exact root packages and aligns npm workspaces", async () => {
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
      },
      optionalDependencies: {
        "@jskit-ai/uploads-runtime": "0.x"
      },
      peerDependencies: {
        "@jskit-ai/kernel": "0.x"
      },
      workspaces: ["packages/*"]
    });
    const workspaceRoot = path.join(appRoot, "packages", "feature");
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "package.json"),
      `${JSON.stringify({
        name: "@local/feature",
        version: "0.1.0",
        dependencies: {
          "@jskit-ai/kernel": "4.x",
          "@jskit-ai/realtime": "0.1.0",
          vue: "^3.5.0"
        }
      }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      path.join(workspaceRoot, "package.descriptor.mjs"),
      `export default {
  packageId: "@local/feature",
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/users-web": "0.1.0",
        "@jskit-ai/database-runtime": {
          version: "0.1.0",
          when: {
            option: "mode",
            notEquals: "orchestrator"
          }
        }
      }
    }
  }
};
`,
      "utf8"
    );
    await writeInstalledPackagesLock(appRoot, {
      "@jskit-ai/shell-web": {
        packageId: "@jskit-ai/shell-web",
        version: "7.8.8",
        migrationSyncVersion: "7.8.9"
      }
    });
    await installFakeLocalJskit(appRoot, logPath, {
      "@jskit-ai/shell-web": "7.8.9"
    });
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...args].join(" ") + "\\n");
if (args[0] === "query") {
  process.stdout.write(JSON.stringify([{ location: "packages/feature" }]) + "\\n");
}
if (args[0] === "view") {
  const packageName = args[args.length - 2];
  const versionMap = {
    "@jskit-ai/jskit-cli": "3.4.5",
    "@jskit-ai/database-runtime": "9.10.11",
    "@jskit-ai/kernel": "5.6.7",
    "@jskit-ai/realtime": "4.5.6",
    "@jskit-ai/shell-web": "7.8.9",
    "@jskit-ai/uploads-runtime": "6.7.8",
    "@jskit-ai/users-web": "8.9.10"
  };
  process.stdout.write((versionMap[packageName] || "1.2.3") + "\\n");
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["app", "update-packages"],
      env: buildTestEnv(binDir, logPath, {
        JSKIT_UPDATE_PACKAGES_BOOTSTRAPPED: "1"
      })
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.deepEqual(await readLogLines(logPath), [
      "npm view @jskit-ai/jskit-cli version",
      "npm view @jskit-ai/kernel version",
      "npm view @jskit-ai/shell-web version",
      "npm view @jskit-ai/uploads-runtime version",
      "npm install --save-exact @jskit-ai/shell-web@7.8.9",
      "npm install --save-dev --save-exact @jskit-ai/jskit-cli@3.4.5",
      "npm install --save-optional --save-exact @jskit-ai/uploads-runtime@6.7.8",
      "npm install --save-peer --save-exact @jskit-ai/kernel@5.6.7",
      "local-jskit update package @jskit-ai/shell-web",
      "local-jskit migrations changed",
      "local-jskit app sync-ci",
      "npm query .workspace --json",
      "npm view @jskit-ai/database-runtime version",
      "npm view @jskit-ai/realtime version",
      "npm view @jskit-ai/users-web version",
      "npm update --workspaces @jskit-ai/database-runtime @jskit-ai/kernel @jskit-ai/realtime @jskit-ai/users-web"
    ]);
    assert.match(String(result.stdout || ""), /\[jskit:update\] generating managed migrations for changed packages\./);
    assert.match(
      String(result.stdout || ""),
      /\[jskit:update\] managed packages requiring reapply: @jskit-ai\/shell-web\./u
    );
    assert.match(String(result.stdout || ""), /\[jskit:update\] Step 1\/3 complete in /);
    assert.match(String(result.stdout || ""), /\[jskit:update\] Step 3\/3 complete in /);

    const workspacePackageJson = JSON.parse(
      await readFile(path.join(workspaceRoot, "package.json"), "utf8")
    );
    assert.deepEqual(workspacePackageJson.dependencies, {
      "@jskit-ai/kernel": "5.x",
      "@jskit-ai/realtime": "4.x",
      vue: "^3.5.0"
    });
    assert.match(
      await readFile(path.join(workspaceRoot, "package.descriptor.mjs"), "utf8"),
      /"@jskit-ai\/users-web": "8\.x"/u
    );
    assert.match(
      await readFile(path.join(workspaceRoot, "package.descriptor.mjs"), "utf8"),
      /"@jskit-ai\/database-runtime": \{\s+version: "9\.x"/u
    );
    const { lock: updatedLock } = await loadLockFile(appRoot);
    assert.equal(updatedLock.installedPackages["@jskit-ai/shell-web"].version, "7.8.9");
  });
});

test("jskit app update-packages dry-run leaves workspace files and managed artifacts unchanged", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMinimalApp(appRoot, {
      dependencies: {
        "@jskit-ai/shell-web": "0.x"
      },
      workspaces: ["packages/*"]
    });
    const workspaceRoot = path.join(appRoot, "packages", "feature");
    await mkdir(workspaceRoot, { recursive: true });
    const workspacePackageJsonPath = path.join(workspaceRoot, "package.json");
    const workspaceDescriptorPath = path.join(workspaceRoot, "package.descriptor.mjs");
    const workspacePackageJsonSource = `${JSON.stringify({
      name: "@local/feature",
      version: "0.1.0",
      dependencies: {
        "@jskit-ai/kernel": "0.x"
      }
    }, null, 2)}\n`;
    const workspaceDescriptorSource = `export default {
  packageId: "@local/feature",
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/users-web": "0.x"
      }
    }
  }
};
`;
    await writeFile(workspacePackageJsonPath, workspacePackageJsonSource, "utf8");
    await writeFile(workspaceDescriptorPath, workspaceDescriptorSource, "utf8");
    await writeInstalledPackagesLock(appRoot, {
      "@jskit-ai/shell-web": {
        packageId: "@jskit-ai/shell-web",
        version: "7.8.8"
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
if (args[0] === "query") {
  process.stdout.write(JSON.stringify([{ location: "packages/feature" }]) + "\\n");
}
if (args[0] === "view") {
  process.stdout.write("7.8.9\\n");
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["app", "update-packages", "--dry-run"],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.equal(await readFile(workspacePackageJsonPath, "utf8"), workspacePackageJsonSource);
    assert.equal(await readFile(workspaceDescriptorPath, "utf8"), workspaceDescriptorSource);
    assert.equal(
      (await readLogLines(logPath)).some((line) => line.startsWith("local-jskit ")),
      false
    );
    assert.equal(
      (await readLogLines(logPath)).some((line) => line.startsWith("npm update ")),
      false
    );
    assert.match(
      String(result.stdout || ""),
      /managed packages requiring reapply: @jskit-ai\/shell-web\./u
    );
    assert.match(String(result.stdout || ""), /Step 3\/3 skipped in dry-run mode/u);
  });
});

test("collectChangedInstalledPackageIds ignores current and unmanaged registry packages", () => {
  const lock = {
    installedPackages: {
      "@jskit-ai/current": { version: "1.2.3" },
      "@jskit-ai/older": { version: "1.2.2" },
      "@jskit-ai/unversioned": {}
    }
  };
  const latestVersions = new Map([
    ["@jskit-ai/current", "1.2.3"],
    ["@jskit-ai/not-installed", "1.2.3"],
    ["@jskit-ai/older", "1.2.3"],
    ["@jskit-ai/unversioned", "1.2.3"]
  ]);

  assert.deepEqual(collectChangedInstalledPackageIds(lock, latestVersions), [
    "@jskit-ai/older",
    "@jskit-ai/unversioned"
  ]);
});

test("managed package reapply skips dependencies brought current by an earlier update", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const logPath = path.join(cwd, "commands.log");
    const parentPackageId = "@jskit-ai/a-parent";
    const dependencyPackageId = "@jskit-ai/z-dependency";
    await createMinimalApp(appRoot);
    await writeInstalledPackagesLock(appRoot, {
      [parentPackageId]: { packageId: parentPackageId, version: "1.0.0" },
      [dependencyPackageId]: { packageId: dependencyPackageId, version: "1.0.0" }
    });
    await installFakeLocalJskit(appRoot, logPath, {
      [parentPackageId]: {
        [parentPackageId]: "1.1.0",
        [dependencyPackageId]: "1.1.0"
      }
    });

    await reapplyChangedInstalledPackages({
      appRoot,
      createCliError: (message) => new Error(message),
      dryRun: false,
      latestVersions: new Map([
        [parentPackageId, "1.1.0"],
        [dependencyPackageId, "1.1.0"]
      ]),
      loadLockFile,
      stderr: silentStream,
      stdout: silentStream
    });

    assert.deepEqual(await readLogLines(logPath), [
      `local-jskit update package ${parentPackageId}`
    ]);
  });
});

test("managed package reapply fails if an update leaves the lock version stale", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const packageId = "@jskit-ai/stale-package";
    await createMinimalApp(appRoot);
    await writeInstalledPackagesLock(appRoot, {
      [packageId]: { packageId, version: "1.0.0" }
    });
    await installFakeLocalJskit(appRoot, path.join(cwd, "commands.log"));

    await assert.rejects(
      reapplyChangedInstalledPackages({
        appRoot,
        createCliError: (message) => new Error(message),
        dryRun: false,
        latestVersions: new Map([[packageId, "1.1.0"]]),
        loadLockFile,
        stderr: silentStream,
        stdout: silentStream
      }),
      /stale lock versions: @jskit-ai\/stale-package/u
    );
  });
});

test("formatElapsedTime keeps updater progress concise", () => {
  assert.equal(formatElapsedTime(0), "under 1s");
  assert.equal(formatElapsedTime(19_900), "19s");
  assert.equal(formatElapsedTime(60_000), "1m");
  assert.equal(formatElapsedTime(125_000), "2m 5s");
});

test("runWithProgress reports start, heartbeat, and completion", async () => {
  const messages = [];
  await runWithProgress(
    () => new Promise((resolve) => setTimeout(resolve, 50)),
    {
      activity: "testing a long update",
      progressIntervalMs: 10,
      stdout: {
        write(message) {
          messages.push(String(message).trim());
        }
      },
      step: "Step 1/3"
    }
  );

  assert.equal(messages[0], "[jskit:update] Step 1/3: testing a long update.");
  assert.ok(messages.some((message) => message.includes("Step 1/3 is still running")));
  assert.match(messages.at(-1), /^\[jskit:update\] Step 1\/3 complete in /u);
});

test("runWithProgress preserves task failures", async () => {
  await assert.rejects(
    runWithProgress(
      async () => {
        throw new Error("update failed");
      },
      {
        activity: "testing a failed update",
        progressIntervalMs: 10,
        stdout: { write() {} },
        step: "Step 3/3"
      }
    ),
    /update failed/u
  );
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
    assert.equal(packageJson.scripts.release, "jskit app release");
    assert.match(String(result.stdout || ""), /kept customized script jskit:update: echo keep-me/);
  });
});

test("jskit app adopt-managed-scripts --force rewrites customized wrappers and removes copied maintenance scripts", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const packageJsonPath = path.join(appRoot, "package.json");
    const copiedScriptPath = path.join(appRoot, "scripts", "release.sh");

    await createMinimalApp(appRoot, {
      scripts: {
        verify: "echo customized",
        "jskit:update": "echo customized",
        release: "echo customized"
      }
    });
    await mkdir(path.dirname(copiedScriptPath), { recursive: true });
    await writeFile(copiedScriptPath, "#!/usr/bin/env bash\n", "utf8");

    const result = runCli({
      cwd: appRoot,
      args: ["app", "adopt-managed-scripts", "--force"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    assert.deepEqual(packageJson.scripts, {
      verify: "jskit app verify && npm run --if-present verify:app",
      "jskit:update": "jskit app update-packages",
      release: "jskit app release"
    });
    await assert.rejects(lstat(copiedScriptPath), /ENOENT/);
  });
});

test("jskit app migrate-source-mutations moves legacy MainClientProvider registrations before the provider class", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createMinimalApp(appRoot);
    const providerPath = await writeLegacyMainClientProvider(appRoot);

    const dryRunResult = runCli({
      cwd: appRoot,
      args: ["app", "migrate-source-mutations", "--dry-run"]
    });
    assert.equal(dryRunResult.status, 0, String(dryRunResult.stderr || ""));
    assert.match(String(dryRunResult.stdout || ""), /would rewrite packages\/main\/src\/client\/providers\/MainClientProvider\.js/);
    const beforeMigration = await readFile(providerPath, "utf8");
    assert.match(beforeMigration, /export \{\n {2}MainClientProvider,\n {2}registerMainClientComponent\n\};\n\nregisterMainClientComponent/);

    const result = runCli({
      cwd: appRoot,
      args: ["app", "migrate-source-mutations"]
    });
    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /rewrote packages\/main\/src\/client\/providers\/MainClientProvider\.js/);

    const migrated = await readFile(providerPath, "utf8");
    assert.ok(
      migrated.indexOf('registerMainClientComponent("local.main.ui.menu-link-item", () => MenuLinkItem);') <
        migrated.indexOf("class MainClientProvider")
    );
    assert.ok(
      migrated.indexOf('registerMainClientComponent("local.main.ui.tab-link-item", () => TabLinkItem);') <
        migrated.indexOf("class MainClientProvider")
    );
    assert.doesNotMatch(migrated, /export \{\n {2}MainClientProvider,\n {2}registerMainClientComponent\n\};\n\nregisterMainClientComponent/);

    const rerunResult = runCli({
      cwd: appRoot,
      args: ["app", "migrate-source-mutations"]
    });
    assert.equal(rerunResult.status, 0, String(rerunResult.stderr || ""));
    assert.match(String(rerunResult.stdout || ""), /already current/);
    assert.equal(await readFile(providerPath, "utf8"), migrated);
  });
});

test("jskit app migrate-source-mutations removes duplicate legacy registrations", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createMinimalApp(appRoot);
    const providerPath = await writeLegacyMainClientProvider(appRoot);
    const source = await readFile(providerPath, "utf8");
    await writeFile(
      providerPath,
      source.replace(
        "class MainClientProvider",
        'registerMainClientComponent("local.main.ui.menu-link-item", () => MenuLinkItem);\n\nclass MainClientProvider'
      ),
      "utf8"
    );

    const result = runCli({
      cwd: appRoot,
      args: ["app", "migrate-source-mutations"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /removed 1 duplicate registration/);
    const migrated = await readFile(providerPath, "utf8");
    assert.equal(
      (migrated.match(/registerMainClientComponent\("local\.main\.ui\.menu-link-item"/g) || []).length,
      1
    );
  });
});

test("jskit app migrate-source-mutations folds legacy CRUD form field pushes into array literals", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createMinimalApp(appRoot);
    const formFieldsPath = await writeLegacyCrudFormFields(appRoot);

    const dryRunResult = runCli({
      cwd: appRoot,
      args: ["app", "migrate-source-mutations", "--dry-run"]
    });
    assert.equal(dryRunResult.status, 0, String(dryRunResult.stderr || ""));
    assert.match(
      String(dryRunResult.stdout || ""),
      /would rewrite src\/pages\/admin\/contacts\/_components\/ContactAddEditFormFields\.js: folded 3 form field pushes into array literals and moved 2 form-field markers/
    );
    assert.match(await readFile(formFieldsPath, "utf8"), /UI_CREATE_FORM_FIELDS\.push/);

    const result = runCli({
      cwd: appRoot,
      args: ["app", "migrate-source-mutations"]
    });
    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(
      String(result.stdout || ""),
      /rewrote src\/pages\/admin\/contacts\/_components\/ContactAddEditFormFields\.js: folded 3 form field pushes into array literals and moved 2 form-field markers/
    );

    const migrated = await readFile(formFieldsPath, "utf8");
    assert.doesNotMatch(migrated, /UI_CREATE_FORM_FIELDS\.push/);
    assert.doesNotMatch(migrated, /UI_EDIT_FORM_FIELDS\.push/);
    assert.match(
      migrated,
      /const UI_CREATE_FORM_FIELDS = \[\n {2}\{\n {4}"key": "firstName"[\s\S]* {2}\/\/ jskit:crud-ui-form-fields:new\n\];/
    );
    assert.match(
      migrated,
      /const UI_EDIT_FORM_FIELDS = \[\n {2}\{\n {4}"key": "existing"[\s\S]* {2}\/\/ jskit:crud-ui-form-fields:edit\n\];/
    );
    assert.match(migrated, /"key": "vetId"/);
    assert.equal((migrated.match(/"key": "existing"/g) || []).length, 1);

    const rerunResult = runCli({
      cwd: appRoot,
      args: ["app", "migrate-source-mutations"]
    });
    assert.equal(rerunResult.status, 0, String(rerunResult.stderr || ""));
    assert.match(String(rerunResult.stdout || ""), /source files are already current/);
    assert.equal(await readFile(formFieldsPath, "utf8"), migrated);
  });
});

test("jskit app migrate-source-mutations upgrades legacy provider and CRUD form pushes in one run", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createMinimalApp(appRoot);
    const providerPath = await writeLegacyMainClientProvider(appRoot);
    const formFieldsPath = await writeLegacyCrudFormFields(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: ["app", "migrate-source-mutations"]
    });
    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /rewrote packages\/main\/src\/client\/providers\/MainClientProvider\.js/);
    assert.match(String(result.stdout || ""), /rewrote src\/pages\/admin\/contacts\/_components\/ContactAddEditFormFields\.js/);

    const providerSource = await readFile(providerPath, "utf8");
    assert.ok(
      providerSource.indexOf('registerMainClientComponent("local.main.ui.menu-link-item", () => MenuLinkItem);') <
        providerSource.indexOf("class MainClientProvider")
    );

    const formFieldsSource = await readFile(formFieldsPath, "utf8");
    assert.doesNotMatch(formFieldsSource, /\.push\(\{/);
    assert.match(formFieldsSource, /"key": "vetId"/);
    assert.match(formFieldsSource, / {2}\/\/ jskit:crud-ui-form-fields:new\n\];/);
    assert.match(formFieldsSource, / {2}\/\/ jskit:crud-ui-form-fields:edit\n\];/);
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
    const branchName = logLines[10].slice("git switch -c ".length);
    const releaseStamp = logLines[12].slice("git commit -m chore: release ".length);
    assert.deepEqual(logLines, [
      "gh auth status",
      "git status --porcelain",
      "git rev-parse --abbrev-ref HEAD",
      "git fetch origin main",
      "git pull --ff-only origin main",
      `npm view --registry ${registryUrl} @jskit-ai/shell-web version`,
      `npm install --save-exact --registry ${registryUrl} @jskit-ai/shell-web@7.8.9`,
      "local-jskit migrations changed",
      "local-jskit app sync-ci",
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
