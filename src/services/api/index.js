import { createAuthApi } from "./authApi.js";
import { createWorkspaceApi } from "./workspaceApi.js";
import { createProjectsApi } from "./projectsApi.js";
import { createSettingsApi } from "./settingsApi.js";
import { createAnnuityApi } from "./annuityApi.js";
import { createHistoryApi } from "./historyApi.js";
import { request, clearCsrfTokenCache, __testables } from "./transport.js";

const api = {
  ...createAuthApi({ request }),
  ...createWorkspaceApi({ request }),
  ...createProjectsApi({ request }),
  ...createSettingsApi({ request }),
  ...createAnnuityApi({ request }),
  ...createHistoryApi({ request }),
  clearCsrfTokenCache
};

export { api, __testables };
