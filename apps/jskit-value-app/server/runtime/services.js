import { createService as createAuthService } from "@jskit-ai/auth-provider-supabase-core";
import { createService as createHistoryModuleService } from "../modules/history/index.js";
import { createService as createSmsService } from "@jskit-ai/sms-core";
import { createService as createEmailService } from "@jskit-ai/email-core";
import { createService as createCommunicationsModuleService } from "../modules/communications/index.js";
import { createService as createSettingsModuleService } from "../modules/settings/index.js";
import { createService as createAvatarStorageService } from "@jskit-ai/user-profile-core/avatarStorageService";
import { createService as createUserAvatarService } from "@jskit-ai/user-profile-core/avatarService";
import { createService as createWorkspaceService } from "@jskit-ai/workspace-service-core/services/workspace";
import { createService as createWorkspaceAdminService } from "@jskit-ai/workspace-service-core/services/admin";
import { createService as createWorkspaceInviteEmailService } from "@jskit-ai/workspace-service-core/services/inviteEmail";
import { createService as createChatAttachmentStorageService } from "@jskit-ai/chat-storage-core";
import { createService as createConsoleService } from "@jskit-ai/workspace-console-service-core/services/console";
import { createService as createConsoleErrorsService } from "@jskit-ai/workspace-console-service-core/services/errors";
import { createService as createAuditService } from "@jskit-ai/security-audit-core";
import { createService as createChatModuleService } from "../modules/chat/index.js";
import { createService as createHealthModuleService } from "../modules/health/index.js";
import { createService as createAiModuleService } from "../modules/ai/index.js";
import {
  createBillingService,
  createBillingPolicyService,
  createBillingPricingService,
  createBillingIdempotencyService,
  createBillingCheckoutSessionService,
  createBillingCheckoutOrchestratorService,
  createBillingWebhookService,
  createBillingRealtimePublishService
} from "@jskit-ai/billing-service-core";
import {
  createBillingOutboxWorkerService,
  createBillingRemediationWorkerService,
  createBillingReconciliationService,
  createBillingWorkerRuntimeService
} from "@jskit-ai/billing-worker-core";
import { createService as createBillingModuleService } from "../modules/billing/index.js";
import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { createService as createRealtimeEventsService } from "@jskit-ai/server-runtime-core/realtimeEventsService";
import { createService as createObservabilityService } from "@jskit-ai/observability-core/service";
import { AVATAR_POLICY } from "../../shared/avatar.js";
import { createSurfacePaths, resolveSurfaceFromPathname } from "../../shared/surfacePaths.js";
import { REALTIME_TOPICS, REALTIME_EVENT_TYPES } from "../../shared/eventTypes.js";
import { normalizeSurfaceId, resolveSurfaceById } from "../surfaces/index.js";

