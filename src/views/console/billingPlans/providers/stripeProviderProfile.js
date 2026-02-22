import { defaultProviderProfile } from "./defaultProviderProfile.js";

function toText(value) {
  return String(value || "").trim();
}

function toMoneyLabel(amountMinor, currency, formatMoneyMinor) {
  const numericAmount = Number(amountMinor);
  const normalizedCurrency = toText(currency).toUpperCase();
  if (Number.isInteger(numericAmount) && numericAmount >= 0 && normalizedCurrency.length === 3) {
    return formatMoneyMinor(numericAmount, normalizedCurrency);
  }
  return "Custom amount";
}

function toIntervalLabel(interval, intervalCount) {
  const normalizedInterval = toText(interval).toLowerCase();
  const normalizedCount = Number(intervalCount);
  if (!normalizedInterval || !Number.isInteger(normalizedCount) || normalizedCount < 1) {
    return "one-time";
  }
  return normalizedCount === 1 ? normalizedInterval : `${normalizedCount} ${normalizedInterval}s`;
}

function toShortPriceId(value) {
  const normalized = toText(value);
  if (normalized.length <= 15) {
    return normalized;
  }
  return `${normalized.slice(0, 9)}...${normalized.slice(-3)}`;
}

const stripeProviderProfile = {
  ...defaultProviderProfile,
  key: "stripe",
  ui: {
    ...defaultProviderProfile.ui,
    corePriceDescription:
      "Stripe price decides the amount and billing interval. The fields below are auto-filled from the selected Stripe price.",
    catalogPriceLabel: "Stripe price",
    catalogPriceHint: "Pick a recurring Stripe Price (format: price_...).",
    catalogPriceNoDataLoading: "Loading Stripe prices...",
    catalogPriceNoDataEmpty: "No recurring Stripe prices found. Create one in Stripe Dashboard (Test mode) first.",
    productLabel: "Stripe product",
    showUnitAmountField: false,
    tablePriceColumnLabel: "Stripe price",
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
  applySelectedPriceToForm({ form, selectedPrice }) {
    if (!selectedPrice || !form) {
      return;
    }

    const productId = toText(selectedPrice?.productId);
    const currency = toText(selectedPrice?.currency).toUpperCase();
    const interval = toText(selectedPrice?.interval).toLowerCase();
    const intervalCount = Number(selectedPrice?.intervalCount);
    const unitAmountMinor = Number(selectedPrice?.unitAmountMinor);

    if (productId) {
      form.providerProductId = productId;
    }
    if (currency.length === 3) {
      form.currency = currency;
    }
    if (interval) {
      form.interval = interval;
    }
    if (Number.isInteger(intervalCount) && intervalCount > 0) {
      form.intervalCount = intervalCount;
    }
    if (Number.isInteger(unitAmountMinor) && unitAmountMinor >= 0) {
      form.unitAmountMinor = unitAmountMinor;
    }
  },
  requiresCatalogPriceSelection() {
    return true;
  },
  isCreateFormDerivedFromSelectedPrice(selectedPrice) {
    return Boolean(selectedPrice);
  }
};

export { stripeProviderProfile };
