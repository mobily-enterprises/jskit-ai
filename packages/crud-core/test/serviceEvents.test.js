import test from "node:test";
import assert from "node:assert/strict";
import { resolveCrudJsonApiEntityIdFromResult } from "../src/server/serviceEvents.js";

test("resolveCrudJsonApiEntityIdFromResult reads the created record's id from a JSON:API document result", () => {
  assert.equal(resolveCrudJsonApiEntityIdFromResult({
    result: {
      kind: "document",
      value: {
        data: {
          id: 15
        }
      }
    }
  }), "15");
  assert.equal(resolveCrudJsonApiEntityIdFromResult({ result: { data: { id: 16 } } }), "",
    "a bare document is not a create result: the action or service returns a JSON:API document result");
  assert.equal(resolveCrudJsonApiEntityIdFromResult({ result: { kind: "document", value: { data: null } } }), "");
  assert.equal(resolveCrudJsonApiEntityIdFromResult({ result: { kind: "document", value: { data: { id: "   " } } } }), "");
});
