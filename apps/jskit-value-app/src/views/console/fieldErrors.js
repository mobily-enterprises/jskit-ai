function toFieldErrors(value) {
  if (!value || typeof value !== "object") {
    return {};
  }
  if (value.fieldErrors && typeof value.fieldErrors === "object") {
    return value.fieldErrors;
  }

  const details = value.details && typeof value.details === "object" ? value.details : {};
  if (details.fieldErrors && typeof details.fieldErrors === "object") {
    return details.fieldErrors;
  }

  return {};
}

export { toFieldErrors };
