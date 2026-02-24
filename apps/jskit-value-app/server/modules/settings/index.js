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
import { createService as createSettingsService } from "./service.js";

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

function createService(options = {}) {
  const service = createSettingsService(options);
  return {
    service
  };
}

function createRepository() {
  return {
    repository
  };
}

export { createController } from "./controller.js";
export { buildRoutes } from "./routes.js";
export { createService, createRepository };
