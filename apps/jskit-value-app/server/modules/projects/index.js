import {
  insert,
  findByIdForWorkspace,
  countForWorkspace,
  countActiveForWorkspace,
  listForWorkspace,
  updateByIdForWorkspace,
  transaction,
  __testables as projectsRepositoryTestables
} from "./repository.js";

const projectsRepository = Object.freeze({
  insert,
  findByIdForWorkspace,
  countForWorkspace,
  countActiveForWorkspace,
  listForWorkspace,
  updateByIdForWorkspace,
  transaction
});

export { createController } from "./controller.js";
export { buildRoutes } from "./routes.js";
export { schema } from "./schema.js";
export { createService } from "./service.js";
export {
  insert,
  findByIdForWorkspace,
  countForWorkspace,
  countActiveForWorkspace,
  listForWorkspace,
  updateByIdForWorkspace,
  transaction,
  projectsRepository,
  projectsRepositoryTestables
};
