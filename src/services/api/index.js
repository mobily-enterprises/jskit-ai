import { createApi as createAuthApi } from "./authApi.js";
import { createApi as createWorkspaceApi } from "./workspaceApi.js";
import { createApi as createGodApi } from "./godApi.js";
import { createApi as createProjectsApi } from "./projectsApi.js";
import { createApi as createSettingsApi } from "./settingsApi.js";
import { createApi as createAnnuityApi } from "./annuityApi.js";
import { createApi as createHistoryApi } from "./historyApi.js";
import { request, clearCsrfTokenCache, __testables } from "./transport.js";

const api = {
  auth: createAuthApi({ request }),
  workspace: createWorkspaceApi({ request }),
  god: createGodApi({ request }),
  projects: createProjectsApi({ request }),
  settings: createSettingsApi({ request }),
  annuity: createAnnuityApi({ request }),
  history: createHistoryApi({ request }),
  clearCsrfTokenCache
};

export { api, __testables };
