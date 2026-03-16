import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as clientApi from "../src/client/index.js";
import * as sharedApi from "../src/shared/index.js";
import { DatabaseRuntimeMysqlServiceProvider } from "../src/server/providers/DatabaseRuntimeMysqlServiceProvider.js";

test("package exports include explicit shared and provider entrypoints", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const exportsMap = packageJson && typeof packageJson === "object" ? packageJson.exports : {};
  assert.equal(exportsMap["./server"], undefined);
  assert.equal(
    exportsMap["./server/providers/DatabaseRuntimeMysqlServiceProvider"],
    "./src/server/providers/DatabaseRuntimeMysqlServiceProvider.js"
  );
  assert.equal(exportsMap["./shared"], "./src/shared/index.js");
});

test("client entrypoint exports no mysql runtime api", () => {
  assert.deepEqual(Object.keys(clientApi), []);
});

test("server provider module exports mysql service provider only", () => {
  assert.equal(typeof DatabaseRuntimeMysqlServiceProvider, "function");
});

test("shared entrypoint exports mysql dialect helpers", () => {
  assert.equal(sharedApi.DIALECT_ID, "mysql2");
  assert.equal(sharedApi.getDialectId(), "mysql2");
  assert.equal(typeof sharedApi.DatabaseRuntimeMysqlServiceProvider, "undefined");
});
