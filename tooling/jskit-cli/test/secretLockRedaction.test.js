import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

async function createSecretRuntimePackage(appRoot) {
  const packageId = "@demo/secret-runtime";
  const packageRoot = path.join(appRoot, "packages", "secret-runtime");
  await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });

  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: packageId,
        version: "0.1.0",
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "src", "server", "Provider.js"),
    "class Provider { static id = \"demo.secret\"; register() {} boot() {} }\nexport { Provider };\n",
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "package.descriptor.mjs"),
    `export default Object.freeze({
  packageId: "${packageId}",
  version: "0.1.0",
  kind: "runtime",
  runtime: {
    server: {
      providers: [{ entrypoint: "src/server/Provider.js", export: "Provider" }]
    },
    client: {
      providers: []
    }
  },
  options: {
    "db-name": {
      required: true,
      defaultValue: "appdb"
    },
    "db-password": {
      required: true,
      inputType: "password",
      promptLabel: "Database password"
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    text: [
      {
        file: ".env",
        op: "upsert-env",
        key: "DB_NAME",
        value: "\${option:db-name}",
        id: "database-name"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "DB_PASSWORD",
        value: "\${option:db-password}",
        id: "database-password"
      }
    ]
  }
});\n`,
    "utf8"
  );

  return packageId;
}

async function readLock(appRoot) {
  return JSON.parse(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"));
}

async function writeLock(appRoot, lock) {
  await writeFile(
    path.join(appRoot, ".jskit", "lock.json"),
    `${JSON.stringify(lock, null, 2)}\n`,
    "utf8"
  );
}

test("package add and update do not persist secret options or env mutation values", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "secret-lock-app");
    await createMinimalApp(appRoot, { name: "secret-lock-app" });
    const packageId = await createSecretRuntimePackage(appRoot);
    const secretValue = "do-not-write-this-password";

    const addResult = runCli({
      cwd: appRoot,
      args: [
        "add",
        "package",
        packageId,
        "--db-name",
        "demo_db",
        "--db-password",
        secretValue,
        "--json"
      ]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));
    assert.doesNotMatch(String(addResult.stdout || ""), new RegExp(secretValue));

    const envSource = await readFile(path.join(appRoot, ".env"), "utf8");
    assert.match(envSource, /^DB_NAME=demo_db$/m);
    assert.match(envSource, new RegExp(`^DB_PASSWORD=${secretValue}$`, "m"));

    const lockAfterAddSource = await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8");
    assert.doesNotMatch(lockAfterAddSource, new RegExp(secretValue));
    const lockAfterAdd = JSON.parse(lockAfterAddSource);
    const installedAfterAdd = lockAfterAdd.installedPackages[packageId];
    assert.equal(installedAfterAdd.options["db-name"], "demo_db");
    assert.equal(Object.prototype.hasOwnProperty.call(installedAfterAdd.options, "db-password"), false);
    assert.equal(installedAfterAdd.managed.text[".env::database-name"].value, "demo_db");
    assert.equal(installedAfterAdd.managed.text[".env::database-password"].sensitive, true);
    assert.equal(Object.prototype.hasOwnProperty.call(installedAfterAdd.managed.text[".env::database-password"], "value"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(installedAfterAdd.managed.text[".env::database-password"], "previousValue"), false);

    const poisonedLock = await readLock(appRoot);
    poisonedLock.installedPackages[packageId].options["db-password"] = "old-lock-password";
    poisonedLock.installedPackages[packageId].managed.text[".env::database-password"].value = "old-lock-password";
    poisonedLock.installedPackages[packageId].managed.text[".env::database-password"].previousValue = "older-lock-password";
    await writeLock(appRoot, poisonedLock);

    const updateResult = runCli({
      cwd: appRoot,
      args: ["update", "package", packageId, "--json"]
    });
    assert.equal(updateResult.status, 0, String(updateResult.stderr || ""));
    assert.doesNotMatch(String(updateResult.stdout || ""), new RegExp(secretValue));
    assert.doesNotMatch(String(updateResult.stdout || ""), /old-lock-password/);

    const lockAfterUpdateSource = await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8");
    assert.doesNotMatch(lockAfterUpdateSource, new RegExp(secretValue));
    assert.doesNotMatch(lockAfterUpdateSource, /old-lock-password|older-lock-password/);
    const lockAfterUpdate = JSON.parse(lockAfterUpdateSource);
    const installedAfterUpdate = lockAfterUpdate.installedPackages[packageId];
    assert.equal(Object.prototype.hasOwnProperty.call(installedAfterUpdate.options, "db-password"), false);
    assert.equal(installedAfterUpdate.managed.text[".env::database-password"].sensitive, true);
    assert.equal(Object.prototype.hasOwnProperty.call(installedAfterUpdate.managed.text[".env::database-password"], "value"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(installedAfterUpdate.managed.text[".env::database-password"], "previousValue"), false);
  });
});

test("package update restores secret options from the process environment when .env is absent", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "secret-process-env-app");
    await createMinimalApp(appRoot, { name: "secret-process-env-app" });
    const packageId = await createSecretRuntimePackage(appRoot);
    const secretValue = "process-env-only-password";

    const addResult = runCli({
      cwd: appRoot,
      args: [
        "add",
        "package",
        packageId,
        "--db-name",
        "demo_db",
        "--db-password",
        "initial-password"
      ]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    await rm(path.join(appRoot, ".env"));
    const updateResult = runCli({
      cwd: appRoot,
      args: ["update", "package", packageId, "--json"],
      env: {
        DB_PASSWORD: secretValue
      }
    });
    assert.equal(updateResult.status, 0, String(updateResult.stderr || ""));
    assert.doesNotMatch(String(updateResult.stdout || ""), new RegExp(secretValue));

    const envSource = await readFile(path.join(appRoot, ".env"), "utf8");
    assert.match(envSource, new RegExp(`^DB_PASSWORD=${secretValue}$`, "m"));
    const lockSource = await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8");
    assert.doesNotMatch(lockSource, new RegExp(secretValue));
  });
});

test("package remove leaves secret env values unmanaged", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "secret-remove-app");
    await createMinimalApp(appRoot, { name: "secret-remove-app" });
    const packageId = await createSecretRuntimePackage(appRoot);
    const secretValue = "remove-keeps-this-password";

    const addResult = runCli({
      cwd: appRoot,
      args: [
        "add",
        "package",
        packageId,
        "--db-name",
        "demo_db",
        "--db-password",
        secretValue
      ]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const removeResult = runCli({
      cwd: appRoot,
      args: ["remove", "package", packageId]
    });
    assert.equal(removeResult.status, 0, String(removeResult.stderr || ""));

    const envSource = await readFile(path.join(appRoot, ".env"), "utf8");
    assert.doesNotMatch(envSource, /^DB_NAME=/m);
    assert.match(envSource, new RegExp(`^DB_PASSWORD=${secretValue}$`, "m"));

    const lockSource = await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8");
    assert.doesNotMatch(lockSource, new RegExp(secretValue));
    const lock = JSON.parse(lockSource);
    assert.equal(Object.prototype.hasOwnProperty.call(lock.installedPackages, packageId), false);
  });
});
