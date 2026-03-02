import {
  insert,
  findByIdForWorkspace,
  countForWorkspace,
  countActiveForWorkspace,
  listForWorkspace,
  updateByIdForWorkspace,
  transaction
} from "./repository.js";
import { createService as createProjectsService } from "./service.js";
import { createRepositoryExport } from "../moduleExports.js";

const repository = Object.freeze({
  insert,
  findByIdForWorkspace,
  countForWorkspace,
  countActiveForWorkspace,
  listForWorkspace,
  updateByIdForWorkspace,
  transaction
});

function createService(options = {}) {
  const service = createProjectsService(options);
  return {
    service
  };
}

function createRepository() {
  return createRepositoryExport(repository);
}

export { createController } from "./controller.js";
export { buildRoutes } from "./routes.js";
export { schema } from "./schema.js";
export { createService, createRepository };
