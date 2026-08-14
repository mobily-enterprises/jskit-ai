import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function writePackage(packageRoot, packageJson) {
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8"
  );
}

test("add uses an installed third-party package without catalog registration or JSKIT state", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "third-party-package-app");
    const packageId = "@acme/external-auth";
    const version = "2.3.4";
    await writePackage(appRoot, {
      name: "demo-app",
      version: "0.1.0",
      private: true,
      type: "module",
      dependencies: {
        [packageId]: version
      }
    });
    await writePackage(path.join(appRoot, "node_modules", ...packageId.split("/")), {
      name: packageId,
      version,
      description: "External JSKIT-compatible package.",
      jskit: {
        kind: "runtime",
        capabilities: {
          provides: [],
          requires: []
        },
        runtime: {
          server: { providers: [] },
          client: { providers: [] }
        },
        mutations: {
          dependencies: { runtime: {}, dev: {} },
          packageJson: { scripts: {} },
          procfile: {},
          files: []
        }
      }
    });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", packageId]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));
    assert.match(String(addResult.stdout || ""), /Added package @acme\/external-auth\./);

    const appPackageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(appPackageJson.dependencies[packageId], version);

    const showResult = runCli({
      cwd: appRoot,
      args: ["show", packageId, "--json"]
    });
    assert.equal(showResult.status, 0, String(showResult.stderr || ""));
    const payload = JSON.parse(String(showResult.stdout || "{}"));
    assert.equal(payload.packageId, packageId);
    assert.equal(payload.version, version);
    assert.equal(payload.manifestPath, "node_modules/@acme/external-auth/package.json");
  });
});
