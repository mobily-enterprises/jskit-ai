import assert from "node:assert/strict";
import test from "node:test";
import Decimal from "decimal.js";
import { calculateAnnuity, validateAndNormalizeInput } from "../server/domain/annuity/calculator.service.js";

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

test("finite FV covers rates-equal branch", () => {
  const input = validateAndNormalizeInput({
    mode: "fv",
    timing: "ordinary",
    payment: 100,
    annualRate: 12,
    annualGrowthRate: 12,
    years: 3,
    paymentsPerYear: 1,
    isPerpetual: false
  });

  const result = calculateAnnuity(input);

  assert.equal(result.mode, "fv");
  assert.equal(result.isPerpetual, false);
  assert.equal(result.totalPeriods, "3.0000");
  assert.equal(Number(result.value) > 0, true);
});

test("finite FV covers discount-growth delta branch", () => {
  const input = validateAndNormalizeInput({
    mode: "fv",
    timing: "ordinary",
    payment: 500,
    annualRate: 6,
    annualGrowthRate: 2,
    years: 20,
    paymentsPerYear: 12,
    isPerpetual: false
  });

  const result = calculateAnnuity(input);

  assert.equal(result.mode, "fv");
  assert.equal(result.totalPeriods, "240.0000");
  assert.equal(Number(result.value) > 0, true);
});

test("finite PV covers rates-equal branch", () => {
  const input = validateAndNormalizeInput({
    mode: "pv",
    timing: "ordinary",
    payment: 250,
    annualRate: 8,
    annualGrowthRate: 8,
    years: 5,
    paymentsPerYear: 1,
    isPerpetual: false
  });

  const result = calculateAnnuity(input);

  assert.equal(result.mode, "pv");
  assert.equal(result.isPerpetual, false);
  assert.equal(Number(result.value) > 0, true);
});

test("finite mode warns on long horizons", () => {
  const input = validateAndNormalizeInput({
    mode: "fv",
    timing: "ordinary",
    payment: 100,
    annualRate: 6,
    annualGrowthRate: 0,
    years: 101,
    paymentsPerYear: 12,
    isPerpetual: false
  });

  const result = calculateAnnuity(input);
  assert.equal(
    result.warnings.some((warning) => warning.toLowerCase().includes("long horizons")),
    true
  );
});

test("validation rejects invalid finite years and extremely large years", () => {
  assert.throws(
    () => {
      validateAndNormalizeInput({
        mode: "pv",
        timing: "ordinary",
        payment: 100,
        annualRate: 5,
        annualGrowthRate: 0,
        years: 0,
        paymentsPerYear: 12,
        isPerpetual: false
      });
    },
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(Boolean(error.details?.fieldErrors?.years), true);
      return true;
    }
  );

  assert.throws(
    () => {
      validateAndNormalizeInput({
        mode: "pv",
        timing: "ordinary",
        payment: 100,
        annualRate: 5,
        annualGrowthRate: 0,
        years: 10001,
        paymentsPerYear: 12,
        isPerpetual: false
      });
    },
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(Boolean(error.details?.fieldErrors?.years), true);
      return true;
    }
  );
});

test("validation rejects invalid periodic conversion and non-pv perpetual mode", () => {
  assert.throws(
    () => {
      validateAndNormalizeInput({
        mode: "fv",
        timing: "ordinary",
        payment: 100,
        annualRate: 6,
        annualGrowthRate: 0,
        paymentsPerYear: 12,
        isPerpetual: true
      });
    },
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(Boolean(error.details?.fieldErrors?.mode), true);
      return true;
    }
  );
});

