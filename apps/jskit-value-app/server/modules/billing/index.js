import * as billingRepositoryModule from "./repository.js";

const { __testables: _billingRepositoryTestables, ...repository } = billingRepositoryModule;

function createRepository() {
  return {
    repository
  };
}

export { createService } from "./service.js";
export { createRepository };
