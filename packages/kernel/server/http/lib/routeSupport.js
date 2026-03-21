import { normalizeArray, normalizeText } from "../../../shared/support/normalize.js";

function resolveRouteLabel({ method = "", path = "" } = {}) {
  const normalizedMethod = normalizeText(method, {
    fallback: "<unknown>"
  }).toUpperCase();
  const normalizedPath = normalizeText(path, {
    fallback: "<unknown>"
  });
  return `${normalizedMethod} ${normalizedPath}`;
}

function normalizeMiddlewareEntry(
  entry,
  { context = "middleware", index = -1, ErrorType = Error, entryLabel = "entry" } = {}
) {
  if (typeof entry === "function") {
    return entry;
  }

  const normalizedName = normalizeText(entry);
  if (normalizedName) {
    return normalizedName;
  }

  const indexSuffix = Number.isInteger(index) && index >= 0 ? ` at index ${index}` : "";
  const normalizedEntryLabel = String(entryLabel || "entry").trim() || "entry";
  throw new ErrorType(`${context} ${normalizedEntryLabel}${indexSuffix} must be a function or non-empty string.`);
}

function normalizeMiddlewareStack(
  value,
  { context = "middleware", ErrorType = Error, entryLabel = "entry", includeIndex = true } = {}
) {
  return normalizeArray(value).map((entry, index) =>
    normalizeMiddlewareEntry(entry, {
      context,
      index: includeIndex ? index : -1,
      ErrorType,
      entryLabel
    })
  );
}

export { resolveRouteLabel, normalizeMiddlewareEntry, normalizeMiddlewareStack };
