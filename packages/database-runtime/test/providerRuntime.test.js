import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { DatabaseRuntimeServiceProvider } from "../src/server/providers/DatabaseRuntimeServiceProvider.js";

function createSingletonApp() {
  const singletons = new Map();
  const instances = new Map();

  return {
    has(token) {
      return singletons.has(token) || instances.has(token);
    },
    singleton(token, factory) {
      if (this.has(token)) {
        throw new Error(`Token ${String(token)} is already registered.`);
      }
      singletons.set(token, {
        factory,
        resolved: false,
        value: undefined
      });
    },
    instance(token, value) {
      if (this.has(token)) {
        throw new Error(`Token ${String(token)} is already registered.`);
      }
      instances.set(token, value);
    },
    make(token) {
      if (instances.has(token)) {
        return instances.get(token);
      }
      if (!singletons.has(token)) {
        throw new Error(`Token ${String(token)} is not registered.`);
      }
      const entry = singletons.get(token);
      if (!entry.resolved) {
        entry.value = entry.factory(this);
        entry.resolved = true;
        instances.set(token, entry.value);
      }
      return entry.value;
    }
  };
}

function createKnexStub() {
  return {
    async transaction(callback) {
      return callback({ trxId: "trx-1" });
    }
  };
}

test("DatabaseRuntimeServiceProvider registers runtime api", () => {
  const app = createSingletonApp();
  const provider = new DatabaseRuntimeServiceProvider();
  provider.register(app);

  assert.equal(app.has("runtime.database"), true);
  const api = app.make("runtime.database");
  assert.equal(typeof api.createTransactionManager, "function");
  assert.equal(typeof api.resolveRepoClient, "function");
});

test("DatabaseRuntimeServiceProvider registers transaction manager when Knex is pre-bound", async () => {
  const app = createSingletonApp();
  app.instance(KERNEL_TOKENS.Knex, createKnexStub());

  const provider = new DatabaseRuntimeServiceProvider();
  provider.register(app);

  assert.equal(app.has(KERNEL_TOKENS.TransactionManager), true);
  const transactionManager = app.make(KERNEL_TOKENS.TransactionManager);
  const result = await transactionManager.inTransaction(async (trx) => trx.trxId);
  assert.equal(result, "trx-1");
});

test("DatabaseRuntimeServiceProvider driver token resolves to registered mysql driver", () => {
  const app = createSingletonApp();
  app.instance("runtime.database.driver.mysql", Object.freeze({ DIALECT_ID: "mysql2" }));

  const provider = new DatabaseRuntimeServiceProvider();
  provider.register(app);

  const driver = app.make("runtime.database.driver");
  assert.deepEqual(driver, { DIALECT_ID: "mysql2" });
});

test("DatabaseRuntimeServiceProvider driver token throws when no driver registered", () => {
  const app = createSingletonApp();
  const provider = new DatabaseRuntimeServiceProvider();
  provider.register(app);

  assert.throws(() => app.make("runtime.database.driver"), /No database driver is registered\./);
});

test("DatabaseRuntimeServiceProvider driver token throws when multiple drivers are registered", () => {
  const app = createSingletonApp();
  app.instance("runtime.database.driver.mysql", Object.freeze({ DIALECT_ID: "mysql2" }));
  app.instance("runtime.database.driver.postgres", Object.freeze({ DIALECT_ID: "pg" }));

  const provider = new DatabaseRuntimeServiceProvider();
  provider.register(app);

  assert.throws(() => app.make("runtime.database.driver"), /Multiple database drivers are registered\./);
});

test("DatabaseRuntimeServiceProvider resolves knex from app root package context", async () => {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-db-runtime-test-"));
  const knexPackageDir = path.join(appRoot, "node_modules", "knex");
  await mkdir(knexPackageDir, { recursive: true });
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "runtime-app", private: true }), "utf8");
  await writeFile(
    path.join(knexPackageDir, "package.json"),
    JSON.stringify({
      name: "knex",
      version: "0.0.0-test",
      main: "index.js",
      type: "commonjs"
    }),
    "utf8"
  );
  await writeFile(
    path.join(knexPackageDir, "index.js"),
    [
      "module.exports = function knex(config) {",
      "  return {",
      "    __source: 'app-root-knex',",
      "    __config: config,",
      "    transaction: async function transaction(callback) {",
      "      return callback({ trxId: 'trx-app-root' });",
      "    }",
      "  };",
      "};",
      ""
    ].join("\n"),
    "utf8"
  );

  const previousCwd = process.cwd();
  try {
    process.chdir(appRoot);

    const app = createSingletonApp();
    app.instance("runtime.database.driver.mysql", Object.freeze({ DIALECT_ID: "mysql2" }));
    app.instance(KERNEL_TOKENS.Env, {
      DB_HOST: "db.local",
      DB_PORT: "3307",
      DB_NAME: "appdb",
      DB_USER: "appuser",
      DB_PASSWORD: "apppass"
    });

    const provider = new DatabaseRuntimeServiceProvider();
    provider.register(app);

    const knex = app.make(KERNEL_TOKENS.Knex);
    assert.equal(knex.__source, "app-root-knex");
    assert.equal(knex.__config.client, "mysql2");
    assert.equal(knex.__config.connection.host, "db.local");
    assert.equal(knex.__config.connection.port, 3307);
    assert.equal(knex.__config.connection.database, "appdb");
    assert.equal(knex.__config.connection.user, "appuser");
    assert.equal(knex.__config.connection.password, "apppass");
  } finally {
    process.chdir(previousCwd);
  }
});
