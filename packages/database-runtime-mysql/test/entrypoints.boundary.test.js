import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as clientApi from "../src/client/index.js";
import * as sharedApi from "../src/shared/index.js";
import { MysqlDatabaseDriverProvider } from "../src/server/providers/MysqlDatabaseDriverProvider.js";

test("package exports include explicit shared and provider entrypoints", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const exportsMap = packageJson && typeof packageJson === "object" ? packageJson.exports : {};
  assert.equal(exportsMap["./server"], undefined);
  assert.equal(
    exportsMap["./server/providers/MysqlDatabaseDriverProvider"],
    "./src/server/providers/MysqlDatabaseDriverProvider.js"
  );
  assert.equal(exportsMap["./shared"], "./src/shared/index.js");
});

test("client entrypoint exports no mysql runtime api", () => {
  assert.deepEqual(Object.keys(clientApi), []);
});

test("server provider module exports the declarative mysql driver provider", () => {
  assert.equal(MysqlDatabaseDriverProvider.id, "runtime.database.driver.mysql");
  assert.deepEqual(MysqlDatabaseDriverProvider.provides, { driver: "runtime.database.driver" });
});

test("shared entrypoint exports mysql dialect helpers", () => {
  assert.equal(sharedApi.DIALECT_ID, "mysql2");
  assert.equal(sharedApi.getDialectId(), "mysql2");
  assert.equal(typeof sharedApi.introspectCrudTableSnapshot, "function");
  assert.equal(typeof sharedApi.MysqlDatabaseDriverProvider, "undefined");
});
