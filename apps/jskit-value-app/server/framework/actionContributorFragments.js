import { createAuthActionContributor } from "@jskit-ai/auth-provider-supabase-core";
import { createWorkspaceActionContributor } from "@jskit-ai/workspace-service-core";
import { createConsoleActionContributor } from "@jskit-ai/workspace-console-service-core";
import { createChatActionContributor } from "@jskit-ai/chat-core";
import { createSocialActionContributor } from "@jskit-ai/social-core";
import { createWorkspaceBillingActionContributor } from "@jskit-ai/billing-service-core";
import { createSettingsActionContributor } from "../runtime/actions/contributors/settings.contributor.js";
import { createAlertsActionContributor } from "../runtime/actions/contributors/alerts.contributor.js";
import { createProjectsActionContributor } from "../runtime/actions/contributors/projects.contributor.js";
import { createDeg2radHistoryActionContributor } from "../runtime/actions/contributors/deg2radHistory.contributor.js";
import { createAssistantActionContributor } from "../runtime/actions/contributors/assistant.contributor.js";
import { createConsoleErrorsActionContributor } from "../runtime/actions/contributors/consoleErrors.contributor.js";
import { createCommunicationsActionContributor } from "../runtime/actions/contributors/communications.contributor.js";
import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../../shared/eventTypes.js";

const ACTION_CONTRIBUTOR_DEFINITIONS = Object.freeze([
  {
    id: "auth",
    moduleId: "auth",
    create({ services }) {
      return createAuthActionContributor({
        authService: services?.authService
      });
    }
  },
  {
    id: "workspace",
    moduleId: "workspace",
    create({ services }) {
      return createWorkspaceActionContributor({
        workspaceService: services?.workspaceService,
        workspaceAdminService: services?.workspaceAdminService,
        aiTranscriptsService: services?.aiTranscriptsService
      });
    }
  },
  {
    id: "console",
    moduleId: "console",
    create({ services }) {
      return createConsoleActionContributor({
        consoleService: services?.consoleService,
        aiTranscriptsService: services?.aiTranscriptsService,
        realtimeEventsService: services?.realtimeEventsService,
        realtimeTopics: REALTIME_TOPICS,
        realtimeEventTypes: REALTIME_EVENT_TYPES
      });
    }
  },
  {
    id: "chat",
    moduleId: "chat",
    create({ services }) {
      return createChatActionContributor({
        chatService: services?.chatService
      });
    }
  },
  {
    id: "social",
    moduleId: "social",
    create({ services, repositoryConfig }) {
      return createSocialActionContributor({
        socialService: services?.socialService,
        moderationAccessMode: repositoryConfig?.social?.moderation?.accessMode
      });
    }
  },
  {
    id: "billing",
    moduleId: "billing",
    create({ services }) {
      return createWorkspaceBillingActionContributor({
        billingService: services?.billingService,
        billingPolicyService: services?.billingPolicyService
      });
    }
  },
  {
    id: "settings",
    moduleId: "settings",
    create({ services }) {
      return createSettingsActionContributor({
        userSettingsService: services?.userSettingsService,
        authService: services?.authService,
        realtimeEventsService: services?.realtimeEventsService
      });
    }
  },
  {
    id: "alerts",
    moduleId: "alerts",
    create({ services }) {
      return createAlertsActionContributor({
        alertsService: services?.alertsService
      });
    }
  },
  {
    id: "projects",
    moduleId: "projects",
    create({ services, repositories }) {
      return createProjectsActionContributor({
        projectsService: services?.projectsService,
        projectsRepository: repositories?.projectsRepository,
        billingService: services?.billingService,
        realtimeEventsService: services?.realtimeEventsService
      });
    }
  },
  {
    id: "deg2radHistory",
    moduleId: "history",
    create({ services }) {
      return createDeg2radHistoryActionContributor({
        deg2radHistoryService: services?.deg2radHistoryService,
        billingService: services?.billingService,
        realtimeEventsService: services?.realtimeEventsService
      });
    }
  },
  {
    id: "assistant",
    moduleId: "ai",
    create({ services, repositoryConfig, appConfig, rbacManifest }) {
      return createAssistantActionContributor({
        aiService: services?.aiService,
        aiTranscriptsService: services?.aiTranscriptsService,
        actionsConfig: repositoryConfig?.actions?.assistant,
        appConfig,
        rbacManifest
      });
    }
  },
  {
    id: "consoleErrors",
    moduleId: "consoleErrors",
    create({ services }) {
      return createConsoleErrorsActionContributor({
        consoleErrorsService: services?.consoleErrorsService,
        realtimeEventsService: services?.realtimeEventsService
      });
    }
  },
  {
    id: "communications",
    moduleId: "communications",
    create({ services }) {
      return createCommunicationsActionContributor({
        communicationsService: services?.communicationsService
      });
    }
  }
]);

function createActionContributorsFromDefinitions(definitions, dependencies = {}) {
  return Object.freeze(definitions.map((definition) => definition.create(dependencies)));
}

export { ACTION_CONTRIBUTOR_DEFINITIONS, createActionContributorsFromDefinitions };
