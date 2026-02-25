import { createAuthActionContributor } from "@jskit-ai/auth-provider-supabase-core";
import { createWorkspaceActionContributor } from "@jskit-ai/workspace-service-core";
import { createConsoleActionContributor } from "@jskit-ai/workspace-console-service-core";
import { createChatActionContributor } from "@jskit-ai/chat-core";
import { createWorkspaceBillingActionContributor } from "@jskit-ai/billing-service-core";
import { createSettingsActionContributor } from "./contributors/settings.contributor.js";
import { createAlertsActionContributor } from "./contributors/alerts.contributor.js";
import { createProjectsActionContributor } from "./contributors/projects.contributor.js";
import { createDeg2radHistoryActionContributor } from "./contributors/deg2radHistory.contributor.js";
import { createAssistantActionContributor } from "./contributors/assistant.contributor.js";
import { createConsoleErrorsActionContributor } from "./contributors/consoleErrors.contributor.js";
import { createCommunicationsActionContributor } from "./contributors/communications.contributor.js";

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
      aiTranscriptsService: services?.aiTranscriptsService
    }),
    createChatActionContributor({
      chatService: services?.chatService
    }),
    createWorkspaceBillingActionContributor({
      billingService: services?.billingService,
      billingPolicyService: services?.billingPolicyService
    }),
    createSettingsActionContributor({
      userSettingsService: services?.userSettingsService,
      authService: services?.authService
    }),
    createAlertsActionContributor({
      alertsService: services?.alertsService
    }),
    createProjectsActionContributor({
      projectsService: services?.projectsService,
      projectsRepository: repositories?.projectsRepository,
      billingService: services?.billingService
    }),
    createDeg2radHistoryActionContributor({
      deg2radHistoryService: services?.deg2radHistoryService,
      billingService: services?.billingService
    }),
    createAssistantActionContributor({
      aiService: services?.aiService,
      aiTranscriptsService: services?.aiTranscriptsService,
      actionsConfig: actionConfig.assistant,
      appConfig,
      rbacManifest
    }),
    createConsoleErrorsActionContributor({
      consoleErrorsService: services?.consoleErrorsService
    }),
    createCommunicationsActionContributor({
      communicationsService: services?.communicationsService
    })
  ]);
}

export { createActionContributors };
