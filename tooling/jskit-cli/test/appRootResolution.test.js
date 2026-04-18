import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { resolveAppRootFromCwd } from "../src/server/cliRuntime/appState.js";
import { withTempDir } from "../../testUtils/tempDir.mjs";

async function writePackageJson(directoryPath, packageJson = {}) {
  await mkdir(directoryPath, { recursive: true });
  await writeFile(
    path.join(directoryPath, "package.json"),
    `${JSON.stringify(
      {
        name: packageJson.name || "tmp-package",
        version: packageJson.version || "0.1.0",
        private: packageJson.private ?? true,
        type: packageJson.type || "module",
        ...packageJson
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

test("resolveAppRootFromCwd prefers the real JSKIT app root over nested local packages", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const nestedPackageRoot = path.join(appRoot, "packages", "main");

    await writePackageJson(appRoot, { name: "example-app" });
    await mkdir(path.join(appRoot, ".jskit"), { recursive: true });
    await writeFile(path.join(appRoot, ".jskit", "lock.json"), "{\n  \"lockVersion\": 1,\n  \"installedPackages\": {}\n}\n", "utf8");
    await writePackageJson(nestedPackageRoot, { name: "@local/main" });

    const resolvedRoot = await resolveAppRootFromCwd(nestedPackageRoot);
    assert.equal(resolvedRoot, appRoot);
  });
});

test("resolveAppRootFromCwd falls back to the nearest package.json when no JSKIT app markers exist", async () => {
  await withTempDir(async (cwd) => {
    const packageRoot = path.join(cwd, "plain-package");
    const childDirectory = path.join(packageRoot, "src");

    await writePackageJson(packageRoot, { name: "plain-package" });
    await mkdir(childDirectory, { recursive: true });

    const resolvedRoot = await resolveAppRootFromCwd(childDirectory);
    assert.equal(resolvedRoot, packageRoot);
  });
});
