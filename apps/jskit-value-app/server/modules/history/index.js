import { insert, countForWorkspaceUser, listForWorkspaceUser, countForWorkspace, listForWorkspace } from "./repository.js";

const repository = Object.freeze({
  insert,
  countForWorkspaceUser,
  listForWorkspaceUser,
  countForWorkspace,
  listForWorkspace
});

function createRepository() {
  return repository;
}

export { createController } from "./controller.js";
export { buildRoutes } from "./routes.js";
export { schema } from "./schema.js";
export { createService } from "./service.js";
export { createRepository };
