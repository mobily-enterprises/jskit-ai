import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));

function runCli({ cwd, args = [] }) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8"
  });
}

function runNpmScript({ cwd, scriptName }) {
  return spawnSync("npm", ["run", scriptName], {
    cwd,
    encoding: "utf8"
  });
}

async function writeJsonFile(absolutePath, value) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonFile(absolutePath) {
  const source = await readFile(absolutePath, "utf8");
  return JSON.parse(source);
}

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-cli-"));

  try {
    await writeJsonFile(path.join(appRoot, "package.json"), {
      name: "temp-app",
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        start: "jskit-app-scripts start",
        server: "jskit-app-scripts server"
      },
      dependencies: {
        "@jskit-ai/app-scripts": "0.1.0",
        fastify: "^5.7.4",
        vue: "^3.5.13"
      },
      devDependencies: {
        "@jskit-ai/config-eslint": "0.1.0",
        eslint: "^9.39.1",
        vite: "^6.1.0",
        vitest: "^4.0.18"
      }
    });

    await writeFile(path.join(appRoot, "Procfile"), "web: npm run start\n", "utf8");

    await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

test("jskit list shows built-in db pack", async () => {
  await withTempApp(async (appRoot) => {
    const result = runCli({
      cwd: appRoot,
      args: ["list"]
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /db \(0\.2\.0\)/);
  });
});

test("jskit add db requires explicit provider", async () => {
  await withTempApp(async (appRoot) => {
    const result = runCli({
      cwd: appRoot,
      args: ["add", "db", "--no-install"]
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires option provider/i);
  });
});

test("jskit add db with provider mysql applies package-owned mutations", async () => {
  await withTempApp(async (appRoot) => {
    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "db", "--provider", "mysql", "--no-install"]
    });

    assert.equal(addResult.status, 0, addResult.stderr);
    assert.match(addResult.stdout, /Added pack db/);
    assert.match(addResult.stdout, /Resolved packages \(1\)/);
    assert.match(addResult.stdout, /db-mysql/);

    const packageJson = await readJsonFile(path.join(appRoot, "package.json"));
    assert.equal(
      packageJson.dependencies.knex,
      "https://codeload.github.com/knex/knex/tar.gz/c18fb1ba2dc3001ee0fb2a79c126a32e6cd831a5"
    );
    assert.equal(packageJson.dependencies.mysql2, "^3.15.3");
    assert.equal(packageJson.scripts["db:migrate"], "jskit-app-scripts db:migrate");

    const procfile = await readFile(path.join(appRoot, "Procfile"), "utf8");
    assert.match(procfile, /^release: npm run db:migrate$/m);
    assert.match(procfile, /^web: npm run start$/m);

    const knexfile = await readFile(path.join(appRoot, "knexfile.cjs"), "utf8");
    assert.match(knexfile, /module\.exports/);

    const lock = await readJsonFile(path.join(appRoot, ".jskit/lock.json"));
    assert.equal(lock.lockVersion, 2);
    assert.equal(lock.installedPacks.db.options.provider, "mysql");
    assert.deepEqual(lock.installedPacks.db.packageIds, ["@jskit-ai/db-mysql"]);
    assert.ok(lock.installedPackages["@jskit-ai/db-mysql"]);

    const doctor = runCli({ cwd: appRoot, args: ["doctor"] });
    assert.equal(doctor.status, 0, doctor.stderr);

    const duplicateAdd = runCli({ cwd: appRoot, args: ["add", "db", "--provider", "mysql", "--no-install"] });
    assert.notEqual(duplicateAdd.status, 0);

    const update = runCli({ cwd: appRoot, args: ["update", "db", "--no-install"] });
    assert.equal(update.status, 0, update.stderr);
  });
});

