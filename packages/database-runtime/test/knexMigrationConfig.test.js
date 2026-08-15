import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createKnexMigrationConfig,
  createKnexMigrationConfigFromApp,
  discoverPackageMigrationDirectories
} from "../src/server/knexMigrationConfig.js";

const connectionEnvironment = Object.freeze({
  DB_HOST: "127.0.0.1",
  DB_NAME: "catalogue",
  DB_USER: "catalogue_user",
  DB_PASSWORD: "secret"
});

test("createKnexMigrationConfig fixes MySQL without requiring DB_CLIENT", () => {
  const config = createKnexMigrationConfig({
    client: "mysql2",
    environment: connectionEnvironment,
    appRoot: "/srv/catalogue"
  });

  assert.equal(config.client, "mysql2");
  assert.equal(config.connection.port, 3306);
  assert.deepEqual(config.migrations.directory, [
    "/srv/catalogue/migrations",
    "/srv/catalogue/migrations/constraints"
  ]);
});

test("createKnexMigrationConfig fixes PostgreSQL without requiring DB_CLIENT", () => {
  const config = createKnexMigrationConfig({
    client: "pg",
    environment: connectionEnvironment,
    appRoot: "/srv/catalogue"
  });

  assert.equal(config.client, "pg");
  assert.equal(config.connection.port, 5432);
});

test("installed package migrations run from their owning packages without copied projections", async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-package-migrations-"));
  context.after(async () => {
    await import("node:fs/promises").then(({ rm }) => rm(appRoot, { recursive: true, force: true }));
  });

  const packageRoot = path.join(appRoot, "node_modules", "@example", "accounts-core");
  await mkdir(path.join(packageRoot, "migrations"), { recursive: true });
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({
    dependencies: { "@example/accounts-core": "1.0.0" }
  }));
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
    name: "@example/accounts-core",
    version: "1.0.0",
    jskit: {
      kind: "runtime",
      runtime: { server: { providers: [] }, client: { providers: [] } },
      migrations: { directories: ["migrations"] }
    }
  }));
  await writeFile(path.join(packageRoot, "migrations", "accounts_initial.cjs"), "exports.up = async () => {};\n");

  const directories = await discoverPackageMigrationDirectories({ appRoot });
  assert.deepEqual(directories, [path.join(packageRoot, "migrations")]);

  const config = await createKnexMigrationConfigFromApp({
    client: "mysql2",
    environment: connectionEnvironment,
    appRoot
  });
  assert.deepEqual(config.migrations.directory, [
    path.join(appRoot, "migrations"),
    path.join(packageRoot, "migrations"),
    path.join(appRoot, "migrations", "constraints")
  ]);
});
