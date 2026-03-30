import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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

async function writeDemoPackageDescriptor(packageRoot, version) {
  await writeFile(
    path.join(packageRoot, "package.descriptor.mjs"),
    `export default Object.freeze({
  packageId: "@demo/migrations-only",
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
        from: "templates/generated.txt",
        to: "src/generated/demo.txt"
      },
      {
        op: "install-migration",
        from: "templates/migration_v1.cjs",
        toDir: "migrations",
        extension: ".cjs",
        id: "demo-migration-v1"
      },
      {
        op: "install-migration",
        from: "templates/migration_v2.cjs",
        toDir: "migrations",
        extension: ".cjs",
        id: "demo-migration-v2",
        when: {
          option: "migrationVersion",
          in: ["v2"]
        }
      }
    ]
  },
  options: {
    migrationVersion: {
      required: false,
      defaultValue: "v1"
    }
  }
});\n`,
    "utf8"
  );
}

test("migrations changed generates only migrations for changed installed packages", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "migrations-command-app");
    await createMinimalApp(appRoot, { name: "migrations-command-app" });

    const packageRoot = path.join(appRoot, "packages", "migrations-only");
    await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
    await mkdir(path.join(packageRoot, "templates"), { recursive: true });

    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@demo/migrations-only",
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
      "class Provider { static id = \"demo.migrations.only\"; register() {} boot() {} }\nexport { Provider };\n",
      "utf8"
    );

    await writeFile(path.join(packageRoot, "templates", "generated.txt"), "generated-v1\n", "utf8");
    await writeFile(path.join(packageRoot, "templates", "migration_v1.cjs"), "module.exports = \"v1\";\n", "utf8");
    await writeFile(path.join(packageRoot, "templates", "migration_v2.cjs"), "module.exports = \"v2\";\n", "utf8");
    await writeDemoPackageDescriptor(packageRoot, "0.1.0");

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/migrations-only"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const generatedPath = path.join(appRoot, "src", "generated", "demo.txt");
    assert.equal(await readFile(generatedPath, "utf8"), "generated-v1\n");

    await writeFile(path.join(packageRoot, "templates", "generated.txt"), "generated-v2\n", "utf8");
    await writeDemoPackageDescriptor(packageRoot, "0.2.0");
    const lockAfterAdd = JSON.parse(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"));
    lockAfterAdd.installedPackages["@demo/migrations-only"].options.migrationVersion = "v2";
    await writeFile(path.join(appRoot, ".jskit", "lock.json"), `${JSON.stringify(lockAfterAdd, null, 2)}\n`, "utf8");

    const migrationsChangedResult = runCli({
      cwd: appRoot,
      args: ["migrations", "changed"]
    });
    assert.equal(migrationsChangedResult.status, 0, String(migrationsChangedResult.stderr || ""));
    assert.doesNotMatch(String(migrationsChangedResult.stdout || ""), /skipped migration/i);

    assert.equal(await readFile(generatedPath, "utf8"), "generated-v1\n");

    const migrationFiles = (await readdir(path.join(appRoot, "migrations")))
      .filter((entry) => /^\d{14}_demo-migration-v[12]\.cjs$/.test(entry))
      .sort();
    assert.equal(migrationFiles.length, 2);
    assert.ok(migrationFiles.some((entry) => entry.endsWith("_demo-migration-v1.cjs")));
    assert.ok(migrationFiles.some((entry) => entry.endsWith("_demo-migration-v2.cjs")));

    const lockAfterMigrationSync = JSON.parse(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"));
    const lockEntry = lockAfterMigrationSync.installedPackages["@demo/migrations-only"];
    assert.equal(lockEntry.version, "0.1.0");
    assert.equal(lockEntry.migrationSyncVersion, "0.2.0");

    const secondRun = runCli({
      cwd: appRoot,
      args: ["migrations", "changed", "--json"]
    });
    assert.equal(secondRun.status, 0, String(secondRun.stderr || ""));
    const secondRunPayload = JSON.parse(String(secondRun.stdout || "{}"));
    assert.deepEqual(secondRunPayload.requestedPackages, []);
    assert.deepEqual(secondRunPayload.touchedFiles, []);

    const verboseRun = runCli({
      cwd: appRoot,
      args: ["migrations", "all", "--verbose"]
    });
    assert.equal(verboseRun.status, 0, String(verboseRun.stderr || ""));
    assert.match(String(verboseRun.stdout || ""), /skipped migration/i);
  });
});
