import { resolveCrudLookupProviderToken } from "./lookupPathSupport.js";

function createCrudLookupProviderResolver(scope, { context = "crudLookupProvider" } = {}) {
  if (!scope || typeof scope.make !== "function") {
    throw new Error(`${context} requires scope.make().`);
  }

  return function resolveLookupProvider(relation = {}) {
    return scope.make(
      resolveCrudLookupProviderToken(relation?.apiPath, {
        context
      })
    );
  };
}

function createCrudLookupProvider(repository, { context = "crudLookupProvider" } = {}) {
  if (!repository || typeof repository.listByIds !== "function") {
    throw new Error(`${context} requires repository.listByIds(ids, options).`);
  }

  return Object.freeze({
    async listByIds(ids = [], options = {}) {
      return repository.listByIds(ids, {
        ...options,
        include: "none"
      });
    }
  });
}

export {
  resolveCrudLookupProviderToken,
  createCrudLookupProviderResolver,
  createCrudLookupProvider
};
