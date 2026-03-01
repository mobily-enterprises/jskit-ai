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

export { toText, toMoneyLabel, toIntervalLabel, toShortPriceId };
