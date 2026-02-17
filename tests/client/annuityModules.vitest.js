import { describe, expect, it } from "vitest";
import {
  createDefaultAnnuityForm,
  modeOptions,
  pageSizeOptions,
  timingOptions
} from "../../src/features/annuity/formModel.js";
import {
  buildAnnuityPayload,
  validateAnnuityForm,
  __testables as requestTestables
} from "../../src/features/annuity/request.js";
import {
  mapCalculationError,
  mapHistoryError,
  __testables as errorTestables
} from "../../src/features/annuity/errors.js";
import {
  formatCurrency,
  formatDate,
  inputSummary,
  resultSummary,
  resultWarnings,
  typeLabel
} from "../../src/features/annuity/presentation.js";
import {
  getFirstPage,
  getNextPage,
  getPreviousPage,
  normalizePage,
  normalizePageSize
} from "../../src/utils/pagination.js";

describe("annuity form model", () => {
  it("exposes options and default form state", () => {
    expect(modeOptions).toEqual([
      { title: "Future Value (FV)", value: "fv" },
      { title: "Present Value (PV)", value: "pv" }
    ]);
    expect(timingOptions).toEqual([
      { title: "End of period (ordinary annuity)", value: "ordinary" },
      { title: "Beginning of period (annuity due)", value: "due" }
    ]);
    expect(pageSizeOptions).toEqual([10, 25, 50]);

    const defaults = createDefaultAnnuityForm();
    expect(defaults).toMatchObject({
      mode: "fv",
      payment: 500,
      annualRate: 6,
      annualGrowthRate: 3,
      isPerpetual: false,
      years: 20,
      paymentsPerYear: 12,
      timing: "ordinary",
      useGrowth: false
    });
  });
});

describe("annuity request helpers", () => {
  it("validates perpetual mode and builds normalized payload", () => {
    expect(validateAnnuityForm({ isPerpetual: true, mode: "fv" })).toEqual({
      ok: false,
      message: requestTestables.PERPETUAL_MODE_ERROR
    });

    expect(validateAnnuityForm({ isPerpetual: true, mode: "pv" })).toEqual({
      ok: true,
      message: ""
    });

    expect(
      buildAnnuityPayload({
        mode: "pv",
        payment: "500",
        annualRate: "6",
        annualGrowthRate: "3",
        years: "20",
        paymentsPerYear: "12",
        timing: "due",
        isPerpetual: false,
        useGrowth: true
      })
    ).toEqual({
      mode: "pv",
      payment: 500,
      annualRate: 6,
      annualGrowthRate: 3,
      years: 20,
      paymentsPerYear: 12,
      timing: "due",
      isPerpetual: false
    });

    expect(
      buildAnnuityPayload({
        mode: "pv",
        payment: 500,
        annualRate: 6,
        annualGrowthRate: 3,
        years: 20,
        paymentsPerYear: 12,
        timing: "ordinary",
        isPerpetual: true,
        useGrowth: false
      })
    ).toEqual({
      mode: "pv",
      payment: 500,
      annualRate: 6,
      annualGrowthRate: 0,
      years: undefined,
      paymentsPerYear: 12,
      timing: "ordinary",
      isPerpetual: true
    });

    expect(buildAnnuityPayload({})).toEqual({
      mode: "",
      payment: NaN,
      annualRate: NaN,
      annualGrowthRate: 0,
      years: NaN,
      paymentsPerYear: NaN,
      timing: "",
      isPerpetual: false
    });
  });
});

