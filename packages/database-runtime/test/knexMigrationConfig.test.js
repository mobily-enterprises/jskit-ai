import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import knexFactory from "knex";
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

test("createKnexMigrationConfig fixes MySQL without requiring DB_CLIENT", (context) => {
  const appRoot = mkdtempSync(path.join(os.tmpdir(), "jskit-app-mysql-"));
  context.after(() => rmSync(appRoot, { recursive: true, force: true }));
  mkdirSync(path.join(appRoot, "migrations"));
  const config = createKnexMigrationConfig({
    client: "mysql2",
    environment: connectionEnvironment,
    appRoot
  });

  assert.equal(config.client, "mysql2");
  assert.equal(config.connection.port, 3306);
  assert.equal(config.pool, undefined);
  assert.deepEqual(config.migrations.directory, [path.join(appRoot, "migrations")]);
});

test("an application without migrations/constraints/ migrates, and its constraints run once the directory exists", async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-app-constraints-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  await mkdir(path.join(appRoot, "migrations"), { recursive: true });
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ dependencies: {} }));
  await writeFile(path.join(appRoot, "migrations", "20260101000000_books.cjs"),
    "exports.up = (knex) => knex.schema.createTable(\"books\", (table) => table.increments(\"id\"));\nexports.down = () => {};\n");

  const migrate = async () => {
    const { migrations } = await createKnexMigrationConfigFromApp({ client: "pg", environment: connectionEnvironment, appRoot });
    const knex = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true, migrations });
    try {
      await knex.migrate.latest();
      return { directories: migrations.directory, ran: await knex("knex_migrations").orderBy("id").pluck("name") };
    } finally {
      await knex.destroy();
    }
  };

  assert.deepEqual(await migrate(), {
    directories: [path.join(appRoot, "migrations")],
    ran: ["20260101000000_books.cjs"]
  });

  await mkdir(path.join(appRoot, "migrations", "constraints"));
  await writeFile(path.join(appRoot, "migrations", "constraints", "20260101000001_books_index.cjs"),
    "exports.up = (knex) => knex.schema.alterTable(\"books\", (table) => table.index([\"id\"]));\nexports.down = () => {};\n");
  assert.deepEqual(await migrate(), {
    directories: [path.join(appRoot, "migrations"), path.join(appRoot, "migrations", "constraints")],
    ran: ["20260101000000_books.cjs", "20260101000001_books_index.cjs"]
  });
});

test("an application without migrations/ migrates the tables its packages hold", async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-app-no-migrations-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  const packageRoot = path.join(appRoot, "node_modules", "@example", "ledger-core");
  await mkdir(path.join(packageRoot, "migrations"), { recursive: true });
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ dependencies: { "@example/ledger-core": "1.0.0" } }));
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
    name: "@example/ledger-core",
    version: "1.0.0",
    jskit: { kind: "runtime", migrations: { directories: ["migrations"] } }
  }));
  await writeFile(path.join(packageRoot, "migrations", "20260101000000_entries.cjs"),
    "exports.up = (knex) => knex.schema.createTable(\"entries\", (table) => table.increments(\"id\"));\nexports.down = () => {};\n");

  const { migrations } = await createKnexMigrationConfigFromApp({ client: "pg", environment: connectionEnvironment, appRoot });
  assert.deepEqual(migrations.directory, [path.join(packageRoot, "migrations")]);
  const knex = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true, migrations });
  try {
    await knex.migrate.latest();
    assert.deepEqual(await knex("knex_migrations").orderBy("id").pluck("name"), ["20260101000000_entries.cjs"]);
  } finally {
    await knex.destroy();
  }
});

test("createKnexMigrationConfig fixes PostgreSQL without requiring DB_CLIENT", () => {
  const config = createKnexMigrationConfig({
    client: "pg",
    environment: connectionEnvironment,
    appRoot: "/srv/catalogue"
  });

  assert.equal(config.client, "pg");
  assert.equal(config.connection.port, 5432);
  // Migrations write in a UTC session too.
  assert.equal(typeof config.pool.afterCreate, "function");
});

test("createKnexMigrationConfig requires the application's environment instead of reading DB_* from nothing", () => {
  assert.throws(
    () => createKnexMigrationConfig({ client: "mysql2", appRoot: "/srv/catalogue" }),
    /requires the application's environment/u
  );
});

