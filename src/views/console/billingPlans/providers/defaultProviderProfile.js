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

const defaultProviderProfile = {
  key: "default",
  ui: {
    basePriceDescription: "Choose a catalog price for this provider.",
    catalogPriceLabel: "Catalog price",
    catalogPriceHint: "This controls what the customer is charged at checkout.",
    catalogPriceNoDataLoading: "Loading catalog prices...",
    catalogPriceNoDataEmpty: "No catalog prices found.",
    productLabel: "Provider product",
    autoFillHint: "Auto-filled from selected catalog price when available.",
    showUnitAmountField: true,
    amountLabel: "Unit amount (minor)",
    intervalLabel: "Interval",
    intervalCountLabel: "Interval count",
    tablePriceColumnLabel: "Catalog price",
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
  applySelectedPriceToForm() {},
  buildCreateBasePrice({ form, selectedPrice }) {
    const selectedProductId = toText(selectedPrice?.productId);
    const selectedCurrency = toText(selectedPrice?.currency).toUpperCase();
    const selectedInterval = toText(selectedPrice?.interval).toLowerCase();
    const selectedIntervalCount = Number(selectedPrice?.intervalCount);
    const selectedUnitAmountMinor = Number(selectedPrice?.unitAmountMinor);

    return {
      providerPriceId: toText(form.providerPriceId),
      providerProductId: selectedProductId || toText(form.providerProductId) || undefined,
      currency: selectedCurrency || toText(form.currency).toUpperCase(),
      unitAmountMinor:
        Number.isInteger(selectedUnitAmountMinor) && selectedUnitAmountMinor >= 0
          ? selectedUnitAmountMinor
          : Number(form.unitAmountMinor),
      interval: selectedInterval || toText(form.interval).toLowerCase(),
      intervalCount:
        Number.isInteger(selectedIntervalCount) && selectedIntervalCount > 0
          ? selectedIntervalCount
          : Number(form.intervalCount) || 1
    };
  },
  requiresCatalogPriceSelection() {
    return false;
  },
  isCreateFormDerivedFromSelectedPrice(selectedPrice) {
    return Boolean(selectedPrice);
  }
};

export { defaultProviderProfile };
