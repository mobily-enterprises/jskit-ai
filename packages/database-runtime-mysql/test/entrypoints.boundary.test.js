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

test("client entrypoint exports no mysql runtime api", () => {
  assert.deepEqual(Object.keys(clientApi), []);
});

test("server entrypoint exports mysql service provider only", () => {
  assert.equal(typeof serverApi.DatabaseRuntimeMysqlServiceProvider, "function");
  assert.equal(typeof serverApi.getDialectId, "undefined");
});

test("shared entrypoint exports mysql dialect helpers", () => {
  assert.equal(sharedApi.DIALECT_ID, "mysql");
  assert.equal(sharedApi.getDialectId(), "mysql");
  assert.equal(typeof sharedApi.DatabaseRuntimeMysqlServiceProvider, "undefined");
});