test("installed package migrations run from their owning packages without copied projections", async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-package-migrations-"));
  context.after(async () => {
    await import("node:fs/promises").then(({ rm }) => rm(appRoot, { recursive: true, force: true }));
  });

  const packageRoot = path.join(appRoot, "node_modules", "@example", "accounts-core");
  await mkdir(path.join(appRoot, "migrations"), { recursive: true });
  await mkdir(path.join(packageRoot, "migrations", "constraints"), { recursive: true });
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
    path.join(packageRoot, "migrations"),
    path.join(appRoot, "migrations"),
    path.join(packageRoot, "migrations", "constraints")
  ]);
});

test("a fresh database runs package migrations before the application's, then its constraints", async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-migration-order-"));
  const packageRoot = path.join(appRoot, "node_modules", "@example", "accounts-core");
  await mkdir(path.join(packageRoot, "migrations"), { recursive: true });
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({
    dependencies: { "@example/accounts-core": "1.0.0" }
  }));
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
    name: "@example/accounts-core",
    version: "1.0.0",
    jskit: { kind: "runtime", migrations: { directories: ["migrations"] } }
  }));
  await writeFile(path.join(packageRoot, "migrations", "accounts_initial.cjs"),
    "exports.up = (knex) => knex.schema.createTable(\"users\", (table) => table.increments(\"id\"));\nexports.down = () => {};\n");
  await writeFile(path.join(appRoot, "migrations", "20260101000000_books.cjs"), [
    "exports.up = async (knex) => {",
    "  await knex(\"users\").insert({ id: 1 });",
    "  await knex.schema.createTable(\"books\", (table) => table.integer(\"user_id\").references(\"id\").inTable(\"users\"));",
    "};",
    "exports.down = () => {};",
    ""
  ].join("\n"));
  await writeFile(path.join(appRoot, "migrations", "constraints", "20200101000000_books_index.cjs"),
    "exports.up = (knex) => knex.schema.alterTable(\"books\", (table) => table.index([\"user_id\"]));\nexports.down = () => {};\n");

  const { migrations } = await createKnexMigrationConfigFromApp({
    client: "pg",
    environment: connectionEnvironment,
    appRoot
  });
  const knex = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true, migrations });
  context.after(async () => {
    await knex.destroy();
    await rm(appRoot, { recursive: true, force: true });
  });

  await knex.migrate.latest();
  assert.deepEqual(await knex("knex_migrations").orderBy("id").pluck("name"), [
    "accounts_initial.cjs",
    "20260101000000_books.cjs",
    "20200101000000_books_index.cjs"
  ]);
});

test("a package constraints migration references the application's users table on a fresh database", async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-package-constraints-"));
  const packageRoot = path.join(appRoot, "node_modules", "@example", "notes-core");
  await mkdir(path.join(packageRoot, "migrations", "constraints"), { recursive: true });
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({
    dependencies: { "@example/notes-core": "1.0.0" }
  }));
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
    name: "@example/notes-core",
    version: "1.0.0",
    jskit: { kind: "runtime", migrations: { directories: ["migrations"] } }
  }));
  await writeFile(path.join(packageRoot, "migrations", "notes_initial.cjs"), [
    "exports.up = (knex) => knex.schema.createTable(\"notes\", (table) => {",
    "  table.increments(\"id\");",
    "  table.integer(\"user_id\").notNullable();",
    "});",
    "exports.down = () => {};",
    ""
  ].join("\n"));
  await writeFile(path.join(appRoot, "migrations", "20260101000000_users.cjs"), [
    "exports.up = async (knex) => {",
    "  await knex.schema.createTable(\"users\", (table) => table.increments(\"id\"));",
    "  await knex(\"users\").insert({ id: 1 });",
    "};",
    "exports.down = () => {};",
    ""
  ].join("\n"));
  await writeFile(path.join(packageRoot, "migrations", "constraints", "notes_users_foreign_key.cjs"), [
    "exports.up = async (knex) => {",
    "  await knex.schema.alterTable(\"notes\", (table) => table.foreign(\"user_id\").references(\"id\").inTable(\"users\"));",
    "  await knex(\"notes\").insert({ user_id: (await knex(\"users\").first(\"id\")).id });",
    "};",
    "exports.down = () => {};",
    ""
  ].join("\n"));
  await writeFile(path.join(appRoot, "migrations", "constraints", "20200101000000_notes_index.cjs"),
    "exports.up = (knex) => knex.schema.alterTable(\"notes\", (table) => table.index([\"user_id\"]));\nexports.down = () => {};\n");

  const { migrations } = await createKnexMigrationConfigFromApp({
    client: "pg",
    environment: connectionEnvironment,
    appRoot
  });
  const knex = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true, migrations });
  context.after(async () => {
    await knex.destroy();
    await rm(appRoot, { recursive: true, force: true });
  });

  await knex.migrate.latest();
  assert.deepEqual(await knex("knex_migrations").orderBy("id").pluck("name"), [
    "notes_initial.cjs",
    "20260101000000_users.cjs",
    "notes_users_foreign_key.cjs",
    "20200101000000_notes_index.cjs"
  ]);
  const foreignKeys = await knex.raw("PRAGMA foreign_key_list(notes)");
  assert.deepEqual(foreignKeys.map(({ table, from, to }) => ({ table, from, to })), [
    { table: "users", from: "user_id", to: "id" }
  ]);
});

