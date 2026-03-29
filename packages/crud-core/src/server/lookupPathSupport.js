import { normalizeCrudLookupApiPath } from "@jskit-ai/kernel/shared/support/crudLookup";

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
