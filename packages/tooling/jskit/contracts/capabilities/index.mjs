// Central capability contracts (WHAT).
// Provider/consumer graph (WHO) is derived from descriptors at lint/doc time.
const CAPABILITY_CONTRACTS = Object.freeze({
  "assistant.client-element": Object.freeze({
    capabilityId: "assistant.client-element",
    kind: "client-element",
    summary: "UI element contract for assistant.client-element.",
    entrypoint: ".",
    symbols: Object.freeze(["AssistantClientElement"]),
    requireContractTest: 0
  }),
  "assistant.client-runtime": Object.freeze({
    capabilityId: "assistant.client-runtime",
    kind: "client-runtime",
    summary: "Headless client runtime contract for assistant.client-runtime.",
    entrypoint: ".",
    symbols: Object.freeze(["assistantRuntimeTestables","buildStreamEventError","createApi","createAssistantApi","createAssistantRuntime","createConsoleTranscriptsApi","createWorkspaceTranscriptsApi"]),
    requireContractTest: 0
  }),
  "assistant.core": Object.freeze({
    capabilityId: "assistant.core",
    kind: "service-contract",
    summary: "Canonical capability contract for assistant.core.",
    entrypoint: ".",
    symbols: Object.freeze(["AI_ASSISTANT_SYSTEM_PROMPT_MAX_LENGTH","applyAssistantSystemPromptAppToWorkspaceFeatures","applyAssistantSystemPromptsToWorkspaceFeatures","applyAssistantSystemPromptWorkspaceToConsoleFeatures","assistantServiceTestables","assistantToolRegistryTestables","buildAiToolRegistry","createAssistantService","executeToolCall","listToolSchemas","normalizePromptValue","resolveAssistantSystemPromptAppFromWorkspaceSettings","resolveAssistantSystemPromptsFromWorkspaceSettings","resolveAssistantSystemPromptWorkspaceFromConsoleSettings"]),
    requireContractTest: 0
  }),
  "assistant.provider": Object.freeze({
    capabilityId: "assistant.provider",
    kind: "provider-family",
    summary: "Provider selection contract for assistant.provider.",
    entrypoint: ".",
    symbols: Object.freeze(["assistantProviderOpenAiTestables","createOpenAiClient"]),
    requireContractTest: 0
  }),
  "assistant.provider.openai": Object.freeze({
    capabilityId: "assistant.provider.openai",
    kind: "provider-implementation",
    summary: "Concrete provider implementation contract for assistant.provider.openai.",
    entrypoint: ".",
    symbols: Object.freeze(["assistantProviderOpenAiTestables","createOpenAiClient"]),
    requireContractTest: 1
  }),
  "assistant.server-routes": Object.freeze({
    capabilityId: "assistant.server-routes",
    kind: "server-routes",
    summary: "Transport route-wiring contract for assistant.server-routes.",
    entrypoint: "./routes",
    symbols: Object.freeze(["buildRoutes"]),
    requireContractTest: 0
  }),
  "assistant.transcripts.core": Object.freeze({
    capabilityId: "assistant.transcripts.core",
    kind: "service-contract",
    summary: "Canonical capability contract for assistant.transcripts.core.",
    entrypoint: ".",
    symbols: Object.freeze(["applyTranscriptModeToWorkspaceFeatures","assistantTranscriptsServiceTestables","createAssistantTranscriptsService","createConsoleTranscriptsActionContributor","createConversationsRepository","createMessagesRepository","normalizeTranscriptMode","REDACTION_VERSION","redactSecrets","redactSecretsTestables","resolveTranscriptModeFromWorkspaceSettings","TRANSCRIPT_MODE_DISABLED","TRANSCRIPT_MODE_RESTRICTED","TRANSCRIPT_MODE_STANDARD","TRANSCRIPT_MODE_VALUES"]),
    requireContractTest: 0
  }),
  "assistant.transcripts.explorer.client": Object.freeze({
    capabilityId: "assistant.transcripts.explorer.client",
    kind: "client-runtime",
    summary: "Headless client runtime contract for assistant.transcripts.explorer.client.",
    entrypoint: ".",
    symbols: Object.freeze(["AssistantTranscriptExplorerClientElement"]),
    requireContractTest: 0
  }),
  "assistant.transcripts.store": Object.freeze({
    capabilityId: "assistant.transcripts.store",
    kind: "storage",
    summary: "Persistence contract for assistant.transcripts.store.",
    entrypoint: ".",
    symbols: Object.freeze(["applyTranscriptModeToWorkspaceFeatures","assistantTranscriptsServiceTestables","createAssistantTranscriptsService","createConsoleTranscriptsActionContributor","createConversationsRepository","createMessagesRepository","normalizeTranscriptMode","REDACTION_VERSION","redactSecrets","redactSecretsTestables","resolveTranscriptModeFromWorkspaceSettings","TRANSCRIPT_MODE_DISABLED","TRANSCRIPT_MODE_RESTRICTED","TRANSCRIPT_MODE_STANDARD","TRANSCRIPT_MODE_VALUES"]),
    requireContractTest: 0
  }),
  "auth.access": Object.freeze({
    capabilityId: "auth.access",
    kind: "service-contract",
    summary: "Canonical capability contract for auth.access.",
    entrypoint: ".",
    symbols: Object.freeze(["AUTH_ACCESS_TOKEN_MAX_LENGTH","AUTH_EMAIL_MAX_LENGTH","AUTH_EMAIL_MIN_LENGTH","AUTH_EMAIL_PATTERN","AUTH_EMAIL_REGEX","AUTH_LOGIN_PASSWORD_MAX_LENGTH","AUTH_METHOD_DEFINITIONS","AUTH_METHOD_EMAIL_OTP_ID","AUTH_METHOD_EMAIL_OTP_PROVIDER","AUTH_METHOD_IDS","AUTH_METHOD_KIND_OAUTH","AUTH_METHOD_KIND_OTP","AUTH_METHOD_KIND_PASSWORD","AUTH_METHOD_KINDS","AUTH_METHOD_MINIMUM_ENABLED","AUTH_METHOD_PASSWORD_ID","AUTH_METHOD_PASSWORD_PROVIDER","AUTH_PASSWORD_MAX_LENGTH","AUTH_PASSWORD_MIN_LENGTH","AUTH_RECOVERY_TOKEN_MAX_LENGTH","AUTH_REFRESH_TOKEN_MAX_LENGTH","buildAuthMethodDefinitions","buildAuthMethodIds","buildInviteToken","buildOAuthMethodDefinitions","buildOAuthMethodId","confirmPassword","createAuthApi","createMembershipIndexes","encodeInviteTokenHash","findAuthMethodDefinition","forgotPasswordInput","hashInviteToken","isSha256Hex","isValidOAuthProviderId","loginInput","loginPassword","mapMembershipSummary","normalizeEmail","normalizeInviteToken","normalizeMembershipForAccess","normalizeOAuthIntent","normalizeOAuthProviderId","normalizeOAuthProviderList","normalizePermissions","normalizeReturnToPath","OAUTH_PROVIDER_ID_PATTERN","OAUTH_PROVIDER_ID_REGEX","OAUTH_QUERY_PARAM_INTENT","OAUTH_QUERY_PARAM_PROVIDER","OAUTH_QUERY_PARAM_RETURN_TO","OPAQUE_INVITE_TOKEN_HASH_PREFIX","parseAuthMethodId","registerInput","registerPassword","resetPassword","resetPasswordInput","resolveInviteTokenHash","resolveMembershipRoleId","resolveMembershipStatus","validators"]),
    requireContractTest: 0
  }),
  "auth.policy": Object.freeze({
    capabilityId: "auth.policy",
    kind: "service-contract",
    summary: "Canonical capability contract for auth.policy.",
    entrypoint: ".",
    symbols: Object.freeze(["authPolicyPlugin","mergeAuthPolicy","withAuthPolicy"]),
    requireContractTest: 0
  }),
  "auth.provider": Object.freeze({
    capabilityId: "auth.provider",
    kind: "provider-family",
    summary: "Provider selection contract for auth.provider.",
    entrypoint: "./service",
    symbols: Object.freeze(["__testables","createService"]),
    requireContractTest: 0
  }),
  "auth.provider.supabase": Object.freeze({
    capabilityId: "auth.provider.supabase",
    kind: "provider-implementation",
    summary: "Concrete provider implementation contract for auth.provider.supabase.",
    entrypoint: "./service",
    symbols: Object.freeze(["__testables","createService"]),
    requireContractTest: 1
  }),
  "auth.rbac": Object.freeze({
    capabilityId: "auth.rbac",
    kind: "service-contract",
    summary: "Canonical capability contract for auth.rbac.",
    entrypoint: ".",
    symbols: Object.freeze(["createOwnerOnlyManifest","hasPermission","listManifestPermissions","loadRbacManifest","manifestIncludesPermission","normalizeManifest","OWNER_ROLE_ID","resolveRolePermissions"]),
    requireContractTest: 0
  }),
  "auth.server-routes": Object.freeze({
    capabilityId: "auth.server-routes",
    kind: "server-routes",
    summary: "Transport route-wiring contract for auth.server-routes.",
    entrypoint: ".",
    symbols: Object.freeze(["buildRoutes","createController","schema"]),
    requireContractTest: 0
  }),
  "billing.commerce.client": Object.freeze({
    capabilityId: "billing.commerce.client",
    kind: "client-runtime",
    summary: "Headless client runtime contract for billing.commerce.client.",
    entrypoint: ".",
    symbols: Object.freeze(["BillingCommerceClientElement"]),
    requireContractTest: 0
  }),
  "billing.console.admin.client": Object.freeze({
    capabilityId: "billing.console.admin.client",
    kind: "client-runtime",
    summary: "Headless client runtime contract for billing.console.admin.client.",
    entrypoint: ".",
    symbols: Object.freeze(["ConsoleBillingPlansClientElement","ConsoleBillingProductsClientElement"]),
    requireContractTest: 0
  }),
  "billing.core": Object.freeze({
    capabilityId: "billing.core",
    kind: "service-contract",
    summary: "Canonical capability contract for billing.core.",
    entrypoint: ".",
    symbols: Object.freeze(["assertEntitlementValueOrThrow","createBillingCatalogCore","createBillingCatalogProviderPricingCore","resolveSchemaValidator","validateEntitlementValue"]),
    requireContractTest: 0
  }),
  "billing.entitlements.core": Object.freeze({
    capabilityId: "billing.entitlements.core",
    kind: "service-contract",
    summary: "Canonical capability contract for billing.entitlements.core.",
    entrypoint: ".",
    symbols: Object.freeze(["assertClock","assertEntitlementsRepository","assertLogger","createEntitlementsPolicy","createEntitlementsService","DEFAULT_SUBJECT_TYPE","ENTITLEMENT_TYPES","EntitlementNotConfiguredError","ENTITLEMENTS_ERROR_CODES","EntitlementsError","EntitlementsValidationError","isEntitlementsError","LIFETIME_WINDOW_END","LIFETIME_WINDOW_START","LOGGER_METHODS","NOOP_LOGGER","normalizeAmount","normalizeBalanceRow","normalizeCodes","normalizeSubjectType","OPTIONAL_REPOSITORY_METHODS","RECOMPUTE_SUPPORT_METHODS","REQUIRED_REPOSITORY_METHODS","resolveClock","resolveLogger","SYSTEM_CLOCK","toDateOrNull","toNonEmptyString","toPositiveInteger","validateClock","validateEntitlementsRepository","validateLogger"]),
    requireContractTest: 0
  }),
  "billing.entitlements.store.mysql": Object.freeze({
    capabilityId: "billing.entitlements.store.mysql",
    kind: "storage",
    summary: "Persistence contract for billing.entitlements.store.mysql.",
    entrypoint: ".",
    symbols: Object.freeze(["createEntitlementMigrations","createEntitlementsKnexRepository","withTransaction"]),
    requireContractTest: 0
  }),
  "billing.plan.client": Object.freeze({
    capabilityId: "billing.plan.client",
    kind: "client-runtime",
    summary: "Headless client runtime contract for billing.plan.client.",
    entrypoint: ".",
    symbols: Object.freeze(["BillingPlanClientElement"]),
    requireContractTest: 0
  }),
  "billing.provider": Object.freeze({
    capabilityId: "billing.provider",
    kind: "provider-family",
    summary: "Provider selection contract for billing.provider.",
    entrypoint: "./adapterService",
    symbols: Object.freeze(["createService"]),
    requireContractTest: 0
  }),
  "billing.provider-contract": Object.freeze({
    capabilityId: "billing.provider-contract",
    kind: "provider-contract",
    summary: "Provider interface contract for billing.provider-contract.",
    entrypoint: ".",
    symbols: Object.freeze(["assertProviderAdapter","assertWebhookTranslator","BILLING_DEFAULT_PROVIDER","BILLING_PROVIDER_PADDLE","BILLING_PROVIDER_SDK_NAME_BY_PROVIDER","BILLING_PROVIDER_STRIPE","BillingProviderError","createBillingProviderError","createProviderRegistry","isBillingProviderError","normalizeProviderCode","normalizeProviderErrorCategory","normalizeWebhookProvider","PROVIDER_ERROR_CATEGORIES","REQUIRED_CANONICAL_WEBHOOK_EVENT_TYPES","REQUIRED_PROVIDER_ADAPTER_METHODS","REQUIRED_PROVIDER_ADAPTER_OPERATION_METHODS","REQUIRED_WEBHOOK_TRANSLATOR_METHODS","resolveProviderSdkName","RETRYABLE_PROVIDER_ERROR_CATEGORIES","shouldProcessCanonicalWebhookEvent","validateProviderAdapter","validateWebhookTranslator"]),
    requireContractTest: 1
  }),
  "billing.provider-registry": Object.freeze({
    capabilityId: "billing.provider-registry",
    kind: "provider-registry",
    summary: "Provider registry contract for billing.provider-registry.",
    entrypoint: ".",
    symbols: Object.freeze(["assertProviderAdapter","assertWebhookTranslator","BILLING_DEFAULT_PROVIDER","BILLING_PROVIDER_PADDLE","BILLING_PROVIDER_SDK_NAME_BY_PROVIDER","BILLING_PROVIDER_STRIPE","BillingProviderError","createBillingProviderError","createProviderRegistry","isBillingProviderError","normalizeProviderCode","normalizeProviderErrorCategory","normalizeWebhookProvider","PROVIDER_ERROR_CATEGORIES","REQUIRED_CANONICAL_WEBHOOK_EVENT_TYPES","REQUIRED_PROVIDER_ADAPTER_METHODS","REQUIRED_PROVIDER_ADAPTER_OPERATION_METHODS","REQUIRED_WEBHOOK_TRANSLATOR_METHODS","resolveProviderSdkName","RETRYABLE_PROVIDER_ERROR_CATEGORIES","shouldProcessCanonicalWebhookEvent","validateProviderAdapter","validateWebhookTranslator"]),
    requireContractTest: 0
  }),
  "billing.provider.paddle": Object.freeze({
    capabilityId: "billing.provider.paddle",
    kind: "provider-implementation",
    summary: "Concrete provider implementation contract for billing.provider.paddle.",
    entrypoint: "./adapterService",
    symbols: Object.freeze(["createService"]),
    requireContractTest: 1
  }),
  "billing.provider.stripe": Object.freeze({
    capabilityId: "billing.provider.stripe",
    kind: "provider-implementation",
    summary: "Concrete provider implementation contract for billing.provider.stripe.",
    entrypoint: "./adapterService",
    symbols: Object.freeze(["createService"]),
    requireContractTest: 1
  }),
  "billing.server-routes": Object.freeze({
    capabilityId: "billing.server-routes",
    kind: "server-routes",
    summary: "Transport route-wiring contract for billing.server-routes.",
    entrypoint: "./routes",
    symbols: Object.freeze(["buildRoutes"]),
    requireContractTest: 0
  }),
  "billing.service": Object.freeze({
    capabilityId: "billing.service",
    kind: "service-contract",
    summary: "Canonical capability contract for billing.service.",
    entrypoint: ".",
    symbols: Object.freeze(["BILLING_ACTIONS","BILLING_CHECKOUT_SESSION_STATUS","BILLING_DEFAULT_PROVIDER","BILLING_FAILURE_CODES","BILLING_IDEMPOTENCY_STATUS","BILLING_PROVIDER_PADDLE","BILLING_PROVIDER_REQUEST_SCHEMA_VERSION_BY_PROVIDER","BILLING_PROVIDER_SDK_NAME_BY_PROVIDER","BILLING_PROVIDER_STRIPE","BILLING_RUNTIME_DEFAULTS","BILLING_SUBSCRIPTION_STATUS","billingCheckoutOrchestratorServiceTestables","billingCheckoutSessionServiceTestables","billingIdempotencyServiceTestables","billingPolicyServiceTestables","billingPricingServiceTestables","billingRealtimePublishServiceTestables","buildConsoleBillingPlanCatalog","buildConsoleBillingProductCatalog","canonicalJsonTestables","canTransitionCheckoutStatus","CHECKOUT_BLOCKING_STATUS_SET","CHECKOUT_STATUS_TRANSITIONS","CHECKOUT_TERMINAL_STATUS_SET","createBillingCheckoutOrchestratorService","createBillingCheckoutSessionService","createBillingIdempotencyService","createBillingPolicyService","createBillingPricingService","createBillingRealtimePublishService","createBillingService","createBillingSettingsService","createBillingWebhookService","createConsoleBillingActionContributor","createConsoleBillingApi","createConsoleBillingService","createWebhookProjectionService","createWorkspaceBillingActionContributor","createWorkspaceBillingApi","DEFAULT_BILLING_PROVIDER","ensureBillingCatalogRepository","ensureBillingProductCatalogRepository","isBlockingCheckoutStatus","isCheckoutTerminalStatus","LOCK_ORDER","mapBillingPlanDuplicateError","mapBillingProductDuplicateError","mapBillingSettingsResponse","mapPlanEntitlementsToTemplates","mapPlanTemplatesToConsoleEntitlements","mapProductEntitlementsToTemplates","mapProductTemplatesToConsoleEntitlements","NON_TERMINAL_CURRENT_SUBSCRIPTION_STATUS_SET","normalizeBillingCatalogPlanCreatePayload","normalizeBillingCatalogPlanUpdatePayload","normalizeBillingCatalogProductCreatePayload","normalizeBillingCatalogProductUpdatePayload","normalizePaidPlanChangePaymentMethodPolicy","PAID_PLAN_CHANGE_POLICY_ALLOW_WITHOUT_PAYMENT_METHOD","PAID_PLAN_CHANGE_POLICY_REQUIRED_NOW","resolveBillingProvider","resolveBillingSettingsFromConsoleSettings","resolveCatalogCorePriceForCreate","resolveCatalogCorePriceForUpdate","resolveCatalogProductPriceForCreate","resolveCatalogProductPriceForUpdate","resolveProviderRequestSchemaVersion","resolveProviderSdkName","safeParseJson","statusFromFailureCode","TERMINAL_SUBSCRIPTION_STATUS_SET","toCanonicalJson","toSha256Hex","webhookProjectionServiceTestables"]),
    requireContractTest: 0
  }),
  "billing.store.mysql": Object.freeze({
    capabilityId: "billing.store.mysql",
    kind: "storage",
    summary: "Persistence contract for billing.store.mysql.",
    entrypoint: "./repository",
    symbols: Object.freeze(["__testables","createBillingRepository","createRepository"]),
    requireContractTest: 0
  }),
  "billing.worker": Object.freeze({
    capabilityId: "billing.worker",
    kind: "worker-runtime",
    summary: "Worker/operations contract for billing.worker.",
    entrypoint: ".",
    symbols: Object.freeze(["BILLING_SUBSYSTEM_EXPORT_IDS","billingReconciliationServiceTestables","billingWorkerRuntimeServiceTestables","createBillingDisabledServices","createBillingOutboxWorkerService","createBillingReconciliationService","createBillingRemediationWorkerService","createBillingSubsystem","createBillingWorkerRuntimeService"]),
    requireContractTest: 0
  }),
  "chat.client-element": Object.freeze({
    capabilityId: "chat.client-element",
    kind: "client-element",
    summary: "UI element contract for chat.client-element.",
    entrypoint: ".",
    symbols: Object.freeze(["ChatClientElement"]),
    requireContractTest: 0
  }),
  "chat.client-runtime": Object.freeze({
    capabilityId: "chat.client-runtime",
    kind: "client-runtime",
    summary: "Headless client runtime contract for chat.client-runtime.",
    entrypoint: ".",
    symbols: Object.freeze(["chatRuntimeTestables","createApi","createChatApi","createChatRuntime"]),
    requireContractTest: 0
  }),
  "chat.core": Object.freeze({
    capabilityId: "chat.core",
    kind: "service-contract",
    summary: "Canonical capability contract for chat.core.",
    entrypoint: ".",
    symbols: Object.freeze(["canonicalJsonTestables","chatRealtimeServiceTestables","chatServiceTestables","createAttachmentsRepository","createBlocksRepository","createChatActionContributor","createChatRealtimeService","createChatService","createIdempotencyTombstonesRepository","createMessagesRepository","createParticipantsRepository","createReactionsRepository","createThreadsRepository","createUserSettingsRepository","toCanonicalJson","toSha256Hex"]),
    requireContractTest: 0
  }),
  "chat.server-routes": Object.freeze({
    capabilityId: "chat.server-routes",
    kind: "server-routes",
    summary: "Transport route-wiring contract for chat.server-routes.",
    entrypoint: "./routes",
    symbols: Object.freeze(["buildRoutes"]),
    requireContractTest: 0
  }),
  "chat.storage": Object.freeze({
    capabilityId: "chat.storage",
    kind: "storage",
    summary: "Persistence contract for chat.storage.",
    entrypoint: ".",
    symbols: Object.freeze(["__testables","createService"]),
    requireContractTest: 0
  }),
  "communications.core": Object.freeze({
    capabilityId: "communications.core",
    kind: "service-contract",
    summary: "Canonical capability contract for communications.core.",
    entrypoint: ".",
    symbols: Object.freeze(["__testables","createDispatchRegistry","createOrchestrator","createService"]),
    requireContractTest: 0
  }),
  "communications.email": Object.freeze({
    capabilityId: "communications.email",
    kind: "service-contract",
    summary: "Canonical capability contract for communications.email.",
    entrypoint: ".",
    symbols: Object.freeze(["__testables","createService"]),
    requireContractTest: 0
  }),
  "communications.provider-contract": Object.freeze({
    capabilityId: "communications.provider-contract",
    kind: "provider-contract",
    summary: "Provider interface contract for communications.provider-contract.",
    entrypoint: ".",
    symbols: Object.freeze(["assertDispatchProvider","COMMUNICATION_CHANNELS","COMMUNICATION_PROVIDER_RESULT_REASONS","normalizeChannel"]),
    requireContractTest: 1
  }),
  "communications.server-routes": Object.freeze({
    capabilityId: "communications.server-routes",
    kind: "server-routes",
    summary: "Transport route-wiring contract for communications.server-routes.",
    entrypoint: "./routes",
    symbols: Object.freeze(["buildRoutes"]),
    requireContractTest: 0
  }),
  "communications.sms": Object.freeze({
    capabilityId: "communications.sms",
    kind: "service-contract",
    summary: "Canonical capability contract for communications.sms.",
    entrypoint: ".",
    symbols: Object.freeze(["__testables","createService"]),
    requireContractTest: 0
  }),
  "contracts.assistant": Object.freeze({
    capabilityId: "contracts.assistant",
    kind: "schema-contract",
    summary: "Shared schema contract for contracts.assistant.",
    entrypoint: ".",
    symbols: Object.freeze(["ASSISTANT_QUERY_KEY_PREFIX","ASSISTANT_STREAM_EVENT_TYPE_VALUES","ASSISTANT_STREAM_EVENT_TYPES","assistantConversationMessagesQueryKey","assistantConversationsListQueryKey","assistantRootQueryKey","assistantWorkspaceScopeQueryKey","isAssistantStreamEventType","normalizeAssistantStreamEvent","normalizeAssistantStreamEventType","WORKSPACE_AI_TRANSCRIPTS_QUERY_KEY_PREFIX","workspaceAiTranscriptMessagesQueryKey","workspaceAiTranscriptsListQueryKey","workspaceAiTranscriptsRootQueryKey","workspaceAiTranscriptsScopeQueryKey"]),
    requireContractTest: 0
  }),
  "contracts.chat": Object.freeze({
    capabilityId: "contracts.chat",
    kind: "schema-contract",
    summary: "Shared schema contract for contracts.chat.",
    entrypoint: ".",
    symbols: Object.freeze(["CHAT_QUERY_KEY_PREFIX","chatErrorTestables","chatInboxInfiniteQueryKey","chatRootQueryKey","chatScopeQueryKey","chatThreadMessagesInfiniteQueryKey","chatThreadQueryKey","mapChatError"]),
    requireContractTest: 0
  }),
  "contracts.communications": Object.freeze({
    capabilityId: "contracts.communications",
    kind: "schema-contract",
    summary: "Shared schema contract for contracts.communications.",
    entrypoint: ".",
    symbols: Object.freeze(["schema"]),
    requireContractTest: 0
  }),
  "contracts.http": Object.freeze({
    capabilityId: "contracts.http",
    kind: "schema-contract",
    summary: "Shared schema contract for contracts.http.",
    entrypoint: ".",
    symbols: Object.freeze(["__testables","apiErrorDetailsSchema","apiErrorResponseSchema","apiValidationErrorResponseSchema","createPaginationQuerySchema","enumSchema","fastifyDefaultErrorResponseSchema","fieldErrorsSchema","registerTypeBoxFormats","STANDARD_ERROR_STATUS_CODES","withStandardErrorResponses"]),
    requireContractTest: 0
  }),
  "contracts.realtime": Object.freeze({
    capabilityId: "contracts.realtime",
    kind: "schema-contract",
    summary: "Shared schema contract for contracts.realtime.",
    entrypoint: ".",
    symbols: Object.freeze(["createTopicCatalog","getAppTopicRule","getAppTopicScope","getTopicRule","hasAppTopicPermission","hasTopicPermission","isAppSupportedTopic","isAppTopicAllowedForSurface","isAppUserScopedTopic","isSupportedTopic","isTopicAllowedForSurface","isUserScopedTopic","isWorkspaceScopedTopic","listRealtimeTopics","listRealtimeTopicsForSurface","listTopics","listTopicsForSurface","REALTIME_ERROR_CODES","REALTIME_EVENT_TYPES","REALTIME_MESSAGE_TYPES","REALTIME_TOPIC_REGISTRY","REALTIME_TOPICS","resolveRequiredPermissions","resolveTopicScope","TOPIC_SCOPES"]),
    requireContractTest: 0
  }),
  "contracts.social": Object.freeze({
    capabilityId: "contracts.social",
    kind: "schema-contract",
    summary: "Shared schema contract for contracts.social.",
    entrypoint: ".",
    symbols: Object.freeze(["mapSocialError","SOCIAL_QUERY_KEY_PREFIX","socialActorSearchQueryKey","socialErrorTestables","socialFeedQueryKey","socialNotificationsQueryKey","socialPostQueryKey","socialRootQueryKey","socialScopeQueryKey"]),
    requireContractTest: 0
  }),
  "db-provider": Object.freeze({
    capabilityId: "db-provider",
    kind: "provider-family",
    summary: "Provider selection contract for db-provider.",
    entrypoint: "descriptor:package.descriptor.mjs",
    symbols: Object.freeze(["capabilities.provides"]),
    requireContractTest: 0
  }),
  "db.core": Object.freeze({
    capabilityId: "db.core",
    kind: "database-contract",
    summary: "Database contract for db.core.",
    entrypoint: ".",
    symbols: Object.freeze(["deleteRowsOlderThan","detectDialectFromClient","isDuplicateEntryError","jsonTextExpression","normalizeBatchSize","normalizeCutoffDateOrThrow","normalizeDeletedRowCount","normalizeDialect","normalizePath","retentionTestables","toDatabaseDateTimeUtc","toIsoString","whereJsonTextEquals"]),
    requireContractTest: 0
  }),
  "db.driver.knex-mysql": Object.freeze({
    capabilityId: "db.driver.knex-mysql",
    kind: "database-contract",
    summary: "Database contract for db.driver.knex-mysql.",
    entrypoint: ".",
    symbols: Object.freeze(["DIALECT_ID","getDialectId"]),
    requireContractTest: 0
  }),
  "db.driver.knex-postgres": Object.freeze({
    capabilityId: "db.driver.knex-postgres",
    kind: "database-contract",
    summary: "Database contract for db.driver.knex-postgres.",
    entrypoint: ".",
    symbols: Object.freeze(["DIALECT_ID","getDialectId"]),
    requireContractTest: 0
  }),
  "observability.console-errors-client": Object.freeze({
    capabilityId: "observability.console-errors-client",
    kind: "service-contract",
    summary: "Canonical capability contract for observability.console-errors-client.",
    entrypoint: ".",
    symbols: Object.freeze(["ConsoleErrorDetailClientElement","ConsoleErrorListClientElement"]),
    requireContractTest: 0
  }),
  "observability.core": Object.freeze({
    capabilityId: "observability.core",
    kind: "service-contract",
    summary: "Canonical capability contract for observability.core.",
    entrypoint: ".",
    symbols: Object.freeze(["BROWSER_ERRORS_READ_PERMISSION","createBrowserErrorPayloadTools","createConsoleErrorPayloadNormalizer","createConsoleErrorsApi","createConsoleErrorsService","createMetricsRegistry","createScopeDebugMatcher","createScopedLogger","createService","normalizeBrowserPayload","normalizeErrorEntryId","normalizeMetricLabel","normalizePagination","normalizeServerPayload","normalizeSimulationKind","SERVER_ERRORS_READ_PERMISSION","SERVER_SIMULATION_KINDS"]),
    requireContractTest: 0
  }),
  "observability.server-routes": Object.freeze({
    capabilityId: "observability.server-routes",
    kind: "server-routes",
    summary: "Transport route-wiring contract for observability.server-routes.",
    entrypoint: "./routes",
    symbols: Object.freeze(["buildRoutes"]),
    requireContractTest: 0
  }),
  "ops.redis": Object.freeze({
    capabilityId: "ops.redis",
    kind: "worker-runtime",
    summary: "Worker/operations contract for ops.redis.",
    entrypoint: ".",
    symbols: Object.freeze(["acquireDistributedLock","buildRedisScopedKey","closeWorkerRedisConnection","createRateLimitPluginOptions","createRetentionDeadLetterQueue","createRetentionQueue","createRetentionSweepLockKey","createRetentionSweepOrchestrator","createRetentionSweepProcessor","createWorkerRedisConnection","createWorkerRedisPrefix","createWorkerRuntime","enqueueRetentionDeadLetterJob","enqueueRetentionSweep","extendDistributedLock","isRetentionLockHeldError","normalizeBoolean","normalizeLockTtlMs","normalizeRedisNamespace","normalizeRetentionBatchSize","normalizeRetentionDays","normalizeRetentionHours","normalizeRetentionSweepPayload","RATE_LIMIT_MODE_MEMORY","RATE_LIMIT_MODE_REDIS","RATE_LIMIT_REDIS_NAMESPACE_SEGMENT","releaseDistributedLock","resolveCutoffDate","resolveRateLimitStartupError","resolveRateLimitStartupWarning","RETENTION_DEAD_LETTER_JOB_NAME","RETENTION_DEAD_LETTER_QUEUE_NAME","RETENTION_QUEUE_NAME","RETENTION_SWEEP_JOB_NAME","RetentionLockHeldError","runBatchedDeletion"]),
    requireContractTest: 0
  }),
  "ops.retention": Object.freeze({
    capabilityId: "ops.retention",
    kind: "worker-runtime",
    summary: "Worker/operations contract for ops.retention.",
    entrypoint: ".",
    symbols: Object.freeze(["__testables","buildRetentionPolicyFromRepositoryConfig","createService","resolveRetentionPolicyConfig"]),
    requireContractTest: 0
  }),
  "realtime.client": Object.freeze({
    capabilityId: "realtime.client",
    kind: "client-runtime",
    summary: "Headless client runtime contract for realtime.client.",
    entrypoint: ".",
    symbols: Object.freeze(["assertRealtimeTransport","createCommandTracker","createRealtimeRuntime","createReconnectPolicy","createReplayPolicy","createSocketIoTransport","DEFAULT_COMMAND_TRACKER_OPTIONS","DEFAULT_RECONNECT_POLICY","DEFAULT_REPLAY_POLICY","DEFAULT_SOCKET_IO_TRANSPORT_OPTIONS","runtimeTestables"]),
    requireContractTest: 0
  }),
  "realtime.server": Object.freeze({
    capabilityId: "realtime.server",
    kind: "service-contract",
    summary: "Canonical capability contract for realtime.server.",
    entrypoint: ".",
    symbols: Object.freeze(["__testables","MAX_INBOUND_MESSAGE_BYTES","registerRealtimeServerSocketio","SOCKET_IO_MESSAGE_EVENT","SOCKET_IO_PATH"]),
    requireContractTest: 0
  }),
  "runtime.actions": Object.freeze({
    capabilityId: "runtime.actions",
    kind: "runtime-primitive",
    summary: "Runtime infrastructure contract for runtime.actions.",
    entrypoint: ".",
    symbols: Object.freeze(["ACTION_CHANNELS","ACTION_DOMAINS","ACTION_ID_VALUES","ACTION_IDEMPOTENCY_POLICIES","ACTION_IDS","ACTION_KINDS","ACTION_SURFACES","ACTION_VISIBILITY_LEVELS","ActionRuntimeError","applyRealtimePublishToCommandAction","createActionRegistry","createActionRuntimeError","createActionVersionKey","createNoopAuditAdapter","createNoopIdempotencyAdapter","createNoopObservabilityAdapter","createPermissionEvaluator","ensureActionChannelAllowed","ensureActionSurfaceAllowed","ensureActionVisibilityAllowed","ensureIdempotencyKeyIfRequired","executeActionPipeline","normalizeActionContributor","normalizeActionDefinition","normalizeActionInput","normalizeActionOutput","normalizeExecutionContext","publishRealtimeCommandEvent","resolveActionIdempotencyKey","resolveCommandId","resolveSourceClientId"]),
    requireContractTest: 0
  }),
  "runtime.env": Object.freeze({
    capabilityId: "runtime.env",
    kind: "runtime-primitive",
    summary: "Runtime infrastructure contract for runtime.env.",
    entrypoint: ".",
    symbols: Object.freeze(["assertEnabledSubsystemStartupPreflight","createAiRuntimeSpec","createAuthRuntimeSpec","createBillingRuntimeSpec","createCoreRuntimeSpec","createDatabaseRuntimeSpec","createEmailRuntimeSpec","createObservabilityRuntimeSpec","createPlatformRuntimeEnv","createPlatformRuntimeEnvSpec","createRedisRuntimeSpec","createSmsRuntimeSpec","createSocialRuntimeSpec","createStorageRuntimeSpec","createWorkerRuntimeSpec","hasNonEmptyEnvValue","loadDotenvFiles","PLATFORM_RUNTIME_DEFAULTS","resolveAppConfig","resolveAuthJwtAudience","resolveAuthProviderId","resolveDotenvPaths","resolveSupabaseAuthUrl","toBrowserConfig"]),
    requireContractTest: 0
  }),
  "runtime.health-server-routes": Object.freeze({
    capabilityId: "runtime.health-server-routes",
    kind: "runtime-primitive",
    summary: "Runtime infrastructure contract for runtime.health-server-routes.",
    entrypoint: "./routes",
    symbols: Object.freeze(["buildRoutes"]),
    requireContractTest: 0
  }),
  "runtime.http-client": Object.freeze({
    capabilityId: "runtime.http-client",
    kind: "runtime-primitive",
    summary: "Runtime infrastructure contract for runtime.http-client.",
    entrypoint: ".",
    symbols: Object.freeze(["createHttpClient","createHttpError","createNetworkError","DEFAULT_RETRYABLE_CSRF_ERROR_CODES","hasHeader","normalizeHeaderName","setHeaderIfMissing","shouldRetryForCsrfFailure"]),
    requireContractTest: 0
  }),
  "runtime.module-framework": Object.freeze({
    capabilityId: "runtime.module-framework",
    kind: "runtime-primitive",
    summary: "Runtime infrastructure contract for runtime.module-framework.",
    entrypoint: ".",
    symbols: Object.freeze(["assertUniqueModuleIds","composeClientModules","composeServerModules","createDiagnostic","createDiagnosticsCollector","defineModule","detectActionConflicts","detectRouteConflicts","detectTopicConflicts","DIAGNOSTIC_LEVELS","loadClientAppDropinsFromModules","loadServerAppDropins","mergeClientModuleRegistry","MODULE_ENABLEMENT_MODES","MODULE_TIERS","resolveCapabilityGraph","resolveConflicts","resolveDependencyGraph","resolveMounts","satisfiesVersion","throwOnDiagnosticErrors","validateModuleDescriptor","validateModuleDescriptors"]),
    requireContractTest: 0
  }),
  "runtime.platform-server": Object.freeze({
    capabilityId: "runtime.platform-server",
    kind: "runtime-primitive",
    summary: "Runtime infrastructure contract for runtime.platform-server.",
    entrypoint: ".",
    symbols: Object.freeze(["createPlatformRuntimeBundle","createServerRuntime","createServerRuntimeWithPlatformBundle"]),
    requireContractTest: 0
  }),
  "runtime.server": Object.freeze({
    capabilityId: "runtime.server",
    kind: "runtime-primitive",
    summary: "Runtime infrastructure contract for runtime.server.",
    entrypoint: ".",
    symbols: Object.freeze(["AppError","buildAuditError","buildAuditEventBase","buildLoginRedirectPathFromRequest","buildPublishRequestMeta","buildRoutesFromManifest","createControllerRegistry","createFastifyLoggerOptions","createRealtimeEventEnvelope","createRealtimeEventsBus","createRepositoryRegistry","createRuntimeAssembly","createRuntimeComposition","createRuntimeKernel","createService","createServiceRegistry","createTargetedChatEventEnvelope","isAppError","mergeRuntimeBundles","normalizeEntityId","normalizeHeaderValue","normalizePagination","normalizePositiveIntegerArray","normalizePositiveIntegerOrNull","normalizeRuntimeBundle","normalizeScopeKind","normalizeStringifiedPositiveIntegerOrNull","normalizeStringOrNull","parsePositiveInteger","publishSafely","recordAuditEvent","recordDbErrorBestEffort","registerApiErrorHandler","registerApiRouteDefinitions","registerRequestLoggingHooks","resolveClientIpAddress","resolveDatabaseErrorCode","resolveLoggerLevel","resolvePublishMethod","runGracefulShutdown","safePathnameFromRequest","safeRequestUrl","selectRuntimeServices","warnPublishFailure","withAuditEvent"]),
    requireContractTest: 0
  }),
  "runtime.surface-routing": Object.freeze({
    capabilityId: "runtime.surface-routing",
    kind: "runtime-primitive",
    summary: "Runtime infrastructure contract for runtime.surface-routing.",
    entrypoint: ".",
    symbols: Object.freeze(["API_BASE_PATH","API_DOCS_PATH","API_MAJOR_VERSION","API_PREFIX","API_PREFIX_SLASH","API_REALTIME_PATH","API_VERSION_SEGMENT","buildVersionedApiPath","createDefaultAppSurfacePaths","createDefaultAppSurfaceRegistry","createSurfacePathHelpers","createSurfaceRegistry","DEFAULT_ROUTES","DEFAULT_SURFACES","isApiPath","isVersionedApiPath","isVersionedApiPrefixMatch","normalizePathname","toVersionedApiPath","toVersionedApiPrefix"]),
    requireContractTest: 0
  }),
  "runtime.web": Object.freeze({
    capabilityId: "runtime.web",
    kind: "runtime-primitive",
    summary: "Runtime infrastructure contract for runtime.web.",
    entrypoint: "descriptor:package.descriptor.mjs",
    symbols: Object.freeze(["capabilities.provides"]),
    requireContractTest: 0
  }),
  "runtime.web-shell-host": Object.freeze({
    capabilityId: "runtime.web-shell-host",
    kind: "runtime-primitive",
    summary: "Runtime infrastructure contract for runtime.web-shell-host.",
    entrypoint: "descriptor:package.descriptor.mjs",
    symbols: Object.freeze(["capabilities.provides"]),
    requireContractTest: 0
  }),
  "security.audit.core": Object.freeze({
    capabilityId: "security.audit.core",
    kind: "service-contract",
    summary: "Canonical capability contract for security.audit.core.",
    entrypoint: ".",
    symbols: Object.freeze(["__testables","auditEventsRepositoryTestables","createAuditEventsRepository","createService"]),
    requireContractTest: 0
  }),
  "security.audit.store": Object.freeze({
    capabilityId: "security.audit.store",
    kind: "storage",
    summary: "Persistence contract for security.audit.store.",
    entrypoint: ".",
    symbols: Object.freeze(["__testables","auditEventsRepositoryTestables","createAuditEventsRepository","createService"]),
    requireContractTest: 0
  }),
  "social.client-runtime": Object.freeze({
    capabilityId: "social.client-runtime",
    kind: "client-runtime",
    summary: "Headless client runtime contract for social.client-runtime.",
    entrypoint: ".",
    symbols: Object.freeze(["createApi","createSocialApi","createSocialRuntime","socialRuntimeTestables"]),
    requireContractTest: 0
  }),
  "social.core": Object.freeze({
    capabilityId: "social.core",
    kind: "service-contract",
    summary: "Canonical capability contract for social.core.",
    entrypoint: ".",
    symbols: Object.freeze(["createRepository","createSocialActionContributor","createSocialOutboxWorkerRuntimeService","createSocialService","socialRepositoryTestables","socialServiceTestables"]),
    requireContractTest: 0
  }),
  "social.server-routes": Object.freeze({
    capabilityId: "social.server-routes",
    kind: "server-routes",
    summary: "Transport route-wiring contract for social.server-routes.",
    entrypoint: "./routes",
    symbols: Object.freeze(["buildRoutes"]),
    requireContractTest: 0
  }),
  "social.storage": Object.freeze({
    capabilityId: "social.storage",
    kind: "storage",
    summary: "Persistence contract for social.storage.",
    entrypoint: ".",
    symbols: Object.freeze(["createRepository","createSocialActionContributor","createSocialOutboxWorkerRuntimeService","createSocialService","socialRepositoryTestables","socialServiceTestables"]),
    requireContractTest: 0
  }),
  "tooling.app-scripts": Object.freeze({
    capabilityId: "tooling.app-scripts",
    kind: "tooling-contract",
    summary: "Tooling contract for tooling.app-scripts.",
    entrypoint: ".",
    symbols: Object.freeze(["createNodeVueFastifyScriptsConfig"]),
    requireContractTest: 0
  }),
  "tooling.create-app": Object.freeze({
    capabilityId: "tooling.create-app",
    kind: "tooling-contract",
    summary: "Tooling contract for tooling.create-app.",
    entrypoint: ".",
    symbols: Object.freeze(["createApp","runCli"]),
    requireContractTest: 0
  }),
  "tooling.eslint-config": Object.freeze({
    capabilityId: "tooling.eslint-config",
    kind: "tooling-contract",
    summary: "Tooling contract for tooling.eslint-config.",
    entrypoint: ".",
    symbols: Object.freeze(["baseConfig","nodeConfig","vueConfig","webConfig"]),
    requireContractTest: 0
  }),
  "tooling.jskit-cli": Object.freeze({
    capabilityId: "tooling.jskit-cli",
    kind: "tooling-contract",
    summary: "Tooling contract for tooling.jskit-cli.",
    entrypoint: ".",
    symbols: Object.freeze(["runCli","runCommand"]),
    requireContractTest: 0
  }),
  "users.members-admin.client": Object.freeze({
    capabilityId: "users.members-admin.client",
    kind: "client-runtime",
    summary: "Headless client runtime contract for users.members-admin.client.",
    entrypoint: ".",
    symbols: Object.freeze(["MembersAdminClientElement"]),
    requireContractTest: 0
  }),
  "users.profile.client": Object.freeze({
    capabilityId: "users.profile.client",
    kind: "client-runtime",
    summary: "Headless client runtime contract for users.profile.client.",
    entrypoint: ".",
    symbols: Object.freeze(["ProfileClientElement"]),
    requireContractTest: 0
  }),
  "users.profile.core": Object.freeze({
    capabilityId: "users.profile.core",
    kind: "service-contract",
    summary: "Canonical capability contract for users.profile.core.",
    entrypoint: ".",
    symbols: Object.freeze(["__testables","createRepository","resolveProfileIdentity"]),
    requireContractTest: 0
  }),
  "users.profile.store": Object.freeze({
    capabilityId: "users.profile.store",
    kind: "storage",
    summary: "Persistence contract for users.profile.store.",
    entrypoint: ".",
    symbols: Object.freeze(["__testables","createRepository","resolveProfileIdentity"]),
    requireContractTest: 0
  }),
  "workspace.console-errors.server-routes": Object.freeze({
    capabilityId: "workspace.console-errors.server-routes",
    kind: "server-routes",
    summary: "Transport route-wiring contract for workspace.console-errors.server-routes.",
    entrypoint: "./routes",
    symbols: Object.freeze(["buildRoutes"]),
    requireContractTest: 0
  }),
  "workspace.console.core": Object.freeze({
    capabilityId: "workspace.console.core",
    kind: "service-contract",
    summary: "Canonical capability contract for workspace.console.core.",
    entrypoint: ".",
    symbols: Object.freeze(["addFieldError","buildFieldSchema","buildPatch","buildSchema","coerceWorkspaceColor","CONSOLE_AI_TRANSCRIPTS_PERMISSIONS","CONSOLE_ASSISTANT_SETTINGS_PERMISSIONS","CONSOLE_BILLING_PERMISSIONS","CONSOLE_MANAGEMENT_PERMISSIONS","CONSOLE_ROLE_DEFINITIONS","CONSOLE_ROLE_ID","createFieldErrorBag","createMembershipIndexes","createWorkspaceSettingsPatchPolicy","DEFAULT_WORKSPACE_COLOR","DEVOP_ROLE_ID","getRoleCatalog","hasFieldErrors","hasOwn","hasPermission","isAllowedAvatarMimeType","isObjectRecord","isValidCurrencyCode","isValidLocale","isValidTimeZone","isWorkspaceColor","listRoleDescriptors","mapMembershipSummary","MODERATOR_ROLE_ID","normalizeAvatarSize","normalizeMembershipForAccess","normalizePermissions","normalizeRoleId","resolveMembershipRoleId","resolveMembershipStatus","resolveRolePermissions","toBoolean","toCurrencyCode","toEnum","toLocale","toNullableString","toPositiveInt","toRoleDescriptor","toTimeZone","toTrimmedString","toValidationError","validateAvatarUpload","WORKSPACE_COLOR_PATTERN"]),
    requireContractTest: 0
  }),
  "workspace.console.server-routes": Object.freeze({
    capabilityId: "workspace.console.server-routes",
    kind: "server-routes",
    summary: "Transport route-wiring contract for workspace.console.server-routes.",
    entrypoint: "./routes",
    symbols: Object.freeze(["buildRoutes"]),
    requireContractTest: 0
  }),
  "workspace.console.service": Object.freeze({
    capabilityId: "workspace.console.service",
    kind: "service-contract",
    summary: "Canonical capability contract for workspace.console.service.",
    entrypoint: ".",
    symbols: Object.freeze(["consoleErrorLogsRepositoryTestables","consoleInvitesRepositoryTestables","consoleMembershipsRepositoryTestables","consoleRootRepositoryTestables","consoleSettingsRepositoryTestables","createConsoleAccessService","createConsoleActionContributor","createConsoleApi","createConsoleCoreActionContributor","createConsoleErrorLogsRepository","createConsoleInvitesRepository","createConsoleInvitesService","createConsoleMembershipsRepository","createConsoleMembersService","createConsoleRootRepository","createConsoleSettingsRepository","DEFAULT_INVITE_TTL_HOURS","mapInvite","mapMember","mapMembershipSummary","mapPendingInvite","resolveInviteExpiresAt"]),
    requireContractTest: 0
  }),
  "workspace.console.store": Object.freeze({
    capabilityId: "workspace.console.store",
    kind: "storage",
    summary: "Persistence contract for workspace.console.store.",
    entrypoint: ".",
    symbols: Object.freeze(["consoleErrorLogsRepositoryTestables","consoleInvitesRepositoryTestables","consoleMembershipsRepositoryTestables","consoleRootRepositoryTestables","consoleSettingsRepositoryTestables","createConsoleAccessService","createConsoleActionContributor","createConsoleApi","createConsoleCoreActionContributor","createConsoleErrorLogsRepository","createConsoleInvitesRepository","createConsoleInvitesService","createConsoleMembershipsRepository","createConsoleMembersService","createConsoleRootRepository","createConsoleSettingsRepository","DEFAULT_INVITE_TTL_HOURS","mapInvite","mapMember","mapMembershipSummary","mapPendingInvite","resolveInviteExpiresAt"]),
    requireContractTest: 0
  }),
  "workspace.server-routes": Object.freeze({
    capabilityId: "workspace.server-routes",
    kind: "server-routes",
    summary: "Transport route-wiring contract for workspace.server-routes.",
    entrypoint: "./routes",
    symbols: Object.freeze(["buildRoutes"]),
    requireContractTest: 0
  }),
  "workspace.service": Object.freeze({
    capabilityId: "workspace.service",
    kind: "service-contract",
    summary: "Canonical capability contract for workspace.service.",
    entrypoint: ".",
    symbols: Object.freeze(["__testables","buildWorkspaceBaseSlug","buildWorkspaceName","collectInviteWorkspaceIds","createWorkspaceActionContributor","createWorkspaceApi","createWorkspaceInvitesRepository","createWorkspaceMembershipsRepository","createWorkspaceSettingsDefaults","createWorkspaceSettingsRepository","createWorkspacesRepository","DEFAULT_INVITE_EXPIRY_DAYS","listInviteMembershipsByWorkspaceId","mapPendingInviteSummary","mapUserSettingsPublic","mapWorkspaceAdminSummary","mapWorkspaceInviteSummary","mapWorkspaceMembershipSummary","mapWorkspaceMemberSummary","mapWorkspacePayloadSummary","mapWorkspaceSettingsPublic","mapWorkspaceSettingsResponse","normalizeWorkspaceColor","parseWorkspaceSettingsPatch","resolveInviteExpiresAt","resolveRequestedWorkspaceSlug","resolveRequestSurfaceId","toSlugPart","workspaceInvitesRepositoryTestables","workspaceMembershipsRepositoryTestables","workspaceSettingsRepositoryTestables","workspacesRepositoryTestables"]),
    requireContractTest: 0
  }),
  "workspace.settings.server-routes": Object.freeze({
    capabilityId: "workspace.settings.server-routes",
    kind: "server-routes",
    summary: "Transport route-wiring contract for workspace.settings.server-routes.",
    entrypoint: "./routes",
    symbols: Object.freeze(["buildRoutes"]),
    requireContractTest: 0
  }),
  "workspace.store": Object.freeze({
    capabilityId: "workspace.store",
    kind: "storage",
    summary: "Persistence contract for workspace.store.",
    entrypoint: ".",
    symbols: Object.freeze(["__testables","buildWorkspaceBaseSlug","buildWorkspaceName","collectInviteWorkspaceIds","createWorkspaceActionContributor","createWorkspaceApi","createWorkspaceInvitesRepository","createWorkspaceMembershipsRepository","createWorkspaceSettingsDefaults","createWorkspaceSettingsRepository","createWorkspacesRepository","DEFAULT_INVITE_EXPIRY_DAYS","listInviteMembershipsByWorkspaceId","mapPendingInviteSummary","mapUserSettingsPublic","mapWorkspaceAdminSummary","mapWorkspaceInviteSummary","mapWorkspaceMembershipSummary","mapWorkspaceMemberSummary","mapWorkspacePayloadSummary","mapWorkspaceSettingsPublic","mapWorkspaceSettingsResponse","normalizeWorkspaceColor","parseWorkspaceSettingsPatch","resolveInviteExpiresAt","resolveRequestedWorkspaceSlug","resolveRequestSurfaceId","toSlugPart","workspaceInvitesRepositoryTestables","workspaceMembershipsRepositoryTestables","workspaceSettingsRepositoryTestables","workspacesRepositoryTestables"]),
    requireContractTest: 0
  }),
});

const CAPABILITY_CONTRACT_IDS = Object.freeze(
  Object.keys(CAPABILITY_CONTRACTS).sort((left, right) => left.localeCompare(right))
);

function normalizeCapabilityId(capabilityId) {
  return String(capabilityId || "").trim();
}

function getCapabilityContract(capabilityId) {
  const normalized = normalizeCapabilityId(capabilityId);
  return CAPABILITY_CONTRACTS[normalized] || null;
}

function listCapabilityContracts() {
  return CAPABILITY_CONTRACT_IDS.map((capabilityId) => CAPABILITY_CONTRACTS[capabilityId]);
}

function getCapabilityContractTestRelativePath(capabilityId) {
  const normalized = normalizeCapabilityId(capabilityId);
  if (!normalized) {
    return "";
  }
  return `test/contracts/${normalized}.contract.test.js`;
}

export {
  CAPABILITY_CONTRACTS,
  CAPABILITY_CONTRACT_IDS,
  normalizeCapabilityId,
  getCapabilityContract,
  listCapabilityContracts,
  getCapabilityContractTestRelativePath
};

