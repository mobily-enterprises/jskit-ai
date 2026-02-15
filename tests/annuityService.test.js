import assert from "node:assert/strict";
import test from "node:test";
import { calculateAnnuity, validateAndNormalizeInput } from "../services/annuityService.js";

function approximatelyEqual(actual, expected, tolerance = 1e-6) {
  return Math.abs(actual - expected) <= tolerance;
}

test("perpetual PV ordinary annuity matches closed-form result", () => {
  const input = validateAndNormalizeInput({
    mode: "pv",
    timing: "ordinary",
    payment: 500,
    annualRate: 6,
    annualGrowthRate: 0,
    paymentsPerYear: 12,
    isPerpetual: true
  });

  const result = calculateAnnuity(input);

  assert.equal(result.isPerpetual, true);
  assert.equal(result.mode, "pv");
  assert.equal(result.totalPeriods, null);
  assert.equal(result.years, null);
  assert.equal(approximatelyEqual(Number(result.value), 100000, 1e-6), true);
});

test("perpetual PV annuity due applies one extra discount period", () => {
  const input = validateAndNormalizeInput({
    mode: "pv",
    timing: "due",
    payment: 500,
    annualRate: 6,
    annualGrowthRate: 0,
    paymentsPerYear: 12,
    isPerpetual: true
  });

  const result = calculateAnnuity(input);

  assert.equal(approximatelyEqual(Number(result.value), 100500, 1e-6), true);
});

test("finite PV warns when growth is at/above discount and horizon is long", () => {
  const input = validateAndNormalizeInput({
    mode: "pv",
    timing: "ordinary",
    payment: 500,
    annualRate: 3,
    annualGrowthRate: 5,
    years: 50,
    paymentsPerYear: 12,
    isPerpetual: false
  });

  const result = calculateAnnuity(input);

  assert.equal(result.isPerpetual, false);
  assert.equal(result.warnings.length > 0, true);
  assert.equal(
    result.warnings.some(
      (warning) => warning.toLowerCase().includes("very large") || warning.toLowerCase().includes("sensitive")
    ),
    true
  );
});

test("perpetual PV validation rejects growth >= discount", () => {
  assert.throws(
    () => {
      validateAndNormalizeInput({
        mode: "pv",
        timing: "ordinary",
        payment: 500,
        annualRate: 4,
        annualGrowthRate: 6,
        paymentsPerYear: 12,
        isPerpetual: true
      });
    },
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(Boolean(error.details?.fieldErrors?.annualRate), true);
      assert.equal(Boolean(error.details?.fieldErrors?.annualGrowthRate), true);
      return true;
    }
  );
});
