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

test("client entrypoint exports no database runtime api", () => {
  assert.deepEqual(Object.keys(clientApi), []);
});

test("server entrypoint exports provider and register helper only", () => {
  assert.equal(typeof serverApi.DatabaseRuntimeServiceProvider, "function");
  assert.equal(typeof serverApi.registerDatabaseRuntime, "function");
  assert.equal(typeof serverApi.createTransactionManager, "undefined");
});

test("shared entrypoint exports shared database utilities only", () => {
  assert.equal(typeof sharedApi.createTransactionManager, "function");
  assert.equal(typeof sharedApi.isDuplicateEntryError, "function");
  assert.equal(typeof sharedApi.DatabaseRuntimeServiceProvider, "undefined");
});
