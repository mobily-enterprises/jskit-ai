import assert from "node:assert/strict";
import { access, constants as fsConstants, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
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

async function fileExists(absolutePath) {
  try {
    await access(absolutePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function createAppOwnedClaimPackage(
  appRoot,
  {
    version = "0.1.0",
    expectedExistingContent = "starter-shell\n",
    replacementContent = "claimed-shell\n"
  } = {}
) {
  const packageRoot = path.join(appRoot, "packages", "claim-feature");
  await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
  await mkdir(path.join(packageRoot, "templates"), { recursive: true });

  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "@demo/claim-feature",
        version,
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "src", "server", "Provider.js"),
    "class Provider { static id = \"demo.claim\"; register() {} boot() {} }\nexport { Provider };\n",
    "utf8"
  );

  await writeFile(path.join(packageRoot, "templates", "expected-existing.txt"), expectedExistingContent, "utf8");
  await writeFile(path.join(packageRoot, "templates", "replacement.txt"), replacementContent, "utf8");

  await writeFile(
    path.join(packageRoot, "package.descriptor.mjs"),
    `export default Object.freeze({
  packageId: "@demo/claim-feature",
  version: "${version}",
  kind: "runtime",
  runtime: {
    server: {
      providers: [{ entrypoint: "src/server/Provider.js", export: "Provider" }]
    },
    client: {
      providers: []
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    files: [
      {
        from: "templates/replacement.txt",
        to: "src/App.vue",
        ownership: "app",
        expectedExistingFrom: "templates/expected-existing.txt",
        reason: "Claim app shell scaffold.",
        category: "demo",
        id: "demo-app-shell"
      }
    ]
  }
});
`,
    "utf8"
  );
}

test("add package claims an app-owned file from the expected baseline and reapplies unchanged content on update", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app-owned-claim-app");
    await createMinimalApp(appRoot, { name: "app-owned-claim-app" });
    await mkdir(path.join(appRoot, "src"), { recursive: true });
    await writeFile(path.join(appRoot, "src", "App.vue"), "starter-shell\n", "utf8");

    await createAppOwnedClaimPackage(appRoot, {
      version: "0.1.0",
      expectedExistingContent: "starter-shell\n",
      replacementContent: "claimed-shell-v1\n"
    });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/claim-feature"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));
    assert.equal(await readFile(path.join(appRoot, "src", "App.vue"), "utf8"), "claimed-shell-v1\n");

    const lockAfterAdd = JSON.parse(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"));
    assert.equal(lockAfterAdd.installedPackages["@demo/claim-feature"].managed.files[0].path, "src/App.vue");

    await createAppOwnedClaimPackage(appRoot, {
      version: "0.2.0",
      expectedExistingContent: "starter-shell\n",
      replacementContent: "claimed-shell-v2\n"
    });

    const updateResult = runCli({
      cwd: appRoot,
      args: ["update", "package", "@demo/claim-feature"]
    });
    assert.equal(updateResult.status, 0, String(updateResult.stderr || ""));
    assert.equal(await readFile(path.join(appRoot, "src", "App.vue"), "utf8"), "claimed-shell-v2\n");
  });
});

test("add package fails before any writes when an app-owned file cannot be claimed", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app-owned-claim-failure-app");
    await createMinimalApp(appRoot, { name: "app-owned-claim-failure-app" });
    await mkdir(path.join(appRoot, "src"), { recursive: true });
    await writeFile(path.join(appRoot, "src", "App.vue"), "custom-app-shell\n", "utf8");
    await createAppOwnedClaimPackage(appRoot, {
      expectedExistingContent: "starter-shell\n",
      replacementContent: "claimed-shell\n"
    });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/claim-feature"]
    });
    assert.notEqual(addResult.status, 0);
    assert.match(String(addResult.stderr || ""), /cannot be claimed/i);

    assert.equal(await readFile(path.join(appRoot, "src", "App.vue"), "utf8"), "custom-app-shell\n");

    const appPackageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(appPackageJson.dependencies, undefined);
    assert.equal(await fileExists(path.join(appRoot, ".jskit", "lock.json")), false);
  });
});

test("update package fails when a managed app-owned file is missing on disk", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app-owned-missing-file-app");
    await createMinimalApp(appRoot, { name: "app-owned-missing-file-app" });
    await mkdir(path.join(appRoot, "src"), { recursive: true });
    await writeFile(path.join(appRoot, "src", "App.vue"), "starter-shell\n", "utf8");

    await createAppOwnedClaimPackage(appRoot, {
      version: "0.1.0",
      expectedExistingContent: "starter-shell\n",
      replacementContent: "claimed-shell-v1\n"
    });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/claim-feature"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const lockPath = path.join(appRoot, ".jskit", "lock.json");
    const lockAfterAdd = await readFile(lockPath, "utf8");

    await unlink(path.join(appRoot, "src", "App.vue"));

    await createAppOwnedClaimPackage(appRoot, {
      version: "0.2.0",
      expectedExistingContent: "starter-shell\n",
      replacementContent: "claimed-shell-v2\n"
    });

    const updateResult = runCli({
      cwd: appRoot,
      args: ["update", "package", "@demo/claim-feature"]
    });
    assert.equal(updateResult.status, 1);
    assert.match(String(updateResult.stderr || ""), /managed in lock but missing on disk/i);
    assert.equal(await fileExists(path.join(appRoot, "src", "App.vue")), false);
    assert.equal(await readFile(lockPath, "utf8"), lockAfterAdd);
  });
});

test("update package fails with install guidance when the package is not installed", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "update-missing-package-app");
    await createMinimalApp(appRoot, { name: "update-missing-package-app" });

    const updateResult = runCli({
      cwd: appRoot,
      args: ["update", "package", "workspaces-core"]
    });
    assert.equal(updateResult.status, 1);
    assert.match(String(updateResult.stderr || ""), /Package is not installed: workspaces-core/);
    assert.match(String(updateResult.stderr || ""), /already recorded in \.jskit\/lock\.json/i);
    assert.match(String(updateResult.stderr || ""), /jskit add package workspaces-core/);
  });
});