describe("annuity error mappers", () => {
  it("maps field errors and fallback messages", () => {
    expect(errorTestables.summarizeFieldErrors(null)).toBe("");
    expect(
      errorTestables.summarizeFieldErrors({
        one: "first",
        two: "",
        three: "second"
      })
    ).toBe("first second");

    expect(
      mapCalculationError({
        fieldErrors: {
          payment: "Payment must be positive.",
          years: "Years must be positive."
        }
      })
    ).toEqual({
      message: "Payment must be positive. Years must be positive.",
      fieldErrorSummary: "Payment must be positive. Years must be positive."
    });

    expect(mapCalculationError({ message: "Custom message" })).toEqual({
      message: "Custom message",
      fieldErrorSummary: ""
    });
    expect(mapCalculationError({})).toEqual({
      message: "Unable to calculate annuity.",
      fieldErrorSummary: ""
    });
    expect(
      mapCalculationError({
        message: "Validation failed.",
        fieldErrors: {
          payment: ""
        }
      })
    ).toEqual({
      message: "Validation failed.",
      fieldErrorSummary: ""
    });

    expect(mapHistoryError({ message: "History unavailable." })).toEqual({
      message: "History unavailable."
    });
    expect(mapHistoryError({})).toEqual({
      message: "Unable to load history."
    });
  });
});

describe("annuity presentation helpers", () => {
  it("formats labels, summaries, warnings, and dates", () => {
    expect(formatCurrency("500")).toBe("$500.00");
    expect(formatCurrency("not-a-number")).toBe("$0.00");
    expect(formatDate("not-a-date")).toBe("Unknown");
    expect(formatDate("2026-02-16T00:00:00.000Z")).not.toBe("Unknown");

    expect(
      typeLabel({
        mode: "pv",
        timing: "due",
        isPerpetual: true,
        annualGrowthRate: "0"
      })
    ).toContain("Perpetual");
    expect(
      typeLabel({
        mode: "fv",
        timing: "ordinary",
        isPerpetual: true,
        annualGrowthRate: "0"
      })
    ).toContain("FV");

    expect(
      typeLabel({
        mode: "fv",
        timing: "ordinary",
        isPerpetual: false,
        annualGrowthRate: "2.5"
      })
    ).toContain("growth");
    expect(
      typeLabel({
        mode: "fv",
        timing: "ordinary",
        isPerpetual: false,
        annualGrowthRate: "0"
      })
    ).toBe("FV · Ordinary");
    expect(
      typeLabel({
        mode: "pv",
        timing: "due",
        isPerpetual: false,
        annualGrowthRate: "0"
      })
    ).toBe("PV · Due");

    expect(
      inputSummary({
        payment: "500",
        annualRate: "6",
        isPerpetual: false,
        years: "20",
        paymentsPerYear: 12
      })
    ).toContain("20 years");
    expect(
      inputSummary({
        payment: "500",
        annualRate: "6",
        isPerpetual: true,
        years: "20",
        paymentsPerYear: 12
      })
    ).toContain("perpetual horizon");

    expect(resultSummary(null)).toBe("");
    expect(
      resultSummary({
        annualGrowthRate: "0",
        timing: "ordinary",
        isPerpetual: false,
        years: "20",
        totalPeriods: "240",
        paymentsPerYear: 12,
        annualRate: "6"
      })
    ).toContain("20 years");

    expect(
      resultSummary({
        annualGrowthRate: "3",
        timing: "due",
        isPerpetual: true,
        paymentsPerYear: 12,
        annualRate: "6"
      })
    ).toContain("perpetual horizon");

    expect(resultWarnings(null)).toEqual([]);
    expect(resultWarnings({ warnings: "not-array" })).toEqual([]);
    expect(resultWarnings({ warnings: ["Large value"] })).toEqual(["Large value"]);
  });
});

describe("pagination helpers", () => {
  it("normalizes and transitions pages without repeating guard logic", () => {
    expect(normalizePage(0)).toBe(1);
    expect(normalizePage(3.5, 7)).toBe(7);
    expect(normalizePageSize(0, 25)).toBe(1);
    expect(normalizePageSize("abc", 25)).toBe(25);
    expect(getFirstPage()).toBe(1);

    expect(getPreviousPage({ page: 1, isLoading: false })).toBe(1);
    expect(getPreviousPage({ page: 3, isLoading: false })).toBe(2);
    expect(getPreviousPage({ page: 3, isLoading: true })).toBe(3);

    expect(getNextPage({ page: 1, totalPages: 3, isLoading: false })).toBe(2);
    expect(getNextPage({ page: 3, totalPages: 3, isLoading: false })).toBe(3);
    expect(getNextPage({ page: 2, totalPages: 3, isLoading: true })).toBe(2);
  });
});
