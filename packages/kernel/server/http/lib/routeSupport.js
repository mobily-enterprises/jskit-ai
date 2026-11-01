import { normalizeText } from "../../../shared/support/normalize.js";

function resolveRouteLabel({ method = "", path = "" } = {}) {
  const normalizedMethod = normalizeText(method, {
    fallback: "<unknown>"
  }).toUpperCase();
  const normalizedPath = normalizeText(path, {
    fallback: "<unknown>"
  });
  return `${normalizedMethod} ${normalizedPath}`;
}

export { resolveRouteLabel };
