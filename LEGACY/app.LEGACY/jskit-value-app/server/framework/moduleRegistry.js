import { REALTIME_TOPICS } from "../../shared/eventTypes.js";
import {
  FRAMEWORK_CAPABILITY_IDS,
  FRAMEWORK_CAPABILITY_VERSION,
  frameworkCapability,
  frameworkCapabilityRequirement
} from "../../shared/framework/capabilities.js";

const SERVER_MODULE_TIERS = Object.freeze({
  foundation: "foundation",
  feature: "feature"
});

const SERVER_MODULE_VERSION = "0.1.0";
const SERVER_MODULE_DEPENDENCY_RANGE = "^0.1.0";
const CAPABILITY_REQUIREMENT_RANGE = `^${FRAMEWORK_CAPABILITY_VERSION}`;

function moduleDependency(moduleId, { range = SERVER_MODULE_DEPENDENCY_RANGE, optional = false } = {}) {
  const dependency = {
    id: String(moduleId || "").trim(),
    optional: Boolean(optional)
  };

  const normalizedRange = String(range || "").trim();
  if (normalizedRange) {
    dependency.range = normalizedRange;
  }

  return Object.freeze(dependency);
}

function moduleCapabilityRequirement(capabilityId, options = {}) {
  return frameworkCapabilityRequirement(capabilityId, {
    range: CAPABILITY_REQUIREMENT_RANGE,
    ...options
  });
}

function createServerModule(definition = {}) {
  return Object.freeze({
    version: SERVER_MODULE_VERSION,
    dependsOnModules: Object.freeze([]),
    requiresCapabilities: Object.freeze([]),
    providesCapabilities: Object.freeze([]),
    ...definition
  });
}

