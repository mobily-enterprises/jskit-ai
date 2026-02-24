import {
  findByUserId,
  ensureForUserId,
  updatePreferences,
  updateNotifications,
  updatePasswordSignInEnabled,
  updatePasswordSetupRequired,
  findByUserIdForUpdate,
  updateLastActiveWorkspaceId
} from "./repository.js";

const repository = Object.freeze({
  findByUserId,
  ensureForUserId,
  updatePreferences,
  updateNotifications,
  updatePasswordSignInEnabled,
  updatePasswordSetupRequired,
  findByUserIdForUpdate,
  updateLastActiveWorkspaceId
});

function createRepository() {
  return repository;
}

export { createController } from "./controller.js";
export { buildRoutes } from "./routes.js";
export { createService } from "./service.js";
export { createRepository };
