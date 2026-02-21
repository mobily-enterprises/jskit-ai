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
import { createService as createConsoleService } from "../domain/console/services/console.service.js";
import { createService as createConsoleErrorsService } from "../domain/console/services/errors.service.js";
import { createService as createAuditService } from "../domain/security/services/audit.service.js";
import { createService as createRealtimeEventsService } from "../domain/realtime/services/events.service.js";
import { createService as createObservabilityService } from "../modules/observability/service.js";
import { createService as createProjectsService } from "../modules/projects/service.js";
import { createService as createHealthService } from "../modules/health/service.js";
import { createService as createAiService } from "../modules/ai/service.js";
import { createService as createAiTranscriptsService } from "../modules/ai/transcripts/service.js";
import { createOpenAiClient } from "../modules/ai/provider/openaiClient.js";
import { createService as createBillingService } from "../modules/billing/service.js";
import { createService as createBillingPolicyService } from "../modules/billing/policy.service.js";
import { createService as createBillingPricingService } from "../modules/billing/pricing.service.js";
import { createService as createBillingIdempotencyService } from "../modules/billing/idempotency.service.js";
import { createService as createBillingCheckoutSessionService } from "../modules/billing/checkoutSession.service.js";
import { createService as createStripeSdkService } from "../modules/billing/stripeSdk.service.js";
import { createService as createBillingCheckoutOrchestratorService } from "../modules/billing/checkoutOrchestrator.service.js";
import { createService as createBillingWebhookService } from "../modules/billing/webhook.service.js";
import { createService as createBillingOutboxWorkerService } from "../modules/billing/outboxWorker.service.js";
import { createService as createBillingRemediationWorkerService } from "../modules/billing/remediationWorker.service.js";
import { createService as createBillingReconciliationService } from "../modules/billing/reconciliation.service.js";
import { createService as createBillingWorkerRuntimeService } from "../modules/billing/workerRuntime.service.js";
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
      buildFrozenStripeCheckoutSessionParams: throwBillingDisabled
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
    billingService: {
      ensureBillableEntity: throwBillingDisabled,
      listPlans: throwBillingDisabled,
      getSnapshot: throwBillingDisabled,
      listPaymentMethods: throwBillingDisabled,
      syncPaymentMethods: throwBillingDisabled,
      getLimitations: throwBillingDisabled,
      listTimeline: throwBillingDisabled,
      recordUsage: throwBillingDisabled,
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

function createServices({
  repositories,
  env,
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
    projectsRepository,
    healthRepository,
    billingRepository
  } = repositories;

  const observabilityService = createObservabilityService({
    metricsRegistry: observabilityRegistry,
    metricsEnabled: env.METRICS_ENABLED,
    metricsBearerToken: env.METRICS_BEARER_TOKEN,
    logger: console
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

  const userAvatarService = createUserAvatarService({
    userProfilesRepository,
    avatarStorageService
  });

  const userSettingsService = createUserSettingsService({
    userSettingsRepository,
    userProfilesRepository,
    authService,
    userAvatarService
  });

  const workspaceService = createWorkspaceService({
    appConfig,
    rbacManifest,
    workspacesRepository,
    workspaceMembershipsRepository,
    workspaceSettingsRepository,
    workspaceInvitesRepository,
    userSettingsRepository,
    userAvatarService
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

  const consoleService = createConsoleService({
    consoleMembershipsRepository,
    consoleInvitesRepository,
    consoleRootRepository,
    consoleSettingsRepository,
    userProfilesRepository,
    billingRepository,
    billingEnabled: env.BILLING_ENABLED
  });

  const consoleErrorsService = createConsoleErrorsService({
    consoleMembershipsRepository,
    consoleErrorLogsRepository,
    observabilityService
  });

  const auditService = createAuditService({
    auditEventsRepository,
    observabilityService
  });

  const projectsService = createProjectsService({
    projectsRepository
  });

  const realtimeEventsService = createRealtimeEventsService();

  const aiProviderClient = createOpenAiClient({
    enabled: env.AI_ENABLED,
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
    aiModel: env.AI_MODEL,
    aiMaxInputChars: env.AI_MAX_INPUT_CHARS,
    aiMaxHistoryMessages: env.AI_MAX_HISTORY_MESSAGES,
    aiMaxToolCallsPerTurn: env.AI_MAX_TOOL_CALLS_PER_TURN
  });

  const healthService = createHealthService({
    healthRepository
  });

  const stripeSdkService = createStripeSdkService({
    enabled: env.BILLING_ENABLED,
    secretKey: env.BILLING_STRIPE_SECRET_KEY,
    apiVersion: env.BILLING_STRIPE_API_VERSION,
    maxNetworkRetries: env.BILLING_STRIPE_MAX_NETWORK_RETRIES,
    timeoutMs: env.BILLING_STRIPE_TIMEOUT_MS
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
  let billingService;
  let billingWorkerRuntimeService;

  if (env.BILLING_ENABLED) {
    billingPolicyService = createBillingPolicyService({
      workspacesRepository,
      billingRepository,
      resolvePermissions: workspaceService.resolvePermissions
    });

    billingPricingService = createBillingPricingService({
      billingRepository,
      billingCurrency: env.BILLING_CURRENCY
    });

    billingIdempotencyService = createBillingIdempotencyService({
      billingRepository,
      operationKeySecret: env.BILLING_OPERATION_KEY_SECRET,
      providerIdempotencyKeySecret: env.BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET,
      pendingLeaseSeconds: env.BILLING_CHECKOUT_PENDING_LEASE_SECONDS,
      observabilityService
    });

    billingCheckoutSessionService = createBillingCheckoutSessionService({
      billingRepository,
      checkoutSessionGraceSeconds: env.BILLING_CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS
    });

    billingCheckoutOrchestrator = createBillingCheckoutOrchestratorService({
      billingRepository,
      billingPolicyService,
      billingPricingService,
      billingIdempotencyService,
      billingCheckoutSessionService,
      stripeSdkService,
      appPublicUrl: env.APP_PUBLIC_URL,
      observabilityService,
      checkoutSessionGraceSeconds: env.BILLING_CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS,
      providerReplayWindowSeconds: env.BILLING_PROVIDER_IDEMPOTENCY_REPLAY_WINDOW_SECONDS,
      providerCheckoutExpirySeconds: env.BILLING_CHECKOUT_PROVIDER_EXPIRES_SECONDS
    });

    billingWebhookService = createBillingWebhookService({
      billingRepository,
      stripeSdkService,
      billingCheckoutSessionService,
      stripeWebhookEndpointSecret: env.BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET,
      observabilityService,
      payloadRetentionDays: env.BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS
    });

    billingOutboxWorkerService = createBillingOutboxWorkerService({
      billingRepository,
      stripeSdkService,
      retryDelaySeconds: env.BILLING_OUTBOX_RETRY_DELAY_SECONDS,
      maxAttempts: env.BILLING_OUTBOX_MAX_ATTEMPTS,
      observabilityService
    });

    billingRemediationWorkerService = createBillingRemediationWorkerService({
      billingRepository,
      stripeSdkService,
      retryDelaySeconds: env.BILLING_REMEDIATION_RETRY_DELAY_SECONDS,
      maxAttempts: env.BILLING_REMEDIATION_MAX_ATTEMPTS,
      observabilityService
    });

    billingReconciliationService = createBillingReconciliationService({
      billingRepository,
      stripeSdkService,
      billingCheckoutSessionService,
      billingWebhookService,
      observabilityService,
      checkoutSessionGraceSeconds: env.BILLING_CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS,
      completionSlaSeconds: env.BILLING_CHECKOUT_COMPLETION_SLA_SECONDS
    });

    billingService = createBillingService({
      billingRepository,
      billingPolicyService,
      billingPricingService,
      billingIdempotencyService,
      billingCheckoutOrchestrator,
      stripeSdkService,
      appPublicUrl: env.APP_PUBLIC_URL,
      providerReplayWindowSeconds: env.BILLING_PROVIDER_IDEMPOTENCY_REPLAY_WINDOW_SECONDS,
      observabilityService
    });

    billingWorkerRuntimeService = createBillingWorkerRuntimeService({
      enabled: env.BILLING_ENABLED,
      billingOutboxWorkerService,
      billingRemediationWorkerService,
      billingReconciliationService,
      logger: observabilityService?.logger || console,
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
      billingService,
      billingWorkerRuntimeService
    } = createBillingDisabledServices());
  }

  return {
    authService,
    annuityService,
    annuityHistoryService,
    smsService,
    communicationsService,
    avatarStorageService,
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
    realtimeEventsService,
    aiTranscriptsService,
    aiService,
    healthService,
    billingPolicyService,
    billingPricingService,
    billingIdempotencyService,
    billingCheckoutSessionService,
    billingCheckoutOrchestrator,
    stripeSdkService,
    billingWebhookService,
    billingOutboxWorkerService,
    billingRemediationWorkerService,
    billingReconciliationService,
    billingWorkerRuntimeService,
    billingService
  };
}

export { createServices };
