const asCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

export function formatCurrency(value) {
  return asCurrency.format(Number(value) || 0);
}

export function formatDate(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString();
}

export function typeLabel(entry) {
  if (entry.isPerpetual) {
    return `${entry.mode === "fv" ? "FV" : "PV"} · ${entry.timing === "due" ? "Due" : "Ordinary"} · Perpetual`;
  }

  const base = `${entry.mode === "fv" ? "FV" : "PV"} · ${entry.timing === "due" ? "Due" : "Ordinary"}`;
  if (Math.abs(Number(entry.annualGrowthRate) || 0) < 1e-12) {
    return base;
  }

  return `${base} · +${Number(entry.annualGrowthRate).toFixed(2)}% growth`;
}

export function inputSummary(entry) {
  const horizonText = entry.isPerpetual ? "perpetual horizon" : `${Number(entry.years)} years`;
  return `${formatCurrency(entry.payment)}, ${Number(entry.annualRate).toFixed(2)}% rate, ${horizonText}, ${entry.paymentsPerYear}/year`;
}

export function resultSummary(result) {
  if (!result) {
    return "";
  }

  const growthText =
    Math.abs(Number(result.annualGrowthRate) || 0) < 1e-12
      ? "no payment growth"
      : `${Number(result.annualGrowthRate).toFixed(2)}% annual payment growth`;

  const timingText = result.timing === "due" ? "annuity due" : "ordinary annuity";
  const horizonText = result.isPerpetual
    ? "perpetual horizon"
    : `${Number(result.years)} years (${Number(result.totalPeriods).toFixed(2)} periods)`;

  return `${result.paymentsPerYear} payments/year, ${horizonText}, ${Number(result.annualRate).toFixed(
    2
  )}% annual rate, ${growthText}, ${timingText}.`;
}

export function resultWarnings(result) {
  if (!result || !Array.isArray(result.warnings)) {
    return [];
  }

  return result.warnings;
}
