import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function createMinimalApp(appRoot, { tenancyMode = "" } = {}) {
  await mkdir(appRoot, { recursive: true });
  await mkdir(path.join(appRoot, "config"), { recursive: true });

  await writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "tmp-app",
        version: "0.1.0",
        private: true,
        type: "module",
        dependencies: {
          "@tanstack/vue-query": "5.100.9",
          vue: "3.5.29",
          "vue-router": "5.0.6"
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    path.join(appRoot, "config/public.js"),
    [
      "export const config = {};",
      tenancyMode ? `config.tenancyMode = ${JSON.stringify(tenancyMode)};` : "",
      'config.surfaceModeAll = "all";',
      'config.surfaceDefaultId = "home";',
      "config.surfaceDefinitions = {};",
      'config.surfaceDefinitions.home = { id: "home", pagesRoot: "", enabled: true, requiresAuth: false, requiresWorkspace: false };',
      'config.surfaceDefinitions.console = { id: "console", pagesRoot: "console", enabled: true, requiresAuth: true, requiresWorkspace: false };',
      ""
    ].join("\n"),
    "utf8"
  );

  await writeFile(path.join(appRoot, "config/server.js"), "export const config = {};\n", "utf8");
}

async function installAuthAndMysql(appRoot) {
  const addProviderResult = runCli({
    cwd: appRoot,
    args: [
      "add",
      "package",
      "auth-provider-supabase-core",
      "--auth-supabase-url",
      "https://example.supabase.co",
      "--auth-supabase-publishable-key",
      "sb_publishable_example",
      "--app-public-url",
      "http://localhost:5173"
    ]
  });
  assert.equal(addProviderResult.status, 0, String(addProviderResult.stderr || ""));

  const addMysqlDriverResult = runCli({
    cwd: appRoot,
    args: [
      "add",
      "package",
      "database-runtime-mysql",
      "--db-name",
      "app_db",
      "--db-user",
      "app_user",
      "--db-password",
      "app_pass"
    ]
  });
  assert.equal(addMysqlDriverResult.status, 0, String(addMysqlDriverResult.stderr || ""));
}

test("installing users-core sets auth profile mode in server config", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "users-profile-mode-app");
    await createMinimalApp(appRoot);
    await installAuthAndMysql(appRoot);

    const addUsersCoreResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "users-core"]
    });
    assert.equal(addUsersCoreResult.status, 0, String(addUsersCoreResult.stderr || ""));

    const serverConfigSource = await readFile(path.join(appRoot, "config/server.js"), "utf8");
    assert.match(serverConfigSource, /config\.auth \|\|= \{\};/);
    assert.match(serverConfigSource, /config\.auth\.profileMode = "provider";/);
    assert.match(serverConfigSource, /config\.auth\.profileMode = "users";/);
    assert.ok(
      serverConfigSource.lastIndexOf('config.auth.profileMode = "users";') >
        serverConfigSource.lastIndexOf('config.auth.profileMode = "provider";')
    );

    const envSource = await readFile(path.join(appRoot, ".env"), "utf8");
    assert.doesNotMatch(envSource, /^AUTH_PROFILE_MODE=/m);
  });
});

test("installing users-core warns when workspace-capable tenancy is missing workspaces-core", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "users-workspace-warning-app");
    await createMinimalApp(appRoot, {
      tenancyMode: "personal"
    });
    await installAuthAndMysql(appRoot);

    const addUsersCoreResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "users-core"]
    });
    assert.equal(addUsersCoreResult.status, 0, String(addUsersCoreResult.stderr || ""));
    assert.match(String(addUsersCoreResult.stdout || ""), /Warnings \(1\):/);
    assert.match(String(addUsersCoreResult.stdout || ""), /@jskit-ai\/workspaces-core/);
    assert.match(String(addUsersCoreResult.stdout || ""), /workspace users scaffold/);
  });
});
