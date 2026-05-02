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
        type: "module"
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

test("installing users-core sets AUTH_PROFILE_MODE to users", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "users-profile-mode-app");
    await createMinimalApp(appRoot);
    await installAuthAndMysql(appRoot);

    const addUsersCoreResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "users-core"]
    });
    assert.equal(addUsersCoreResult.status, 0, String(addUsersCoreResult.stderr || ""));

    const envSource = await readFile(path.join(appRoot, ".env"), "utf8");
    assert.match(envSource, /^AUTH_PROFILE_MODE=users$/m);
    assert.doesNotMatch(envSource, /^AUTH_PROFILE_MODE=standalone$/m);
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

test("updating users-core after switching tenancy to personal reapplies the workspace users scaffold when files are unchanged", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "users-tenancy-recovery-app");
    await createMinimalApp(appRoot, {
      tenancyMode: "none"
    });
    await installAuthAndMysql(appRoot);

    const addUsersCoreResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "users-core"]
    });
    assert.equal(addUsersCoreResult.status, 0, String(addUsersCoreResult.stderr || ""));

    await writeFile(
      path.join(appRoot, "config/public.js"),
      (await readFile(path.join(appRoot, "config/public.js"), "utf8")).replace(
        'config.tenancyMode = "none";',
        'config.tenancyMode = "personal";'
      ),
      "utf8"
    );

    const addWorkspacesCoreResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "workspaces-core"]
    });
    assert.equal(addWorkspacesCoreResult.status, 0, String(addWorkspacesCoreResult.stderr || ""));

    const updateUsersCoreResult = runCli({
      cwd: appRoot,
      args: ["update", "package", "users-core"]
    });
    assert.equal(updateUsersCoreResult.status, 0, String(updateUsersCoreResult.stderr || ""));

    const packageDescriptorSource = await readFile(path.join(appRoot, "packages/users/package.descriptor.mjs"), "utf8");
    const providerSource = await readFile(path.join(appRoot, "packages/users/src/server/UsersProvider.js"), "utf8");
    const actionsSource = await readFile(path.join(appRoot, "packages/users/src/server/actions.js"), "utf8");
    const routesSource = await readFile(path.join(appRoot, "packages/users/src/server/registerRoutes.js"), "utf8");

    assert.match(packageDescriptorSource, /@jskit-ai\/workspaces-core/);
    assert.match(providerSource, /surface: "admin"/);
    assert.match(providerSource, /routeSurfaceRequiresWorkspace/);
    assert.match(actionsSource, /workspaceSlugParamsValidator/);
    assert.match(routesSource, /routeBase: routeSurfaceRequiresWorkspace === true \? "\/w\/:workspaceSlug" : "\/"/);
  });
});

test("updating users-core after switching tenancy preserves user-modified managed scaffold files", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "users-tenancy-recovery-preserve-app");
    await createMinimalApp(appRoot, {
      tenancyMode: "none"
    });
    await installAuthAndMysql(appRoot);

    const addUsersCoreResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "users-core"]
    });
    assert.equal(addUsersCoreResult.status, 0, String(addUsersCoreResult.stderr || ""));

    await writeFile(
      path.join(appRoot, "config/public.js"),
      (await readFile(path.join(appRoot, "config/public.js"), "utf8")).replace(
        'config.tenancyMode = "none";',
        'config.tenancyMode = "personal";'
      ),
      "utf8"
    );

    const addWorkspacesCoreResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "workspaces-core"]
    });
    assert.equal(addWorkspacesCoreResult.status, 0, String(addWorkspacesCoreResult.stderr || ""));

    const providerPath = path.join(appRoot, "packages/users/src/server/UsersProvider.js");
    await writeFile(
      providerPath,
      `${await readFile(providerPath, "utf8")}\n// user-customized\n`,
      "utf8"
    );

    const updateUsersCoreResult = runCli({
      cwd: appRoot,
      args: ["update", "package", "users-core"]
    });
    assert.equal(updateUsersCoreResult.status, 0, String(updateUsersCoreResult.stderr || ""));

    const providerSource = await readFile(providerPath, "utf8");
    assert.match(providerSource, /user-customized/);
    assert.match(providerSource, /surface: "home"/);
    assert.doesNotMatch(providerSource, /surface: "admin"/);
  });
});
