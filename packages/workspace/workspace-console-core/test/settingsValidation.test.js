import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidCurrencyCode,
  isValidLocale,
  isValidTimeZone,
  toBoolean,
  toCurrencyCode,
  toEnum,
  toLocale,
  toNullableString,
  toPositiveInt,
  toTimeZone,
  toTrimmedString
} from "../src/shared/settingsValidation.js";

test("settings validation normalizers parse and coerce expected values", () => {
  assert.equal(toTrimmedString("  hello  "), "hello");
  assert.equal(toNullableString("   "), null);
  assert.equal(toNullableString("  value  "), "value");
  assert.equal(toBoolean(true), true);
  assert.equal(toBoolean("true", { coerce: true }), true);
  assert.equal(toEnum("dark", ["system", "light", "dark"]), "dark");
  assert.equal(toPositiveInt("64", { min: 32, max: 128 }), 64);
  assert.equal(toLocale("en-US"), "en-US");
  assert.equal(toTimeZone("UTC"), "UTC");
  assert.equal(toCurrencyCode("usd"), "USD");
  assert.equal(isValidLocale("en-US"), true);
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidCurrencyCode("USD"), true);
});

test("settings validation normalizers reject invalid values", () => {
  assert.throws(() => toBoolean("yes"), /boolean/i);
  assert.throws(() => toEnum("invalid", ["a", "b"]), /allowed/i);
  assert.throws(() => toPositiveInt(0, { min: 1, max: 10 }), /integer/i);
  assert.throws(() => toLocale("bad-@@"), /BCP 47/i);
  assert.throws(() => toTimeZone("Mars\/Phobos"), /IANA/i);
  assert.throws(() => toCurrencyCode("US"), /ISO 4217/i);
});
