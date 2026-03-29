import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizePathname } from "@jskit-ai/kernel/shared/surface/paths";

function normalizeCrudLookupApiPath(value = "") {
  const normalized = normalizePathname(normalizeText(value));
  if (!normalized || normalized === "/") {
    return "";
  }

  return normalized;
}

function requireCrudLookupApiPath(value = "", { context = "crudLookupProvider" } = {}) {
  const normalizedPath = normalizeCrudLookupApiPath(value);
  if (!normalizedPath) {
    throw new Error(`${context} requires relation.apiPath.`);
  }

  return normalizedPath;
}

function resolveCrudLookupProviderToken(apiPath = "", { context = "crudLookupProvider" } = {}) {
  const normalizedPath = requireCrudLookupApiPath(apiPath, {
    context
  });
  return `crud.lookup.${normalizedPath.slice(1).toLowerCase().replace(/\//g, ".")}`;
}

export {
  normalizeCrudLookupApiPath,
  requireCrudLookupApiPath,
  resolveCrudLookupProviderToken
};
