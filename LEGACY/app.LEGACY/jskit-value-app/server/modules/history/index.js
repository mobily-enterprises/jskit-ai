import { insert, countForWorkspaceUser, listForWorkspaceUser, countForWorkspace, listForWorkspace } from "./repository.js";
import { createService as createHistoryService } from "./service.js";
import { createRepositoryExport } from "../moduleExports.js";

const repository = Object.freeze({
  insert,
  countForWorkspaceUser,
  listForWorkspaceUser,
  countForWorkspace,
  listForWorkspace
});

function createService(options = {}) {
  const service = createHistoryService(options);
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
