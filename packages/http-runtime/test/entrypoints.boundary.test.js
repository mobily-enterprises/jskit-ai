import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as clientApi from "../src/client/index.js";
import * as sharedApi from "../src/shared/index.js";
import { HttpValidatorsProvider } from "../src/server/providers/HttpValidatorsProvider.js";
import { HttpClientProvider } from "../src/server/providers/HttpClientProvider.js";

test("package exports include explicit shared entrypoint and no server barrel", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const exportsMap = packageJson && typeof packageJson === "object" ? packageJson.exports : {};
  assert.equal(exportsMap["./server"], undefined);
  assert.equal(exportsMap["./shared"], "./src/shared/index.js");
});

test("client entrypoint exports client runtime helpers and client providers only", () => {
  assert.equal(typeof clientApi.createHttpClient, "function");
  assert.equal(typeof clientApi.createTransientRetryHttpClient, "function");
  assert.equal(clientApi.HttpValidatorsClientProvider.id, "validators.http.client");
  assert.equal(clientApi.HttpClientRuntimeClientProvider.id, "runtime.http-client.client");
  assert.equal(typeof clientApi.withStandardErrorResponses, "undefined");
});

test("server provider modules export declarative providers only", () => {
  assert.equal(HttpValidatorsProvider.id, "validators.http");
  assert.equal(HttpClientProvider.id, "runtime.http-client");
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
  assert.equal(typeof sharedApi.HttpValidatorsProvider, "undefined");
});
