import { createController as createAuthController } from "../modules/auth/controller.js";
import { createController as createHistoryController } from "../modules/history/controller.js";
import { createController as createAnnuityController } from "../modules/annuity/controller.js";
import { createController as createSettingsController } from "../modules/settings/controller.js";
import { createController as createWorkspaceController } from "../modules/workspace/controller.js";
import { createController as createConsoleController } from "../modules/console/controller.js";
import { createController as createProjectsController } from "../modules/projects/controller.js";

function createControllers({ services }) {
  const {
    authService,
    annuityHistoryService,
    annuityService,
    userSettingsService,
    projectsService,
    workspaceService,
    workspaceAdminService,
    consoleService
  } = services;

  return {
    auth: createAuthController({ authService }),
    history: createHistoryController({ annuityHistoryService }),
    annuity: createAnnuityController({
      annuityService,
      annuityHistoryService
    }),
    settings: createSettingsController({
      userSettingsService,
      authService
    }),
    projects: createProjectsController({
      projectsService
    }),
    workspace: createWorkspaceController({
      authService,
      workspaceService,
      workspaceAdminService,
      consoleService
    }),
    console: createConsoleController({
      consoleService
    })
  };
}

export { createControllers };