// An app whose node_modules hold the given JSKIT packages, each with its migration directories.
async function createAppWithPackages(context, packages) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-migrations-after-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({
    dependencies: Object.fromEntries(packages.map(({ name }) => [name, "1.0.0"]))
  }));
  const directoryOf = {};
  for (const { name, migrations, files = {} } of packages) {
    const packageRoot = path.join(appRoot, "node_modules", ...name.split("/"));
    await mkdir(packageRoot, { recursive: true });
    await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
      name,
      version: "1.0.0",
      jskit: { kind: "runtime", ...(migrations ? { migrations } : {}) }
    }));
    for (const directory of migrations?.directories || []) {
      await mkdir(path.join(packageRoot, directory), { recursive: true });
      directoryOf[`${name}:${directory}`] = path.join(packageRoot, directory);
    }
    for (const [file, source] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(packageRoot, file)), { recursive: true });
      await writeFile(path.join(packageRoot, file), source);
    }
  }
  return { appRoot, directoryOf };
}

test("without jskit.migrations.after, package migration directories keep their path order", async (context) => {
  const { appRoot, directoryOf } = await createAppWithPackages(context, [
    { name: "@example/units-core", migrations: { directories: ["migrations"] } },
    { name: "@example/assets-core", migrations: { directories: ["migrations", "reference"] } },
    { name: "@example/plain-core" }
  ]);
  assert.deepEqual(await discoverPackageMigrationDirectories({ appRoot }), [
    directoryOf["@example/assets-core:migrations"],
    directoryOf["@example/assets-core:reference"],
    directoryOf["@example/units-core:migrations"]
  ]);
});

test("a package's migrations and constraints run after those of the packages its jskit.migrations.after names", async (context) => {
  const { appRoot, directoryOf } = await createAppWithPackages(context, [
    {
      name: "@example/assets-core",
      migrations: { directories: ["migrations", "reference"], after: ["@example/units-core", "@example/plain-core"] },
      files: { "migrations/constraints/assets_units.cjs": "exports.up = async () => {};\n" }
    },
    { name: "@example/notes-core", migrations: { directories: ["migrations"] } },
    {
      name: "@example/units-core",
      migrations: { directories: ["migrations"] },
      files: { "migrations/constraints/units_users.cjs": "exports.up = async () => {};\n" }
    },
    { name: "@example/plain-core" }
  ]);
  const packageDirectories = [
    directoryOf["@example/units-core:migrations"],
    directoryOf["@example/assets-core:migrations"],
    directoryOf["@example/assets-core:reference"],
    directoryOf["@example/notes-core:migrations"]
  ];
  assert.deepEqual(await discoverPackageMigrationDirectories({ appRoot }), packageDirectories);
  // The application's own migrations run after every package's and before any constraints.
  await mkdir(path.join(appRoot, "migrations"));
  const { migrations } = await createKnexMigrationConfigFromApp({ client: "mysql2", environment: connectionEnvironment, appRoot });
  assert.deepEqual(migrations.directory, [
    ...packageDirectories,
    path.join(appRoot, "migrations"),
    path.join(directoryOf["@example/units-core:migrations"], "constraints"),
    path.join(directoryOf["@example/assets-core:migrations"], "constraints")
  ]);
});

