import { createAuthActionContributor } from "@jskit-ai/auth-provider-supabase-core";
import { createWorkspaceActionContributor } from "@jskit-ai/workspace-service-core";
import { createConsoleActionContributor } from "@jskit-ai/workspace-console-service-core";
import { createChatActionContributor } from "@jskit-ai/chat-core";
import { createSocialActionContributor } from "@jskit-ai/social-core";
import { createWorkspaceBillingActionContributor } from "@jskit-ai/billing-service-core";
import { createSettingsActionContributor } from "./contributors/settings.contributor.js";
import { createAlertsActionContributor } from "./contributors/alerts.contributor.js";
import { createProjectsActionContributor } from "./contributors/projects.contributor.js";
import { createDeg2radHistoryActionContributor } from "./contributors/deg2radHistory.contributor.js";
import { createAssistantActionContributor } from "./contributors/assistant.contributor.js";
import { createConsoleErrorsActionContributor } from "./contributors/consoleErrors.contributor.js";
import { createCommunicationsActionContributor } from "./contributors/communications.contributor.js";
import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../../../shared/eventTypes.js";

function createActionContributors({ services, repositories, repositoryConfig, appConfig, rbacManifest } = {}) {
  const actionConfig = repositoryConfig?.actions || {};

  return Object.freeze([
    createAuthActionContributor({
      authService: services?.authService
    }),
    createWorkspaceActionContributor({
      workspaceService: services?.workspaceService,
      workspaceAdminService: services?.workspaceAdminService,
      aiTranscriptsService: services?.aiTranscriptsService
    }),
    createConsoleActionContributor({
      consoleService: services?.consoleService,
      aiTranscriptsService: services?.aiTranscriptsService,
      realtimeEventsService: services?.realtimeEventsService,
      realtimeTopics: REALTIME_TOPICS,
      realtimeEventTypes: REALTIME_EVENT_TYPES
    }),
    createChatActionContributor({
      chatService: services?.chatService
    }),
    createSocialActionContributor({
      socialService: services?.socialService,
      moderationAccessMode: repositoryConfig?.social?.moderation?.accessMode
    }),
    createWorkspaceBillingActionContributor({
      billingService: services?.billingService,
      billingPolicyService: services?.billingPolicyService
    }),
    createSettingsActionContributor({
      userSettingsService: services?.userSettingsService,
      authService: services?.authService,
      realtimeEventsService: services?.realtimeEventsService
    }),
    createAlertsActionContributor({
      alertsService: services?.alertsService
    }),
    createProjectsActionContributor({
      projectsService: services?.projectsService,
      projectsRepository: repositories?.projectsRepository,
      billingService: services?.billingService,
      realtimeEventsService: services?.realtimeEventsService
    }),
    createDeg2radHistoryActionContributor({
      deg2radHistoryService: services?.deg2radHistoryService,
      billingService: services?.billingService,
      realtimeEventsService: services?.realtimeEventsService
    }),
    createAssistantActionContributor({
      aiService: services?.aiService,
      aiTranscriptsService: services?.aiTranscriptsService,
      actionsConfig: actionConfig.assistant,
      appConfig,
      rbacManifest
    }),
    createConsoleErrorsActionContributor({
      consoleErrorsService: services?.consoleErrorsService,
      realtimeEventsService: services?.realtimeEventsService
    }),
    createCommunicationsActionContributor({
      communicationsService: services?.communicationsService
    })
  ]);
}

export { createActionContributors };
