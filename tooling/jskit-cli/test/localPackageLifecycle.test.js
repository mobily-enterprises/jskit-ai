import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
}

test("local package can be removed (disabled) and added back from app packages directory", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "local-package-lifecycle-app");
    await createMinimalApp(appRoot, { name: "demo-app" });

    const packageId = "@demo/local-feature";
    const createResult = runCli({
      cwd: appRoot,
      args: ["create", "package", "local-feature", "--package-id", packageId, "--no-install"]
    });
    assert.equal(createResult.status, 0, String(createResult.stderr || ""));

    const removeResult = runCli({
      cwd: appRoot,
      args: ["remove", "package", packageId, "--no-install"]
    });
    assert.equal(removeResult.status, 0, String(removeResult.stderr || ""));

    const listAfterRemove = runCli({
      cwd: appRoot,
      args: ["list", "packages"]
    });
    assert.equal(listAfterRemove.status, 0, String(listAfterRemove.stderr || ""));
    const removeStdout = String(listAfterRemove.stdout || "");
    assert.match(removeStdout, /Available local packages \(not installed\):/);
    assert.match(removeStdout, /@demo\/local-feature \(0\.1\.0\)/);

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", packageId, "--no-install"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));
    assert.match(String(addResult.stdout || ""), /Added package @demo\/local-feature\./);

    const lock = JSON.parse(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"));
    assert.ok(lock.installedPackages[packageId]);
    assert.equal(lock.installedPackages[packageId].packageId, packageId);

    const listAfterAdd = runCli({
      cwd: appRoot,
      args: ["list", "packages"]
    });
    assert.equal(listAfterAdd.status, 0, String(listAfterAdd.stderr || ""));
    const addStdout = String(listAfterAdd.stdout || "");
    assert.match(addStdout, /Installed local packages:/);
    assert.match(addStdout, /@demo\/local-feature \(0\.1\.0\) \(installed\)/);
  });
});

test("doctor accepts installed app-local packages", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-local-package-app");
    await createMinimalApp(appRoot, { name: "demo-app" });

    const packageId = "@demo/local-feature";
    const createResult = runCli({
      cwd: appRoot,
      args: ["create", "package", "local-feature", "--package-id", packageId, "--no-install"]
    });
    assert.equal(createResult.status, 0, String(createResult.stderr || ""));

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });
    assert.equal(doctorResult.status, 0, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.deepEqual(payload.issues, []);
    assert.ok(Array.isArray(payload.installedPackages));
    assert.ok(payload.installedPackages.includes(packageId));
  });
});