test("jskit remove db reverts managed app mutations", async () => {
  await withTempApp(async (appRoot) => {
    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "db", "--provider", "mysql", "--no-install"]
    });
    assert.equal(addResult.status, 0, addResult.stderr);

    const removeResult = runCli({
      cwd: appRoot,
      args: ["remove", "db"]
    });

    assert.equal(removeResult.status, 0, removeResult.stderr);
    assert.match(removeResult.stdout, /Removed pack db/);

    const packageJson = await readJsonFile(path.join(appRoot, "package.json"));
    assert.equal(packageJson.dependencies.knex, undefined);
    assert.equal(packageJson.dependencies.mysql2, undefined);
    assert.equal(packageJson.scripts["db:migrate"], undefined);

    const procfile = await readFile(path.join(appRoot, "Procfile"), "utf8");
    assert.doesNotMatch(procfile, /^release:/m);
    assert.match(procfile, /^web: npm run start$/m);

    await assert.rejects(access(path.join(appRoot, "knexfile.cjs")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, ".jskit/lock.json")), /ENOENT/);
  });
});

test("jskit update preserves managed file ownership for later remove", async () => {
  await withTempApp(async (appRoot) => {
    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "db", "--provider", "mysql", "--no-install"]
    });
    assert.equal(addResult.status, 0, addResult.stderr);

    const updateResult = runCli({
      cwd: appRoot,
      args: ["update", "db", "--no-install"]
    });
    assert.equal(updateResult.status, 0, updateResult.stderr);

    const removeResult = runCli({
      cwd: appRoot,
      args: ["remove", "db"]
    });
    assert.equal(removeResult.status, 0, removeResult.stderr);

    await assert.rejects(access(path.join(appRoot, "knexfile.cjs")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "migrations")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "seeds")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, ".jskit/lock.json")), /ENOENT/);
  });
});

test("jskit update db provider reconciles package set", async () => {
  await withTempApp(async (appRoot) => {
    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "db", "--provider", "mysql", "--no-install"]
    });
    assert.equal(addResult.status, 0, addResult.stderr);

    const updateResult = runCli({
      cwd: appRoot,
      args: ["update", "db", "--provider", "postgres", "--no-install"]
    });
    assert.equal(updateResult.status, 0, updateResult.stderr);
    assert.match(updateResult.stdout, /Removed packages \(1\)/);
    assert.match(updateResult.stdout, /@jskit-ai\/db-mysql/);
    assert.match(updateResult.stdout, /@jskit-ai\/db-postgres/);

    const packageJson = await readJsonFile(path.join(appRoot, "package.json"));
    assert.equal(packageJson.dependencies.mysql2, undefined);
    assert.equal(packageJson.dependencies.pg, "^8.16.3");

    const knexfile = await readFile(path.join(appRoot, "knexfile.cjs"), "utf8");
    assert.match(knexfile, /const KNEX_CLIENT = "pg"/);

    const lock = await readJsonFile(path.join(appRoot, ".jskit/lock.json"));
    assert.deepEqual(lock.installedPacks.db.packageIds, ["@jskit-ai/db-postgres"]);
    assert.equal(lock.installedPacks.db.options.provider, "postgres");
    assert.equal(lock.installedPackages["@jskit-ai/db-mysql"], undefined);
    assert.ok(lock.installedPackages["@jskit-ai/db-postgres"]);
  });
});

test("jskit security-audit pack requires db provider capability", async () => {
  await withTempApp(async (appRoot) => {
    const missingProvider = runCli({
      cwd: appRoot,
      args: ["add", "security-audit", "--no-install"]
    });
    assert.notEqual(missingProvider.status, 0);
    assert.match(missingProvider.stderr, /\[capability-violation\]/);
    assert.match(missingProvider.stderr, /db-provider/i);

    const addDb = runCli({
      cwd: appRoot,
      args: ["add", "db", "--provider", "mysql", "--no-install"]
    });
    assert.equal(addDb.status, 0, addDb.stderr);

    const addSecurityAudit = runCli({
      cwd: appRoot,
      args: ["add", "security-audit", "--no-install"]
    });
    assert.equal(addSecurityAudit.status, 0, addSecurityAudit.stderr);

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor"]
    });
    assert.equal(doctorResult.status, 0, doctorResult.stderr);
  });
});

