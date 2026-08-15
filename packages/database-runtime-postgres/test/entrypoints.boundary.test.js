import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as clientApi from "../src/client/index.js";
import * as sharedApi from "../src/shared/index.js";
import { PostgresDatabaseDriverProvider } from "../src/server/providers/PostgresDatabaseDriverProvider.js";

test("package exports include explicit shared and provider entrypoints", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const exportsMap = packageJson && typeof packageJson === "object" ? packageJson.exports : {};
  assert.equal(exportsMap["./server"], undefined);
  assert.equal(
    exportsMap["./server/providers/PostgresDatabaseDriverProvider"],
    "./src/server/providers/PostgresDatabaseDriverProvider.js"
  );
  assert.equal(exportsMap["./shared"], "./src/shared/index.js");
});

test("client entrypoint exports no postgres runtime api", () => {
  assert.deepEqual(Object.keys(clientApi), []);
});

test("server provider module exports the declarative postgres driver provider", () => {
  assert.equal(PostgresDatabaseDriverProvider.id, "runtime.database.driver.postgres");
  assert.deepEqual(PostgresDatabaseDriverProvider.provides, { driver: "runtime.database.driver" });
});

test("shared entrypoint exports postgres dialect helpers", () => {
  assert.equal(sharedApi.DIALECT_ID, "pg");
  assert.equal(sharedApi.getDialectId(), "pg");
  assert.equal(typeof sharedApi.PostgresDatabaseDriverProvider, "undefined");
});
