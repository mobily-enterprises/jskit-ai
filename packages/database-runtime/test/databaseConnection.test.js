import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDatabaseUrl,
  resolveDatabaseClientFromEnvironment,
  resolveDatabaseConnectionFromEnvironment,
  resolveKnexConnectionFromEnvironment
} from "../src/shared/databaseConnection.js";

test("parseDatabaseUrl parses mysql url fields", () => {
  const parsed = parseDatabaseUrl("mysql://appuser:apppass@db.local:3307/appdb");
  assert.equal(parsed.protocol, "mysql:");
  assert.equal(parsed.host, "db.local");
  assert.equal(parsed.port, 3307);
  assert.equal(parsed.database, "appdb");
  assert.equal(parsed.user, "appuser");
  assert.equal(parsed.password, "apppass");
});

test("resolveDatabaseClientFromEnvironment infers client from DATABASE_URL when DB_CLIENT is absent", () => {
  const client = resolveDatabaseClientFromEnvironment({
    DATABASE_URL: "postgres://user:pass@db.local:5432/appdb"
  });
  assert.equal(client, "pg");
});

test("resolveDatabaseConnectionFromEnvironment falls back to DATABASE_URL values", () => {
  const connection = resolveDatabaseConnectionFromEnvironment({
    DATABASE_URL: "mysql://urluser:urlpass@db.url.local:3308/url_db_name"
  }, {
    defaultPort: 3306,
    context: "database runtime"
  });

  assert.equal(connection.host, "db.url.local");
  assert.equal(connection.port, 3308);
  assert.equal(connection.database, "url_db_name");
  assert.equal(connection.user, "urluser");
  assert.equal(connection.password, "urlpass");
});

test("resolveDatabaseConnectionFromEnvironment keeps explicit DB_* values over DATABASE_URL", () => {
  const connection = resolveDatabaseConnectionFromEnvironment({
    DATABASE_URL: "mysql://urluser:urlpass@db.url.local:3308/url_db_name",
    DB_HOST: "db.explicit.local",
    DB_PORT: "3310",
    DB_NAME: "explicit_db",
    DB_USER: "explicit_user",
    DB_PASSWORD: "explicit_pass"
  }, {
    defaultPort: 3306,
    context: "database runtime"
  });

  assert.equal(connection.host, "db.explicit.local");
  assert.equal(connection.port, 3310);
  assert.equal(connection.database, "explicit_db");
  assert.equal(connection.user, "explicit_user");
  assert.equal(connection.password, "explicit_pass");
});

test("resolveDatabaseConnectionFromEnvironment returns mutable connection fields for knex", () => {
  const connection = resolveDatabaseConnectionFromEnvironment({
    DATABASE_URL: "mysql://urluser:urlpass@db.url.local:3308/url_db_name"
  }, {
    defaultPort: 3306,
    context: "database runtime"
  });

  assert.equal(Object.isFrozen(connection), false);
  const descriptor = Object.getOwnPropertyDescriptor(connection, "password");
  assert.equal(descriptor?.configurable, true);
  assert.equal(descriptor?.writable, true);
});

test("resolveKnexConnectionFromEnvironment keeps only MySQL DATE columns as strings", () => {
  const mysqlConnection = resolveKnexConnectionFromEnvironment({
    DB_CLIENT: "mysql2",
    DB_HOST: "db.local",
    DB_NAME: "appdb",
    DB_USER: "appuser",
    DB_PASSWORD: "apppass"
  }, {
    client: "mysql2"
  });

  assert.deepEqual(mysqlConnection.dateStrings, ["DATE"]);
  assert.equal(mysqlConnection.supportBigNumbers, true);
  assert.equal(mysqlConnection.bigNumberStrings, true);

  const postgresConnection = resolveKnexConnectionFromEnvironment({
    DB_CLIENT: "pg",
    DB_HOST: "db.local",
    DB_NAME: "appdb",
    DB_USER: "appuser",
    DB_PASSWORD: "apppass"
  }, {
    client: "pg",
    defaultPort: 5432
  });

  assert.equal(postgresConnection.dateStrings, undefined);
});
