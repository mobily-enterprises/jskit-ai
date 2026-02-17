import DecimalBase from "decimal.js";
import { AppError } from "../lib/errors.js";

const Decimal = DecimalBase.clone({
  precision: 50,
  rounding: DecimalBase.ROUND_HALF_UP
});

const RATE_EPSILON = new Decimal("1e-12");
const WARNING_RATE_EPSILON = new Decimal("1e-6");

const ASSUMPTIONS = {
  rateConversion:
    "Periodic discount rate = annualRate/100/paymentsPerYear. Periodic growth rate = (1 + annualGrowthRate/100)^(1/paymentsPerYear) - 1.",
  timing:
    "Ordinary annuity assumes end-of-period payments. Annuity due assumes beginning-of-period payments and multiplies by (1 + periodic discount rate).",
  growingAnnuity: "Growing annuity assumes payments grow at a constant annual rate converted to a periodic rate.",
  perpetuity:
    "Perpetual present value is only valid when periodic discount rate is strictly greater than periodic growth rate."
};

function parseBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return false;
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function powDecimal(base, exponent) {
  try {
    return Decimal.pow(base, exponent);
    /* c8 ignore start */
  } catch {
    const fallback = Math.pow(base.toNumber(), exponent.toNumber());
    if (!Number.isFinite(fallback)) {
      return new Decimal(NaN);
    }
    return new Decimal(fallback);
  }
  /* c8 ignore stop */
}

export function validateAndNormalizeInput(payload) {
  const mode = String(payload.mode || "")
    .trim()
    .toLowerCase();
  const timing = String(payload.timing || "")
    .trim()
    .toLowerCase();
  const payment = toFiniteNumber(payload.payment);
  const annualRate = toFiniteNumber(payload.annualRate);
  const annualGrowthRate = toFiniteNumber(payload.annualGrowthRate ?? 0);
  const years = toFiniteNumber(payload.years);
  const paymentsPerYear = Number(payload.paymentsPerYear);
  const isPerpetual = parseBoolean(payload.isPerpetual);

  const fieldErrors = {};

  if (!new Set(["fv", "pv"]).has(mode)) {
    fieldErrors.mode = "Mode must be either 'fv' or 'pv'.";
  }

  if (!new Set(["ordinary", "due"]).has(timing)) {
    fieldErrors.timing = "Timing must be either 'ordinary' or 'due'.";
  }

  if (!Number.isFinite(payment) || payment <= 0) {
    fieldErrors.payment = "Payment each period must be greater than 0.";
  }

  if (!Number.isFinite(annualRate) || annualRate <= -100) {
    fieldErrors.annualRate = "Annual rate must be greater than -100%.";
  }

  if (!Number.isFinite(annualGrowthRate) || annualGrowthRate <= -100) {
    fieldErrors.annualGrowthRate = "Annual growth rate must be greater than -100%.";
  }

  if (!Number.isInteger(paymentsPerYear) || paymentsPerYear < 1 || paymentsPerYear > 365) {
    fieldErrors.paymentsPerYear = "Payments per year must be a whole number between 1 and 365.";
  }

  if (!isPerpetual) {
    if (!Number.isFinite(years) || years <= 0) {
      fieldErrors.years = "Number of years must be greater than 0 for finite annuities.";
    } else if (years > 10000) {
      fieldErrors.years = "Number of years is too large; use a smaller finite horizon or perpetual mode.";
    }
  }

  if (isPerpetual && mode && mode !== "pv") {
    fieldErrors.mode = "Perpetual annuity is only supported for present value (PV).";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors
      }
    });
  }

  const paymentDecimal = new Decimal(payment);
  const annualRateDecimal = new Decimal(annualRate);
  const annualGrowthRateDecimal = new Decimal(annualGrowthRate);
  const paymentsPerYearDecimal = new Decimal(paymentsPerYear);
  const yearsDecimal = isPerpetual ? null : new Decimal(years);

  const periodicRateDecimal = annualRateDecimal.div(100).div(paymentsPerYearDecimal);
  const periodicGrowthRateDecimal = powDecimal(
    new Decimal(1).plus(annualGrowthRateDecimal.div(100)),
    new Decimal(1).div(paymentsPerYearDecimal)
  ).minus(1);

  /* c8 ignore next 3 */
  if (!periodicRateDecimal.isFinite() || !periodicGrowthRateDecimal.isFinite()) {
    throw new AppError(422, "Rate conversion produced an invalid value. Check your inputs.");
  }

  if (isPerpetual && periodicRateDecimal.lte(periodicGrowthRateDecimal)) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          annualRate: "For perpetual PV, periodic discount rate must be strictly greater than periodic growth rate.",
          annualGrowthRate: "Growth is too high relative to discount rate for perpetual PV."
        }
      }
    });
  }

  return {
    mode,
    timing,
    payment: paymentDecimal.toFixed(6),
    annualRate: annualRateDecimal.toFixed(6),
    annualGrowthRate: annualGrowthRateDecimal.toFixed(6),
    years: yearsDecimal ? yearsDecimal.toFixed(4) : null,
    paymentsPerYear: paymentsPerYearDecimal.toNumber(),
    periodicRate: periodicRateDecimal.toFixed(12),
    periodicGrowthRate: periodicGrowthRateDecimal.toFixed(12),
    isPerpetual,
    paymentDecimal,
    annualRateDecimal,
    annualGrowthRateDecimal,
    yearsDecimal,
    paymentsPerYearDecimal,
    periodicRateDecimal,
    periodicGrowthRateDecimal
  };
}

