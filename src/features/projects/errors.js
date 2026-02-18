function summarizeFieldErrors(fieldErrors) {
  if (!fieldErrors || typeof fieldErrors !== "object") {
    return "";
  }

  return Object.values(fieldErrors)
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
}

export function mapProjectsError(error, fallbackMessage) {
  const summary = summarizeFieldErrors(error?.fieldErrors);
  return {
    message: summary || String(error?.message || fallbackMessage || "Unable to process project request."),
    fieldErrorSummary: summary
  };
}

export const __testables = {
  summarizeFieldErrors
};
