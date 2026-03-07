import assert from "node:assert/strict";
import test from "node:test";

import { registerTypeBoxFormats, __testables } from "../src/shared/contracts/typeboxFormats.js";

test("strict uuid validator accepts canonical lowercase v4/v5 values", () => {
  assert.equal(__testables.isStrictUuid("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), true);
  assert.equal(__testables.isStrictUuid("aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa"), true);
  assert.equal(__testables.isStrictUuid("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"), false);
  assert.equal(__testables.isStrictUuid("not-a-uuid"), false);
});

test("strict iso utc date-time validator accepts only canonical millisecond UTC", () => {
  assert.equal(__testables.isStrictIsoUtcDateTime("2024-01-01T00:00:00.000Z"), true);
  assert.equal(__testables.isStrictIsoUtcDateTime("2024-01-01T00:00:00Z"), false);
  assert.equal(__testables.isStrictIsoUtcDateTime("2024-01-01T00:00:00.000+01:00"), false);
  assert.equal(__testables.isStrictIsoUtcDateTime("2024-02-30T00:00:00.000Z"), false);
});

test("registerTypeBoxFormatsWith only sets missing validators", () => {
  const setCalls = [];
  const registry = {
    existing: new Set(["uuid"]),
    Has(name) {
      return this.existing.has(name);
    },
    Set(name, fn) {
      setCalls.push([name, fn]);
      this.existing.add(name);
    }
  };

  __testables.registerTypeBoxFormatsWith(registry);

  assert.equal(setCalls.length, 1);
  assert.equal(setCalls[0][0], "iso-utc-date-time");
});

test("registerTypeBoxFormats is callable", () => {
  registerTypeBoxFormats();
  assert.equal(typeof registerTypeBoxFormats, "function");
});