test("calculateAnnuity rejects non-finite output and invalid total periods", () => {
  assert.throws(
    () => {
      calculateAnnuity({
        mode: "pv",
        timing: "ordinary",
        payment: "1.000000",
        annualRate: "1.000000",
        annualGrowthRate: "0.000000",
        years: null,
        paymentsPerYear: 1,
        periodicRate: "0.010000000000",
        periodicGrowthRate: "0.000000000000",
        totalPeriods: null,
        isPerpetual: true,
        paymentDecimal: new Decimal(Infinity),
        annualRateDecimal: new Decimal(1),
        annualGrowthRateDecimal: new Decimal(0),
        yearsDecimal: null,
        paymentsPerYearDecimal: new Decimal(1),
        periodicRateDecimal: new Decimal(0.01),
        periodicGrowthRateDecimal: new Decimal(0)
      });
    },
    (error) => {
      assert.equal(error.status, 422);
      return true;
    }
  );

  assert.throws(
    () => {
      calculateAnnuity({
        mode: "pv",
        timing: "ordinary",
        payment: "1.000000",
        annualRate: "1.000000",
        annualGrowthRate: "0.000000",
        years: "0.0000",
        paymentsPerYear: 12,
        periodicRate: "0.010000000000",
        periodicGrowthRate: "0.000000000000",
        totalPeriods: "0.0000",
        isPerpetual: false,
        paymentDecimal: new Decimal(1),
        annualRateDecimal: new Decimal(1),
        annualGrowthRateDecimal: new Decimal(0),
        yearsDecimal: new Decimal(0),
        paymentsPerYearDecimal: new Decimal(12),
        periodicRateDecimal: new Decimal(0.01),
        periodicGrowthRateDecimal: new Decimal(0)
      });
    },
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(Boolean(error.details?.fieldErrors?.years), true);
      return true;
    }
  );
});

test("validation aggregates field errors for invalid scalar inputs", () => {
  assert.throws(
    () => {
      validateAndNormalizeInput({
        mode: "invalid",
        timing: "middle",
        payment: 0,
        annualRate: -100,
        annualGrowthRate: -100,
        years: 1,
        paymentsPerYear: 0,
        isPerpetual: false
      });
    },
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(Boolean(error.details?.fieldErrors?.mode), true);
      assert.equal(Boolean(error.details?.fieldErrors?.timing), true);
      assert.equal(Boolean(error.details?.fieldErrors?.payment), true);
      assert.equal(Boolean(error.details?.fieldErrors?.annualRate), true);
      assert.equal(Boolean(error.details?.fieldErrors?.annualGrowthRate), true);
      assert.equal(Boolean(error.details?.fieldErrors?.paymentsPerYear), true);
      return true;
    }
  );
});

test("validation parses boolean strings for perpetual toggle", () => {
  const normalizedTrue = validateAndNormalizeInput({
    mode: "pv",
    timing: "ordinary",
    payment: 100,
    annualRate: 6,
    annualGrowthRate: 0,
    paymentsPerYear: 12,
    isPerpetual: "true"
  });

  assert.equal(normalizedTrue.isPerpetual, true);
  assert.equal(normalizedTrue.years, null);

  const normalizedFalse = validateAndNormalizeInput({
    mode: "pv",
    timing: "ordinary",
    payment: 100,
    annualRate: 6,
    annualGrowthRate: 0,
    years: 10,
    paymentsPerYear: 12,
    isPerpetual: "false"
  });

  assert.equal(normalizedFalse.isPerpetual, false);
  assert.equal(normalizedFalse.years, "10.0000");

  const normalizedUnknown = validateAndNormalizeInput({
    mode: "pv",
    timing: "ordinary",
    payment: 100,
    annualRate: 6,
    annualGrowthRate: 0,
    years: 10,
    paymentsPerYear: 12,
    isPerpetual: "unexpected"
  });

  assert.equal(normalizedUnknown.isPerpetual, false);
  assert.equal(normalizedUnknown.years, "10.0000");
});

test("validation applies default growth when perpetual mode is enabled", () => {
  const normalized = validateAndNormalizeInput({
    mode: "pv",
    timing: "ordinary",
    payment: 100,
    annualRate: 6,
    paymentsPerYear: 12,
    isPerpetual: true
  });

  assert.equal(normalized.isPerpetual, true);
  assert.equal(normalized.annualGrowthRate, "0.000000");
  assert.equal(normalized.years, null);
});

test("validation reports missing mode and timing when omitted", () => {
  assert.throws(
    () => {
      validateAndNormalizeInput({
        payment: 100,
        annualRate: 6,
        annualGrowthRate: 0,
        years: 10,
        paymentsPerYear: 12
      });
    },
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(Boolean(error.details?.fieldErrors?.mode), true);
      assert.equal(Boolean(error.details?.fieldErrors?.timing), true);
      return true;
    }
  );
});
