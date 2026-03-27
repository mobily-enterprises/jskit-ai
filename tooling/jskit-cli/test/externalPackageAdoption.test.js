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

async function createExternalDescriptorPackage(appRoot, { packageId, version }) {
  const packageRoot = path.join(appRoot, "node_modules", ...String(packageId).split("/"));
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: packageId,
        version
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(packageRoot, "package.descriptor.mjs"),
    `export default Object.freeze({
  packageVersion: 1,
  packageId: ${JSON.stringify(packageId)},
  version: ${JSON.stringify(version)},
  kind: "runtime",
  description: "External JSKIT-compatible package.",
  dependsOn: [],
  capabilities: {
    provides: [],
    requires: []
  },
  options: {},
  runtime: {
    server: {
      providers: []
    },
    client: {
      providers: []
    }
  },
  metadata: {
    server: {
      routes: []
    },
    ui: {
      routes: [],
      elements: [],
      overrides: []
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    text: [],
    files: []
  }
});
`,
    "utf8"
  );
}

test("add package adopts installed external npm package descriptor into lock", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "external-package-adoption-app");
    await createMinimalApp(appRoot, { name: "demo-app" });

    const packageId = "@acme/external-auth";
    await createExternalDescriptorPackage(appRoot, {
      packageId,
      version: "2.3.4"
    });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", packageId, "--no-install"]
    });

    assert.equal(addResult.status, 0, String(addResult.stderr || ""));
    assert.match(String(addResult.stdout || ""), /Added package @acme\/external-auth\./);

    const appPackageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(appPackageJson.dependencies[packageId], "2.3.4");

    const lock = JSON.parse(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"));
    const lockEntry = lock.installedPackages[packageId];
    assert.ok(lockEntry);
    assert.equal(lockEntry.packageId, packageId);
    assert.equal(lockEntry.source.type, "npm-installed-package");
    assert.equal(lockEntry.source.packagePath, "node_modules/@acme/external-auth");
    assert.equal(lockEntry.source.descriptorPath, "node_modules/@acme/external-auth/package.descriptor.mjs");

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });
    assert.equal(doctorResult.status, 0, String(doctorResult.stderr || ""));
    const doctorPayload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.deepEqual(doctorPayload.issues, []);

    const listResult = runCli({
      cwd: appRoot,
      args: ["list", "packages"]
    });
    assert.equal(listResult.status, 0, String(listResult.stderr || ""));
    assert.match(String(listResult.stdout || ""), /Installed external packages:/);
    assert.match(String(listResult.stdout || ""), /@acme\/external-auth \(2\.3\.4\) \(installed\)/);
  });
});
