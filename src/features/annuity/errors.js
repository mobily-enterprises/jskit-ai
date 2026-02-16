function summarizeFieldErrors(fieldErrors) {
  if (!fieldErrors || typeof fieldErrors !== "object") {
    return "";
  }

  const details = Object.values(fieldErrors)
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (details.length === 0) {
    return "";
  }

  return details.join(" ");
}

export function mapHistoryError(error) {
  return {
    message: String(error?.message || "Unable to load history.")
  };
}

export function mapCalculationError(error) {
  const summary = summarizeFieldErrors(error?.fieldErrors);
  return {
    message: summary || String(error?.message || "Unable to calculate annuity."),
    fieldErrorSummary: summary
  };
}

export const __testables = {
  summarizeFieldErrors
};
