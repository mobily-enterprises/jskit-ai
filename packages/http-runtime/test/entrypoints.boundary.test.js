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

test("client entrypoint exports client runtime and client providers only", () => {
  assert.equal(typeof clientApi.createHttpClient, "function");
  assert.equal(typeof clientApi.HttpValidatorsClientProvider, "function");
  assert.equal(typeof clientApi.HttpClientRuntimeClientProvider, "function");
  assert.equal(typeof clientApi.withStandardErrorResponses, "undefined");
});

test("server entrypoint exports server providers only", () => {
  assert.equal(typeof serverApi.HttpValidatorsServiceProvider, "function");
  assert.equal(typeof serverApi.HttpClientRuntimeServiceProvider, "function");
  assert.equal(typeof serverApi.createHttpClient, "undefined");
  assert.equal(typeof serverApi.withStandardErrorResponses, "undefined");
});

test("shared entrypoint exports shared validators only", () => {
  assert.equal(typeof sharedApi.withStandardErrorResponses, "function");
  assert.equal(typeof sharedApi.enumSchema, "function");
  assert.equal(typeof sharedApi.createResource, "function");
  assert.equal(typeof sharedApi.createCommand, "function");
  assert.equal(typeof sharedApi.createHttpClient, "undefined");
  assert.equal(typeof sharedApi.HttpValidatorsServiceProvider, "undefined");
});
