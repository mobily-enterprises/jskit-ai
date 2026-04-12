import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDbRecordId,
  parseMetadataJson,
  resolveInsertedRecordId,
  stringifyMetadataJson
} from "../src/shared/repositoryOptions.js";

test("parseMetadataJson parses object-like metadata payloads", () => {
  assert.deepEqual(parseMetadataJson(""), {});
  assert.deepEqual(parseMetadataJson("{"), {});
  assert.deepEqual(parseMetadataJson("{\"source\":\"console\"}"), { source: "console" });
  assert.deepEqual(parseMetadataJson("[1,2,3]"), [1, 2, 3]);
});

test("stringifyMetadataJson serializes metadata payloads", () => {
  assert.equal(stringifyMetadataJson(null), "{}");
  assert.equal(stringifyMetadataJson({ source: "console" }), "{\"source\":\"console\"}");
  assert.equal(stringifyMetadataJson([1, 2, 3]), "[1,2,3]");
});

test("stringifyMetadataJson returns fallback for non-serializable values", () => {
  const circular = {};
  circular.self = circular;
  assert.equal(stringifyMetadataJson(circular), "{}");
});

test("normalizeDbRecordId preserves canonical DB ids and rejects unsafe JS numbers", () => {
  const unsafeNumericId = Number(9007199254740993n);
  assert.equal(normalizeDbRecordId("9007199254740993"), "9007199254740993");
  assert.equal(normalizeDbRecordId(42), "42");
  assert.equal(normalizeDbRecordId(42n), "42");
  assert.equal(normalizeDbRecordId(unsafeNumericId), null);
});

test("resolveInsertedRecordId normalizes insert ids without accepting unsafe JS numbers", () => {
  const unsafeNumericId = Number(9007199254740993n);
  assert.equal(resolveInsertedRecordId(["9007199254740993"]), "9007199254740993");
  assert.equal(resolveInsertedRecordId([42]), "42");
  assert.equal(resolveInsertedRecordId([unsafeNumericId]), null);
});
