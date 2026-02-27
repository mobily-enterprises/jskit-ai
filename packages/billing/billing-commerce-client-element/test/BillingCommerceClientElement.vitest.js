import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import BillingCommerceClientElement from "../src/shared/BillingCommerceClientElement.vue";

function mountElement(options) {
  return mount(BillingCommerceClientElement, {
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
    catalogItems: [
      {
        value: "price_1",
        title: "Starter credits",
        subtitle: "$10.00"
      }
    ],
    paymentLinkLoading: false,
    buyingCatalogPriceId: "",
    lastPaymentLinkUrl: "https://example.com/pay",
    purchasesError: "",
    purchasesLoading: false,
    purchaseItems: [
      {
        id: 1,
        title: "Plan charge",
        purchasedAt: "2026-02-20T00:00:00.000Z",
        kindLabel: "Plan charge",
        amountMinor: 500,
        quantity: 1,
        currency: "USD"
      }
    ],
    limitationsError: "",
    limitationsLoading: false,
    limitationItems: [
      {
        code: "tokens.monthly",
        overLimit: false,
        consumedAmount: 20,
        grantedAmount: 100,
        hardLimitAmount: 100,
        effectiveAmount: 80,
        lockState: "none",
        usagePercent: 20,
        unit: "tokens",
        nextChangeAt: "2026-03-01T00:00:00.000Z"
      }
    ],
    limitationsGeneratedAt: "2026-02-24T00:00:00.000Z",
    limitationsStale: false
  };

  const actions = {
    buyCatalogItem: vi.fn(async () => {})
  };

  return {
    meta: {
      formatDateOnly: vi.fn(() => "Feb 24, 2026"),
      formatMoneyMinor: vi.fn(() => "$5.00")
    },
    state,
    actions,
    ...overrides
  };
}

describe("BillingCommerceClientElement", () => {
  it("renders commerce and usage sections in expected order", () => {
    const wrapper = mountElement({ props: createBaseProps() });

    const sourceText = wrapper.text();
    const oneOffIndex = sourceText.indexOf("One-off purchases");
    const purchaseHistoryIndex = sourceText.indexOf("Purchase history");
    const usageLimitsIndex = sourceText.indexOf("Usage limits");

    expect(oneOffIndex).toBeGreaterThan(-1);
    expect(purchaseHistoryIndex).toBeGreaterThan(-1);
    expect(usageLimitsIndex).toBeGreaterThan(purchaseHistoryIndex);
    expect(usageLimitsIndex).toBeGreaterThan(oneOffIndex);
  });

  it("emits checkout and action events when catalog item is selected", async () => {
    const props = createBaseProps();
    const wrapper = mountElement({ props });

    await wrapper.get(".one-off-tile").trigger("click");

    expect(props.actions.buyCatalogItem).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("checkout:open")?.length).toBe(1);
    expect(wrapper.emitted("interaction")?.length).toBeGreaterThan(0);
    expect(wrapper.emitted("action:started")?.length).toBe(1);
    expect(wrapper.emitted("action:succeeded")?.length).toBe(1);
  });

  it("supports slots and variant classes", () => {
    const wrapper = mountElement({
      props: createBaseProps({
        variant: {
          layout: "compact",
          surface: "plain",
          density: "compact",
          tone: "emphasized"
        }
      }),
      slots: {
        "usage-limits-extra": "<div data-testid='usage-extra-slot'>Extra</div>"
      }
    });

    expect(wrapper.get('[data-testid="usage-extra-slot"]').exists()).toBe(true);
    expect(wrapper.classes()).toContain("billing-commerce-client-element--layout-compact");
    expect(wrapper.classes()).toContain("billing-commerce-client-element--surface-plain");
  });
});