function createBillingDisabledServices() {
  const throwBillingDisabled = async () => {
    throw new AppError(404, "Not found.");
  };

  return {
    billingPolicyService: {
      resolveBillableEntityForReadRequest: throwBillingDisabled,
      resolveBillableEntityForWriteRequest: throwBillingDisabled,
      listAccessibleWorkspacesForUser: async () => []
    },
    billingPricingService: {
      resolvePhase1SellablePrice: throwBillingDisabled,
      deploymentCurrency: ""
    },
    billingIdempotencyService: {
      claimOrReplay: throwBillingDisabled,
      recoverPendingRequest: throwBillingDisabled,
      expireStalePendingRequests: throwBillingDisabled,
      assertProviderRequestHashStable: throwBillingDisabled,
      assertLeaseVersion: throwBillingDisabled,
      assertProviderReplayWindowOpen: throwBillingDisabled,
      assertReplayProvenanceCompatible: throwBillingDisabled,
      markSucceeded: throwBillingDisabled,
      markFailed: throwBillingDisabled,
      markExpired: throwBillingDisabled
    },
    billingCheckoutSessionService: {
      cleanupExpiredBlockingSessions: throwBillingDisabled,
      getBlockingCheckoutSession: throwBillingDisabled,
      upsertBlockingCheckoutSession: throwBillingDisabled,
      markCheckoutSessionCompletedPendingSubscription: throwBillingDisabled,
      markCheckoutSessionReconciled: throwBillingDisabled,
      markCheckoutSessionRecoveryVerificationPending: throwBillingDisabled,
      markCheckoutSessionExpiredOrAbandoned: throwBillingDisabled,
      assertCheckoutSessionCorrelation: throwBillingDisabled
    },
    billingCheckoutOrchestrator: {
      startCheckout: throwBillingDisabled,
      recoverCheckoutFromPending: throwBillingDisabled,
      finalizeRecoveredCheckout: throwBillingDisabled,
      buildFrozenCheckoutSessionParams: throwBillingDisabled
    },
    billingWebhookService: {
      processProviderEvent: throwBillingDisabled,
      reprocessStoredEvent: throwBillingDisabled
    },
    billingOutboxWorkerService: {
      leaseNextJob: async () => null,
      executeJob: throwBillingDisabled,
      retryOrDeadLetter: throwBillingDisabled,
      runExpireCheckoutSession: throwBillingDisabled
    },
    billingRemediationWorkerService: {
      leaseNextRemediation: async () => null,
      runCancelDuplicateSubscription: throwBillingDisabled,
      retryOrDeadLetterRemediation: throwBillingDisabled
    },
    billingReconciliationService: {
      runScope: throwBillingDisabled
    },
    billingRealtimePublishService: {
      async publishWorkspaceBillingLimitsUpdated() {
        return null;
      }
    },
    billingService: {
      ensureBillableEntity: throwBillingDisabled,
      seedSignupPromoPlan: throwBillingDisabled,
      listPlans: throwBillingDisabled,
      listPurchases: throwBillingDisabled,
      getPlanState: throwBillingDisabled,
      requestPlanChange: throwBillingDisabled,
      cancelPendingPlanChange: throwBillingDisabled,
      processDuePlanChanges: async () => ({
        scannedCount: 0,
        appliedCount: 0
      }),
      listPaymentMethods: throwBillingDisabled,
      syncPaymentMethods: throwBillingDisabled,
      getLimitations: throwBillingDisabled,
      resolveEffectiveLimitations: throwBillingDisabled,
      consumeEntitlement: throwBillingDisabled,
      executeWithEntitlementConsumption: async ({ action } = {}) => {
        if (typeof action !== "function") {
          throw new AppError(500, "Billing entitlement action is unavailable.");
        }
        return action({ trx: null });
      },
      grantEntitlementsForPurchase: throwBillingDisabled,
      grantEntitlementsForPlanState: throwBillingDisabled,
      refreshDueLimitationsForSubject: throwBillingDisabled,
      listTimeline: throwBillingDisabled,
      createPortalSession: throwBillingDisabled,
      createPaymentLink: throwBillingDisabled,
      startCheckout: throwBillingDisabled
    },
    billingWorkerRuntimeService: {
      start() {},
      stop() {},
      isStarted() {
        return false;
      }
    }
  };
}

function hasNonEmptyEnvValue(value) {
  return String(value || "").trim().length > 0;
}

function resolveAuthProviderId(env) {
  return (
    String(env.AUTH_PROVIDER || "")
      .trim()
      .toLowerCase() || "supabase"
  );
}

function resolveSupabaseAuthUrl(env) {
  return String(env.AUTH_SUPABASE_URL || "").trim();
}

function resolveAuthJwtAudience(env) {
  return String(env.AUTH_JWT_AUDIENCE || "authenticated").trim();
}

function throwEnabledSubsystemStartupPreflightError({ env, aiPolicyConfig, billingPolicyConfig }) {
  const issues = [];
  const hints = [];

  if (aiPolicyConfig?.enabled === true && !hasNonEmptyEnvValue(env.AI_API_KEY)) {
    issues.push("AI_API_KEY is required when AI is enabled in config/ai.js.");
    hints.push("Disable AI in config/ai.js (ai.enabled = false) if you are not using it yet.");
  }

  if (billingPolicyConfig?.enabled === true) {
    const provider = String(billingPolicyConfig?.provider || "")
      .trim()
      .toLowerCase();

    if (!hasNonEmptyEnvValue(env.APP_PUBLIC_URL)) {
      issues.push("APP_PUBLIC_URL is required.");
    }
    if (!hasNonEmptyEnvValue(env.BILLING_OPERATION_KEY_SECRET)) {
      issues.push("operationKeySecret is required (set BILLING_OPERATION_KEY_SECRET).");
    }
    if (!hasNonEmptyEnvValue(env.BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET)) {
      issues.push("providerIdempotencyKeySecret is required (set BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET).");
    }

    if (provider === "stripe") {
      if (!hasNonEmptyEnvValue(env.BILLING_STRIPE_SECRET_KEY)) {
        issues.push("BILLING_STRIPE_SECRET_KEY is required when billing is enabled in config/billing.js.");
      }
      if (!hasNonEmptyEnvValue(env.BILLING_STRIPE_API_VERSION)) {
        issues.push("BILLING_STRIPE_API_VERSION is required when billing is enabled in config/billing.js.");
      }
      if (!hasNonEmptyEnvValue(env.BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET)) {
        issues.push("BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET is required when billing is enabled in config/billing.js.");
      }
    } else if (provider === "paddle") {
      if (!hasNonEmptyEnvValue(env.BILLING_PADDLE_API_KEY)) {
        issues.push("BILLING_PADDLE_API_KEY is required when billing is enabled in config/billing.js.");
      }
      if (!hasNonEmptyEnvValue(env.BILLING_PADDLE_WEBHOOK_ENDPOINT_SECRET)) {
        issues.push("BILLING_PADDLE_WEBHOOK_ENDPOINT_SECRET is required when billing is enabled in config/billing.js.");
      }
    }

    hints.push("Disable billing in config/billing.js (billing.enabled = false) if you are not using it yet.");
  }

  if (issues.length < 1) {
    return;
  }

  const uniqueHints = [...new Set(hints)];
  const hintBlock = uniqueHints.length > 0 ? `\nHints:\n- ${uniqueHints.join("\n- ")}` : "";
  throw new Error(`Startup configuration preflight failed:\n- ${issues.join("\n- ")}${hintBlock}`);
}

