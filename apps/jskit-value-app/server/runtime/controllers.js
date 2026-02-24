import { createController as createAuthController } from "@jskit-ai/auth-fastify-adapter";
import { createController as createHistoryController } from "../modules/history/index.js";
import { createController as createCommunicationsController } from "@jskit-ai/communications-fastify-adapter";
import { createController as createSettingsController } from "../modules/settings/index.js";
import { createController as createWorkspaceController } from "../modules/workspace/index.js";
import { createController as createConsoleController } from "../modules/console/index.js";
import { createController as createConsoleErrorsController } from "@jskit-ai/console-errors-fastify-adapter";
import { createController as createObservabilityController } from "@jskit-ai/observability-fastify-adapter";
import { createController as createChatController } from "../modules/chat/index.js";
import { createController as createHealthController } from "@jskit-ai/health-fastify-adapter";
import { createController as createAiController } from "../modules/ai/index.js";
import { createController as createBillingController } from "@jskit-ai/billing-fastify-adapter/controller";

const PLATFORM_CONTROLLER_DEFINITIONS = Object.freeze([
  {
    id: "auth",
    create: ({ services }) =>
      createAuthController({
        authService: services.authService
      })
  },
  {
    id: "history",
    create: ({ services }) =>
      createHistoryController({
        deg2radHistoryService: services.deg2radHistoryService
      })
  },
  {
    id: "communications",
    create: ({ services }) =>
      createCommunicationsController({
        communicationsService: services.communicationsService
      })
  },
  {
    id: "settings",
    create: ({ services }) =>
      createSettingsController({
        userSettingsService: services.userSettingsService,
        authService: services.authService,
        auditService: services.auditService
      })
  },
  {
    id: "health",
    create: ({ services }) =>
      createHealthController({
        healthService: services.healthService
      })
  },
  {
    id: "billing",
    create: ({ services }) =>
      createBillingController({
        billingService: services.billingService,
        billingWebhookService: services.billingWebhookService
      })
  },
  {
    id: "chat",
    create: ({ services }) =>
      createChatController({
        chatService: services.chatService
      })
  },
  {
    id: "ai",
    create: ({ services }) =>
      createAiController({
        aiService: services.aiService,
        aiTranscriptsService: services.aiTranscriptsService
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
        realtimeEventsService: services.realtimeEventsService
      })
  },
  {
    id: "console",
    create: ({ services }) =>
      createConsoleController({
        consoleService: services.consoleService,
        aiTranscriptsService: services.aiTranscriptsService,
        auditService: services.auditService
      })
  },
  {
    id: "consoleErrors",
    create: ({ services }) =>
      createConsoleErrorsController({
        consoleErrorsService: services.consoleErrorsService
      })
  },
  {
    id: "observability",
    create: ({ services }) =>
      createObservabilityController({
        observabilityService: services.observabilityService
      })
  }
]);

export { PLATFORM_CONTROLLER_DEFINITIONS };
