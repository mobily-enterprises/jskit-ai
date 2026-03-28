import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeListSearchConfig,
  matchesLocalSearch
} from "../src/client/composables/listSearchSupport.js";

test("normalizeListSearchConfig defaults to disabled query search", () => {
  const config = normalizeListSearchConfig();
  assert.equal(config.enabled, false);
  assert.equal(config.mode, "query");
  assert.equal(config.queryParam, "q");
  assert.equal(config.label, "Search");
  assert.equal(config.minLength, 1);
});

test("normalizeListSearchConfig accepts query mode and fields", () => {
  const config = normalizeListSearchConfig({
    enabled: true,
    mode: "query",
    queryParam: "search",
    fields: ["name", "name", "email"]
  });
  assert.equal(config.enabled, true);
  assert.equal(config.mode, "query");
  assert.equal(config.queryParam, "search");
  assert.deepEqual(config.fields, ["name", "email"]);
});

test("normalizeListSearchConfig accepts explicit local mode", () => {
  const config = normalizeListSearchConfig({
    enabled: true,
    mode: "local"
  });
  assert.equal(config.mode, "local");
});

test("matchesLocalSearch checks configured fields", () => {
  const result = matchesLocalSearch(
    {
      firstName: "Ana",
      surname: "Marin",
      phone: "0400"
    },
    "mar",
    ["surname"]
  );
  assert.equal(result, true);
});

test("matchesLocalSearch scans scalar values when fields are not configured", () => {
  const result = matchesLocalSearch(
    {
      firstName: "Ana",
      surname: "Marin",
      count: 42
    },
    "42"
  );
  assert.equal(result, true);
});
