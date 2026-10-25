import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as clientApi from "../src/client/index.js";
import * as sharedApi from "../src/shared/index.js";

test("package exports include explicit shared entrypoint and no server barrel", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const exportsMap = packageJson && typeof packageJson === "object" ? packageJson.exports : {};
  assert.equal(exportsMap["./server"], undefined);
  assert.equal(exportsMap["./shared"], "./src/shared/index.js");
});

test("package registers no container providers; callers import its functions directly", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(packageJson.jskit.capabilities.provides, []);
  assert.deepEqual(packageJson.jskit.runtime.server.providers, []);
  assert.deepEqual(packageJson.jskit.runtime.client.providers, []);
  for (const surface of packageJson.jskit.metadata.apiSummary.surfaces) {
    assert.ok(packageJson.exports[surface.subpath], `apiSummary names a real export: ${surface.subpath}`);
  }
});

test("client entrypoint exports client runtime helpers only", () => {
  assert.equal(typeof clientApi.createHttpClient, "function");
  assert.equal(typeof clientApi.createTransientRetryHttpClient, "function");
  assert.equal(typeof clientApi.withStandardErrorResponses, "undefined");
});

test("shared entrypoint exports shared validators only", () => {
  assert.equal(typeof sharedApi.withStandardErrorResponses, "function");
  assert.equal(typeof sharedApi.validateOperationSection, "function");
  assert.equal(typeof sharedApi.createJsonApiDocument, "function");
  assert.equal(typeof sharedApi.createJsonApiErrorDocumentFromFailure, "function");
  assert.equal(typeof sharedApi.normalizeJsonApiDocument, "function");
  assert.equal(typeof sharedApi.returnJsonApiDocument, "function");
  assert.equal(typeof sharedApi.returnJsonApiData, "function");
  assert.equal(typeof sharedApi.returnJsonApiMeta, "function");
  assert.equal(typeof sharedApi.createJsonApiResourceRouteContract, "function");
  assert.equal(typeof sharedApi.withJsonApiErrorResponses, "function");
  assert.equal(typeof sharedApi.createHttpClient, "undefined");
  for (const removed of ["createResource", "createCommand", "createPaginationQuerySchema", "mapOperationIssues", "enumSchema", "passthroughErrorResponses"]) {
    assert.equal(typeof sharedApi[removed], "undefined", removed);
  }
});
