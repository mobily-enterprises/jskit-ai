import assert from "node:assert/strict";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function createAppWithMigrationPackage(appRoot) {
  const packageRoot = path.join(appRoot, "packages", "migrations-only");
  await mkdir(path.join(packageRoot, "templates"), { recursive: true });
  await writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify({
      name: "migrations-sync-app",
      version: "0.1.0",
      private: true,
      type: "module",
      dependencies: {
        "@demo/migrations-only": "file:packages/migrations-only"
      }
    }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify({
      name: "@demo/migrations-only",
      version: "1.2.3",
      type: "module",
      jskit: {
        kind: "runtime",
        runtime: {
          server: { providers: [] },
          client: { providers: [] }
        },
        mutations: {
          files: [
            {
              op: "copy-file",
              from: "templates/generated.txt",
              to: "src/generated/demo.txt"
            },
            {
              op: "install-migration",
              from: "templates/demo.cjs",
              toDir: "migrations",
              extension: ".cjs",
              id: "demo-migration"
            }
          ]
        }
      }
    }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(path.join(packageRoot, "templates", "generated.txt"), "not-a-migration\n", "utf8");
  await writeFile(path.join(packageRoot, "templates", "demo.cjs"), "module.exports = { up() {}, down() {} };\n", "utf8");
}

async function addGeneratorMigrationPackage(appRoot) {
  const packageRoot = path.join(appRoot, "packages", "demo-generator");
  const appPackageJsonPath = path.join(appRoot, "package.json");
  const appPackageJson = JSON.parse(await readFile(appPackageJsonPath, "utf8"));
  appPackageJson.devDependencies = {
    ...(appPackageJson.devDependencies || {}),
    "@demo/demo-generator": "file:packages/demo-generator"
  };
  await writeFile(appPackageJsonPath, `${JSON.stringify(appPackageJson, null, 2)}\n`, "utf8");
  await mkdir(path.join(packageRoot, "templates"), { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify({
      name: "@demo/demo-generator",
      version: "1.0.0",
      type: "module",
      jskit: {
        kind: "generator",
        runtime: {
          server: { providers: [] },
          client: { providers: [] }
        },
        mutations: {
          files: [
            {
              op: "install-migration",
              from: "templates/generated.cjs",
              toDir: "migrations",
              extension: ".cjs",
              id: "generated-migration"
            }
          ]
        }
      }
    }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(packageRoot, "templates", "generated.cjs"),
    "module.exports = { generated: true };\n",
    "utf8"
  );
}

async function createAppWithTransitiveMigrationPackage(appRoot) {
  const featureRoot = path.join(appRoot, "packages", "feature");
  const migrationPackageRoot = path.join(
    appRoot,
    "node_modules",
    "@demo",
    "transitive-migrations"
  );
  await mkdir(featureRoot, { recursive: true });
  await mkdir(path.join(migrationPackageRoot, "templates"), { recursive: true });
  await writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify({
      name: "transitive-migrations-app",
      version: "0.1.0",
      private: true,
      type: "module",
      dependencies: {
        "@demo/feature": "file:packages/feature"
      }
    }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(featureRoot, "package.json"),
    `${JSON.stringify({
      name: "@demo/feature",
      version: "1.0.0",
      type: "module",
      dependencies: {
        "@demo/transitive-migrations": "1.0.0"
      },
      jskit: {
        kind: "runtime",
        runtime: {
          server: { providers: [] },
          client: { providers: [] }
        },
        mutations: { files: [] }
      }
    }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(migrationPackageRoot, "package.json"),
    `${JSON.stringify({
      name: "@demo/transitive-migrations",
      version: "1.0.0",
      type: "module",
      jskit: {
        kind: "runtime",
        runtime: {
          server: { providers: [] },
          client: { providers: [] }
        },
        mutations: {
          files: [
            {
              op: "install-migration",
              from: "templates/transitive.cjs",
              toDir: "migrations",
              extension: ".cjs",
              id: "transitive-migration"
            }
          ]
        }
      }
    }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(migrationPackageRoot, "templates", "transitive.cjs"),
    "module.exports = { transitive: true };\n",
    "utf8"
  );
}

async function migrationFiles(appRoot) {
  return (await readdir(path.join(appRoot, "migrations")).catch(() => []))
    .filter((entry) => entry.endsWith("_demo-migration.cjs"));
}

test("migrations sync reads installed package.json metadata and writes only migrations", async () => {
  await withTempDir(async (appRoot) => {
    await createAppWithMigrationPackage(appRoot);

    const checkBefore = runCli({ cwd: appRoot, args: ["migrations", "sync", "--check"] });
    assert.equal(checkBefore.status, 1);
    assert.match(String(checkBefore.stderr || ""), /Migration files are out of date/u);
    assert.deepEqual(await migrationFiles(appRoot), []);

    const syncResult = runCli({ cwd: appRoot, args: ["migrations", "sync"] });
    assert.equal(syncResult.status, 0, String(syncResult.stderr || ""));
    assert.match(String(syncResult.stdout || ""), /Synchronized migrations from 1 of 1 installed package/u);
    const files = await migrationFiles(appRoot);
    assert.equal(files.length, 1);
    assert.equal(
      await readFile(path.join(appRoot, "migrations", files[0]), "utf8"),
      "module.exports = { up() {}, down() {} };\n"
    );
    await assert.rejects(access(path.join(appRoot, "src", "generated", "demo.txt")), /ENOENT/u);

    const checkAfter = runCli({ cwd: appRoot, args: ["migrations", "sync", "--check"] });
    assert.equal(checkAfter.status, 0, String(checkAfter.stderr || ""));
    assert.match(String(checkAfter.stdout || ""), /Migration files: current/u);
  });
});

test("migrations sync refuses to rewrite an immutable migration id", async () => {
  await withTempDir(async (appRoot) => {
    await createAppWithMigrationPackage(appRoot);
    const firstSync = runCli({ cwd: appRoot, args: ["migrations", "sync"] });
    assert.equal(firstSync.status, 0, String(firstSync.stderr || ""));
    await writeFile(
      path.join(appRoot, "packages", "migrations-only", "templates", "demo.cjs"),
      "module.exports = { changed: true };\n",
      "utf8"
    );

    const secondSync = runCli({ cwd: appRoot, args: ["migrations", "sync"] });
    assert.equal(secondSync.status, 1);
    assert.match(String(secondSync.stderr || ""), /demo-migration.*changed|changed.*demo-migration/iu);
  });
});

test("migrations sync ignores generator migration templates", async () => {
  await withTempDir(async (appRoot) => {
    await createAppWithMigrationPackage(appRoot);
    await addGeneratorMigrationPackage(appRoot);

    const result = runCli({ cwd: appRoot, args: ["migrations", "sync"] });
    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /Synchronized migrations from 1 of 2 installed package/u);
    assert.equal((await migrationFiles(appRoot)).length, 1);
    await assert.rejects(
      access(path.join(appRoot, "migrations", "generated-migration.cjs")),
      /ENOENT/u
    );
    const allMigrations = await readdir(path.join(appRoot, "migrations"));
    assert.equal(allMigrations.some((entry) => entry.includes("generated-migration")), false);
  });
});

test("add package synchronizes migrations from the installed npm graph", async () => {
  await withTempDir(async (appRoot) => {
    await createAppWithTransitiveMigrationPackage(appRoot);

    const result = runCli({ cwd: appRoot, args: ["add", "package", "@demo/feature"] });
    assert.equal(result.status, 0, String(result.stderr || ""));

    const files = (await readdir(path.join(appRoot, "migrations")))
      .filter((entry) => entry.endsWith("_transitive-migration.cjs"));
    assert.equal(files.length, 1);
    assert.equal(
      await readFile(path.join(appRoot, "migrations", files[0]), "utf8"),
      "module.exports = { transitive: true };\n"
    );
  });
});
