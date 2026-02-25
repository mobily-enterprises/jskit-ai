import { createController as createAuthController } from "@jskit-ai/auth-fastify-adapter";
import { createController as createHistoryController } from "../modules/history/index.js";
import { createController as createCommunicationsController } from "@jskit-ai/communications-fastify-adapter";
import { createController as createSettingsController } from "../modules/settings/index.js";
import { createController as createAlertsController } from "../modules/alerts/index.js";
import { createController as createWorkspaceController } from "../modules/workspace/index.js";
import { createController as createConsoleController } from "../modules/console/index.js";
import { createController as createConsoleErrorsController } from "@jskit-ai/console-errors-fastify-adapter";
import { createController as createObservabilityController } from "@jskit-ai/observability-fastify-adapter";
import { createController as createChatController } from "../modules/chat/index.js";
import { createController as createSocialController } from "../modules/social/index.js";
import { createController as createHealthController } from "@jskit-ai/health-fastify-adapter";
import { createController as createAiController } from "../modules/ai/index.js";
import { createController as createBillingController } from "@jskit-ai/billing-fastify-adapter/controller";

const PLATFORM_CONTROLLER_DEFINITIONS = Object.freeze([
  {
    id: "auth",
    create: ({ services }) =>
      createAuthController({
        authService: services.authService,
        actionExecutor: services.actionExecutor
      })
  },
  {
    id: "history",
    create: ({ services }) =>
      createHistoryController({
        deg2radHistoryService: services.deg2radHistoryService,
        actionExecutor: services.actionExecutor
      })
  },
  {
    id: "communications",
    create: ({ services }) =>
      createCommunicationsController({
        communicationsService: services.communicationsService,
        actionExecutor: services.actionExecutor
      })
  },
  {
    id: "settings",
    create: ({ services }) =>
      createSettingsController({
        userSettingsService: services.userSettingsService,
        authService: services.authService,
        auditService: services.auditService,
        actionExecutor: services.actionExecutor
      })
  },
  {
    id: "alerts",
    create: ({ services }) =>
      createAlertsController({
        actionExecutor: services.actionExecutor
      })
  },
  {
    id: "health",
    create: ({ services }) =>
      createHealthController({
        healthService: services.healthService,
        actionExecutor: services.actionExecutor
      })
  },
  {
    id: "billing",
    create: ({ services }) =>
      createBillingController({
        billingService: services.billingService,
        billingWebhookService: services.billingWebhookService,
        actionExecutor: services.actionExecutor
      })
  },
  {
    id: "chat",
    create: ({ services }) =>
      createChatController({
        chatService: services.chatService,
        actionExecutor: services.actionExecutor
      })
  },
  {
    id: "social",
    create: ({ services }) =>
      createSocialController({
        socialService: services.socialService,
        actionExecutor: services.actionExecutor
      })
  },
  {
    id: "ai",
    create: ({ services }) =>
      createAiController({
        aiService: services.aiService,
        aiTranscriptsService: services.aiTranscriptsService,
        actionExecutor: services.actionExecutor
      })
  },
  {
    id: "workspace",
    create: ({ services }) =>
      createWorkspaceController({
        authService: services.authService,
        workspaceService: services.workspaceService,
        workspaceAdminService: services.workspaceAdminService,
        aiTranscriptsService: services.aiTranscriptsService,
        consoleService: services.consoleService,
        auditService: services.auditService,
        realtimeEventsService: services.realtimeEventsService,
        actionExecutor: services.actionExecutor
      })
  },
  {
    id: "console",
    create: ({ services }) =>
      createConsoleController({
        consoleService: services.consoleService,
        aiTranscriptsService: services.aiTranscriptsService,
        auditService: services.auditService,
        actionExecutor: services.actionExecutor
      })
  },
  {
    id: "consoleErrors",
    create: ({ services }) =>
      createConsoleErrorsController({
        consoleErrorsService: services.consoleErrorsService,
        actionExecutor: services.actionExecutor
      })
  },
  {
    id: "observability",
    create: ({ services }) =>
      createObservabilityController({
        observabilityService: services.observabilityService,
        actionExecutor: services.actionExecutor
      })
  }
]);

export { PLATFORM_CONTROLLER_DEFINITIONS };
