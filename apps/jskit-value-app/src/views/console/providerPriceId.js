function shortenProviderPriceId(value) {
  const normalized = String(value || "").trim();
  if (normalized.length <= 15) {
    return normalized;
  }

  return `${normalized.slice(0, 9)}...${normalized.slice(-3)}`;
}

export { shortenProviderPriceId };
