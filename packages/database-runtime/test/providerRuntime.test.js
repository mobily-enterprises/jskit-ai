import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { defineProvider, createCapabilityRuntime } from "@jskit-ai/kernel/shared/capabilities";
import { DatabaseProvider } from "../src/server/providers/DatabaseProvider.js";

function driverProvider(dialectId = "mysql2") {
  return defineProvider({
    id: `test.database.driver.${dialectId}`,
    provides: { driver: "runtime.database.driver" },
    setup() {
      return {
        driver: Object.freeze({
          DIALECT_ID: dialectId,
          getDialectId: () => dialectId
        })
      };
    }
  });
}

function databaseConsumer(onDatabase) {
  return defineProvider({
    id: "test.database.consumer",
    requires: { database: "runtime.database" },
    setup({ database }) {
      onDatabase(database);
      return {};
    }
  });
}

async function withAppRootKnexStub(callback) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-db-runtime-test-"));
  const knexPackageDir = path.join(appRoot, "node_modules", "knex");
  await mkdir(knexPackageDir, { recursive: true });
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "runtime-app", private: true }), "utf8");
  await writeFile(
    path.join(knexPackageDir, "package.json"),
    JSON.stringify({ name: "knex", version: "0.0.0-test", main: "index.js", type: "commonjs" }),
    "utf8"
  );
  await writeFile(
    path.join(knexPackageDir, "index.js"),
    [
      "module.exports = function knex(config) {",
      "  return {",
      "    __source: 'app-root-knex',",
      "    __config: config,",
      "    destroyCalls: 0,",
      "    transaction: async function transaction(callback) {",
      "      return callback({ trxId: 'trx-app-root' });",
      "    },",
      "    destroy: async function destroy() { this.destroyCalls += 1; }",
      "  };",
      "};",
      ""
    ].join("\n"),
    "utf8"
  );

  const previousCwd = process.cwd();
  try {
    process.chdir(appRoot);
    await callback();
  } finally {
    process.chdir(previousCwd);
  }
}

test("DatabaseProvider exposes one cohesive database capability", async () => {
  await withAppRootKnexStub(async () => {
    let database;
    const runtime = createCapabilityRuntime({
      inputs: {
        "runtime.env": {
          DB_HOST: "db.local",
          DB_PORT: "3307",
          DB_NAME: "appdb",
          DB_USER: "appuser",
          DB_PASSWORD: "apppass"
        }
      },
      providers: [
        driverProvider(),
        DatabaseProvider,
        databaseConsumer((value) => {
          database = value;
        })
      ]
    });

    await runtime.start();

    assert.equal(database.driver.DIALECT_ID, "mysql2");
    assert.equal(database.knex.__source, "app-root-knex");
    assert.equal(database.knex.__config.client, "mysql2");
    assert.deepEqual(database.knex.__config.connection, {
      host: "db.local",
      port: 3307,
      database: "appdb",
      user: "appuser",
      password: "apppass",
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: ["DATE"],
      timezone: "Z"
    });
    assert.equal(typeof database.transactionManager.inTransaction, "function");
    assert.equal(typeof database.resolveRepoClient, "function");

    await runtime.shutdown();
    assert.equal(database.knex.destroyCalls, 1);
    assert.deepEqual(await runtime.shutdown(), []);
    assert.equal(database.knex.destroyCalls, 1);
  });
});

test("DatabaseProvider accepts DATABASE_URL without redundant DB_CLIENT", async () => {
  await withAppRootKnexStub(async () => {
    let database;
    const runtime = createCapabilityRuntime({
      inputs: {
        "runtime.env": {
          DATABASE_URL: "mysql://urluser:urlpass@db.url.local:3308/url_db_name"
        }
      },
      providers: [driverProvider(), DatabaseProvider, databaseConsumer((value) => { database = value; })]
    });

    await runtime.start();
    assert.equal(database.knex.__config.connection.host, "db.url.local");
    assert.equal(database.knex.__config.connection.port, 3308);
    assert.equal(database.knex.__config.connection.database, "url_db_name");
    assert.equal(database.knex.__config.connection.user, "urluser");
    assert.equal(database.knex.__config.connection.password, "urlpass");
    await runtime.shutdown();
  });
});

test("DatabaseProvider rejects environment dialect mismatch", async () => {
  await withAppRootKnexStub(async () => {
    const runtime = createCapabilityRuntime({
      inputs: {
        "runtime.env": {
          DB_CLIENT: "pg",
          DB_NAME: "appdb",
          DB_USER: "appuser"
        }
      },
      providers: [driverProvider(), DatabaseProvider]
    });

    await assert.rejects(
      runtime.start(),
      /DB_CLIENT="pg" does not match installed database driver "mysql2"\./
    );
  });
});
