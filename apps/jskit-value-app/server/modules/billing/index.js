import * as billingRepositoryModule from "./repository.js";

const repository = { ...billingRepositoryModule };
delete repository.__testables;

function createRepository() {
  return {
    repository
  };
}

export { createService } from "./service.js";
export { createRepository };
