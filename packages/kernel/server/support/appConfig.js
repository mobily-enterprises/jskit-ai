import { normalizeObject } from "../../shared/support/normalize.js";

function resolveAppConfig(scope = null) {
  const source = scope && typeof scope === "object" ? scope : null;
  if (!source || typeof source.has !== "function" || typeof source.make !== "function") {
    return {};
  }
  if (!source.has("appConfig")) {
    return {};
  }

  return normalizeObject(source.make("appConfig"));
}

export { resolveAppConfig };
