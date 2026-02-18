import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: {
    annuity: {
      calculate: vi.fn()
    }
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

vi.mock("../../src/services/api/index.js", () => ({
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
    mocks.api.annuity.calculate.mockReset();
    mocks.handleUnauthorizedError.mockReset();
    mocks.handleUnauthorizedError.mockResolvedValue(false);
    mocks.onCalculated.mockReset();
    mocks.onCalculated.mockResolvedValue(undefined);
    mocks.mutationPending = null;
  });

  it("validates perpetuity mode and performs successful calculations", async () => {
    const wrapper = mount(TestHarness);

    wrapper.vm.state.form.isPerpetual = true;
    wrapper.vm.state.form.mode = "fv";
    await wrapper.vm.actions.calculate();

    expect(wrapper.vm.state.error).toContain("Perpetual calculations are only supported");
    expect(mocks.api.annuity.calculate).not.toHaveBeenCalled();

    wrapper.vm.state.form.mode = "pv";
    wrapper.vm.state.form.isPerpetual = false;
    mocks.api.annuity.calculate.mockResolvedValueOnce({
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

    await wrapper.vm.actions.calculate();

    expect(wrapper.vm.state.result.value).toBe("10");
    expect(wrapper.vm.state.warnings).toEqual(["warn-1"]);
    expect(wrapper.vm.state.resultSummary).toContain("1 years");
    expect(wrapper.vm.state.resultWarnings).toEqual(["warn-1"]);
    expect(mocks.onCalculated).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.meta.modeOptions.length).toBeGreaterThan(0);
    expect(wrapper.vm.meta.timingOptions.length).toBeGreaterThan(0);

    mocks.api.annuity.calculate.mockResolvedValueOnce({
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
    await wrapper.vm.actions.calculate();

    expect(wrapper.vm.state.warnings).toEqual([]);
  });

  it("maps unauthorized and non-unauthorized errors", async () => {
    const wrapper = mount(TestHarness);

    mocks.api.annuity.calculate.mockRejectedValueOnce({
      status: 401,
      message: "Authentication required."
    });
    mocks.handleUnauthorizedError.mockResolvedValueOnce(true);

    await wrapper.vm.actions.calculate();
    expect(wrapper.vm.state.error).toBe("");

    mocks.api.annuity.calculate.mockRejectedValueOnce({
      status: 400,
      message: "Validation failed.",
      fieldErrors: {
        payment: "Payment must be positive.",
        years: "Years must be positive."
      }
    });
    mocks.handleUnauthorizedError.mockResolvedValueOnce(false);

    await wrapper.vm.actions.calculate();
    expect(wrapper.vm.state.error).toContain("Payment must be positive.");
    expect(wrapper.vm.state.error).toContain("Years must be positive.");

    mocks.api.annuity.calculate.mockRejectedValueOnce({
      status: 500,
      message: "Server unavailable."
    });
    mocks.handleUnauthorizedError.mockResolvedValueOnce(false);

    await wrapper.vm.actions.calculate();
    expect(wrapper.vm.state.error).toBe("Server unavailable.");
  });

  it("resets form state", () => {
    const wrapper = mount(TestHarness);

    wrapper.vm.state.form.payment = 999;
    wrapper.vm.state.form.useGrowth = true;
    wrapper.vm.state.error = "x";
    wrapper.vm.state.warnings = ["x"];
    wrapper.vm.state.result = { value: "100", warnings: ["w"] };

    wrapper.vm.actions.resetForm();

    expect(wrapper.vm.state.form.payment).toBe(500);
    expect(wrapper.vm.state.form.useGrowth).toBe(false);
    expect(wrapper.vm.state.error).toBe("");
    expect(wrapper.vm.state.warnings).toEqual([]);
    expect(wrapper.vm.state.result).toBeNull();
  });

  it("reports pending mutation state", async () => {
    const { ref } = await import("vue");
    mocks.mutationPending = ref(true);
    const wrapper = mount(TestHarness);

    expect(wrapper.vm.state.calculating).toBe(true);
  });
});
