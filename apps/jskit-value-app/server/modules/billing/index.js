import * as billingRepositoryModule from "./repository.js";
import { createRepositoryExport } from "../moduleExports.js";

const repository = { ...billingRepositoryModule };
delete repository.__testables;

function createRepository() {
  return createRepositoryExport(repository);
}

export { createService } from "./service.js";
export { createRepository };
