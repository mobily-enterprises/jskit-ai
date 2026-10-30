import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as sharedApi from "../src/shared/index.js";
import { DatabaseProvider } from "../src/server/providers/DatabaseProvider.js";

test("package exports include explicit shared and provider entrypoints", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const exportsMap = packageJson && typeof packageJson === "object" ? packageJson.exports : {};
  assert.equal(exportsMap["./server"], undefined);
  assert.equal(exportsMap["./client"], undefined);
  assert.equal(
    exportsMap["./server/providers/DatabaseProvider"],
    "./src/server/providers/DatabaseProvider.js"
  );
  assert.equal(exportsMap["./shared"], "./src/shared/index.js");
  for (const surface of packageJson.jskit.metadata.apiSummary.surfaces) {
    assert.ok(exportsMap[surface.subpath], `apiSummary names a real export: ${surface.subpath}`);
  }
});

test("server provider module exports one declarative provider", () => {
  assert.equal(DatabaseProvider.id, "runtime.database");
  assert.deepEqual(DatabaseProvider.provides, { database: "runtime.database" });
});

test("shared entrypoint exports shared database utilities only", () => {
  assert.equal(typeof sharedApi.createWithTransaction, "function");
  assert.equal(typeof sharedApi.isDuplicateEntryError, "function");
  assert.equal(typeof sharedApi.isDeadlockError, "function");
  assert.equal(typeof sharedApi.retryDeadlocks, "function");
  assert.equal(typeof sharedApi.toDatabaseDateTimeUtc, "function");
  assert.equal(typeof sharedApi.DatabaseProvider, "undefined");
  for (const removed of ["normalizeText", "retentionTestables", "createTransactionManager", "createRepositoryScope", "BaseRepository"]) {
    assert.equal(typeof sharedApi[removed], "undefined", removed);
  }
});
