import {
  normalizeCrudLookupApiPath,
  normalizeCrudLookupNamespace
} from "@jskit-ai/resource-crud-core/shared/crudLookup";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { toSnakeCase } from "@jskit-ai/kernel/shared/support/stringCase";

const LOOKUP_OWNERSHIP_FILTER_VALUES = Object.freeze([
  "public",
  "user",
  "workspace",
  "workspace_user"
]);
const LOOKUP_OWNERSHIP_FILTER_SET = new Set(LOOKUP_OWNERSHIP_FILTER_VALUES);

/**
 * The ownership filter a lookup's records use, or "" when it names none.
 * @param {unknown} value
 * @param {{ context: string }} labels The name its error gives the value.
 */
function normalizeLookupOwnershipFilter(value, { context }) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return "";
  }

  if (LOOKUP_OWNERSHIP_FILTER_SET.has(normalized)) {
    return normalized;
  }

  throw new TypeError(
    `${context} must be one of: ${LOOKUP_OWNERSHIP_FILTER_VALUES.join(", ")}.`
  );
}

function requireCrudLookupNamespace(value = "", { context = "crudLookup" } = {}) {
  const normalizedNamespace = normalizeCrudLookupNamespace(value);
  if (!normalizedNamespace) {
    throw new Error(`${context} requires relation.namespace.`);
  }

  return normalizedNamespace;
}

function resolveCrudLookupToken(namespace = "", { context = "crudLookup" } = {}) {
  const normalizedNamespace = requireCrudLookupNamespace(namespace, {
    context
  });
  const tokenPart = normalizedNamespace
    .split("/")
    .map((segment) => toSnakeCase(segment))
    .filter(Boolean)
    .join(".");
  return `lookup.${tokenPart}`;
}

function resolveCrudLookupNamespaceFromRelation(relation = {}, { context = "crudLookup" } = {}) {
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
  normalizeLookupOwnershipFilter,
  requireCrudLookupNamespace,
  resolveCrudLookupNamespaceFromRelation,
  resolveCrudLookupToken
};
