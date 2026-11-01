import test from "node:test";
import assert from "node:assert/strict";
import { returnJsonApiData, returnJsonApiDocument } from "@jskit-ai/http-runtime/shared";
import { resolveCrudJsonApiEntityIdFromResult } from "../src/server/serviceEvents.js";

test("resolveCrudJsonApiEntityIdFromResult reads the created record's id from a tagged JSON:API result of either kind", () => {
  assert.equal(resolveCrudJsonApiEntityIdFromResult({ result: returnJsonApiDocument({ data: { id: 15 } }) }), "15");
  assert.equal(resolveCrudJsonApiEntityIdFromResult({ result: returnJsonApiData({ id: 16, title: "Kindred" }) }), "16");
  assert.equal(resolveCrudJsonApiEntityIdFromResult({ result: { data: { id: 17 } } }), "",
    "an untagged document is not a create result");
  assert.equal(resolveCrudJsonApiEntityIdFromResult({ result: { kind: "document", value: { data: { id: 18 } } } }), "",
    "a look-alike without the result tag is not a create result");
  assert.equal(resolveCrudJsonApiEntityIdFromResult({ result: returnJsonApiDocument({ data: null }) }), "");
  assert.equal(resolveCrudJsonApiEntityIdFromResult({ result: returnJsonApiData(null) }), "");
  assert.equal(resolveCrudJsonApiEntityIdFromResult({ result: returnJsonApiDocument({ data: { id: "   " } }) }), "");
});
