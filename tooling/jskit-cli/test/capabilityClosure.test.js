import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function createMinimalApp(appRoot) {
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
      'config.surfaceModeAll = "all";',
      'config.surfaceDefaultId = "home";',
      "config.surfaceDefinitions = {};",
      'config.surfaceDefinitions.home = { id: "home", pagesRoot: "home", enabled: true, requiresAuth: false, requiresWorkspace: false };',
      'config.surfaceDefinitions.console = { id: "console", pagesRoot: "console", enabled: true, requiresAuth: true, requiresWorkspace: false };',
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(path.join(appRoot, "config/server.js"), "export const config = {};\n", "utf8");
}

test("add bundle auth-base fails when required capabilities have no provider", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "missing-provider-app");
    await createMinimalApp(appRoot);
    const result = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "auth-base"]
    });

    assert.notEqual(result.status, 0);
    assert.match(String(result.stderr || ""), /requires capability auth\.provider/);
    assert.match(String(result.stderr || ""), /@jskit-ai\/auth-provider-supabase-core/);
  });
});

test("add bundle auth-base passes after a provider package is installed", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "provider-installed-app");
    await createMinimalApp(appRoot);
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

    const addBundleResult = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "auth-base"]
    });
    assert.equal(addBundleResult.status, 0, String(addBundleResult.stderr || ""));
    assert.match(String(addBundleResult.stdout || ""), /Added bundle auth-base\./);
  });
});