test("after is followed depth first, each prerequisite in the order it is listed", async (context) => {
  const { appRoot, directoryOf } = await createAppWithPackages(context, [
    { name: "@example/a-core", migrations: { directories: ["migrations"], after: ["@example/d-core", "@example/c-core"] } },
    { name: "@example/b-core", migrations: { directories: ["migrations"] } },
    { name: "@example/c-core", migrations: { directories: ["migrations"], after: ["@example/e-core"] } },
    { name: "@example/d-core", migrations: { directories: ["migrations"] } },
    { name: "@example/e-core", migrations: { directories: ["migrations"] } }
  ]);
  assert.deepEqual(await discoverPackageMigrationDirectories({ appRoot }), [
    "@example/d-core", "@example/e-core", "@example/c-core", "@example/a-core", "@example/b-core"
  ].map((name) => directoryOf[`${name}:migrations`]));
});

test("a fresh database runs a package's migrations after the package whose table they use", async (context) => {
  const { appRoot } = await createAppWithPackages(context, [
    {
      name: "@example/assets-core",
      migrations: { directories: ["migrations"], after: ["@example/units-core"] },
      files: {
        "migrations/assets_initial.cjs": [
          "exports.up = async (knex) => {",
          "  await knex.schema.createTable(\"assets\", (table) => table.integer(\"unit_id\").references(\"id\").inTable(\"units\"));",
          "  await knex(\"assets\").insert({ unit_id: (await knex(\"units\").first(\"id\")).id });",
          "};",
          "exports.down = () => {};",
          ""
        ].join("\n")
      }
    },
    {
      name: "@example/units-core",
      migrations: { directories: ["migrations"] },
      files: {
        "migrations/units_initial.cjs": [
          "exports.up = async (knex) => {",
          "  await knex.schema.createTable(\"units\", (table) => table.increments(\"id\"));",
          "  await knex(\"units\").insert({ id: 1 });",
          "};",
          "exports.down = () => {};",
          ""
        ].join("\n")
      }
    }
  ]);
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  const { migrations } = await createKnexMigrationConfigFromApp({ client: "pg", environment: connectionEnvironment, appRoot });
  const knex = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true, migrations });
  context.after(() => knex.destroy());

  await knex.migrate.latest();
  assert.deepEqual(await knex("knex_migrations").orderBy("id").pluck("name"), ["units_initial.cjs", "assets_initial.cjs"]);
  assert.deepEqual(await knex("assets").pluck("unit_id"), [1]);
});

test("packages whose migrations each name the other in after are rejected with the cycle", async (context) => {
  const { appRoot } = await createAppWithPackages(context, [
    { name: "@example/a-core", migrations: { directories: ["migrations"], after: ["@example/b-core"] } },
    { name: "@example/b-core", migrations: { directories: ["migrations"], after: ["@example/a-core"] } }
  ]);
  await assert.rejects(
    () => discoverPackageMigrationDirectories({ appRoot }),
    /Package migrations cannot each run after the other: @example\/a-core -> @example\/b-core -> @example\/a-core\./
  );
});

test("jskit.migrations.after names other installed JSKIT packages, beside the package's directories", async (context) => {
  const cases = [
    [{ directories: ["migrations"], after: ["@example/missing-core"] }, /names @example\/missing-core, which is not an installed JSKIT package/],
    [{ directories: ["migrations"], after: ["@example/a-core"] }, /after names the package itself/],
    [{ directories: ["migrations"], after: "@example/b-core" }, /after must be an array of package names/],
    [{ directories: ["migrations"], after: [" "] }, /after must be an array of package names/],
    [{ after: ["@example/b-core"] }, /after needs jskit\.migrations\.directories/]
  ];
  for (const [migrations, message] of cases) {
    const { appRoot } = await createAppWithPackages(context, [
      { name: "@example/a-core", migrations },
      { name: "@example/b-core", migrations: { directories: ["migrations"] } }
    ]);
    await assert.rejects(() => discoverPackageMigrationDirectories({ appRoot }), message);
  }
});
