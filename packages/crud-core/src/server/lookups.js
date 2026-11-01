import { normalizeLookupOwnershipFilter, resolveCrudLookupToken } from "./lookupPathSupport.js";

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

  async function listByIds(ids = [], options = {}) {
    const include = options?.include === undefined ? "none" : options.include;
    return repository.listByIds(ids, {
      ...options,
      include
    });
  }

  return Object.freeze({
    ownershipFilter: normalizedOwnershipFilter || null,
    listByIds
  });
}

export {
  resolveCrudLookupToken,
  createCrudLookup
};
