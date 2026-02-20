import { createApi as createAuthApi } from "./authApi.js";
import { createApi as createAiApi } from "./aiApi.js";
import { createApi as createWorkspaceApi } from "./workspaceApi.js";
import { createApi as createConsoleApi } from "./consoleApi.js";
import { createApi as createProjectsApi } from "./projectsApi.js";
import { createApi as createSettingsApi } from "./settingsApi.js";
import { createApi as createAnnuityApi } from "./annuityApi.js";
import { createApi as createHistoryApi } from "./historyApi.js";
import { request, requestStream, clearCsrfTokenCache, __testables } from "./transport.js";

const api = {
  ai: createAiApi({ requestStream }),
  auth: createAuthApi({ request }),
  workspace: createWorkspaceApi({ request }),
  console: createConsoleApi({ request }),
  projects: createProjectsApi({ request }),
  settings: createSettingsApi({ request }),
  annuity: createAnnuityApi({ request }),
  history: createHistoryApi({ request }),
  clearCsrfTokenCache
};

export { api, __testables };
