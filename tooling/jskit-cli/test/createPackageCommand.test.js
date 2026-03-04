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

test("create package scaffolds local module and wires package.json + lock", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "create-local-package-app");
    await createMinimalApp(appRoot, { name: "demo-app" });

    const result = runCli({
      cwd: appRoot,
      args: ["create", "package", "feature-auth", "--no-install"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /Created local package @demo-app\/feature-auth\./);

    const appPackageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(appPackageJson.dependencies["@demo-app/feature-auth"], "file:packages/feature-auth");

    const lock = JSON.parse(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"));
    const entry = lock.installedPackages["@demo-app/feature-auth"];
    assert.equal(entry.packageId, "@demo-app/feature-auth");
    assert.equal(entry.source.type, "local-package");
    assert.equal(entry.source.packagePath, "packages/feature-auth");
    assert.equal(entry.source.descriptorPath, "packages/feature-auth/package.descriptor.mjs");

    const localPackageJson = JSON.parse(await readFile(path.join(appRoot, "packages", "feature-auth", "package.json"), "utf8"));
    assert.equal(localPackageJson.name, "@demo-app/feature-auth");
    assert.equal(localPackageJson.exports["./client"], "./src/client/index.js");
    assert.equal(localPackageJson.exports["./server"], "./src/server/index.js");
    assert.equal(localPackageJson.exports["./shared"], "./src/shared/index.js");

    const descriptorSource = String(
      await readFile(path.join(appRoot, "packages", "feature-auth", "package.descriptor.mjs"), "utf8")
    );
    assert.match(descriptorSource, /capabilities:/);
    assert.match(descriptorSource, /runtime:/);
    assert.match(descriptorSource, /metadata:/);
    assert.match(descriptorSource, /mutations:/);
    assert.match(descriptorSource, /options:/);
  });
});

test("create package --dry-run reports changes without writing files", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "create-local-package-dry-run-app");
    await createMinimalApp(appRoot, { name: "demo-app" });

    const result = runCli({
      cwd: appRoot,
      args: ["create", "package", "sample", "--dry-run", "--no-install", "--package-id", "@acme/sample"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /Dry run enabled: no files were written\./);

    const appPackageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(appPackageJson.dependencies, undefined);
  });
});

