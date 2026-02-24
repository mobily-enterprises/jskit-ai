import assert from "node:assert/strict";
import test from "node:test";
import { toIsoString } from "@jskit-ai/knex-mysql-core/dateUtils";
import { __testables as profileTestables } from "../server/domain/users/profile.repository.js";
import { __testables as calcTestables } from "../server/modules/history/repository.js";

test("toIsoString throws on invalid date input", () => {
  assert.throws(() => {
    toIsoString("not-a-date");
  }, /Invalid date value/);
});

test("profile mapper required/nullable invariants", () => {
  assert.throws(() => {
    profileTestables.mapProfileRowRequired(null);
  }, /expected a row object/);

  assert.equal(profileTestables.mapProfileRowNullable(null), null);
});

test("calculation mapper required invariant and decimal string mapping", () => {
  assert.throws(() => {
    calcTestables.mapCalculationRowRequired(null);
  }, /expected a row object/);

  const mapped = calcTestables.mapCalculationRowRequired({
    id: "log-1",
    created_at: "2026-02-15T00:00:00.000Z",
    deg2rad_operation: "DEG2RAD",
    deg2rad_formula: "DEG2RAD(x) = x * PI / 180",
    deg2rad_degrees: "180.000000000000",
    deg2rad_radians: "3.141592653590"
  });

  assert.equal(mapped.id, "log-1");
  assert.equal(mapped.DEG2RAD_operation, "DEG2RAD");
  assert.equal(mapped.DEG2RAD_degrees, "180.000000000000");
  assert.equal(mapped.DEG2RAD_radians, "3.141592653590");
});