function createBillingSubsystem({ repositories, services, env, repositoryConfig }) {
  const { workspacesRepository, billingRepository, consoleSettingsRepository } = repositories;
  const { workspaceService, realtimeEventsService, observabilityService } = services;
  const billingPolicyConfig = repositoryConfig?.billing || {};

  if (!billingPolicyConfig.enabled) {
    return {
      ...createBillingDisabledServices(),
      billingPromoProvisioner: null
    };
  }

  const billingPolicyService = createBillingPolicyService({
    workspacesRepository,
    billingRepository,
    resolvePermissions: workspaceService.resolvePermissions
  });

  const billingPricingService = createBillingPricingService({
    billingRepository,
    billingCurrency: billingPolicyConfig.currency
  });

  const billingIdempotencyService = createBillingIdempotencyService({
    billingRepository,
    operationKeySecret: env.BILLING_OPERATION_KEY_SECRET,
    providerIdempotencyKeySecret: env.BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET,
    pendingLeaseSeconds: billingPolicyConfig.idempotency.pendingLeaseSeconds,
    observabilityService
  });

  const billingCheckoutSessionService = createBillingCheckoutSessionService({
    billingRepository,
    checkoutSessionGraceSeconds: billingPolicyConfig.checkout.sessionExpiresAtGraceSeconds
  });

  const billingCheckoutOrchestrator = createBillingCheckoutOrchestratorService({
    billingRepository,
    billingPolicyService,
    billingPricingService,
    billingIdempotencyService,
    billingCheckoutSessionService,
    billingProviderAdapter: services.billingProviderAdapter,
    appPublicUrl: env.APP_PUBLIC_URL,
    observabilityService,
    logger: observabilityService.createScopedLogger("billing.checkout"),
    checkoutSessionGraceSeconds: billingPolicyConfig.checkout.sessionExpiresAtGraceSeconds,
    providerReplayWindowSeconds: billingPolicyConfig.idempotency.providerReplayWindowSeconds,
    providerCheckoutExpirySeconds: billingPolicyConfig.checkout.providerExpiresSeconds
  });

  const billingRealtimePublishService = createBillingRealtimePublishService({
    billingRepository,
    realtimeEventsService,
    realtimeEventTypes: REALTIME_EVENT_TYPES,
    realtimeTopics: REALTIME_TOPICS
  });

  const billingOutboxWorkerService = createBillingOutboxWorkerService({
    billingRepository,
    billingProviderAdapter: services.billingProviderAdapter,
    retryDelaySeconds: billingPolicyConfig.workers.outbox.retryDelaySeconds,
    maxAttempts: billingPolicyConfig.workers.outbox.maxAttempts,
    observabilityService
  });

  const billingRemediationWorkerService = createBillingRemediationWorkerService({
    billingRepository,
    billingProviderAdapter: services.billingProviderAdapter,
    retryDelaySeconds: billingPolicyConfig.workers.remediation.retryDelaySeconds,
    maxAttempts: billingPolicyConfig.workers.remediation.maxAttempts,
    observabilityService
  });

  const billingService = createBillingService({
    billingRepository,
    billingPolicyService,
    billingPricingService,
    billingIdempotencyService,
    billingCheckoutOrchestrator,
    billingProviderAdapter: services.billingProviderAdapter,
    billingRealtimePublishService,
    consoleSettingsRepository,
    appPublicUrl: env.APP_PUBLIC_URL,
    providerReplayWindowSeconds: billingPolicyConfig.idempotency.providerReplayWindowSeconds,
    observabilityService
  });

  const billingWebhookService = createBillingWebhookService({
    billingRepository,
    billingProviderAdapter: services.billingProviderAdapter,
    billingProviderRegistryService: services.billingProviderRegistryService,
    billingWebhookTranslationRegistryService: services.billingWebhookTranslationRegistryService,
    billingCheckoutSessionService,
    billingService,
    billingRealtimePublishService,
    stripeWebhookEndpointSecret: env.BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET,
    paddleWebhookEndpointSecret: env.BILLING_PADDLE_WEBHOOK_ENDPOINT_SECRET,
    observabilityService,
    payloadRetentionDays: billingPolicyConfig.retention.webhookPayloadDays
  });

  const billingReconciliationService = createBillingReconciliationService({
    billingRepository,
    billingProviderAdapter: services.billingProviderAdapter,
    billingCheckoutSessionService,
    billingWebhookService,
    observabilityService,
    checkoutSessionGraceSeconds: billingPolicyConfig.checkout.sessionExpiresAtGraceSeconds,
    completionSlaSeconds: billingPolicyConfig.checkout.completionSlaSeconds
  });

  const billingWorkerRuntimeService = createBillingWorkerRuntimeService({
    enabled: billingPolicyConfig.enabled,
    billingRepository,
    billingOutboxWorkerService,
    billingRemediationWorkerService,
    billingReconciliationService,
    billingService,
    billingRealtimePublishService,
    reconciliationProvider: services.billingProviderAdapter.provider,
    logger: observabilityService.createScopedLogger("billing.worker"),
    workerIdPrefix: `billing:${process.pid}`
  });

  return {
    billingPolicyService,
    billingPricingService,
    billingIdempotencyService,
    billingCheckoutSessionService,
    billingCheckoutOrchestrator,
    billingWebhookService,
    billingOutboxWorkerService,
    billingRemediationWorkerService,
    billingReconciliationService,
    billingRealtimePublishService,
    billingWorkerRuntimeService,
    billingService,
    billingPromoProvisioner: (payload) => billingService.seedSignupPromoPlan(payload)
  };
}

