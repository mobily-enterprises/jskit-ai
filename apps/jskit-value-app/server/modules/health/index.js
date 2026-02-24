import { checkDatabase } from "./repository.js";
import { createService as createHealthService } from "./service.js";

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
  return {
    repository
  };
}

export { createService, createRepository };
