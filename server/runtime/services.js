import { createService as createAuthService } from "../modules/auth/service.js";
import { createService as createAnnuityService } from "../domain/annuity/calculator.service.js";
import { createService as createAnnuityHistoryService } from "../modules/history/service.js";
import { createService as createSmsService } from "../domain/communications/services/sms.service.js";
import { createService as createCommunicationsService } from "../modules/communications/service.js";
import { createService as createUserSettingsService } from "../modules/settings/service.js";
import { createService as createAvatarStorageService } from "../domain/users/avatarStorage.service.js";
import { createService as createUserAvatarService } from "../domain/users/avatar.service.js";
import { createService as createWorkspaceService } from "../domain/workspace/services/workspace.service.js";
import { createService as createWorkspaceAdminService } from "../domain/workspace/services/admin.service.js";
import { createService as createWorkspaceInviteEmailService } from "../domain/workspace/services/inviteEmail.service.js";
import { createService as createChatAttachmentStorageService } from "../domain/chat/services/attachmentStorage.service.js";
import { createService as createConsoleService } from "../domain/console/services/console.service.js";
import { createService as createConsoleErrorsService } from "../domain/console/services/errors.service.js";
import { createService as createAuditService } from "../domain/security/services/audit.service.js";
import { createService as createRealtimeEventsService } from "../domain/realtime/services/events.service.js";
import { createService as createChatRealtimeService } from "../domain/chat/services/realtime.service.js";
import { createService as createObservabilityService } from "../modules/observability/service.js";
import { createService as createProjectsService } from "../modules/projects/service.js";
import { createService as createChatService } from "../modules/chat/service.js";
import { createService as createHealthService } from "../modules/health/service.js";
import { createService as createAiService } from "../modules/ai/service.js";
import { createService as createAiTranscriptsService } from "../modules/ai/transcripts/service.js";
import { createOpenAiClient } from "../modules/ai/provider/openaiClient.js";
import { createService as createBillingService } from "../modules/billing/service.js";
import { createService as createBillingPolicyService } from "../modules/billing/policy.service.js";
import { createService as createBillingPricingService } from "../modules/billing/pricing.service.js";
import { createService as createBillingIdempotencyService } from "../modules/billing/idempotency.service.js";
import { createService as createBillingCheckoutSessionService } from "../modules/billing/checkoutSession.service.js";
import { createService as createBillingProvidersModule } from "../modules/billing/providers/index.js";
import { createService as createBillingCheckoutOrchestratorService } from "../modules/billing/checkoutOrchestrator.service.js";
import { createService as createBillingWebhookService } from "../modules/billing/webhook.service.js";
import { createService as createBillingOutboxWorkerService } from "../modules/billing/outboxWorker.service.js";
import { createService as createBillingRemediationWorkerService } from "../modules/billing/remediationWorker.service.js";
import { createService as createBillingReconciliationService } from "../modules/billing/reconciliation.service.js";
import { createService as createBillingWorkerRuntimeService } from "../modules/billing/workerRuntime.service.js";
import { createService as createBillingRealtimePublishService } from "../modules/billing/realtimePublish.service.js";
import { AppError } from "../lib/errors.js";

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

