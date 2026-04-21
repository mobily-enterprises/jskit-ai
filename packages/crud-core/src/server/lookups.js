import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  resolveCrudLookupToken,
  resolveCrudLookupNamespaceFromRelation
} from "./lookupPathSupport.js";

const LOOKUP_OWNERSHIP_FILTER_VALUES = Object.freeze([
  "public",
  "user",
  "workspace",
  "workspace_user"
]);
const LOOKUP_OWNERSHIP_FILTER_SET = new Set(LOOKUP_OWNERSHIP_FILTER_VALUES);

function normalizeLookupOwnershipFilter(value, { context = "crudLookup ownershipFilter" } = {}) {
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

function createCrudLookupResolver(scope, { context = "crudLookup" } = {}) {
  if (!scope || typeof scope.make !== "function") {
    throw new Error(`${context} requires scope.make().`);
  }

  return function resolveLookup(relation = {}) {
    const namespace = resolveCrudLookupNamespaceFromRelation(relation, {
      context
    });
    return scope.make(
      resolveCrudLookupToken(namespace, {
        context
      })
    );
  };
}

function createCrudLookup(repository, { context = "crudLookup", ownershipFilter = "" } = {}) {
  if (!repository || typeof repository.listByIds !== "function") {
    throw new Error(`${context} requires repository.listByIds(ids, options).`);
  }

  const normalizedOwnershipFilter = normalizeLookupOwnershipFilter(
    ownershipFilter || repository?.ownershipFilter,
    {
      context: `${context} ownershipFilter`
    }
  );

  return Object.freeze({
    ownershipFilter: normalizedOwnershipFilter || null,
    async listByIds(ids = [], options = {}) {
      const include = options?.include === undefined ? "none" : options.include;
      return repository.listByIds(ids, {
        ...options,
        include
      });
    }
  });
}

export {
  resolveCrudLookupToken,
  createCrudLookupResolver,
  createCrudLookup
};
