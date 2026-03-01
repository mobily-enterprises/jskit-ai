import test from "node:test";
import assert from "node:assert/strict";
import { parseMetadataJson, stringifyMetadataJson } from "../src/shared/repositoryOptions.js";

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
