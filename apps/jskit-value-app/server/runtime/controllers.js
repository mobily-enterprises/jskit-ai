import { createController as createAuthController } from "../modules/auth/controller.js";
import { createController as createHistoryController } from "../modules/history/controller.js";
import { createController as createCommunicationsController } from "../modules/communications/controller.js";
import { createController as createSettingsController } from "../modules/settings/controller.js";
import { createController as createWorkspaceController } from "../modules/workspace/controller.js";
import { createController as createConsoleController } from "../modules/console/controller.js";
import { createController as createConsoleErrorsController } from "../modules/consoleErrors/controller.js";
import { createController as createObservabilityController } from "../modules/observability/controller.js";
import { createController as createChatController } from "../modules/chat/controller.js";
import { createController as createHealthController } from "../modules/health/controller.js";
import { createController as createAiController } from "../modules/ai/controller.js";
import { createController as createBillingController } from "../modules/billing/controller.js";

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
