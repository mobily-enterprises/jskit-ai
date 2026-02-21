import { createController as createAuthController } from "../modules/auth/controller.js";
import { createController as createHistoryController } from "../modules/history/controller.js";
import { createController as createAnnuityController } from "../modules/annuity/controller.js";
import { createController as createCommunicationsController } from "../modules/communications/controller.js";
import { createController as createSettingsController } from "../modules/settings/controller.js";
import { createController as createWorkspaceController } from "../modules/workspace/controller.js";
import { createController as createConsoleController } from "../modules/console/controller.js";
import { createController as createConsoleErrorsController } from "../modules/consoleErrors/controller.js";
import { createController as createObservabilityController } from "../modules/observability/controller.js";
import { createController as createProjectsController } from "../modules/projects/controller.js";
import { createController as createHealthController } from "../modules/health/controller.js";
import { createController as createAiController } from "../modules/ai/controller.js";
import { createController as createBillingController } from "../modules/billing/controller.js";

function createControllers({ services }) {
  const {
    authService,
    annuityHistoryService,
    annuityService,
    communicationsService,
    userSettingsService,
    projectsService,
    aiService,
    aiTranscriptsService,
    realtimeEventsService,
    healthService,
    billingService,
    billingWebhookService,
    workspaceService,
    workspaceAdminService,
    consoleService,
    consoleErrorsService,
    observabilityService,
    auditService
  } = services;

  return {
    auth: createAuthController({ authService }),
    history: createHistoryController({ annuityHistoryService }),
    annuity: createAnnuityController({
      annuityService,
      annuityHistoryService
    }),
    communications: createCommunicationsController({
      communicationsService
    }),
    settings: createSettingsController({
      userSettingsService,
      authService,
      auditService
    }),
    health: createHealthController({
      healthService
    }),
    billing: createBillingController({
      billingService,
      billingWebhookService
    }),
    projects: createProjectsController({
      projectsService,
      realtimeEventsService,
      billingService
    }),
    ai: createAiController({
      aiService,
      aiTranscriptsService
    }),
    workspace: createWorkspaceController({
      authService,
      workspaceService,
      workspaceAdminService,
      aiTranscriptsService,
      consoleService,
      auditService,
      realtimeEventsService
    }),
    console: createConsoleController({
      consoleService,
      aiTranscriptsService,
      auditService
    }),
    consoleErrors: createConsoleErrorsController({
      consoleErrorsService
    }),
    observability: createObservabilityController({
      observabilityService
    })
  };
}

export { createControllers };
