import assert from "node:assert/strict";
import test from "node:test";
import { toIsoString } from "../server/lib/primitives/dateUtils.js";
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
    mode: "pv",
    timing: "ordinary",
    payment: "500.000000",
    annual_rate: "6.000000",
    annual_growth_rate: "0.000000",
    years: null,
    payments_per_year: 12,
    periodic_rate: "0.005000000000",
    periodic_growth_rate: "0.000000000000",
    total_periods: null,
    is_perpetual: 1,
    value: "100000.000000000000"
  });

  assert.equal(mapped.id, "log-1");
  assert.equal(mapped.isPerpetual, true);
  assert.equal(mapped.years, null);
  assert.equal(mapped.totalPeriods, null);
  assert.equal(mapped.payment, "500.000000");
});