const BILLING_SUBSYSTEM_EXPORT_IDS = Object.freeze([
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
]);

const RUNTIME_SERVICE_EXPORT_IDS = Object.freeze([
  "authService",
  "workspaceService",
  "consoleService",
  "consoleErrorsService",
  "realtimeEventsService",
  "observabilityService",
  "avatarStorageService",
  "chatAttachmentStorageService",
  "aiService",
  "billingService",
  "billingWebhookService",
  "billingOutboxWorkerService",
  "billingRemediationWorkerService",
  "billingReconciliationService",
  "billingWorkerRuntimeService"
]);

const PLATFORM_SERVICE_DEFINITIONS = Object.freeze([
  {
    id: "observabilityService",
    create({ env, repositoryConfig, observabilityRegistry }) {
      throwEnabledSubsystemStartupPreflightError({
        env,
        aiPolicyConfig: repositoryConfig?.ai || {},
        billingPolicyConfig: repositoryConfig?.billing || {}
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
    create({ repositories, services }) {
      const { service } = createSettingsModuleService({
        userSettingsRepository: repositories.userSettingsRepository,
        chatUserSettingsRepository: repositories.chatUserSettingsRepository,
        userProfilesRepository: repositories.userProfilesRepository,
        authService: services.authService,
        userAvatarService: services.userAvatarService
      });
      return service;
    }
  },
  {
    id: "workspaceInviteEmailService",
    create({ env }) {
      return createWorkspaceInviteEmailService({
        driver: env.WORKSPACE_INVITE_EMAIL_DRIVER,
        appPublicUrl: env.APP_PUBLIC_URL,
        smtpHost: env.SMTP_HOST,
        smtpPort: env.SMTP_PORT,
        smtpSecure: env.SMTP_SECURE,
        smtpUsername: env.SMTP_USERNAME,
        smtpPassword: env.SMTP_PASSWORD,
        smtpFrom: env.SMTP_FROM,
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
        workspaceInviteEmailService: services.workspaceInviteEmailService
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

      return createConsoleService({
        consoleMembershipsRepository: repositories.consoleMembershipsRepository,
        consoleInvitesRepository: repositories.consoleInvitesRepository,
        consoleRootRepository: repositories.consoleRootRepository,
        consoleSettingsRepository: repositories.consoleSettingsRepository,
        userProfilesRepository: repositories.userProfilesRepository,
        billingRepository: repositories.billingRepository,
        billingProviderAdapter: services.billingProviderAdapter,
        billingEnabled: billingPolicyConfig.enabled,
        billingProvider: billingPolicyConfig.provider
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
        repositoryConfig
      });
    }
  },
  ...BILLING_SUBSYSTEM_EXPORT_IDS.map((id) => ({
    id,
    create({ services }) {
      return services.billingSubsystem[id];
    }
  }))
]);

const __testables = {
  createBillingDisabledServices,
  hasNonEmptyEnvValue,
  resolveAuthProviderId,
  resolveSupabaseAuthUrl,
  resolveAuthJwtAudience,
  throwEnabledSubsystemStartupPreflightError,
  createBillingSubsystem
};

export { PLATFORM_SERVICE_DEFINITIONS, RUNTIME_SERVICE_EXPORT_IDS, __testables };
