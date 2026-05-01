import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function createMinimalApp(appRoot, { name = "tmp-app" } = {}) {
  await mkdir(appRoot, { recursive: true });
  await writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify(
      {
        name,
        version: "0.1.0",
        private: true,
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(appRoot, "app.json"),
    `${JSON.stringify({ name }, null, 2)}\n`,
    "utf8"
  );
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

async function writeUiReceipt(appRoot, {
  feature = "contacts list",
  command = "npx playwright test tests/e2e/contacts.spec.ts -g list",
  authMode = "none",
  changedUiFiles = []
} = {}) {
  await mkdir(path.join(appRoot, ".jskit", "verification"), { recursive: true });
  await writeFile(
    path.join(appRoot, ".jskit", "verification", "ui.json"),
    `${JSON.stringify(
      {
        version: 1,
        runner: "playwright",
        recordedAt: "2026-04-20T12:00:00.000Z",
        feature,
        command,
        authMode,
        changedUiFiles
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

test("doctor flags changed UI files when no verification receipt exists", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-ui-receipt-missing-app");
    await createMinimalApp(appRoot, { name: "doctor-ui-receipt-missing-app" });
    await initializeGitApp(appRoot);

    await mkdir(path.join(appRoot, "src", "pages", "home", "contacts"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "contacts", "index.vue"),
      "<template><div>Contacts</div></template>\n",
      "utf8"
    );

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.equal(payload.issues.length, 1);
    assert.match(
      String(payload.issues[0] || ""),
      /\[ui:verification\] changed UI files require a matching \.jskit\/verification\/ui\.json receipt/
    );
  });
});

test("doctor flags stale UI verification receipts when changed UI files no longer match", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-ui-receipt-stale-app");
    await createMinimalApp(appRoot, { name: "doctor-ui-receipt-stale-app" });
    await initializeGitApp(appRoot);

    await mkdir(path.join(appRoot, "src", "pages", "home", "contacts"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "contacts", "index.vue"),
      "<template><div>Contacts</div></template>\n",
      "utf8"
    );

    await writeUiReceipt(appRoot, {
      changedUiFiles: ["src/pages/home/contacts/index.vue"]
    });

    await writeFile(
      path.join(appRoot, "src", "pages", "home", "contacts", "details.vue"),
      "<template><div>Details</div></template>\n",
      "utf8"
    );

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.equal(payload.issues.length, 1);
    assert.match(
      String(payload.issues[0] || ""),
      /\[ui:verification\] \.jskit\/verification\/ui\.json does not match the current changed UI file set/
    );
  });
});

test("doctor accepts matching UI verification receipts for the current dirty UI file set", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-ui-receipt-valid-app");
    await createMinimalApp(appRoot, { name: "doctor-ui-receipt-valid-app" });
    await initializeGitApp(appRoot);

    await mkdir(path.join(appRoot, "src", "pages", "home", "contacts"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "contacts", "index.vue"),
      "<template><div>Contacts</div></template>\n",
      "utf8"
    );

    await writeUiReceipt(appRoot, {
      authMode: "dev-auth-login-as",
      changedUiFiles: ["src/pages/home/contacts/index.vue"]
    });

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 0, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.deepEqual(payload.issues, []);
  });
});

test("doctor skips UI verification receipt enforcement outside JSKIT app roots", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "package-only-root");
    await mkdir(appRoot, { recursive: true });
    await writeFile(
      path.join(appRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "package-only-root",
          version: "0.1.0",
          private: true,
          type: "module"
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await initializeGitApp(appRoot);

    await mkdir(path.join(appRoot, "src", "pages", "home"), { recursive: true });
    await writeFile(path.join(appRoot, "src", "pages", "home", "index.vue"), "<template />\n", "utf8");

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 0, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.deepEqual(payload.issues, []);
  });
});
