import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveCrudLookupToken } from "./lookupPathSupport.js";

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

/**
 * The repository a lookup reads: any object with listByIds().
 * @typedef {object} CrudLookupRepository
 * @property {(ids: unknown[], options?: Record<string, unknown>) => Promise<unknown>} listByIds
 * @property {string} [ownershipFilter] The ownership filter its records use.
 */

/**
 * A lookup over a repository's listByIds(), which includes no relationships unless asked.
 * @param {CrudLookupRepository} repository
 * @param {object} [options]
 * @param {string} [options.context] The name the lookup's errors give it.
 * @param {string} [options.ownershipFilter] Defaults to the repository's.
 */
function createCrudLookup(repository, { context = "crudLookup", ownershipFilter = "" } = {}) {
  // readable-check: allow method-probe - input validation: the application passes its own repository
  if (!repository || typeof repository.listByIds !== "function") {
    throw new Error(`${context} requires repository.listByIds(ids, options).`);
  }

  const normalizedOwnershipFilter = normalizeLookupOwnershipFilter(
    ownershipFilter || repository.ownershipFilter,
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
  createCrudLookup
};
