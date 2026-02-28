import { checkDatabase } from "./repository.js";
import { createService as createHealthService } from "./service.js";
import { createRepositoryExport } from "../moduleExports.js";

const repository = Object.freeze({
  checkDatabase
});

function createService(options = {}) {
  const service = createHealthService(options);
  return {
    service
  };
}

function createRepository() {
  return createRepositoryExport(repository);
}

export { createService, createRepository };
