import test from "node:test";
import assert from "node:assert/strict";
import {
  toIsoString,
  toDatabaseDateTimeUtc,
  toJsonDate,
  toJsonTime,
  toJsonDateTime
} from "../src/shared/dateUtils.js";

test("toIsoString normalizes valid date input", () => {
  assert.equal(toIsoString("2024-01-01T00:00:00.000Z"), "2024-01-01T00:00:00.000Z");
  assert.equal(toIsoString("2024-01-01 01:02:03.045"), "2024-01-01T01:02:03.045Z");
});

test("toDatabaseDateTimeUtc formats DATETIME(3) UTC string", () => {
  assert.equal(toDatabaseDateTimeUtc("2024-01-01T00:00:00.000Z"), "2024-01-01 00:00:00.000");
  assert.equal(toDatabaseDateTimeUtc(new Date("2024-01-01T01:02:03.045Z")), "2024-01-01 01:02:03.045");
});

test("toDatabaseDateTimeUtc preserves nullable empty values", () => {
  assert.equal(toDatabaseDateTimeUtc(null), null);
  assert.equal(toDatabaseDateTimeUtc(undefined), null);
  assert.equal(toDatabaseDateTimeUtc(""), null);
  assert.equal(toDatabaseDateTimeUtc("   "), null);
});

test("date utils throw on invalid date", () => {
  assert.throws(() => toIsoString("not-a-date"), /Invalid date value\./);
  assert.throws(() => toIsoString("January 1, 2024"), /Invalid date value\./);
  assert.throws(() => toIsoString("2024-01-01T00:00:00"), /Invalid date value\./);
  assert.throws(() => toDatabaseDateTimeUtc("not-a-date"), /Invalid date value\./);
});

test("JSON temporal serializers produce json-rest-schema 1.0.17 string shapes", () => {
  assert.equal(toJsonDate("2026-08-13"), "2026-08-13");
  assert.equal(toJsonDate(new Date("2026-08-13T23:59:58.123Z")), "2026-08-13");
  assert.equal(toJsonTime("07:08"), "07:08");
  assert.equal(toJsonTime("07:08:09.123456"), "07:08:09.123456");
  assert.equal(toJsonTime(new Date("2026-08-13T07:08:09.000Z"), { temporalPrecision: 0 }), "07:08:09");
  assert.equal(toJsonDateTime("2026-08-13 07:08:09.123456"), "2026-08-13T07:08:09.123456Z");
  assert.equal(toJsonDateTime("2026-08-13T07:08:09+08:00"), "2026-08-13T07:08:09+08:00");
  assert.equal(toJsonDateTime(new Date("2026-08-13T07:08:09.123Z")), "2026-08-13T07:08:09.123Z");
  assert.equal(
    toJsonDateTime(new Date("2026-08-13T07:08:09.123Z"), { temporalPrecision: 6 }),
    "2026-08-13T07:08:09.123000Z"
  );
  assert.equal(toJsonDateTime(null), null);
});

test("JSON temporal serializers reject invalid or ambiguous values", () => {
  assert.throws(() => toJsonDate("2026-02-30"), /Invalid date value/);
  assert.throws(() => toJsonTime("25:00"), /Invalid time value/);
  assert.throws(() => toJsonDateTime("2026-08-13T07:08"), /Invalid date-time value/);
  assert.throws(() => toJsonDateTime("2026-08-13 07:08:09+25:00"), /Invalid time value/);
  assert.throws(
    () => toJsonDateTime("2026-08-13T07:08:09.123Z", { temporalPrecision: 2 }),
    /exceeds configured precision/
  );
  assert.throws(
    () => toJsonTime(new Date("2026-08-13T07:08:09.123Z"), { temporalPrecision: 2 }),
    /exceeds configured precision/
  );
});
