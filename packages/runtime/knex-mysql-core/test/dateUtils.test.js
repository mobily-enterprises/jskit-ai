import assert from "node:assert/strict";
import test from "node:test";
import { toIsoString, toMysqlDateTimeUtc } from "../src/dateUtils.js";

test("toIsoString returns ISO string for valid date", () => {
  assert.equal(toIsoString(new Date("2024-01-01T00:00:00.000Z")), "2024-01-01T00:00:00.000Z");
  assert.equal(toIsoString("2024-01-01T00:00:00.000Z"), "2024-01-01T00:00:00.000Z");
});

test("date helpers throw on invalid date values", () => {
  assert.throws(() => toIsoString("not-a-date"), /Invalid date value\./);
  assert.throws(() => toMysqlDateTimeUtc("not-a-date"), /Invalid date value\./);
});

test("toMysqlDateTimeUtc formats DATETIME(3) UTC string", () => {
  assert.equal(toMysqlDateTimeUtc("2024-01-01T00:00:00.000Z"), "2024-01-01 00:00:00.000");
  assert.equal(toMysqlDateTimeUtc(new Date("2024-01-01T01:02:03.045Z")), "2024-01-01 01:02:03.045");
});
