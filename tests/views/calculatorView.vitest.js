import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  api: {
    calculate: vi.fn(),
    history: vi.fn()
  },
  authStore: {
    setSignedOut: vi.fn()
  },
  historyData: null,
  historyError: null,
  historyPending: null,
  historyFetching: null,
  historyRefetch: vi.fn(async () => undefined),
  invalidateQueries: vi.fn(async () => undefined)
}));

vi.mock("@tanstack/vue-router", () => ({
  useNavigate: () => mocks.navigate
}));

vi.mock("@tanstack/vue-query", () => ({
  useMutation: ({ mutationFn }) => ({
    isPending: ref(false),
    mutateAsync: (payload) => mutationFn(payload)
  }),
  useQuery: () => ({
    data: mocks.historyData,
    error: mocks.historyError,
    isPending: mocks.historyPending,
    isFetching: mocks.historyFetching,
    refetch: mocks.historyRefetch
  }),
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries
  })
}));

vi.mock("../../src/services/api.js", () => ({
  api: mocks.api
}));

vi.mock("../../src/stores/authStore.js", () => ({
  useAuthStore: () => mocks.authStore
}));

import CalculatorView from "../../src/views/CalculatorView.vue";

function buildAnnuityResponse(overrides = {}) {
  return {
    historyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    mode: "fv",
    timing: "ordinary",
    payment: "500.000000",
    annualRate: "6.000000",
    annualGrowthRate: "0.000000",
    years: "20.0000",
    paymentsPerYear: 12,
    periodicRate: "0.005000000000",
    periodicGrowthRate: "0.000000000000",
    totalPeriods: "240.0000",
    isPerpetual: false,
    value: "230581.364674000000",
    warnings: [],
    assumptions: {
      rateConversion: "Periodic discount rate = annualRate/100/paymentsPerYear.",
      timing: "Ordinary annuity assumes end-of-period payments.",
      growingAnnuity: "Growing annuity assumes a constant annual growth rate.",
      perpetuity: "Perpetual present value requires discount > growth."
    },
    ...overrides
  };
}

function mountView() {
  return mount(CalculatorView, {
    global: {
      stubs: {
        "v-app": true,
        "v-main": true,
        "v-container": true,
        "v-row": true,
        "v-col": true,
        "v-card": true,
        "v-card-item": true,
        "v-card-title": true,
        "v-card-subtitle": true,
        "v-card-text": true,
        "v-divider": true,
        "v-form": true,
        "v-select": true,
        "v-text-field": true,
        "v-checkbox": true,
        "v-expansion-panels": true,
        "v-expansion-panel": true,
        "v-expansion-panel-title": true,
        "v-expansion-panel-text": true,
        "v-alert": true,
        "v-btn": true,
        "v-chip": true,
        "v-table": true,
        "v-spacer": true,
        "v-btn-group": true
      }
    }
  });
}

describe("CalculatorView", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.api.calculate.mockReset();
    mocks.api.history.mockReset();
    mocks.authStore.setSignedOut.mockReset();
    mocks.historyData = ref({
      entries: [],
      page: 1,
      pageSize: 10,
      total: 0,
      totalPages: 1
    });
    mocks.historyError = ref(null);
    mocks.historyPending = ref(false);
    mocks.historyFetching = ref(false);
    mocks.historyRefetch.mockReset();
    mocks.invalidateQueries.mockReset();
  });

  it("calculates annuity and invalidates history cache", async () => {
    mocks.api.calculate.mockResolvedValue(buildAnnuityResponse());

    const wrapper = mountView();
    await wrapper.vm.calculate();

    expect(mocks.api.calculate).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["history"] });
    expect(wrapper.vm.result.value).toBe("230581.364674000000");
  });

  it("handles unauthorized history errors by signing out and redirecting", async () => {
    const wrapper = mountView();

    mocks.historyError.value = {
      status: 401,
      message: "Authentication required."
    };

    await nextTick();

    expect(mocks.authStore.setSignedOut).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/login", replace: true });
    wrapper.unmount();
  });

  it("changes history page with next/previous helpers", async () => {
    const wrapper = mountView();
    mocks.historyData.value.totalPages = 3;
    await nextTick();

    expect(wrapper.vm.historyPage).toBe(1);
    wrapper.vm.goToNextPage();
    expect(wrapper.vm.historyPage).toBe(2);
    wrapper.vm.goToPreviousPage();
    expect(wrapper.vm.historyPage).toBe(1);
  });
});
