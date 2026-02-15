import assert from "node:assert/strict";
import test from "node:test";
import { AppError, isAppError } from "../lib/errors.js";
import { safePathnameFromRequest, safeRequestUrl } from "../lib/requestUrl.js";
import { toIsoString, toMysqlDateTimeUtc } from "../lib/dateUtils.js";
import { registerTypeBoxFormats, __testables as formatTestables } from "../lib/schemas/registerTypeBoxFormats.js";

test("AppError and isAppError cover true/false branches", () => {
  const error = new AppError(422, "Validation failed.", {
    code: "VALIDATION_ERROR",
    details: {
      fieldErrors: {
        email: "Invalid"
      }
    },
    headers: {
      "x-test": "1"
    }
  });

  assert.equal(error.status, 422);
  assert.equal(error.statusCode, 422);
  assert.equal(error.code, "VALIDATION_ERROR");
  assert.equal(error.details.fieldErrors.email, "Invalid");
  assert.equal(error.headers["x-test"], "1");
  assert.equal(isAppError(error), true);
  assert.equal(isAppError(new Error("x")), false);

  const defaulted = new AppError(undefined, "fallback");
  assert.equal(defaulted.status, 500);
  assert.deepEqual(defaulted.headers, {});
  assert.equal(defaulted.code, "APP_ERROR");
});

test("safeRequestUrl and safePathnameFromRequest handle valid and invalid inputs", () => {
  const valid = safeRequestUrl({
    raw: {
      url: "/api/history?page=2"
    }
  });
  assert.equal(valid.pathname, "/api/history");

  const fallbackFromInvalid = safeRequestUrl({
    raw: {
      url: "http://%"
    }
  });
  assert.equal(fallbackFromInvalid.pathname, "/");

  const fallbackFromMissing = safeRequestUrl({});
  assert.equal(fallbackFromMissing.pathname, "/");
  assert.equal(safePathnameFromRequest({ url: "/login" }), "/login");
});

test("toIsoString accepts Date objects and throws on invalid values", () => {
  const date = new Date("2024-01-01T00:00:00.000Z");
  assert.equal(toIsoString(date), "2024-01-01T00:00:00.000Z");
  assert.throws(() => toIsoString("not-a-date"), /Invalid date value/);
});

test("toMysqlDateTimeUtc formats UTC timestamp for MySQL DATETIME(3)", () => {
  assert.equal(toMysqlDateTimeUtc("2024-01-01T00:00:00.000Z"), "2024-01-01 00:00:00.000");
  assert.equal(toMysqlDateTimeUtc(new Date("2024-01-01T01:02:03.045Z")), "2024-01-01 01:02:03.045");
  assert.throws(() => toMysqlDateTimeUtc("not-a-date"), /Invalid date value/);
});

test("registerTypeBoxFormats and strict format helpers validate inputs", () => {
  const setCalls = [];
  const fakeRegistry = {
    Has() {
      return false;
    },
    Set(name, fn) {
      setCalls.push([name, fn]);
    }
  };
  formatTestables.registerTypeBoxFormatsWith(fakeRegistry);
  assert.equal(setCalls.length, 2);

  registerTypeBoxFormats();

  assert.equal(formatTestables.isStrictUuid(123), false);
  assert.equal(formatTestables.isStrictUuid("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), true);
  assert.equal(formatTestables.isStrictUuid("not-a-uuid"), false);

  assert.equal(formatTestables.isStrictIsoUtcDateTime(123), false);
  assert.equal(formatTestables.isStrictIsoUtcDateTime("2024-01-01"), false);
  assert.equal(formatTestables.isStrictIsoUtcDateTime("2024-13-01T00:00:00.000Z"), false);
  assert.equal(formatTestables.isStrictIsoUtcDateTime("2024-02-30T00:00:00.000Z"), false);
  assert.equal(formatTestables.isStrictIsoUtcDateTime("2024-01-01T00:00:00.000Z"), true);
});
