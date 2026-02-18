import { createAuthController } from "../../controllers/auth.js";
import { createHistoryController } from "../../controllers/history.js";
import { createAnnuityController } from "../../controllers/annuity.js";
import { createSettingsController } from "../../controllers/settings.js";
import { createWorkspaceController } from "../../controllers/workspace.js";
import { createProjectsController } from "../../controllers/workspace/projects.js";

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