test("jskit update reports migration file drift for db packages", async () => {
  await withTempApp(async (appRoot) => {
    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "db", "--provider", "mysql", "--no-install"]
    });
    assert.equal(addResult.status, 0, addResult.stderr);

    await writeFile(
      path.join(appRoot, "migrations", "20260101000000_create_placeholder_table.cjs"),
      "// drifted file\n",
      "utf8"
    );

    const updateResult = runCli({
      cwd: appRoot,
      args: ["update", "db", "--no-install"]
    });
    assert.notEqual(updateResult.status, 0);
    assert.match(updateResult.stderr, /\[managed-file-drift\]/);
  });
});

test("db:migrate smoke runs for mysql and postgres provider descriptors", async () => {
  await withTempApp(async (appRoot) => {
    for (const provider of ["mysql", "postgres"]) {
      const addResult = runCli({
        cwd: appRoot,
        args: ["add", "db", "--provider", provider, "--no-install"]
      });
      assert.equal(addResult.status, 0, addResult.stderr);

      const binPath = path.join(appRoot, "node_modules", ".bin", "jskit-app-scripts");
      await mkdir(path.dirname(binPath), { recursive: true });
      await writeFile(
        binPath,
        "#!/usr/bin/env node\nprocess.stdout.write('mocked app-scripts\\n');\n",
        "utf8"
      );
      await chmod(binPath, 0o755);

      const migrateResult = runNpmScript({
        cwd: appRoot,
        scriptName: "db:migrate"
      });
      assert.equal(migrateResult.status, 0, migrateResult.stderr);

      const removeDb = runCli({
        cwd: appRoot,
        args: ["remove", "db"]
      });
      assert.equal(removeDb.status, 0, removeDb.stderr);
    }
  });
});

test("jskit doctor reports capability violations", async () => {
  await withTempApp(async (appRoot) => {
    const localPackageDir = path.join(appRoot, "packages", "requires-db");
    await mkdir(localPackageDir, { recursive: true });
    await writeFile(
      path.join(localPackageDir, "package.descriptor.mjs"),
      `export default Object.freeze({
  packageVersion: 1,
  packageId: "@test/requires-db",
  version: "0.0.1",
  description: "local test package",
  dependsOn: [],
  capabilities: {
    provides: [],
    requires: ["db-provider"]
  },
  mutations: {
    dependencies: { runtime: {}, dev: {} },
    packageJson: { scripts: {} },
    procfile: {},
    files: []
  }
});
`,
      "utf8"
    );

    await writeJsonFile(path.join(appRoot, ".jskit/lock.json"), {
      lockVersion: 2,
      installedPacks: {},
      installedPackages: {
        "@test/requires-db": {
          packageId: "@test/requires-db",
          version: "0.0.1",
          source: { type: "local", descriptorPath: "packages/requires-db/package.descriptor.mjs" },
          managed: { packageJson: {}, procfile: {}, files: [] },
          installedAt: "2026-01-01T00:00:00.000Z"
        }
      }
    });

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor"]
    });
    assert.notEqual(doctorResult.status, 0);
    assert.match(doctorResult.stdout + doctorResult.stderr, /requires capability db-provider/i);
  });
});

test("jskit update rollback restores state on failure", async () => {
  await withTempApp(async (appRoot) => {
    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "db", "--provider", "mysql", "--no-install"]
    });
    assert.equal(addResult.status, 0, addResult.stderr);

    await writeFile(path.join(appRoot, "knexfile.cjs"), "module.exports = { broken: true };\n", "utf8");

    const updateResult = runCli({
      cwd: appRoot,
      args: ["update", "db", "--provider", "postgres", "--no-install"]
    });
    assert.notEqual(updateResult.status, 0);

    const packageJson = await readJsonFile(path.join(appRoot, "package.json"));
    assert.equal(packageJson.dependencies.mysql2, "^3.15.3");
    assert.equal(packageJson.dependencies.pg, undefined);

    const lock = await readJsonFile(path.join(appRoot, ".jskit/lock.json"));
    assert.equal(lock.installedPacks.db.options.provider, "mysql");
    assert.deepEqual(lock.installedPacks.db.packageIds, ["@jskit-ai/db-mysql"]);
    assert.ok(lock.installedPackages["@jskit-ai/db-mysql"]);
    assert.equal(lock.installedPackages["@jskit-ai/db-postgres"], undefined);
  });
});