export function calculateAnnuity(input) {
  const warnings = [];
  const rateDiff = input.periodicRateDecimal.minus(input.periodicGrowthRateDecimal).abs();

  if (rateDiff.lt(WARNING_RATE_EPSILON)) {
    warnings.push("Discount and growth rates are nearly equal; small rate changes can materially change value.");
  }

  if (!input.isPerpetual && input.mode === "pv" && input.periodicGrowthRateDecimal.gte(input.periodicRateDecimal)) {
    warnings.push("Finite PV can become very large when payment growth meets or exceeds discount over long horizons.");
  }

  let valueDecimal;
  let totalPeriodsDecimal = null;
  let totalPeriods = null;
  let years = null;

  if (input.isPerpetual) {
    valueDecimal = input.paymentDecimal.div(input.periodicRateDecimal.minus(input.periodicGrowthRateDecimal));
  } else {
    years = input.years;
    totalPeriodsDecimal = input.yearsDecimal.mul(input.paymentsPerYearDecimal);
    totalPeriods = totalPeriodsDecimal.toFixed(4);

    if (!totalPeriodsDecimal.isFinite() || !totalPeriodsDecimal.gt(0)) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            years: "Total periods must be greater than 0."
          }
        }
      });
    }

    if (totalPeriodsDecimal.gt(1200)) {
      warnings.push("Long horizons can produce very large values and are sensitive to rate assumptions.");
    }

    const one = new Decimal(1);
    const rateDelta = input.periodicRateDecimal.minus(input.periodicGrowthRateDecimal);
    const ratesAreEqual = rateDelta.abs().lt(RATE_EPSILON);

    if (input.mode === "fv") {
      if (ratesAreEqual) {
        valueDecimal = input.paymentDecimal
          .mul(totalPeriodsDecimal)
          .mul(powDecimal(one.plus(input.periodicRateDecimal), totalPeriodsDecimal.minus(1)));
      } else {
        const discountPow = powDecimal(one.plus(input.periodicRateDecimal), totalPeriodsDecimal);
        const growthPow = powDecimal(one.plus(input.periodicGrowthRateDecimal), totalPeriodsDecimal);
        valueDecimal = input.paymentDecimal.mul(discountPow.minus(growthPow).div(rateDelta));
      }
    } else if (ratesAreEqual) {
      valueDecimal = input.paymentDecimal.mul(totalPeriodsDecimal.div(one.plus(input.periodicRateDecimal)));
    } else {
      const growthOverDiscount = one.plus(input.periodicGrowthRateDecimal).div(one.plus(input.periodicRateDecimal));
      valueDecimal = input.paymentDecimal.mul(
        one.minus(powDecimal(growthOverDiscount, totalPeriodsDecimal)).div(rateDelta)
      );
    }
  }

  if (input.timing === "due") {
    valueDecimal = valueDecimal.mul(new Decimal(1).plus(input.periodicRateDecimal));
  }

  if (!valueDecimal.isFinite()) {
    throw new AppError(
      422,
      "Calculated value is too large to represent. Reduce years, payment, interest rate, or growth rate."
    );
  }

  return {
    mode: input.mode,
    timing: input.timing,
    payment: input.payment,
    annualRate: input.annualRate,
    annualGrowthRate: input.annualGrowthRate,
    years,
    paymentsPerYear: input.paymentsPerYear,
    periodicRate: input.periodicRate,
    periodicGrowthRate: input.periodicGrowthRate,
    totalPeriods,
    isPerpetual: input.isPerpetual,
    value: valueDecimal.toFixed(12),
    warnings,
    assumptions: ASSUMPTIONS
  };
}

export { ASSUMPTIONS };
