import assert from "node:assert/strict";
import test from "node:test";

import {
  jsonApiResultValue,
  returnJsonApiData,
  returnJsonApiDocument,
  returnJsonApiMeta,
  simplifyJsonApiResult
} from "../src/shared/index.js";

const UNTAGGED = /jsonApiResultValue requires a JSON:API result/;

test("jsonApiResultValue returns the value each kind of tagged result carries", () => {
  const document = { data: { type: "contacts", id: "1", attributes: { name: "Merc" } } };
  assert.equal(jsonApiResultValue(returnJsonApiDocument(document)), document);
  assert.deepEqual(jsonApiResultValue(returnJsonApiData({ id: "1" })), { id: "1" });
  assert.deepEqual(jsonApiResultValue(returnJsonApiMeta({ total: 2 })), { total: 2 });
});

test("jsonApiResultValue refuses a value that is not a tagged result", () => {
  assert.throws(() => jsonApiResultValue({ id: "1", name: "Merc" }), UNTAGGED);
  assert.throws(() => jsonApiResultValue(null), UNTAGGED);
  assert.throws(() => jsonApiResultValue([{ id: "1" }]), UNTAGGED);
});

test("simplifyJsonApiResult reads only tagged results", () => {
  const document = { data: { type: "contacts", id: "1", attributes: { name: "Merc" } } };
  assert.deepEqual(simplifyJsonApiResult(returnJsonApiDocument(document)), { id: "1", name: "Merc" });
  assert.throws(() => simplifyJsonApiResult(document), UNTAGGED);
});
