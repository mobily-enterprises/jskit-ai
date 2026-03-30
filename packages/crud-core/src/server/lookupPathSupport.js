import {
  normalizeCrudLookupApiPath,
  normalizeCrudLookupNamespace
} from "@jskit-ai/kernel/shared/support/crudLookup";
import { toSnakeCase } from "@jskit-ai/kernel/shared/support/stringCase";

function requireCrudLookupNamespace(value = "", { context = "crudLookupProvider" } = {}) {
  const normalizedNamespace = normalizeCrudLookupNamespace(value);
  if (!normalizedNamespace) {
    throw new Error(`${context} requires relation.namespace.`);
  }

  return normalizedNamespace;
}

function resolveCrudLookupProviderToken(namespace = "", { context = "crudLookupProvider" } = {}) {
  const normalizedNamespace = requireCrudLookupNamespace(namespace, {
    context
  });
  const tokenPart = normalizedNamespace
    .split("/")
    .map((segment) => toSnakeCase(segment))
    .filter(Boolean)
    .join(".");
  return `crud.lookup.${tokenPart}`;
}

function resolveCrudLookupNamespaceFromRelation(relation = {}, { context = "crudLookupProvider" } = {}) {
  const normalizedNamespace =
    normalizeCrudLookupNamespace(relation?.namespace) ||
    normalizeCrudLookupNamespace(relation?.apiPath);
  if (!normalizedNamespace) {
    throw new Error(`${context} requires relation.namespace.`);
  }

  return normalizedNamespace;
}

export {
  normalizeCrudLookupApiPath,
  normalizeCrudLookupNamespace,
  requireCrudLookupNamespace,
  resolveCrudLookupNamespaceFromRelation,
  resolveCrudLookupProviderToken
};
