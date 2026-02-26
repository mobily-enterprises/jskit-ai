const SERVER_MODULE_TIERS = Object.freeze({
  foundation: "foundation",
  feature: "feature"
});

const SERVER_MODULE_REGISTRY = Object.freeze([
  {
    id: "observability",
    tier: SERVER_MODULE_TIERS.foundation,
    contributions: {
      services: ["observabilityService"],
      controllers: ["observability"],
      routes: ["observability"],
      runtimeServices: ["observabilityService"]
    }
  },
  {
    id: "auth",
    tier: SERVER_MODULE_TIERS.foundation,
    contributions: {
      repositories: ["userProfilesRepository"],
      services: ["authService"],
      controllers: ["auth"],
      routes: ["auth"],
      runtimeServices: ["authService"],
      actionContributorModules: ["auth"]
    }
  },
  {
    id: "history",
    tier: SERVER_MODULE_TIERS.feature,
    contributions: {
      repositories: ["calculationLogsRepository"],
      services: ["deg2radHistoryService"],
      controllers: ["history"],
      routes: ["history"],
      actionContributorModules: ["history"]
    }
  },
  {
    id: "communications",
    tier: SERVER_MODULE_TIERS.feature,
    contributions: {
      services: ["smsService", "emailService", "communicationsService"],
      controllers: ["communications"],
      routes: ["communications"],
      actionContributorModules: ["communications"]
    }
  },
  {
    id: "settings",
    tier: SERVER_MODULE_TIERS.feature,
    contributions: {
      repositories: ["userSettingsRepository"],
      services: ["avatarStorageService", "chatAttachmentStorageService", "userAvatarService", "userSettingsService"],
      controllers: ["settings"],
      routes: ["settings"],
      runtimeServices: ["avatarStorageService", "chatAttachmentStorageService"],
      actionContributorModules: ["settings"]
    }
  },
  {
    id: "alerts",
    tier: SERVER_MODULE_TIERS.feature,
    contributions: {
      repositories: ["alertsRepository"],
      services: ["alertsService"],
      controllers: ["alerts"],
      routes: ["alerts"],
      runtimeServices: ["alertsService"],
      actionContributorModules: ["alerts"]
    }
  },
  {
    id: "workspace",
    tier: SERVER_MODULE_TIERS.foundation,
    contributions: {
      repositories: [
        "workspacesRepository",
        "workspaceMembershipsRepository",
        "workspaceSettingsRepository",
        "workspaceInvitesRepository"
      ],
      services: [
        "workspaceInviteEmailService",
        "workspaceService",
        "workspaceAdminService",
        "auditService",
        "realtimeEventsService"
      ],
      controllers: ["workspace"],
      routes: ["workspace"],
      runtimeServices: ["workspaceService", "realtimeEventsService"],
      actionContributorModules: ["workspace"]
    }
  },
  {
    id: "console",
    tier: SERVER_MODULE_TIERS.foundation,
    contributions: {
      repositories: [
        "consoleMembershipsRepository",
        "consoleInvitesRepository",
        "consoleRootRepository",
        "consoleSettingsRepository"
      ],
      services: ["consoleService"],
      controllers: ["console"],
      routes: ["console"],
      runtimeServices: ["consoleService"],
      actionContributorModules: ["console"]
    }
  },
  {
    id: "consoleErrors",
    tier: SERVER_MODULE_TIERS.feature,
    contributions: {
      repositories: ["consoleErrorLogsRepository"],
      services: ["consoleErrorsService"],
      controllers: ["consoleErrors"],
      routes: ["consoleErrors"],
      runtimeServices: ["consoleErrorsService"],
      actionContributorModules: ["consoleErrors"]
    }
  },
  {
    id: "securityAudit",
    tier: SERVER_MODULE_TIERS.foundation,
    contributions: {
      repositories: ["auditEventsRepository"]
    }
  },
  {
    id: "ai",
    tier: SERVER_MODULE_TIERS.feature,
    contributions: {
      repositories: ["aiTranscriptConversationsRepository", "aiTranscriptMessagesRepository"],
      services: ["aiModuleServices", "aiTranscriptsService", "aiService"],
      controllers: ["ai"],
      routes: ["ai"],
      runtimeServices: ["aiService"],
      actionContributorModules: ["ai"]
    }
  },
  {
    id: "chat",
    tier: SERVER_MODULE_TIERS.feature,
    contributions: {
      repositories: [
        "chatThreadsRepository",
        "chatParticipantsRepository",
        "chatMessagesRepository",
        "chatIdempotencyTombstonesRepository",
        "chatAttachmentsRepository",
        "chatReactionsRepository",
        "chatUserSettingsRepository",
        "chatBlocksRepository"
      ],
      services: ["chatService"],
      controllers: ["chat"],
      routes: ["chat"],
      actionContributorModules: ["chat"]
    }
  },
  {
    id: "projects",
    tier: SERVER_MODULE_TIERS.feature,
    contributions: {
      repositories: ["projectsRepository"],
      routes: ["projects"],
      appFeatureServices: ["projectsService"],
      appFeatureControllers: ["projects"],
      actionContributorModules: ["projects"]
    }
  },
  {
    id: "health",
    tier: SERVER_MODULE_TIERS.foundation,
    contributions: {
      repositories: ["healthRepository"],
      services: ["healthService"],
      controllers: ["health"],
      routes: ["health"]
    }
  },
  {
    id: "billing",
    tier: SERVER_MODULE_TIERS.feature,
    contributions: {
      repositories: ["billingRepository"],
      services: [
        "billingProvidersModule",
        "stripeSdkService",
        "paddleSdkService",
        "billingProviderRegistryService",
        "billingProviderAdapter",
        "billingWebhookTranslationRegistryService",
        "billingSubsystem",
        "billingPolicyService",
        "billingPricingService",
        "billingIdempotencyService",
        "billingCheckoutSessionService",
        "billingCheckoutOrchestrator",
        "billingWebhookService",
        "billingOutboxWorkerService",
        "billingRemediationWorkerService",
        "billingReconciliationService",
        "billingRealtimePublishService",
        "billingWorkerRuntimeService",
        "billingService"
      ],
      controllers: ["billing"],
      routes: ["billing"],
      runtimeServices: [
        "billingService",
        "billingWebhookService",
        "billingOutboxWorkerService",
        "billingRemediationWorkerService",
        "billingReconciliationService",
        "billingWorkerRuntimeService"
      ],
      actionContributorModules: ["billing"]
    }
  },
  {
    id: "social",
    tier: SERVER_MODULE_TIERS.feature,
    contributions: {
      repositories: ["socialRepository"],
      services: ["socialService", "socialOutboxWorkerRuntimeService"],
      controllers: ["social"],
      routes: ["social"],
      runtimeServices: ["socialService", "socialOutboxWorkerRuntimeService"],
      actionContributorModules: ["social"]
    }
  },
  {
    id: "actionRuntime",
    tier: SERVER_MODULE_TIERS.foundation,
    contributions: {
      services: ["actionRuntimeServices", "actionRegistry", "actionExecutor"],
      runtimeServices: ["actionRegistry", "actionExecutor"]
    }
  },
  {
    id: "deg2rad",
    tier: SERVER_MODULE_TIERS.feature,
    contributions: {
      routes: ["deg2rad"],
      appFeatureServices: ["deg2radService"],
      appFeatureControllers: ["deg2rad"],
      actionContributorModules: ["history"]
    }
  }
]);

const SERVER_MODULE_IDS = Object.freeze(SERVER_MODULE_REGISTRY.map((entry) => entry.id));

function resolveServerModuleRegistry() {
  return SERVER_MODULE_REGISTRY;
}

function resolveServerModuleById(moduleId) {
  const normalized = String(moduleId || "").trim();
  return SERVER_MODULE_REGISTRY.find((entry) => entry.id === normalized) || null;
}

export {
  SERVER_MODULE_TIERS,
  SERVER_MODULE_REGISTRY,
  SERVER_MODULE_IDS,
  resolveServerModuleRegistry,
  resolveServerModuleById
};
