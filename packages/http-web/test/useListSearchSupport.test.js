import assert from "node:assert/strict";
import test from "node:test";
import { normalizeListSearchConfig } from "../src/client/composables/support/listSearchSupport.js";

test("normalizeListSearchConfig defaults to disabled query search", () => {
  const config = normalizeListSearchConfig();
  assert.equal(config.enabled, false);
  assert.equal(config.mode, "query");
  assert.equal(config.queryParam, "q");
  assert.equal(config.label, "Search");
  assert.equal(config.minLength, 1);
});

test("normalizeListSearchConfig accepts query mode and its query parameter", () => {
  const config = normalizeListSearchConfig({
    enabled: true,
    mode: "query",
    queryParam: "search"
  });
  assert.equal(config.enabled, true);
  assert.equal(config.mode, "query");
  assert.equal(config.queryParam, "search");
});

test("normalizeListSearchConfig refuses a search of the loaded page, naming the server search", () => {
  assert.throws(
    () => normalizeListSearchConfig({ enabled: true, mode: "local" }),
    (error) => error instanceof TypeError && /runs on the server/u.test(error.message) && /searchSchema\.q/u.test(error.message)
  );
});
