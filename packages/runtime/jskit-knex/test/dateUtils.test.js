import test from "node:test";
import assert from "node:assert/strict";
import { toIsoString, toDatabaseDateTimeUtc } from "../src/shared/dateUtils.js";

test("toIsoString normalizes valid date input", () => {
  assert.equal(toIsoString("2024-01-01T00:00:00.000Z"), "2024-01-01T00:00:00.000Z");
});

test("toDatabaseDateTimeUtc formats DATETIME(3) UTC string", () => {
  assert.equal(toDatabaseDateTimeUtc("2024-01-01T00:00:00.000Z"), "2024-01-01 00:00:00.000");
  assert.equal(toDatabaseDateTimeUtc(new Date("2024-01-01T01:02:03.045Z")), "2024-01-01 01:02:03.045");
});

test("date utils throw on invalid date", () => {
  assert.throws(() => toIsoString("not-a-date"), /Invalid date value\./);
  assert.throws(() => toDatabaseDateTimeUtc("not-a-date"), /Invalid date value\./);
});
