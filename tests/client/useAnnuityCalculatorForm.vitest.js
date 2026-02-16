import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: {
    calculateAnnuity: vi.fn()
  },
  handleUnauthorizedError: vi.fn(async () => false),
  mutationPending: null,
  onCalculated: vi.fn(async () => undefined)
}));

vi.mock("@tanstack/vue-query", async () => {
  const vue = await import("vue");
  return {
    useMutation: ({ mutationFn }) => ({
      isPending: mocks.mutationPending || vue.ref(false),
      mutateAsync: (payload) => mutationFn(payload)
    })
  };
});

vi.mock("../../src/services/api.js", () => ({
  api: mocks.api
}));

vi.mock("../../src/composables/useAuthGuard.js", () => ({
  useAuthGuard: () => ({
    handleUnauthorizedError: mocks.handleUnauthorizedError
  })
}));

import { useAnnuityCalculatorForm } from "../../src/components/annuity-calculator-form/useAnnuityCalculatorForm.js";

const TestHarness = defineComponent({
  name: "UseAnnuityFormHarness",
  setup() {
    return useAnnuityCalculatorForm({ onCalculated: mocks.onCalculated });
  },
  template: "<div />"
});

describe("useAnnuityCalculatorForm", () => {
  beforeEach(() => {
    mocks.api.calculateAnnuity.mockReset();
    mocks.handleUnauthorizedError.mockReset();
    mocks.handleUnauthorizedError.mockResolvedValue(false);
    mocks.onCalculated.mockReset();
    mocks.onCalculated.mockResolvedValue(undefined);
    mocks.mutationPending = null;
  });

  it("validates perpetuity mode and performs successful calculations", async () => {
    const wrapper = mount(TestHarness);

    wrapper.vm.form.isPerpetual = true;
    wrapper.vm.form.mode = "fv";
    await wrapper.vm.calculate();

    expect(wrapper.vm.calcError).toContain("Perpetual calculations are only supported");
    expect(mocks.api.calculateAnnuity).not.toHaveBeenCalled();

    wrapper.vm.form.mode = "pv";
    wrapper.vm.form.isPerpetual = false;
    mocks.api.calculateAnnuity.mockResolvedValueOnce({
      value: "10",
      warnings: ["warn-1"],
      annualGrowthRate: "0",
      timing: "ordinary",
      isPerpetual: false,
      years: "1",
      totalPeriods: "12",
      paymentsPerYear: 12,
      annualRate: "6"
    });

    await wrapper.vm.calculate();

    expect(wrapper.vm.result.value).toBe("10");
    expect(wrapper.vm.calcWarnings).toEqual(["warn-1"]);
    expect(wrapper.vm.resultSummary).toContain("1 years");
    expect(wrapper.vm.resultWarnings).toEqual(["warn-1"]);
    expect(mocks.onCalculated).toHaveBeenCalledTimes(1);

    mocks.api.calculateAnnuity.mockResolvedValueOnce({
      value: "11",
      warnings: null,
      annualGrowthRate: "0",
      timing: "ordinary",
      isPerpetual: false,
      years: "1",
      totalPeriods: "12",
      paymentsPerYear: 12,
      annualRate: "6"
    });
    await wrapper.vm.calculate();

    expect(wrapper.vm.calcWarnings).toEqual([]);
  });

  it("maps unauthorized and non-unauthorized errors", async () => {
    const wrapper = mount(TestHarness);

    mocks.api.calculateAnnuity.mockRejectedValueOnce({
      status: 401,
      message: "Authentication required."
    });
    mocks.handleUnauthorizedError.mockResolvedValueOnce(true);

    await wrapper.vm.calculate();
    expect(wrapper.vm.calcError).toBe("");

    mocks.api.calculateAnnuity.mockRejectedValueOnce({
      status: 400,
      message: "Validation failed.",
      fieldErrors: {
        payment: "Payment must be positive.",
        years: "Years must be positive."
      }
    });
    mocks.handleUnauthorizedError.mockResolvedValueOnce(false);

    await wrapper.vm.calculate();
    expect(wrapper.vm.calcError).toContain("Payment must be positive.");
    expect(wrapper.vm.calcError).toContain("Years must be positive.");

    mocks.api.calculateAnnuity.mockRejectedValueOnce({
      status: 500,
      message: "Server unavailable."
    });
    mocks.handleUnauthorizedError.mockResolvedValueOnce(false);

    await wrapper.vm.calculate();
    expect(wrapper.vm.calcError).toBe("Server unavailable.");
  });

  it("resets form state and exposes display helpers", () => {
    const wrapper = mount(TestHarness);

    wrapper.vm.form.payment = 999;
    wrapper.vm.form.useGrowth = true;
    wrapper.vm.calcError = "x";
    wrapper.vm.calcWarnings = ["x"];
    wrapper.vm.result = { value: "100", warnings: ["w"] };

    wrapper.vm.resetForm();

    expect(wrapper.vm.form.payment).toBe(500);
    expect(wrapper.vm.form.useGrowth).toBe(false);
    expect(wrapper.vm.calcError).toBe("");
    expect(wrapper.vm.calcWarnings).toEqual([]);
    expect(wrapper.vm.result).toBeNull();

    expect(wrapper.vm.formatDate("not-a-date")).toBe("Unknown");
    expect(wrapper.vm.formatCurrency("500")).toBe("$500.00");
    expect(
      wrapper.vm.typeLabel({
        mode: "pv",
        timing: "due",
        isPerpetual: true,
        annualGrowthRate: "0"
      })
    ).toContain("Perpetual");
    expect(
      wrapper.vm.inputSummary({
        payment: "500",
        annualRate: "6",
        isPerpetual: false,
        years: "20",
        paymentsPerYear: 12
      })
    ).toContain("20 years");
  });

  it("reports pending mutation state", async () => {
    const { ref } = await import("vue");
    mocks.mutationPending = ref(true);
    const wrapper = mount(TestHarness);

    expect(wrapper.vm.calculating).toBe(true);
  });
});
