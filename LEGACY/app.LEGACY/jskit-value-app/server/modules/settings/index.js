import {
  findByUserId,
  ensureForUserId,
  updatePreferences,
  updateNotifications,
  updatePasswordSignInEnabled,
  updatePasswordSetupRequired,
  findByUserIdForUpdate,
  updateLastActiveWorkspaceId,
  readProjectsSettingsForUserId,
  updateProjectsSettingsForUserId
} from "./repository.js";
import { createService as createSettingsService } from "./service.js";
import { createRepositoryExport } from "../moduleExports.js";

const repository = Object.freeze({
  findByUserId,
  ensureForUserId,
  updatePreferences,
  updateNotifications,
  updatePasswordSignInEnabled,
  updatePasswordSetupRequired,
  findByUserIdForUpdate,
  updateLastActiveWorkspaceId,
  readProjectsSettingsForUserId,
  updateProjectsSettingsForUserId
});

function createService(options = {}) {
  const service = createSettingsService(options);
  return {
    service
  };
}

function createRepository() {
  return createRepositoryExport(repository);
}

export { createController } from "./controller.js";
export { buildRoutes } from "./routes.js";
export { createService, createRepository };
