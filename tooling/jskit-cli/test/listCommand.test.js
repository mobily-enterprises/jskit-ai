import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function createMinimalApp(appRoot, { name = "tmp-app", installedPackages = {} } = {}) {
  await mkdir(path.join(appRoot, ".jskit"), { recursive: true });
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
    path.join(appRoot, ".jskit", "lock.json"),
    `${JSON.stringify(
      {
        lockVersion: 1,
        installedPackages
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

test("list packages shows installed local packages section for lock-only package ids", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "list-local-packages-app");
    await createMinimalApp(appRoot, {
      name: "demo-app",
      installedPackages: {
        "@jskit-ai/auth-core": {
          packageId: "@jskit-ai/auth-core",
          version: "0.1.0"
        },
        "@demo-app/local-feature": {
          packageId: "@demo-app/local-feature",
          version: "0.3.2",
          source: {
            type: "local-package",
            packagePath: "packages/local-feature",
            descriptorPath: "packages/local-feature/package.descriptor.mjs"
          }
        }
      }
    });

    const result = runCli({
      cwd: appRoot,
      args: ["list", "packages"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const stdout = String(result.stdout || "");
    assert.match(stdout, /Available runtime packages:/);
    assert.match(stdout, /Installed local packages:/);
    assert.match(stdout, /@demo-app\/local-feature \(0\.3\.2\) \(installed\)/);
  });
});

test("list packages --json includes installedLocalPackages payload", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "list-local-packages-json-app");
    await createMinimalApp(appRoot, {
      name: "demo-app",
      installedPackages: {
        "@demo-app/local-feature": {
          packageId: "@demo-app/local-feature",
          version: "0.3.2",
          source: {
            type: "local-package",
            packagePath: "packages/local-feature",
            descriptorPath: "packages/local-feature/package.descriptor.mjs"
          }
        }
      }
    });

    const result = runCli({
      cwd: appRoot,
      args: ["list", "packages", "--json"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const payload = JSON.parse(String(result.stdout || "{}"));
    assert.equal(Array.isArray(payload.installedLocalPackages), true);
    assert.deepEqual(payload.installedLocalPackages, [
      {
        packageId: "@demo-app/local-feature",
        version: "0.3.2"
      }
    ]);

    const lock = JSON.parse(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"));
    assert.equal(lock.installedPackages["@demo-app/local-feature"].version, "0.3.2");
  });
});

test("list generators prints generator-only section", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "list-generators-app");
    await createMinimalApp(appRoot, { name: "list-generators-app" });

    const result = runCli({
      cwd: appRoot,
      args: ["list", "generators"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const stdout = String(result.stdout || "");
    assert.match(stdout, /Available generators:/);
    assert.match(stdout, /@jskit-ai\/crud-server-generator/);
    assert.match(stdout, /@jskit-ai\/crud-ui-generator/);
    assert.doesNotMatch(stdout, /Available runtime packages:/);
  });
});

test("list packages does not include generator package ids", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "list-runtime-packages-app");
    await createMinimalApp(appRoot, { name: "list-runtime-packages-app" });

    const result = runCli({
      cwd: appRoot,
      args: ["list", "packages"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const stdout = String(result.stdout || "");
    assert.match(stdout, /Available runtime packages:/);
    assert.doesNotMatch(stdout, /@jskit-ai\/crud-ui-generator/);
    assert.doesNotMatch(stdout, /@jskit-ai\/crud-server-generator/);
  });
});
