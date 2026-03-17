import assert from "node:assert/strict";
import test from "node:test";

import {
  assertEntitlementValueOrThrow,
  resolveSchemaValidator,
  validateEntitlementValue
} from "../src/lib/entitlementSchema.js";

test("resolveSchemaValidator returns known validators and null for unknown schema ids", () => {
  assert.equal(typeof resolveSchemaValidator("entitlement.boolean.v"), "function");
  assert.equal(typeof resolveSchemaValidator("entitlement.quota.v"), "function");
  assert.equal(typeof resolveSchemaValidator("entitlement.string_list.v"), "function");
  assert.equal(resolveSchemaValidator("entitlement.unknown.v"), null);
});

test("validateEntitlementValue supports boolean, quota, and string list payloads", () => {
  assert.deepEqual(
    validateEntitlementValue({
      schemaVersion: "entitlement.boolean.v",
      value: { enabled: true }
    }),
    { valid: true, reason: "ok" }
  );

  assert.deepEqual(
    validateEntitlementValue({
      schemaVersion: "entitlement.quota.v",
      value: { limit: 10, interval: "month", enforcement: "hard" }
    }),
    { valid: true, reason: "ok" }
  );

  assert.deepEqual(
    validateEntitlementValue({
      schemaVersion: "entitlement.string_list.v",
      value: { values: ["alpha", "beta"] }
    }),
    { valid: true, reason: "ok" }
  );

  assert.deepEqual(
    validateEntitlementValue({
      schemaVersion: "entitlement.unknown.v",
      value: {}
    }),
    { valid: false, reason: "unknown_schema_version" }
  );

  assert.deepEqual(
    validateEntitlementValue({
      schemaVersion: "entitlement.boolean.v",
      value: { enabled: "yes" }
    }),
    { valid: false, reason: "invalid_payload" }
  );
});

test("assertEntitlementValueOrThrow throws AppError for invalid payloads", () => {
  assert.throws(
    () =>
      assertEntitlementValueOrThrow({
        schemaVersion: "entitlement.boolean.v",
        value: { enabled: "yes" },
        errorStatus: 400
      }),
    (error) => {
      assert.equal(error?.statusCode, 400);
      assert.equal(error?.code, "ENTITLEMENT_SCHEMA_INVALID");
      assert.equal(error?.details?.schemaVersion, "entitlement.boolean.v");
      assert.equal(error?.details?.reason, "invalid_payload");
      return true;
    }
  );
});
