import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as clientApi from "../src/client/index.js";
import * as sharedApi from "../src/shared/index.js";
import { DatabaseRuntimeServiceProvider } from "../src/server/providers/DatabaseRuntimeServiceProvider.js";

test("package exports include explicit shared and provider entrypoints", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const exportsMap = packageJson && typeof packageJson === "object" ? packageJson.exports : {};
  assert.equal(exportsMap["./server"], undefined);
  assert.equal(
    exportsMap["./server/providers/DatabaseRuntimeServiceProvider"],
    "./src/server/providers/DatabaseRuntimeServiceProvider.js"
  );
  assert.equal(exportsMap["./shared"], "./src/shared/index.js");
});

test("client entrypoint exports no database runtime api", () => {
  assert.deepEqual(Object.keys(clientApi), []);
});

test("server provider module exports service provider only", () => {
  assert.equal(typeof DatabaseRuntimeServiceProvider, "function");
});

test("shared entrypoint exports shared database utilities only", () => {
  assert.equal(typeof sharedApi.registerDatabaseRuntime, "function");
  assert.equal(typeof sharedApi.createTransactionManager, "function");
  assert.equal(typeof sharedApi.isDuplicateEntryError, "function");
  assert.equal(typeof sharedApi.createRepositoryScope, "function");
  assert.equal(typeof sharedApi.DatabaseRuntimeServiceProvider, "undefined");
});
