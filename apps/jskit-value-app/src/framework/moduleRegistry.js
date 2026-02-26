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
import { createRoutes as createAssistantRoutes } from "../app/router/routes/assistantRoutes.js";
import { createRoutes as createChatRoutes } from "../app/router/routes/chatRoutes.js";
import { createRoutes as createSocialRoutes } from "../app/router/routes/socialRoutes.js";
import { createRoutes as createWorkspaceRoutes } from "../app/router/routes/workspaceRoutes.js";
import { createRoutes as createProjectsRoutes } from "../app/router/routes/projectsRoutes.js";
import { createRoutes as createConsoleCoreRoutes } from "../app/router/routes/consoleCoreRoutes.js";
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
      routeFragments: {
        app: [
          {
            id: "assistant",
            order: 10,
            createRoutes: createAssistantRoutes,
            mountKey: "ai.workspace"
          }
        ],
        admin: [
          {
            id: "assistant",
            order: 10,
            createRoutes: createAssistantRoutes,
            mountKey: "ai.workspace"
          }
        ]
      },
      guardPolicies: {
        assistant: {
          featureFlag: "assistantEnabled",
          requiredFeaturePermissionKey: "assistantRequiredPermission"
        }
      },
      navigation: {
        app: [
          {
            id: "assistant",
            title: "Assistant",
            destinationTitle: "Assistant",
            path: "/assistant",
            mountKey: "ai.workspace",
            icon: "$navChoice2",
            featureFlag: "assistantEnabled",
            requiredFeaturePermissionKey: "assistantRequiredPermission"
          }
        ],
        admin: [
          {
            id: "assistant",
            title: "Assistant",
            destinationTitle: "Assistant",
            path: "/assistant",
            mountKey: "ai.workspace",
            icon: "$navChoice2",
            featureFlag: "assistantEnabled",
            requiredFeaturePermissionKey: "assistantRequiredPermission"
          }
        ]
      },
      realtimeTopics: [REALTIME_TOPICS.WORKSPACE_AI_TRANSCRIPTS],
      realtimeInvalidation: [
        {
          topic: REALTIME_TOPICS.WORKSPACE_AI_TRANSCRIPTS,
          invalidatorId: "workspaceAiTranscripts"
        }
      ]
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
      routeFragments: {
        admin: [
          {
            id: "workspace",
            order: 40,
            createRoutes: createWorkspaceRoutes
          }
        ]
      },
      realtimeTopics: [
        REALTIME_TOPICS.WORKSPACE_META,
        REALTIME_TOPICS.WORKSPACE_SETTINGS,
        REALTIME_TOPICS.WORKSPACE_MEMBERS,
        REALTIME_TOPICS.WORKSPACE_INVITES
      ],
      realtimeInvalidation: [
        {
          topic: REALTIME_TOPICS.WORKSPACE_META,
          invalidatorId: "noop",
          refreshBootstrap: true
        },
        {
          topic: REALTIME_TOPICS.WORKSPACE_SETTINGS,
          invalidatorId: "workspaceAdmin",
          refreshBootstrap: true
        },
        {
          topic: REALTIME_TOPICS.WORKSPACE_MEMBERS,
          invalidatorId: "workspaceAdmin",
          refreshBootstrap: true
        },
        {
          topic: REALTIME_TOPICS.WORKSPACE_INVITES,
          invalidatorId: "workspaceAdmin"
        }
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
      routeFragments: {
        console: [
          {
            id: "core",
            order: 0,
            createRoutes: createConsoleCoreRoutes
          }
        ]
      },
      realtimeTopics: [
        REALTIME_TOPICS.CONSOLE_MEMBERS,
        REALTIME_TOPICS.CONSOLE_SETTINGS,
        REALTIME_TOPICS.CONSOLE_INVITES,
        REALTIME_TOPICS.CONSOLE_BILLING,
        REALTIME_TOPICS.CONSOLE_ERRORS
      ],
      realtimeInvalidation: [
        {
          topic: REALTIME_TOPICS.CONSOLE_MEMBERS,
          invalidatorId: "consoleMembers",
          refreshConsoleBootstrap: true
        },
        {
          topic: REALTIME_TOPICS.CONSOLE_SETTINGS,
          invalidatorId: "consoleSettings"
        },
        {
          topic: REALTIME_TOPICS.CONSOLE_INVITES,
          invalidatorId: "consoleInvites",
          refreshConsoleBootstrap: true
        },
        {
          topic: REALTIME_TOPICS.CONSOLE_BILLING,
          invalidatorId: "consoleBilling"
        },
        {
          topic: REALTIME_TOPICS.CONSOLE_ERRORS,
          invalidatorId: "consoleErrors"
        }
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
      routeFragments: {
        admin: [
          {
            id: "projects",
            order: 50,
            createRoutes: createProjectsRoutes,
            mountKey: "projects.workspace"
          }
        ]
      },
      navigation: {
        admin: [
          {
            id: "projects",
            title: "Projects",
            destinationTitle: "Projects",
            path: "/projects",
            mountKey: "projects.workspace",
            icon: "$navChoice2"
          }
        ]
      },
      realtimeTopics: [REALTIME_TOPICS.PROJECTS],
      realtimeInvalidation: [
        {
          topic: REALTIME_TOPICS.PROJECTS,
          invalidatorId: "projects"
        }
      ]
    }
  },
  {
    id: "settings",
    client: {
      api: {
        key: "settings",
        createApi: ({ request }) => createSettingsApi({ request })
      },
      realtimeTopics: [REALTIME_TOPICS.SETTINGS],
      realtimeInvalidation: [
        {
          topic: REALTIME_TOPICS.SETTINGS,
          invalidatorId: "settings"
        }
      ]
    }
  },
  {
    id: "alerts",
    client: {
      api: {
        key: "alerts",
        createApi: ({ request }) => createAlertsApi({ request })
      },
      realtimeTopics: [REALTIME_TOPICS.ALERTS],
      realtimeInvalidation: [
        {
          topic: REALTIME_TOPICS.ALERTS,
          invalidatorId: "noop"
        }
      ]
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
        app: [
          {
            id: "deg2rad",
            title: "Deg2rad",
            destinationTitle: "JSKIT app",
            path: "/",
            icon: "$navChoice1"
          }
        ]
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
      realtimeTopics: [REALTIME_TOPICS.HISTORY],
      realtimeInvalidation: [
        {
          topic: REALTIME_TOPICS.HISTORY,
          invalidatorId: "history"
        }
      ]
    }
  },
  {
    id: "billing",
    client: {
      api: {
        key: "billing",
        createApi: ({ request }) => createBillingApi({ request })
      },
      realtimeTopics: [REALTIME_TOPICS.WORKSPACE_BILLING_LIMITS, REALTIME_TOPICS.CONSOLE_BILLING],
      realtimeInvalidation: [
        {
          topic: REALTIME_TOPICS.WORKSPACE_BILLING_LIMITS,
          invalidatorId: "workspaceBillingLimits"
        }
      ]
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
      routeFragments: {
        app: [
          {
            id: "chat",
            order: 20,
            createRoutes: createChatRoutes,
            mountKey: "chat.workspace"
          }
        ],
        admin: [
          {
            id: "chat",
            order: 20,
            createRoutes: createChatRoutes,
            mountKey: "chat.workspace"
          }
        ]
      },
      navigation: {
        admin: [
          {
            id: "workspace-chat",
            title: "Workspace chat",
            destinationTitle: "Workspace chat",
            path: "/chat",
            mountKey: "chat.workspace",
            icon: "$workspaceChat",
            requiredAnyPermission: ["chat.read"]
          }
        ]
      },
      realtimeTopics: [REALTIME_TOPICS.CHAT, REALTIME_TOPICS.TYPING],
      realtimeInvalidation: [
        {
          topic: REALTIME_TOPICS.CHAT,
          invalidatorId: "chat"
        },
        {
          topic: REALTIME_TOPICS.TYPING,
          invalidatorId: "noop"
        }
      ]
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
      routeFragments: {
        app: [
          {
            id: "social",
            order: 30,
            createRoutes: createSocialRoutes,
            mountKey: "social.workspace",
            options: {
              includeModerationRoute: false
            }
          }
        ],
        admin: [
          {
            id: "social",
            order: 30,
            createRoutes: createSocialRoutes,
            mountKey: "social.workspace",
            options: {
              includeModerationRoute: true
            }
          }
        ]
      },
      guardPolicies: {
        social: {
          featureFlag: "socialEnabled"
        }
      },
      navigation: {
        app: [
          {
            id: "social",
            title: "Social",
            destinationTitle: "Social",
            path: "/social",
            mountKey: "social.workspace",
            icon: "$workspaceSocial",
            featureFlag: "socialEnabled",
            requiredAnyPermission: ["social.read"]
          }
        ],
        admin: [
          {
            id: "social",
            title: "Social",
            destinationTitle: "Social",
            path: "/social",
            mountKey: "social.workspace",
            icon: "$workspaceSocial",
            featureFlag: "socialEnabled",
            requiredAnyPermission: ["social.read"]
          },
          {
            id: "social-moderation",
            title: "Social moderation",
            destinationTitle: "Social moderation",
            path: "/social/moderation",
            mountKey: "social.workspace",
            mountPathSuffix: "/moderation",
            icon: "$workspaceModeration",
            featureFlag: "socialEnabled",
            requiredAnyPermission: ["social.moderate"]
          }
        ]
      },
      realtimeTopics: [REALTIME_TOPICS.SOCIAL_FEED, REALTIME_TOPICS.SOCIAL_NOTIFICATIONS],
      realtimeInvalidation: [
        {
          topic: REALTIME_TOPICS.SOCIAL_FEED,
          invalidatorId: "socialScope"
        },
        {
          topic: REALTIME_TOPICS.SOCIAL_NOTIFICATIONS,
          invalidatorId: "socialScope"
        }
      ]
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
