import { createAuthController } from "../modules/auth/controller.js";
import { createHistoryController } from "../modules/history/controller.js";
import { createAnnuityController } from "../modules/annuity/controller.js";
import { createSettingsController } from "../modules/settings/controller.js";
import { createWorkspaceController } from "../modules/workspace/controller.js";
import { createProjectsController } from "../modules/projects/controller.js";

function createControllers({ services }) {
  return {
    auth: createAuthController({ authService: services.authService }),
    history: createHistoryController({ annuityHistoryService: services.annuityHistoryService }),
    annuity: createAnnuityController({
      annuityService: services.annuityService,
      annuityHistoryService: services.annuityHistoryService
    }),
    settings: createSettingsController({
      userSettingsService: services.userSettingsService,
      authService: services.authService
    }),
    projects: createProjectsController({
      projectsService: services.projectsService
    }),
    workspace: createWorkspaceController({
      authService: services.authService,
      workspaceService: services.workspaceService,
      workspaceAdminService: services.workspaceAdminService
    })
  };
}

export { createControllers };
