export function toErrorMessage(error, fallback) {
  if (error?.fieldErrors && typeof error.fieldErrors === "object") {
    const details = Array.from(
      new Set(
        Object.values(error.fieldErrors)
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
    );

    if (details.length > 0) {
      return details.join(" ");
    }
  }

  return String(error?.message || fallback);
}
