import { createService as createAuthService } from "@jskit-ai/auth-provider-supabase-core";
import { createService as createHistoryModuleService } from "../modules/history/index.js";
import { createService as createSmsService } from "@jskit-ai/sms-core";
import { createService as createEmailService } from "@jskit-ai/email-core";
import { createService as createCommunicationsModuleService } from "../modules/communications/index.js";
import { createService as createSettingsModuleService } from "../modules/settings/index.js";
import { createService as createAlertsModuleService } from "../modules/alerts/index.js";
import { createService as createAvatarStorageService } from "@jskit-ai/user-profile-core/avatarStorageService";
import { createService as createUserAvatarService } from "@jskit-ai/user-profile-core/avatarService";
import { createService as createWorkspaceService } from "@jskit-ai/workspace-service-core/services/workspace";
import { createService as createWorkspaceAdminService } from "@jskit-ai/workspace-service-core/services/admin";
import { createService as createWorkspaceInviteEmailService } from "@jskit-ai/workspace-service-core/services/inviteEmail";
import { createService as createChatAttachmentStorageService } from "@jskit-ai/chat-storage-core";
import { createService as createConsoleService } from "@jskit-ai/workspace-console-service-core/services/console";
import { createService as createConsoleErrorsService } from "@jskit-ai/observability-core/services/consoleErrors";
import { createService as createAuditService } from "@jskit-ai/security-audit-core";
import { createService as createChatModuleService } from "../modules/chat/index.js";
import { createService as createSocialModuleService } from "../modules/social/index.js";
import { createSocialOutboxWorkerRuntimeService } from "@jskit-ai/social-core/outboxWorkerRuntimeService";
import { createService as createHealthModuleService } from "../modules/health/index.js";
import { createService as createAiModuleService } from "../modules/ai/index.js";
import {
  createConsoleBillingService,
  resolveBillingProvider
} from "@jskit-ai/billing-service-core";
import { createBillingSubsystem, BILLING_SUBSYSTEM_EXPORT_IDS } from "@jskit-ai/billing-worker-core/runtimeSubsystemFactory";
import { createService as createBillingModuleService } from "../modules/billing/index.js";
import { createActionRuntimeServices } from "./actions/index.js";
import {
  resolveAuthProviderId,
  resolveSupabaseAuthUrl,
  resolveAuthJwtAudience,
  assertEnabledSubsystemStartupPreflight
} from "@jskit-ai/runtime-env-core/startupPreflight";
import { createService as createRealtimeEventsService } from "@jskit-ai/server-runtime-core/realtimeEventsService";
import { createService as createObservabilityService } from "@jskit-ai/observability-core/service";
import { AVATAR_POLICY } from "../../shared/avatar.js";
import { createSurfacePaths, resolveSurfaceFromPathname } from "../../shared/surfacePaths.js";
import { REALTIME_TOPICS, REALTIME_EVENT_TYPES } from "../../shared/eventTypes.js";
import { normalizeSurfaceId, resolveSurfaceById } from "../surfaces/index.js";

const RUNTIME_SERVICE_EXPORT_IDS = Object.freeze([
  "authService",
  "alertsService",
  "workspaceService",
  "consoleService",
  "consoleErrorsService",
  "socialService",
  "realtimeEventsService",
  "observabilityService",
  "avatarStorageService",
  "chatAttachmentStorageService",
  "aiService",
  "actionRegistry",
  "actionExecutor",
  "billingService",
  "billingWebhookService",
  "billingOutboxWorkerService",
  "billingRemediationWorkerService",
  "billingReconciliationService",
  "billingWorkerRuntimeService",
  "socialOutboxWorkerRuntimeService"
]);