const SERVER_MODULE_REGISTRY = Object.freeze([
  createServerModule({
    id: "observability",
    tier: SERVER_MODULE_TIERS.foundation,
    providesCapabilities: Object.freeze([frameworkCapability(FRAMEWORK_CAPABILITY_IDS.httpContracts)]),
    contributions: {
      services: ["observabilityService"],
      controllers: ["observability"],
      routes: ["observability"],
      runtimeServices: ["observabilityService"]
    }
  }),
  createServerModule({
    id: "auth",
    tier: SERVER_MODULE_TIERS.foundation,
    providesCapabilities: Object.freeze([
      frameworkCapability(FRAMEWORK_CAPABILITY_IDS.authIdentity),
      frameworkCapability(FRAMEWORK_CAPABILITY_IDS.authCookies),
      frameworkCapability(FRAMEWORK_CAPABILITY_IDS.rbacPermissions),
      frameworkCapability(FRAMEWORK_CAPABILITY_IDS.httpRoutePolicy)
    ]),
    contributions: {
      repositories: ["userProfilesRepository"],
      services: ["authService"],
      controllers: ["auth"],
      routes: ["auth"],
      runtimeServices: ["authService"],
      actionContributorModules: ["auth"]
    }
  }),
  createServerModule({
    id: "history",
    tier: SERVER_MODULE_TIERS.feature,
    dependsOnModules: Object.freeze([moduleDependency("auth"), moduleDependency("workspace")]),
    requiresCapabilities: Object.freeze([
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.workspaceSelection),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.actionRuntimeExecute)
    ]),
    contributions: {
      repositories: ["calculationLogsRepository"],
      services: ["deg2radHistoryService"],
      controllers: ["history"],
      routes: ["history"],
      realtimeTopics: [REALTIME_TOPICS.HISTORY],
      actionContributorModules: ["history"]
    }
  }),
  createServerModule({
    id: "communications",
    tier: SERVER_MODULE_TIERS.feature,
    contributions: {
      services: ["smsService", "emailService", "communicationsService"],
      controllers: ["communications"],
      routes: ["communications"],
      actionContributorModules: ["communications"]
    }
  }),
  createServerModule({
    id: "settings",
    tier: SERVER_MODULE_TIERS.feature,
    dependsOnModules: Object.freeze([moduleDependency("auth"), moduleDependency("workspace")]),
    requiresCapabilities: Object.freeze([
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.workspaceSelection),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.actionRuntimeExecute),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.realtimePublish)
    ]),
    contributions: {
      repositories: ["userSettingsRepository"],
      services: ["avatarStorageService", "chatAttachmentStorageService", "userAvatarService", "userSettingsService"],
      controllers: ["settings"],
      routes: ["settings"],
      realtimeTopics: [REALTIME_TOPICS.SETTINGS],
      runtimeServices: ["avatarStorageService", "chatAttachmentStorageService"],
      actionContributorModules: ["settings"]
    }
  }),
  createServerModule({
    id: "alerts",
    tier: SERVER_MODULE_TIERS.feature,
    dependsOnModules: Object.freeze([moduleDependency("auth"), moduleDependency("workspace")]),
    requiresCapabilities: Object.freeze([
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.workspaceSelection),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.actionRuntimeExecute),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.realtimePublish)
    ]),
    contributions: {
      repositories: ["alertsRepository"],
      services: ["alertsService"],
      controllers: ["alerts"],
      routes: ["alerts"],
      realtimeTopics: [REALTIME_TOPICS.ALERTS],
      runtimeServices: ["alertsService"],
      actionContributorModules: ["alerts"]
    }
  }),
  createServerModule({
    id: "workspace",
    tier: SERVER_MODULE_TIERS.foundation,
    dependsOnModules: Object.freeze([moduleDependency("auth")]),
    requiresCapabilities: Object.freeze([
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.authIdentity),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.authCookies),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.rbacPermissions)
    ]),
    providesCapabilities: Object.freeze([
      frameworkCapability(FRAMEWORK_CAPABILITY_IDS.workspaceSelection),
      frameworkCapability(FRAMEWORK_CAPABILITY_IDS.workspaceMembership),
      frameworkCapability(FRAMEWORK_CAPABILITY_IDS.realtimePublish),
      frameworkCapability(FRAMEWORK_CAPABILITY_IDS.realtimeSubscribe)
    ]),
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
      realtimeTopics: [
        REALTIME_TOPICS.WORKSPACE_META,
        REALTIME_TOPICS.WORKSPACE_SETTINGS,
        REALTIME_TOPICS.WORKSPACE_MEMBERS,
        REALTIME_TOPICS.WORKSPACE_INVITES
      ],
      runtimeServices: ["workspaceService", "realtimeEventsService"],
      actionContributorModules: ["workspace"]
    }
  }),
  createServerModule({
    id: "console",
    tier: SERVER_MODULE_TIERS.foundation,
    dependsOnModules: Object.freeze([moduleDependency("auth")]),
    requiresCapabilities: Object.freeze([
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.authIdentity),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.rbacPermissions)
    ]),
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
      realtimeTopics: [REALTIME_TOPICS.CONSOLE_SETTINGS, REALTIME_TOPICS.CONSOLE_MEMBERS, REALTIME_TOPICS.CONSOLE_INVITES],
      runtimeServices: ["consoleService"],
      actionContributorModules: ["console"]
    }
  }),
  createServerModule({
    id: "consoleErrors",
    tier: SERVER_MODULE_TIERS.feature,
    dependsOnModules: Object.freeze([moduleDependency("auth"), moduleDependency("console")]),
    requiresCapabilities: Object.freeze([moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.realtimePublish)]),
    contributions: {
      repositories: ["consoleErrorLogsRepository"],
      services: ["consoleErrorsService"],
      controllers: ["consoleErrors"],
      routes: ["consoleErrors"],
      realtimeTopics: [REALTIME_TOPICS.CONSOLE_ERRORS],
      runtimeServices: ["consoleErrorsService"],
      actionContributorModules: ["consoleErrors"]
    }
  }),
  createServerModule({
    id: "securityAudit",
    tier: SERVER_MODULE_TIERS.foundation,
    contributions: {
      repositories: ["auditEventsRepository"]
    }
  }),
  createServerModule({
    id: "ai",
    tier: SERVER_MODULE_TIERS.feature,
    dependsOnModules: Object.freeze([moduleDependency("auth"), moduleDependency("workspace")]),
    requiresCapabilities: Object.freeze([
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.workspaceSelection),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.actionRuntimeExecute),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.realtimePublish)
    ]),
    contributions: {
      repositories: ["aiTranscriptConversationsRepository", "aiTranscriptMessagesRepository"],
      services: ["aiModuleServices", "aiTranscriptsService", "aiService"],
      controllers: ["ai"],
      routes: ["ai"],
      realtimeTopics: [REALTIME_TOPICS.WORKSPACE_AI_TRANSCRIPTS],
      runtimeServices: ["aiService"],
      actionContributorModules: ["ai"]
    }
  }),
  createServerModule({
    id: "chat",
    tier: SERVER_MODULE_TIERS.feature,
    dependsOnModules: Object.freeze([moduleDependency("auth"), moduleDependency("workspace")]),
    requiresCapabilities: Object.freeze([
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.workspaceSelection),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.actionRuntimeExecute),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.realtimePublish)
    ]),
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
      realtimeTopics: [REALTIME_TOPICS.CHAT, REALTIME_TOPICS.TYPING],
      actionContributorModules: ["chat"]
    }
  }),
  createServerModule({
    id: "projects",
    tier: SERVER_MODULE_TIERS.feature,
    dependsOnModules: Object.freeze([moduleDependency("auth"), moduleDependency("workspace")]),
    requiresCapabilities: Object.freeze([
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.workspaceSelection),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.actionRuntimeExecute),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.realtimePublish),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.billingEntitlements, { optional: true })
    ]),
    contributions: {
      repositories: ["projectsRepository"],
      routes: ["projects"],
      realtimeTopics: [REALTIME_TOPICS.PROJECTS],
      appFeatureServices: ["projectsService"],
      appFeatureControllers: ["projects"],
      actionContributorModules: ["projects"]
    }
  }),
  createServerModule({
    id: "health",
    tier: SERVER_MODULE_TIERS.foundation,
    contributions: {
      repositories: ["healthRepository"],
      services: ["healthService"],
      controllers: ["health"],
      routes: ["health"]
    }
  }),
  createServerModule({
    id: "billing",
    tier: SERVER_MODULE_TIERS.feature,
    dependsOnModules: Object.freeze([
      moduleDependency("auth"),
      moduleDependency("workspace"),
      moduleDependency("actionRuntime")
    ]),
    requiresCapabilities: Object.freeze([
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.workspaceSelection),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.actionRuntimeExecute),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.realtimePublish)
    ]),
    providesCapabilities: Object.freeze([frameworkCapability(FRAMEWORK_CAPABILITY_IDS.billingEntitlements)]),
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
      realtimeTopics: [REALTIME_TOPICS.WORKSPACE_BILLING_LIMITS, REALTIME_TOPICS.CONSOLE_BILLING],
      fastifyPlugins: ["billingWebhookRawBody"],
      runtimeServices: [
        "billingService",
        "billingWebhookService",
        "billingOutboxWorkerService",
        "billingRemediationWorkerService",
        "billingReconciliationService",
        "billingWorkerRuntimeService"
      ],
      backgroundRuntimeServices: ["billingWorkerRuntimeService"],
      actionContributorModules: ["billing"]
    }
  }),
  createServerModule({
    id: "social",
    tier: SERVER_MODULE_TIERS.feature,
    dependsOnModules: Object.freeze([moduleDependency("auth"), moduleDependency("workspace")]),
    requiresCapabilities: Object.freeze([
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.workspaceSelection),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.actionRuntimeExecute),
      moduleCapabilityRequirement(FRAMEWORK_CAPABILITY_IDS.realtimePublish)
    ]),
    contributions: {
      repositories: ["socialRepository"],
      services: ["socialService", "socialOutboxWorkerRuntimeService"],
      controllers: ["social"],
      routes: ["social"],
      realtimeTopics: [REALTIME_TOPICS.SOCIAL_FEED, REALTIME_TOPICS.SOCIAL_NOTIFICATIONS],
      fastifyPlugins: ["activityPubRawBody"],
      runtimeServices: ["socialService", "socialOutboxWorkerRuntimeService"],
      backgroundRuntimeServices: ["socialOutboxWorkerRuntimeService"],
      actionContributorModules: ["social"]
    }
  }),
  createServerModule({
    id: "actionRuntime",
    tier: SERVER_MODULE_TIERS.foundation,
    providesCapabilities: Object.freeze([frameworkCapability(FRAMEWORK_CAPABILITY_IDS.actionRuntimeExecute)]),
    contributions: {
      services: ["actionRuntimeServices", "actionRegistry", "actionExecutor"],
      runtimeServices: ["actionRegistry", "actionExecutor"]
    }
  }),
  createServerModule({
    id: "deg2rad",
    tier: SERVER_MODULE_TIERS.feature,
    dependsOnModules: Object.freeze([moduleDependency("history")]),
    contributions: {
      routes: ["deg2rad"],
      appFeatureServices: ["deg2radService"],
      appFeatureControllers: ["deg2rad"],
      actionContributorModules: ["history"]
    }
  })
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
  SERVER_MODULE_VERSION,
  SERVER_MODULE_REGISTRY,
  SERVER_MODULE_IDS,
  resolveServerModuleRegistry,
  resolveServerModuleById
};
