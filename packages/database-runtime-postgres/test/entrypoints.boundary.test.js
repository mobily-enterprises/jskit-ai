import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as clientApi from "../src/client/index.js";
import * as serverApi from "../src/server/index.js";
import * as sharedApi from "../src/shared/index.js";

test("package exports include explicit shared entrypoint", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const exportsMap = packageJson && typeof packageJson === "object" ? packageJson.exports : {};
  assert.equal(exportsMap["./shared"], "./src/shared/index.js");
});

test("client entrypoint exports no postgres runtime api", () => {
  assert.deepEqual(Object.keys(clientApi), []);
});

test("server entrypoint exports postgres service provider only", () => {
  assert.equal(typeof serverApi.DatabaseRuntimePostgresServiceProvider, "function");
  assert.equal(typeof serverApi.getDialectId, "undefined");
});

test("shared entrypoint exports postgres dialect helpers", () => {
  assert.equal(sharedApi.DIALECT_ID, "postgres");
  assert.equal(sharedApi.getDialectId(), "postgres");
  assert.equal(typeof sharedApi.DatabaseRuntimePostgresServiceProvider, "undefined");
});