const PLATFORM_SERVICE_DEFINITIONS = Object.freeze([
  {
    id: "observabilityService",
    create({ env, repositoryConfig, observabilityRegistry }) {
      assertEnabledSubsystemStartupPreflight({
        env,
        aiPolicyConfig: repositoryConfig?.ai || {},
        billingPolicyConfig: repositoryConfig?.billing || {},
        socialPolicyConfig: repositoryConfig?.social || {}
      });

      return createObservabilityService({
        metricsRegistry: observabilityRegistry,
        metricsEnabled: env.METRICS_ENABLED,
        metricsBearerToken: env.METRICS_BEARER_TOKEN,
        logger: console,
        debugScopes: env.LOG_DEBUG_SCOPES,
        guardrailLogLabel: "billing.guardrail"
      });
    }
  },
  {
    id: "authService",
    create({ repositories, env, nodeEnv, supabasePublishableKey }) {
      const authProviderId = resolveAuthProviderId(env);

      return createAuthService({
        authProvider: {
          id: authProviderId,
          supabaseUrl: resolveSupabaseAuthUrl(env),
          supabasePublishableKey,
          jwtAudience: resolveAuthJwtAudience(env),
          emailManagedBy: authProviderId,
          emailChangeFlow: authProviderId
        },
        appPublicUrl: env.APP_PUBLIC_URL,
        userProfilesRepository: repositories.userProfilesRepository,
        userSettingsRepository: repositories.userSettingsRepository,
        nodeEnv
      });
    }
  },
  {
    id: "deg2radHistoryService",
    create({ repositories }) {
      const { service } = createHistoryModuleService({
        calculationLogsRepository: repositories.calculationLogsRepository
      });
      return service;
    }
  },
  {
    id: "smsService",
    create({ env }) {
      return createSmsService({
        driver: env.SMS_DRIVER,
        plivoAuthId: env.PLIVO_AUTH_ID,
        plivoAuthToken: env.PLIVO_AUTH_TOKEN,
        plivoSourceNumber: env.PLIVO_SOURCE_NUMBER
      });
    }
  },
  {
    id: "emailService",
    create({ env }) {
      return createEmailService({
        provider: env.EMAIL_PROVIDER
      });
    }
  },
  {
    id: "communicationsService",
    create({ services }) {
      const { service } = createCommunicationsModuleService({
        smsService: services.smsService,
        emailService: services.emailService
      });
      return service;
    }
  },
  {
    id: "avatarStorageService",
    create({ env, rootDir }) {
      return createAvatarStorageService({
        driver: env.AVATAR_STORAGE_DRIVER,
        fsBasePath: env.AVATAR_STORAGE_FS_BASE_PATH,
        publicBasePath: env.AVATAR_PUBLIC_BASE_PATH,
        rootDir
      });
    }
  },
  {
    id: "chatAttachmentStorageService",
    create({ env, rootDir }) {
      return createChatAttachmentStorageService({
        driver: env.CHAT_ATTACHMENT_STORAGE_DRIVER,
        fsBasePath: env.CHAT_ATTACHMENT_STORAGE_FS_BASE_PATH,
        rootDir
      });
    }
  },
  {
    id: "userAvatarService",
    create({ repositories, services }) {
      return createUserAvatarService({
        userProfilesRepository: repositories.userProfilesRepository,
        avatarStorageService: services.avatarStorageService,
        avatarPolicy: AVATAR_POLICY
      });
    }
  },
  {
    id: "userSettingsService",
    create({ repositories, services, appServerExtensions }) {
      const { service } = createSettingsModuleService({
        userSettingsRepository: repositories.userSettingsRepository,
        chatUserSettingsRepository: repositories.chatUserSettingsRepository,
        userProfilesRepository: repositories.userProfilesRepository,
        authService: services.authService,
        userAvatarService: services.userAvatarService,
        settingsExtensions: appServerExtensions?.settings || []
      });
      return service;
    }
  },
  {
    id: "alertsService",
    create({ repositories, services }) {
      const { service } = createAlertsModuleService({
        alertsRepository: repositories.alertsRepository,
        resolveRealtimeEventsService: () => services.realtimeEventsService || null
      });
      return service;
    }
  },
  {
    id: "workspaceInviteEmailService",
    create({ env, services }) {
      return createWorkspaceInviteEmailService({
        appPublicUrl: env.APP_PUBLIC_URL,
        communicationsService: services.communicationsService,
        createSurfacePaths
      });
    }
  },
  {
    id: "workspaceService",
    create({ repositories, services, appConfig, rbacManifest }) {
      return createWorkspaceService({
        appConfig,
        rbacManifest,
        workspacesRepository: repositories.workspacesRepository,
        workspaceMembershipsRepository: repositories.workspaceMembershipsRepository,
        workspaceSettingsRepository: repositories.workspaceSettingsRepository,
        workspaceInvitesRepository: repositories.workspaceInvitesRepository,
        userSettingsRepository: repositories.userSettingsRepository,
        userAvatarService: services.userAvatarService,
        getBillingPromoProvisioner: () => services.billingSubsystem?.billingPromoProvisioner || null,
        surfaceResolver: {
          normalizeSurfaceId,
          resolveSurfaceById
        },
        resolveSurfaceFromPathname
      });
    }
  },
  {
    id: "workspaceAdminService",
    create({ repositories, services, appConfig, rbacManifest }) {
      return createWorkspaceAdminService({
        appConfig,
        rbacManifest,
        workspacesRepository: repositories.workspacesRepository,
        workspaceSettingsRepository: repositories.workspaceSettingsRepository,
        workspaceMembershipsRepository: repositories.workspaceMembershipsRepository,
        workspaceInvitesRepository: repositories.workspaceInvitesRepository,
        userProfilesRepository: repositories.userProfilesRepository,
        userSettingsRepository: repositories.userSettingsRepository,
        workspaceInviteEmailService: services.workspaceInviteEmailService,
        alertsService: services.alertsService
      });
    }
  },
  {
    id: "auditService",
    create({ repositories, services }) {
      return createAuditService({
        auditEventsRepository: repositories.auditEventsRepository,
        observabilityService: services.observabilityService
      });
    }
  },
  {
    id: "realtimeEventsService",
    create() {
      return createRealtimeEventsService({
        realtimeTopics: REALTIME_TOPICS,
        realtimeEventTypes: REALTIME_EVENT_TYPES
      });
    }
  },
  {
    id: "chatService",
    create({ repositories, services, repositoryConfig, rbacManifest }) {
      const chatPolicyConfig = repositoryConfig?.chat || {};
      const { chatService } = createChatModuleService({
        chatRealtimeServiceOptions: {
          realtimeEventsService: services.realtimeEventsService
        },
        chatServiceOptions: {
          chatThreadsRepository: repositories.chatThreadsRepository,
          chatParticipantsRepository: repositories.chatParticipantsRepository,
          chatMessagesRepository: repositories.chatMessagesRepository,
          chatAttachmentsRepository: repositories.chatAttachmentsRepository,
          chatReactionsRepository: repositories.chatReactionsRepository,
          chatIdempotencyTombstonesRepository: repositories.chatIdempotencyTombstonesRepository,
          chatUserSettingsRepository: repositories.chatUserSettingsRepository,
          chatBlocksRepository: repositories.chatBlocksRepository,
          chatAttachmentStorageService: services.chatAttachmentStorageService,
          workspaceMembershipsRepository: repositories.workspaceMembershipsRepository,
          userSettingsRepository: repositories.userSettingsRepository,
          userProfilesRepository: repositories.userProfilesRepository,
          userAvatarService: services.userAvatarService,
          rbacManifest,
          config: {
            chatEnabled: chatPolicyConfig.enabled,
            chatWorkspaceThreadsEnabled: chatPolicyConfig.workspaceThreadsEnabled,
            chatGlobalDmsEnabled: chatPolicyConfig.globalDmsEnabled,
            chatGlobalDmsRequireSharedWorkspace: chatPolicyConfig.globalDmsRequireSharedWorkspace,
            chatMessageMaxTextChars: chatPolicyConfig.messageMaxTextChars,
            chatMessagesPageSizeMax: chatPolicyConfig.messagesPageSizeMax,
            chatThreadsPageSizeMax: chatPolicyConfig.threadsPageSizeMax,
            chatAttachmentsEnabled: chatPolicyConfig.attachmentsEnabled,
            chatAttachmentsMaxFilesPerMessage: chatPolicyConfig.attachmentsMaxFilesPerMessage,
            chatAttachmentMaxUploadBytes: chatPolicyConfig.attachmentMaxUploadBytes,
            chatUnattachedUploadRetentionHours: chatPolicyConfig.unattachedUploadRetentionHours
          }
        }
      });
      return chatService;
    }
  },
  {
    id: "socialService",
    create({ repositories, services, repositoryConfig, env }) {
      const { socialService } = createSocialModuleService({
        socialServiceOptions: {
          socialRepository: repositories.socialRepository,
          chatUserSettingsRepository: repositories.chatUserSettingsRepository,
          userProfilesRepository: repositories.userProfilesRepository,
          workspacesRepository: repositories.workspacesRepository,
          realtimeEventsService: services.realtimeEventsService,
          realtimeTopics: REALTIME_TOPICS,
          realtimeEventTypes: REALTIME_EVENT_TYPES,
          appPublicUrl: env.APP_PUBLIC_URL,
          observabilityService: services.observabilityService,
          repositoryConfig,
          env
        }
      });

      return socialService;
    }
  },
  {
    id: "aiModuleServices",
    create({ repositories, services, repositoryConfig, env }) {
      const aiPolicyConfig = repositoryConfig?.ai || {};
      return createAiModuleService({
        aiTranscriptsServiceOptions: {
          conversationsRepository: repositories.aiTranscriptConversationsRepository,
          messagesRepository: repositories.aiTranscriptMessagesRepository,
          workspaceSettingsRepository: repositories.workspaceSettingsRepository,
          consoleMembershipsRepository: repositories.consoleMembershipsRepository,
          observabilityService: services.observabilityService
        },
        aiServiceOptions: {
          enabled: aiPolicyConfig.enabled,
          provider: env.AI_PROVIDER,
          apiKey: env.AI_API_KEY,
          baseUrl: env.AI_BASE_URL,
          timeoutMs: env.AI_TIMEOUT_MS,
          actionsConfig: repositoryConfig?.actions?.assistant || {},
          resolveActionExecutor: () => services.actionExecutor || null,
          workspaceAdminService: services.workspaceAdminService,
          workspaceSettingsRepository: repositories.workspaceSettingsRepository,
          consoleSettingsRepository: repositories.consoleSettingsRepository,
          realtimeEventsService: services.realtimeEventsService,
          auditService: services.auditService,
          observabilityService: services.observabilityService,
          aiModel: aiPolicyConfig.model,
          aiMaxInputChars: aiPolicyConfig.maxInputChars,
          aiMaxHistoryMessages: aiPolicyConfig.maxHistoryMessages,
          aiMaxToolCallsPerTurn: aiPolicyConfig.maxToolCallsPerTurn
        }
      });
    }
  },
  {
    id: "aiTranscriptsService",
    create({ services }) {
      return services.aiModuleServices.aiTranscriptsService;
    }
  },
  {
    id: "aiService",
    create({ services }) {
      return services.aiModuleServices.aiService;
    }
  },
  {
    id: "healthService",
    create({ repositories }) {
      const { service } = createHealthModuleService({
        healthRepository: repositories.healthRepository
      });
      return service;
    }
  },
  {
    id: "billingProvidersModule",
    create({ repositoryConfig, env }) {
      const billingPolicyConfig = repositoryConfig?.billing || {};
      const { billingProvidersService } = createBillingModuleService({
        enabled: billingPolicyConfig.enabled,
        defaultProvider: billingPolicyConfig.provider,
        stripe: {
          secretKey: env.BILLING_STRIPE_SECRET_KEY,
          apiVersion: env.BILLING_STRIPE_API_VERSION,
          maxNetworkRetries: env.BILLING_STRIPE_MAX_NETWORK_RETRIES,
          timeoutMs: env.BILLING_STRIPE_TIMEOUT_MS
        },
        paddle: {
          apiKey: env.BILLING_PADDLE_API_KEY,
          apiBaseUrl: env.BILLING_PADDLE_API_BASE_URL,
          timeoutMs: env.BILLING_PADDLE_TIMEOUT_MS
        }
      });
      return billingProvidersService;
    }
  },
  {
    id: "stripeSdkService",
    create({ services }) {
      return services.billingProvidersModule.stripeSdkService;
    }
  },
  {
    id: "paddleSdkService",
    create({ services }) {
      return services.billingProvidersModule.paddleSdkService;
    }
  },
  {
    id: "billingProviderRegistryService",
    create({ services }) {
      return services.billingProvidersModule.billingProviderRegistryService;
    }
  },
  {
    id: "billingProviderAdapter",
    create({ services }) {
      return services.billingProvidersModule.billingProviderAdapter;
    }
  },
  {
    id: "billingWebhookTranslationRegistryService",
    create({ services }) {
      return services.billingProvidersModule.billingWebhookTranslationRegistryService;
    }
  },
  {
    id: "consoleService",
    create({ repositories, services, repositoryConfig }) {
      const billingPolicyConfig = repositoryConfig?.billing || {};
      const activeBillingProvider = resolveBillingProvider(billingPolicyConfig.provider);

      return createConsoleService({
        consoleMembershipsRepository: repositories.consoleMembershipsRepository,
        consoleInvitesRepository: repositories.consoleInvitesRepository,
        consoleRootRepository: repositories.consoleRootRepository,
        consoleSettingsRepository: repositories.consoleSettingsRepository,
        userProfilesRepository: repositories.userProfilesRepository,
        consoleBillingServiceFactory: ({ requirePermission, ensureConsoleSettings }) =>
          createConsoleBillingService({
            requirePermission,
            ensureConsoleSettings,
            consoleSettingsRepository: repositories.consoleSettingsRepository,
            billingEnabled: billingPolicyConfig.enabled,
            billingRepository: repositories.billingRepository,
            billingProviderAdapter: services.billingProviderAdapter,
            activeBillingProvider
          }),
        alertsService: services.alertsService
      });
    }
  },
  {
    id: "consoleErrorsService",
    create({ repositories, services }) {
      return createConsoleErrorsService({
        consoleMembershipsRepository: repositories.consoleMembershipsRepository,
        consoleErrorLogsRepository: repositories.consoleErrorLogsRepository,
        observabilityService: services.observabilityService
      });
    }
  },
  {
    id: "billingSubsystem",
    create({ repositories, services, env, repositoryConfig }) {
      return createBillingSubsystem({
        repositories,
        services,
        env,
        repositoryConfig,
        realtimeEventTypes: REALTIME_EVENT_TYPES,
        realtimeTopics: REALTIME_TOPICS
      });
    }
  },
  ...BILLING_SUBSYSTEM_EXPORT_IDS.map((id) => ({
    id,
    create({ services }) {
      return services.billingSubsystem[id];
    }
  })),
  {
    id: "actionRuntimeServices",
    create({
      services,
      repositories,
      repositoryConfig,
      appConfig,
      rbacManifest,
      frameworkCompositionMode,
      frameworkProfileId,
      frameworkOptionalModulePacks,
      frameworkEnforceProfileRequired,
      frameworkExtensionModules
    }) {
      return createActionRuntimeServices({
        services,
        repositories,
        repositoryConfig,
        appConfig,
        rbacManifest,
        frameworkCompositionMode,
        frameworkProfileId,
        frameworkOptionalModulePacks,
        frameworkEnforceProfileRequired,
        frameworkExtensionModules
      });
    }
  },
  {
    id: "actionRegistry",
    create({ services }) {
      return services.actionRuntimeServices.actionRegistry;
    }
  },
  {
    id: "actionExecutor",
    create({ services }) {
      return services.actionRuntimeServices.actionExecutor;
    }
  },
  {
    id: "socialOutboxWorkerRuntimeService",
    create({ repositories, services, repositoryConfig }) {
      const socialPolicyConfig =
        repositoryConfig?.social && typeof repositoryConfig.social === "object" ? repositoryConfig.social : {};
      const workersConfig =
        socialPolicyConfig?.workers && typeof socialPolicyConfig.workers === "object" ? socialPolicyConfig.workers : {};

      const workerLogger =
        services?.observabilityService && typeof services.observabilityService.createScopedLogger === "function"
          ? services.observabilityService.createScopedLogger("social.worker")
          : console;

      return createSocialOutboxWorkerRuntimeService({
        enabled: socialPolicyConfig.enabled === true,
        federationEnabled: socialPolicyConfig.federationEnabled === true,
        actionExecutor: services.actionExecutor,
        socialRepository: repositories.socialRepository,
        logger: workerLogger,
        pollSeconds: workersConfig.outboxPollSeconds,
        workspaceBatchSize: workersConfig.outboxWorkspaceBatchSize
      });
    }
  }
]);

const __testables = {
  resolveAuthProviderId,
  resolveSupabaseAuthUrl,
  resolveAuthJwtAudience,
  assertEnabledSubsystemStartupPreflight
};

export { PLATFORM_SERVICE_DEFINITIONS, RUNTIME_SERVICE_EXPORT_IDS, __testables };
