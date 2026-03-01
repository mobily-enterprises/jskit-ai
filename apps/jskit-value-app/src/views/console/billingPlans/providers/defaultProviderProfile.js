import { toText, toMoneyLabel, toIntervalLabel, toShortPriceId } from "./providerProfileHelpers.js";

function toOptionalCurrency(value) {
  const normalized = toText(value).toUpperCase();
  return normalized.length === 3 ? normalized : undefined;
}

function toOptionalNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function toOptionalPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined;
  }
  return parsed;
}

const defaultProviderProfile = {
  key: "default",
  ui: {
    corePriceDescription: "Choose a catalog price for this provider.",
    catalogPriceLabel: "Catalog price",
    catalogPriceHint: "This controls what the customer is charged at checkout.",
    catalogPriceNoDataLoading: "Loading catalog prices...",
    catalogPriceNoDataEmpty: "No catalog prices found.",
    selectPriceRequiredError: "Select a catalog price."
  },
  selectCatalogPrices(prices = []) {
    return (Array.isArray(prices) ? prices : []).filter((entry) => toText(entry?.id));
  },
  formatCatalogPriceOption(price, { formatMoneyMinor }) {
    const id = toText(price?.id);
    const amountLabel = toMoneyLabel(price?.unitAmountMinor, price?.currency, formatMoneyMinor);
    const intervalLabel = toIntervalLabel(price?.interval, price?.intervalCount);
    const productName = toText(price?.productName);
    return `${toShortPriceId(id)} | ${amountLabel}/${intervalLabel}${productName ? ` | ${productName}` : ""}`;
  },
  buildCorePricePayload({ form, selectedPrice }) {
    const providerPriceId = toText(form?.providerPriceId || selectedPrice?.id);
    return {
      providerPriceId,
      providerProductId: toText(selectedPrice?.productId) || undefined,
      currency: toOptionalCurrency(selectedPrice?.currency),
      unitAmountMinor: toOptionalNonNegativeInteger(selectedPrice?.unitAmountMinor),
      interval: toText(selectedPrice?.interval).toLowerCase() || undefined,
      intervalCount: toOptionalPositiveInteger(selectedPrice?.intervalCount)
    };
  },
  requiresCatalogPriceSelection() {
    return false;
  }
};

export { defaultProviderProfile };
