import { describe, expect, it } from "vitest";

import { resolveBillingPlanProviderProfile } from "../../src/views/console/billingPlans/providers/index.js";

describe("console billing plan provider profiles", () => {
  it("resolves stripe profile when provider is stripe", () => {
    const profile = resolveBillingPlanProviderProfile("stripe");
    expect(profile.key).toBe("stripe");
    expect(profile.ui.catalogPriceLabel).toBe("Stripe price");
    expect(profile.ui.showUnitAmountField).toBe(false);
  });

  it("falls back to default profile for unknown providers", () => {
    const profile = resolveBillingPlanProviderProfile("acmepay");
    expect(profile.key).toBe("default");
    expect(profile.ui.catalogPriceLabel).toBe("Catalog price");
  });

  it("stripe profile filters selectable prices to recurring entries", () => {
    const profile = resolveBillingPlanProviderProfile("stripe");
    const selected = profile.selectCatalogPrices([
      {
        id: "price_monthly",
        interval: "month",
        intervalCount: 1
      },
      {
        id: "price_one_time",
        interval: null,
        intervalCount: null
      }
    ]);

    expect(selected.length).toBe(1);
    expect(selected[0].id).toBe("price_monthly");
  });
});
