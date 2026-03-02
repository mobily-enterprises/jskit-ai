function formatMoneyMinor(amountMinor, currency, { fallbackCurrency = "USD" } = {}) {
  const numericAmount = Number(amountMinor || 0);
  const normalizedCurrency =
    String(currency || "")
      .trim()
      .toUpperCase() || fallbackCurrency;
  const major = numericAmount / 100;

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: normalizedCurrency
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${normalizedCurrency}`;
  }
}

function formatInterval(interval, intervalCount, { emptyLabel = "month" } = {}) {
  const normalizedInterval = String(interval || "")
    .trim()
    .toLowerCase();
  const count = Math.max(1, Number(intervalCount) || 1);
  if (!normalizedInterval) {
    return emptyLabel;
  }

  return count === 1 ? normalizedInterval : `${count} ${normalizedInterval}s`;
}

export { formatMoneyMinor, formatInterval };
