import { normalizeCrudLookupApiPath } from "@jskit-ai/kernel/shared/support/crudLookup";
import { toSnakeCase } from "@jskit-ai/kernel/shared/support/stringCase";

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
  const tokenPart = normalizedPath
    .slice(1)
    .split("/")
    .map((segment) => toSnakeCase(segment))
    .filter(Boolean)
    .join(".");
  return `crud.lookup.${tokenPart}`;
}

export {
  normalizeCrudLookupApiPath,
  requireCrudLookupApiPath,
  resolveCrudLookupProviderToken
};