function throwEnabledSubsystemStartupPreflightError({ env, aiPolicyConfig, billingPolicyConfig }) {
  const issues = [];
  const hints = [];

  if (aiPolicyConfig?.enabled === true && !hasNonEmptyEnvValue(env.AI_API_KEY)) {
    issues.push("AI_API_KEY is required when AI is enabled in config/ai.js.");
    hints.push("Disable AI in config/ai.js (ai.enabled = false) if you are not using it yet.");
  }

  if (billingPolicyConfig?.enabled === true) {
    const provider = String(billingPolicyConfig?.provider || "").trim().toLowerCase();

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

function createServices({
  repositories,
  env,
  repositoryConfig,
  nodeEnv,
  appConfig,
  rbacManifest,
  rootDir,
  supabasePublishableKey,
  observabilityRegistry
}) {
  const {
    userProfilesRepository,
    calculationLogsRepository,
    userSettingsRepository,
    workspacesRepository,
    workspaceMembershipsRepository,
    workspaceSettingsRepository,
    workspaceInvitesRepository,
    consoleMembershipsRepository,
    consoleInvitesRepository,
    consoleRootRepository,
    consoleSettingsRepository,
    consoleErrorLogsRepository,
    auditEventsRepository,
    aiTranscriptConversationsRepository,
    aiTranscriptMessagesRepository,
    chatThreadsRepository,
    chatParticipantsRepository,
    chatMessagesRepository,
    chatIdempotencyTombstonesRepository,
    chatAttachmentsRepository,
    chatReactionsRepository,
    chatUserSettingsRepository,
    chatBlocksRepository,
    projectsRepository,
    healthRepository,
    billingRepository
  } = repositories;
  if (!repositoryConfig || typeof repositoryConfig !== "object") {
    throw new Error("repositoryConfig is required.");
  }
  const chatPolicyConfig = repositoryConfig?.chat || {};
  const aiPolicyConfig = repositoryConfig?.ai || {};
  const billingPolicyConfig = repositoryConfig?.billing || {};
  throwEnabledSubsystemStartupPreflightError({
    env,
    aiPolicyConfig,
    billingPolicyConfig
  });

  const observabilityService = createObservabilityService({
    metricsRegistry: observabilityRegistry,
    metricsEnabled: env.METRICS_ENABLED,
    metricsBearerToken: env.METRICS_BEARER_TOKEN,
    logger: console,
    debugScopes: env.LOG_DEBUG_SCOPES
  });

  const authService = createAuthService({
    supabaseUrl: env.SUPABASE_URL,
    supabasePublishableKey,
    appPublicUrl: env.APP_PUBLIC_URL,
    jwtAudience: env.SUPABASE_JWT_AUDIENCE,
    userProfilesRepository,
    userSettingsRepository,
    nodeEnv
  });

  const annuityHistoryService = createAnnuityHistoryService({
    calculationLogsRepository
  });
  const annuityService = createAnnuityService();
  const smsService = createSmsService({
    driver: env.SMS_DRIVER,
    plivoAuthId: env.PLIVO_AUTH_ID,
    plivoAuthToken: env.PLIVO_AUTH_TOKEN,
    plivoSourceNumber: env.PLIVO_SOURCE_NUMBER
  });

  const communicationsService = createCommunicationsService({
    smsService
  });

  const avatarStorageService = createAvatarStorageService({
    driver: env.AVATAR_STORAGE_DRIVER,
    fsBasePath: env.AVATAR_STORAGE_FS_BASE_PATH,
    publicBasePath: env.AVATAR_PUBLIC_BASE_PATH,
    rootDir
  });

  const chatAttachmentStorageService = createChatAttachmentStorageService({
    driver: env.CHAT_ATTACHMENT_STORAGE_DRIVER,
    fsBasePath: env.CHAT_ATTACHMENT_STORAGE_FS_BASE_PATH,
    rootDir
  });

  const userAvatarService = createUserAvatarService({
    userProfilesRepository,
    avatarStorageService
  });

  const userSettingsService = createUserSettingsService({
    userSettingsRepository,
    chatUserSettingsRepository,
    userProfilesRepository,
    authService,
    userAvatarService
  });

  let billingPromoProvisioner = null;

  const workspaceService = createWorkspaceService({
    appConfig,
    rbacManifest,
    workspacesRepository,
    workspaceMembershipsRepository,
    workspaceSettingsRepository,
    workspaceInvitesRepository,
    userSettingsRepository,
    userAvatarService,
    getBillingPromoProvisioner: () => billingPromoProvisioner
  });

  const workspaceInviteEmailService = createWorkspaceInviteEmailService({
    driver: env.WORKSPACE_INVITE_EMAIL_DRIVER,
    appPublicUrl: env.APP_PUBLIC_URL,
    smtpHost: env.SMTP_HOST,
    smtpPort: env.SMTP_PORT,
    smtpSecure: env.SMTP_SECURE,
    smtpUsername: env.SMTP_USERNAME,
    smtpPassword: env.SMTP_PASSWORD,
    smtpFrom: env.SMTP_FROM
  });

  const workspaceAdminService = createWorkspaceAdminService({
    appConfig,
    rbacManifest,
    workspacesRepository,
    workspaceSettingsRepository,
    workspaceMembershipsRepository,
    workspaceInvitesRepository,
    userProfilesRepository,
    userSettingsRepository,
    workspaceInviteEmailService
  });

  const auditService = createAuditService({
    auditEventsRepository,
    observabilityService
  });

  const projectsService = createProjectsService({
    projectsRepository
  });

  const realtimeEventsService = createRealtimeEventsService();

  const chatRealtimeService = createChatRealtimeService({
    realtimeEventsService
  });

  const chatService = createChatService({
    chatThreadsRepository,
    chatParticipantsRepository,
    chatMessagesRepository,
    chatAttachmentsRepository,
    chatReactionsRepository,
    chatIdempotencyTombstonesRepository,
    chatUserSettingsRepository,
    chatBlocksRepository,
    chatRealtimeService,
    chatAttachmentStorageService,
    workspaceMembershipsRepository,
    userSettingsRepository,
    userProfilesRepository,
    userAvatarService,
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
  });

  const aiProviderClient = createOpenAiClient({
    enabled: aiPolicyConfig.enabled,
    provider: env.AI_PROVIDER,
    apiKey: env.AI_API_KEY,
    baseUrl: env.AI_BASE_URL,
    timeoutMs: env.AI_TIMEOUT_MS
  });

  const aiTranscriptsService = createAiTranscriptsService({
    conversationsRepository: aiTranscriptConversationsRepository,
    messagesRepository: aiTranscriptMessagesRepository,
    workspaceSettingsRepository,
    consoleMembershipsRepository,
    observabilityService
  });

  const aiService = createAiService({
    providerClient: aiProviderClient,
    workspaceAdminService,
    workspaceSettingsRepository,
    consoleSettingsRepository,
    realtimeEventsService,
    aiTranscriptsService,
    auditService,
    observabilityService,
    aiModel: aiPolicyConfig.model,
    aiMaxInputChars: aiPolicyConfig.maxInputChars,
    aiMaxHistoryMessages: aiPolicyConfig.maxHistoryMessages,
    aiMaxToolCallsPerTurn: aiPolicyConfig.maxToolCallsPerTurn
  });

  const healthService = createHealthService({
    healthRepository
  });

  const billingProvidersModule = createBillingProvidersModule({
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
  const {
    stripeSdkService,
    paddleSdkService,
    billingProviderRegistryService,
    billingProviderAdapter,
    billingWebhookTranslationRegistryService
  } = billingProvidersModule;

  const consoleService = createConsoleService({
    consoleMembershipsRepository,
    consoleInvitesRepository,
    consoleRootRepository,
    consoleSettingsRepository,
    userProfilesRepository,
    billingRepository,
    billingProviderAdapter,
    billingEnabled: billingPolicyConfig.enabled,
    billingProvider: billingPolicyConfig.provider
  });

  const consoleErrorsService = createConsoleErrorsService({
    consoleMembershipsRepository,
    consoleErrorLogsRepository,
    observabilityService
  });

  let billingPolicyService;
  let billingPricingService;
  let billingIdempotencyService;
  let billingCheckoutSessionService;
  let billingCheckoutOrchestrator;
  let billingWebhookService;
  let billingOutboxWorkerService;
  let billingRemediationWorkerService;
  let billingReconciliationService;
  let billingRealtimePublishService;
  let billingService;
  let billingWorkerRuntimeService;

  if (billingPolicyConfig.enabled) {
    billingPolicyService = createBillingPolicyService({
      workspacesRepository,
      billingRepository,
      resolvePermissions: workspaceService.resolvePermissions
    });

    billingPricingService = createBillingPricingService({
      billingRepository,
      billingCurrency: billingPolicyConfig.currency
    });

    billingIdempotencyService = createBillingIdempotencyService({
      billingRepository,
      operationKeySecret: env.BILLING_OPERATION_KEY_SECRET,
      providerIdempotencyKeySecret: env.BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET,
      pendingLeaseSeconds: billingPolicyConfig.idempotency.pendingLeaseSeconds,
      observabilityService
    });

    billingCheckoutSessionService = createBillingCheckoutSessionService({
      billingRepository,
      checkoutSessionGraceSeconds: billingPolicyConfig.checkout.sessionExpiresAtGraceSeconds
    });

    billingCheckoutOrchestrator = createBillingCheckoutOrchestratorService({
      billingRepository,
      billingPolicyService,
      billingPricingService,
      billingIdempotencyService,
      billingCheckoutSessionService,
      billingProviderAdapter,
      appPublicUrl: env.APP_PUBLIC_URL,
      observabilityService,
      logger: observabilityService.createScopedLogger("billing.checkout"),
      checkoutSessionGraceSeconds: billingPolicyConfig.checkout.sessionExpiresAtGraceSeconds,
      providerReplayWindowSeconds: billingPolicyConfig.idempotency.providerReplayWindowSeconds,
      providerCheckoutExpirySeconds: billingPolicyConfig.checkout.providerExpiresSeconds
    });

    billingRealtimePublishService = createBillingRealtimePublishService({
      billingRepository,
      realtimeEventsService
    });

    billingOutboxWorkerService = createBillingOutboxWorkerService({
      billingRepository,
      billingProviderAdapter,
      retryDelaySeconds: billingPolicyConfig.workers.outbox.retryDelaySeconds,
      maxAttempts: billingPolicyConfig.workers.outbox.maxAttempts,
      observabilityService
    });

    billingRemediationWorkerService = createBillingRemediationWorkerService({
      billingRepository,
      billingProviderAdapter,
      retryDelaySeconds: billingPolicyConfig.workers.remediation.retryDelaySeconds,
      maxAttempts: billingPolicyConfig.workers.remediation.maxAttempts,
      observabilityService
    });

    billingService = createBillingService({
      billingRepository,
      billingPolicyService,
      billingPricingService,
      billingIdempotencyService,
      billingCheckoutOrchestrator,
      billingProviderAdapter,
      billingRealtimePublishService,
      consoleSettingsRepository,
      appPublicUrl: env.APP_PUBLIC_URL,
      providerReplayWindowSeconds: billingPolicyConfig.idempotency.providerReplayWindowSeconds,
      observabilityService
    });
    billingWebhookService = createBillingWebhookService({
      billingRepository,
      billingProviderAdapter,
      billingProviderRegistryService,
      billingWebhookTranslationRegistryService,
      billingCheckoutSessionService,
      billingService,
      billingRealtimePublishService,
      stripeWebhookEndpointSecret: env.BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET,
      paddleWebhookEndpointSecret: env.BILLING_PADDLE_WEBHOOK_ENDPOINT_SECRET,
      observabilityService,
      payloadRetentionDays: billingPolicyConfig.retention.webhookPayloadDays
    });
    billingReconciliationService = createBillingReconciliationService({
      billingRepository,
      billingProviderAdapter,
      billingCheckoutSessionService,
      billingWebhookService,
      observabilityService,
      checkoutSessionGraceSeconds: billingPolicyConfig.checkout.sessionExpiresAtGraceSeconds,
      completionSlaSeconds: billingPolicyConfig.checkout.completionSlaSeconds
    });
    billingPromoProvisioner = (payload) => billingService.seedSignupPromoPlan(payload);

    billingWorkerRuntimeService = createBillingWorkerRuntimeService({
      enabled: billingPolicyConfig.enabled,
      billingRepository,
      billingOutboxWorkerService,
      billingRemediationWorkerService,
      billingReconciliationService,
      billingService,
      billingRealtimePublishService,
      reconciliationProvider: billingProviderAdapter.provider,
      logger: observabilityService.createScopedLogger("billing.worker"),
      workerIdPrefix: `billing:${process.pid}`
    });
  } else {
    ({
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
      billingService,
      billingWorkerRuntimeService
    } = createBillingDisabledServices());
    billingPromoProvisioner = null;
  }

  return {
    authService,
    annuityService,
    annuityHistoryService,
    smsService,
    communicationsService,
    avatarStorageService,
    chatAttachmentStorageService,
    userAvatarService,
    userSettingsService,
    workspaceService,
    workspaceInviteEmailService,
    workspaceAdminService,
    consoleService,
    consoleErrorsService,
    observabilityService,
    auditService,
    projectsService,
    chatService,
    realtimeEventsService,
    aiTranscriptsService,
    aiService,
    healthService,
    billingPolicyService,
    billingPricingService,
    billingIdempotencyService,
    billingCheckoutSessionService,
    billingCheckoutOrchestrator,
    billingProviderRegistryService,
    billingProviderAdapter,
    billingWebhookTranslationRegistryService,
    stripeSdkService,
    paddleSdkService,
    billingWebhookService,
    billingOutboxWorkerService,
    billingRemediationWorkerService,
    billingReconciliationService,
    billingRealtimePublishService,
    billingWorkerRuntimeService,
    billingService
  };
}

export { createServices };
