import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as clientApi from "../src/client/index.js";
import * as sharedApi from "../src/shared/index.js";
import { HttpValidatorsServiceProvider } from "../src/server/providers/HttpValidatorsServiceProvider.js";
import { HttpClientRuntimeServiceProvider } from "../src/server/providers/HttpClientRuntimeServiceProvider.js";

test("package exports include explicit shared entrypoint and no server barrel", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const exportsMap = packageJson && typeof packageJson === "object" ? packageJson.exports : {};
  assert.equal(exportsMap["./server"], undefined);
  assert.equal(exportsMap["./shared"], "./src/shared/index.js");
});

test("client entrypoint exports client runtime helpers and client providers only", () => {
  assert.equal(typeof clientApi.createHttpClient, "function");
  assert.equal(typeof clientApi.createTransientRetryHttpClient, "function");
  assert.equal(typeof clientApi.HttpValidatorsClientProvider, "function");
  assert.equal(typeof clientApi.HttpClientRuntimeClientProvider, "function");
  assert.equal(typeof clientApi.withStandardErrorResponses, "undefined");
});

test("server provider modules export server providers only", () => {
  assert.equal(typeof HttpValidatorsServiceProvider, "function");
  assert.equal(typeof HttpClientRuntimeServiceProvider, "function");
});

test("shared entrypoint exports shared validators only", () => {
  assert.equal(typeof sharedApi.withStandardErrorResponses, "function");
  assert.equal(typeof sharedApi.enumSchema, "function");
  assert.equal(typeof sharedApi.createResource, "function");
  assert.equal(typeof sharedApi.createCommand, "function");
  assert.equal(typeof sharedApi.createJsonApiDocument, "function");
  assert.equal(typeof sharedApi.createJsonApiErrorDocumentFromFailure, "function");
  assert.equal(typeof sharedApi.normalizeJsonApiDocument, "function");
  assert.equal(typeof sharedApi.returnJsonApiDocument, "function");
  assert.equal(typeof sharedApi.returnJsonApiData, "function");
  assert.equal(typeof sharedApi.returnJsonApiMeta, "function");
  assert.equal(typeof sharedApi.createJsonApiResourceRouteContract, "function");
  assert.equal(typeof sharedApi.withJsonApiErrorResponses, "function");
  assert.equal(typeof sharedApi.createHttpClient, "undefined");
  assert.equal(typeof sharedApi.HttpValidatorsServiceProvider, "undefined");
});
