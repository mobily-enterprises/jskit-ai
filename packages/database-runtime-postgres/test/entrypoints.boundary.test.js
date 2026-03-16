import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as clientApi from "../src/client/index.js";
import * as sharedApi from "../src/shared/index.js";
import { DatabaseRuntimePostgresServiceProvider } from "../src/server/providers/DatabaseRuntimePostgresServiceProvider.js";

test("package exports include explicit shared and provider entrypoints", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const exportsMap = packageJson && typeof packageJson === "object" ? packageJson.exports : {};
  assert.equal(exportsMap["./server"], undefined);
  assert.equal(
    exportsMap["./server/providers/DatabaseRuntimePostgresServiceProvider"],
    "./src/server/providers/DatabaseRuntimePostgresServiceProvider.js"
  );
  assert.equal(exportsMap["./shared"], "./src/shared/index.js");
});

test("client entrypoint exports no postgres runtime api", () => {
  assert.deepEqual(Object.keys(clientApi), []);
});

test("server provider module exports postgres service provider only", () => {
  assert.equal(typeof DatabaseRuntimePostgresServiceProvider, "function");
});

test("shared entrypoint exports postgres dialect helpers", () => {
  assert.equal(sharedApi.DIALECT_ID, "pg");
  assert.equal(sharedApi.getDialectId(), "pg");
  assert.equal(typeof sharedApi.DatabaseRuntimePostgresServiceProvider, "undefined");
});
