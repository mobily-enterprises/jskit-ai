import { createApi as createAuthApi } from "./authApi.js";
import { createApi as createAiApi } from "@jskit-ai/assistant-client-runtime";
import { createApi as createWorkspaceApi } from "./workspaceApi.js";
import { createApi as createConsoleApi } from "./consoleApi.js";
import { createApi as createProjectsApi } from "./projectsApi.js";
import { createApi as createSettingsApi } from "./settingsApi.js";
import { createApi as createDeg2radApi } from "./deg2radApi.js";
import { createApi as createHistoryApi } from "./historyApi.js";
import { createApi as createBillingApi } from "./billingApi.js";
import { createApi as createChatApi } from "@jskit-ai/chat-client-runtime";
import { createApi as createSocialApi } from "@jskit-ai/social-client-runtime";
import { request, requestStream, clearCsrfTokenCache, __testables } from "./transport.js";

const api = {
  ai: createAiApi({ request, requestStream }),
  auth: createAuthApi({ request }),
  workspace: createWorkspaceApi({ request }),
  console: createConsoleApi({ request }),
  projects: createProjectsApi({ request }),
  settings: createSettingsApi({ request }),
  deg2rad: createDeg2radApi({ request }),
  history: createHistoryApi({ request }),
  billing: createBillingApi({ request }),
  chat: createChatApi({ request }),
  social: createSocialApi({ request }),
  clearCsrfTokenCache
};

export { api, __testables };
