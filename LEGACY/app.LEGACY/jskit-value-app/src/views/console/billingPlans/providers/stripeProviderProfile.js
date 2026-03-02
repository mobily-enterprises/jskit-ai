import { defaultProviderProfile } from "./defaultProviderProfile.js";
import { toText, toMoneyLabel, toIntervalLabel, toShortPriceId } from "./providerProfileHelpers.js";

const stripeProviderProfile = {
  ...defaultProviderProfile,
  key: "stripe",
  ui: {
    ...defaultProviderProfile.ui,
    corePriceDescription:
      "Select a recurring Stripe price. Plan amount and interval come from Stripe and are shown below as read-only details.",
    catalogPriceLabel: "Stripe price",
    catalogPriceHint: "Pick a recurring Stripe Price (price_...).",
    catalogPriceNoDataLoading: "Loading Stripe prices...",
    catalogPriceNoDataEmpty: "No recurring Stripe prices found. Create one in Stripe Dashboard first.",
    selectPriceRequiredError: "Select a recurring Stripe price."
  },
  selectCatalogPrices(prices = []) {
    return (Array.isArray(prices) ? prices : []).filter((entry) => {
      const id = toText(entry?.id);
      const interval = toText(entry?.interval).toLowerCase();
      const intervalCount = Number(entry?.intervalCount);
      return id && interval && Number.isInteger(intervalCount) && intervalCount > 0;
    });
  },
  formatCatalogPriceOption(price, { formatMoneyMinor }) {
    const id = toText(price?.id);
    const amountLabel = toMoneyLabel(price?.unitAmountMinor, price?.currency, formatMoneyMinor);
    const intervalLabel = toIntervalLabel(price?.interval, price?.intervalCount);
    const productName = toText(price?.productName);
    return `${toShortPriceId(id)} | ${amountLabel}/${intervalLabel}${productName ? ` | ${productName}` : ""}`;
  },
  requiresCatalogPriceSelection() {
    return true;
  }
};

export { stripeProviderProfile };
