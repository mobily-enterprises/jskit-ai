import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import BillingPlanClientElement from "../src/shared/BillingPlanClientElement.vue";

function mountElement(options) {
  return mount(BillingPlanClientElement, {
    global: {
      config: {
        warnHandler: () => {}
      }
    },
    ...options
  });
}

function createBaseProps(overrides = {}) {
  const state = {
    currentPlan: {
      code: "pro",
      name: "Pro",
      description: "Pro plan",
      corePrice: {
        unitAmountMinor: 2500,
        currency: "USD",
        interval: "month"
      }
    },
    currentPlanHasNoExpiry: false,
    currentPeriodEndAt: "2026-06-01T00:00:00.000Z",
    canCancelCurrentPlan: true,
    cancelCurrentPlanLoading: false,
    pendingChange: true,
    nextPlan: {
      code: "free",
      name: "Free"
    },
    nextEffectiveAt: "2026-07-01T00:00:00.000Z",
    cancelPlanChangeLoading: false,
    planOptions: [
      {
        value: "free",
        title: "Free"
      },
      {
        value: "pro",
        title: "Pro"
      }
    ],
    selectedPlanCode: "free",
    selectedTargetPlan: {
      code: "free",
      description: "Downgrade"
    },
    planChangeLoading: false,
    paymentPolicy: "required_now",
    lastCheckoutUrl: "https://checkout.example.com/session",
    actionError: "",
    actionSuccess: "",
    error: ""
  };

  const actions = {
    submitPlanChange: vi.fn(async () => {}),
    cancelCurrentPlan: vi.fn(async () => {}),
    cancelPendingPlanChange: vi.fn(async () => {})
  };

  return {
    meta: {
      formatDateOnly: vi.fn((value) => `date:${value}`),
      formatMoneyMinor: vi.fn((amountMinor, currency) => `${currency}:${amountMinor}`)
    },
    state,
    actions,
    ...overrides
  };
}

describe("BillingPlanClientElement", () => {
  it("renders package-owned billing plan sections", () => {
    const wrapper = mountElement({
      props: createBaseProps()
    });

    expect(wrapper.text()).toContain("Workspace billing");
    expect(wrapper.text()).toContain("Current plan");
    expect(wrapper.text()).toContain("Scheduled change");
    expect(wrapper.text()).toContain("Change core plan");
  });

  it("wires actions and emits domain events", async () => {
    const props = createBaseProps();
    const wrapper = mountElement({
      props
    });

    await wrapper.get('[data-testid="billing-plan-submit"]').trigger("click");
    await wrapper.get('[data-testid="billing-plan-cancel-current"]').trigger("click");
    await wrapper.get('[data-testid="billing-plan-cancel-scheduled"]').trigger("click");
    await wrapper.get('[data-testid="billing-plan-checkout-link"]').trigger("click");

    expect(props.actions.submitPlanChange).toHaveBeenCalledTimes(1);
    expect(props.actions.cancelCurrentPlan).toHaveBeenCalledTimes(1);
    expect(props.actions.cancelPendingPlanChange).toHaveBeenCalledTimes(1);

    expect(wrapper.emitted("plan-change:submit")?.length).toBe(1);
    expect(wrapper.emitted("plan-change:cancel-current")?.length).toBe(1);
    expect(wrapper.emitted("plan-change:cancel-scheduled")?.length).toBe(1);
    expect(wrapper.emitted("checkout:open")?.length).toBe(1);
    expect(wrapper.emitted("interaction")?.length).toBeGreaterThan(0);
    expect(wrapper.emitted("action:started")?.length).toBe(3);
    expect(wrapper.emitted("action:succeeded")?.length).toBe(3);
  });

  it("supports slots and variant class customization", () => {
    const wrapper = mountElement({
      props: createBaseProps({
        variant: {
          layout: "compact",
          surface: "plain",
          density: "compact",
          emphasis: "quiet"
        }
      }),
      slots: {
        "header-extra": "<div data-testid='header-extra-slot'>Header extra</div>",
        "footer-extra": "<div data-testid='footer-extra-slot'>Footer extra</div>"
      }
    });

    expect(wrapper.get('[data-testid="header-extra-slot"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="footer-extra-slot"]').exists()).toBe(true);
    expect(wrapper.classes()).toContain("billing-plan-client-element--layout-compact");
    expect(wrapper.classes()).toContain("billing-plan-client-element--surface-plain");
  });
});
