import {
  findByUserId,
  ensureForUserId,
  updatePreferences,
  updateNotifications,
  updatePasswordSignInEnabled,
  updatePasswordSetupRequired,
  findByUserIdForUpdate,
  updateLastActiveWorkspaceId,
  __testables as userSettingsRepositoryTestables
} from "./repository.js";

const userSettingsRepository = Object.freeze({
  findByUserId,
  ensureForUserId,
  updatePreferences,
  updateNotifications,
  updatePasswordSignInEnabled,
  updatePasswordSetupRequired,
  findByUserIdForUpdate,
  updateLastActiveWorkspaceId
});

export { createController } from "./controller.js";
export { buildRoutes } from "./routes.js";
export { createService, __testables as userSettingsServiceTestables } from "./service.js";
export {
  findByUserId,
  ensureForUserId,
  updatePreferences,
  updateNotifications,
  updatePasswordSignInEnabled,
  updatePasswordSetupRequired,
  findByUserIdForUpdate,
  updateLastActiveWorkspaceId,
  userSettingsRepository,
  userSettingsRepositoryTestables
};
