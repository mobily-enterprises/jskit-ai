import {
  insert,
  findByIdForWorkspace,
  countForWorkspace,
  countActiveForWorkspace,
  listForWorkspace,
  updateByIdForWorkspace,
  transaction
} from "./repository.js";

const repository = Object.freeze({
  insert,
  findByIdForWorkspace,
  countForWorkspace,
  countActiveForWorkspace,
  listForWorkspace,
  updateByIdForWorkspace,
  transaction
});

function createRepository() {
  return repository;
}

export { createController } from "./controller.js";
export { buildRoutes } from "./routes.js";
export { schema } from "./schema.js";
export { createService } from "./service.js";
export { createRepository };
