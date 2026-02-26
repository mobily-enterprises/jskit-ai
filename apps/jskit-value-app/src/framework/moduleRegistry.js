import { createApi as createAuthApi } from "../platform/http/api/authApi.js";
import { createApi as createAiApi } from "@jskit-ai/assistant-client-runtime";
import { createApi as createWorkspaceApi } from "../platform/http/api/workspaceApi.js";
import { createApi as createConsoleApi } from "../platform/http/api/consoleApi.js";
import { createApi as createProjectsApi } from "../platform/http/api/projectsApi.js";
import { createApi as createSettingsApi } from "../platform/http/api/settingsApi.js";
import { createApi as createAlertsApi } from "../platform/http/api/alertsApi.js";
import { createApi as createDeg2radApi } from "../platform/http/api/deg2radApi.js";
import { createApi as createHistoryApi } from "../platform/http/api/historyApi.js";
import { createApi as createBillingApi } from "../platform/http/api/billingApi.js";
import { createApi as createChatApi } from "@jskit-ai/chat-client-runtime";
import { createApi as createSocialApi } from "@jskit-ai/social-client-runtime";
import { REALTIME_TOPICS } from "../../shared/eventTypes.js";

const CLIENT_MODULE_REGISTRY = Object.freeze([
  {
    id: "auth",
    client: {
      api: {
        key: "auth",
        createApi: ({ request }) => createAuthApi({ request })
      }
    }
  },
  {
    id: "ai",
    client: {
      api: {
        key: "ai",
        createApi: ({ request, requestStream }) => createAiApi({ request, requestStream })
      },
      router: {
        app: { includeAssistantRoute: true },
        admin: { includeAssistantRoute: true }
      },
      navigation: {
        app: [{ id: "assistant", title: "Assistant", path: "/assistant" }],
        admin: [{ id: "assistant", title: "Assistant", path: "/assistant" }]
      },
      realtimeTopics: [REALTIME_TOPICS.WORKSPACE_AI_TRANSCRIPTS]
    }
  },
  {
    id: "workspace",
    client: {
      api: {
        key: "workspace",
        createApi: ({ request }) => createWorkspaceApi({ request })
      },
      router: {
        admin: { includeWorkspaceSettings: true }
      },
      realtimeTopics: [
        REALTIME_TOPICS.WORKSPACE_META,
        REALTIME_TOPICS.WORKSPACE_SETTINGS,
        REALTIME_TOPICS.WORKSPACE_MEMBERS,
        REALTIME_TOPICS.WORKSPACE_INVITES
      ]
    }
  },
  {
    id: "console",
    client: {
      api: {
        key: "console",
        createApi: ({ request }) => createConsoleApi({ request })
      },
      realtimeTopics: [
        REALTIME_TOPICS.CONSOLE_MEMBERS,
        REALTIME_TOPICS.CONSOLE_SETTINGS,
        REALTIME_TOPICS.CONSOLE_INVITES,
        REALTIME_TOPICS.CONSOLE_BILLING,
        REALTIME_TOPICS.CONSOLE_ERRORS
      ]
    }
  },
  {
    id: "projects",
    client: {
      api: {
        key: "projects",
        createApi: ({ request }) => createProjectsApi({ request })
      },
      navigation: {
        admin: [{ id: "projects", title: "Projects", path: "/projects" }]
      },
      realtimeTopics: [REALTIME_TOPICS.PROJECTS]
    }
  },
  {
    id: "settings",
    client: {
      api: {
        key: "settings",
        createApi: ({ request }) => createSettingsApi({ request })
      },
      realtimeTopics: [REALTIME_TOPICS.SETTINGS]
    }
  },
  {
    id: "alerts",
    client: {
      api: {
        key: "alerts",
        createApi: ({ request }) => createAlertsApi({ request })
      },
      realtimeTopics: [REALTIME_TOPICS.ALERTS]
    }
  },
  {
    id: "deg2rad",
    client: {
      api: {
        key: "deg2rad",
        createApi: ({ request }) => createDeg2radApi({ request })
      },
      navigation: {
        app: [{ id: "deg2rad", title: "Deg2rad", path: "/" }]
      }
    }
  },
  {
    id: "history",
    client: {
      api: {
        key: "history",
        createApi: ({ request }) => createHistoryApi({ request })
      },
      realtimeTopics: [REALTIME_TOPICS.HISTORY]
    }
  },
  {
    id: "billing",
    client: {
      api: {
        key: "billing",
        createApi: ({ request }) => createBillingApi({ request })
      },
      realtimeTopics: [REALTIME_TOPICS.WORKSPACE_BILLING_LIMITS, REALTIME_TOPICS.CONSOLE_BILLING]
    }
  },
  {
    id: "chat",
    client: {
      api: {
        key: "chat",
        createApi: ({ request }) => createChatApi({ request })
      },
      router: {
        app: { includeChatRoute: true },
        admin: { includeChatRoute: true }
      },
      navigation: {
        admin: [{ id: "workspace-chat", title: "Workspace chat", path: "/chat" }]
      },
      realtimeTopics: [REALTIME_TOPICS.CHAT, REALTIME_TOPICS.TYPING]
    }
  },
  {
    id: "social",
    client: {
      api: {
        key: "social",
        createApi: ({ request }) => createSocialApi({ request })
      },
      router: {
        app: { includeSocialRoute: true, includeSocialModerationRoute: false },
        admin: { includeSocialRoute: true, includeSocialModerationRoute: true }
      },
      navigation: {
        app: [{ id: "social", title: "Social", path: "/social" }],
        admin: [
          { id: "social", title: "Social", path: "/social" },
          { id: "social-moderation", title: "Social moderation", path: "/social/moderation" }
        ]
      },
      realtimeTopics: [REALTIME_TOPICS.SOCIAL_FEED, REALTIME_TOPICS.SOCIAL_NOTIFICATIONS]
    }
  }
]);

const CLIENT_MODULE_IDS = Object.freeze(CLIENT_MODULE_REGISTRY.map((entry) => entry.id));

function resolveClientModuleRegistry() {
  return CLIENT_MODULE_REGISTRY;
}

function resolveClientModuleById(moduleId) {
  const normalized = String(moduleId || "").trim();
  return CLIENT_MODULE_REGISTRY.find((entry) => entry.id === normalized) || null;
}

export { CLIENT_MODULE_REGISTRY, CLIENT_MODULE_IDS, resolveClientModuleRegistry, resolveClientModuleById };
