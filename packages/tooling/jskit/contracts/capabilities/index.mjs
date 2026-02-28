// Central capability contracts (WHAT).
// Provider/consumer graph (WHO) is derived from descriptors at lint/doc time.

function deepFreeze(value) {
  if (!value || typeof value !== "object") {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

const CAPABILITY_CONTRACTS_BY_DOMAIN = deepFreeze({
  "assistant": {
    "client-runtime": {
      "capabilityId": "assistant.client-runtime",
      "kind": "client-runtime",
      "summary": "Headless client runtime contract for assistant.client-runtime.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "assistantRuntimeTestables",
            "buildStreamEventError",
            "createApi",
            "createAssistantApi",
            "createAssistantRuntime",
            "createConsoleTranscriptsApi",
            "createWorkspaceTranscriptsApi"
          ]
        },
        {
          "entrypoint": "./consoleTranscriptsApi",
          "functions": [
            "createApi"
          ]
        },
        {
          "entrypoint": "./workspaceTranscriptsApi",
          "functions": [
            "createApi"
          ]
        }
      ]
    },
    "core": {
      "capabilityId": "assistant.core",
      "kind": "service-contract",
      "summary": "Canonical capability contract for assistant.core.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "applyAssistantSystemPromptAppToWorkspaceFeatures",
            "applyAssistantSystemPromptsToWorkspaceFeatures",
            "applyAssistantSystemPromptWorkspaceToConsoleFeatures",
            "assistantServiceTestables",
            "assistantToolRegistryTestables",
            "buildAiToolRegistry",
            "createAssistantService",
            "executeToolCall",
            "listToolSchemas",
            "normalizePromptValue",
            "resolveAssistantSystemPromptAppFromWorkspaceSettings",
            "resolveAssistantSystemPromptsFromWorkspaceSettings",
            "resolveAssistantSystemPromptWorkspaceFromConsoleSettings"
          ],
          "constants": [
            "AI_ASSISTANT_SYSTEM_PROMPT_MAX_LENGTH"
          ]
        },
        {
          "entrypoint": "./systemPrompt",
          "functions": [
            "applyAssistantSystemPromptAppToWorkspaceFeatures",
            "applyAssistantSystemPromptsToWorkspaceFeatures",
            "applyAssistantSystemPromptWorkspaceToConsoleFeatures",
            "normalizePromptValue",
            "resolveAssistantSystemPromptAppFromWorkspaceSettings",
            "resolveAssistantSystemPromptsFromWorkspaceSettings",
            "resolveAssistantSystemPromptWorkspaceFromConsoleSettings"
          ],
          "constants": [
            "AI_ASSISTANT_SYSTEM_PROMPT_MAX_LENGTH"
          ]
        }
      ]
    },
    "provider": {
      "capabilityId": "assistant.provider",
      "kind": "provider-family",
      "summary": "Provider selection contract for assistant.provider.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "assistantProviderOpenAiTestables",
            "createOpenAiClient"
          ]
        }
      ]
    },
    "transcripts": {
      "core": {
        "capabilityId": "assistant.transcripts.core",
        "kind": "service-contract",
        "summary": "Canonical capability contract for assistant.transcripts.core.",
        "api": [
          {
            "entrypoint": ".",
            "functions": [
              "applyTranscriptModeToWorkspaceFeatures",
              "assistantTranscriptsServiceTestables",
              "createAssistantTranscriptsService",
              "createConsoleTranscriptsActionContributor",
              "createConversationsRepository",
              "createMessagesRepository",
              "normalizeTranscriptMode",
              "redactSecrets",
              "redactSecretsTestables",
              "resolveTranscriptModeFromWorkspaceSettings"
            ],
            "constants": [
              "REDACTION_VERSION",
              "TRANSCRIPT_MODE_DISABLED",
              "TRANSCRIPT_MODE_RESTRICTED",
              "TRANSCRIPT_MODE_STANDARD",
              "TRANSCRIPT_MODE_VALUES"
            ]
          },
          {
            "entrypoint": "./actions/consoleTranscripts",
            "functions": [
              "createConsoleTranscriptsActionContributor"
            ]
          },
          {
            "entrypoint": "./repositories/conversations",
            "functions": [
              "createConversationsRepository",
              "createRepository"
            ]
          },
          {
            "entrypoint": "./repositories/messages",
            "functions": [
              "createMessagesRepository",
              "createRepository"
            ]
          }
        ]
      }
    }
  },
  "auth": {
    "access": {
      "capabilityId": "auth.access",
      "kind": "service-contract",
      "summary": "Canonical capability contract for auth.access.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "buildAuthMethodDefinitions",
            "buildAuthMethodIds",
            "buildInviteToken",
            "buildOAuthMethodDefinitions",
            "buildOAuthMethodId",
            "confirmPassword",
            "createAuthApi",
            "createMembershipIndexes",
            "encodeInviteTokenHash",
            "findAuthMethodDefinition",
            "forgotPasswordInput",
            "hashInviteToken",
            "isSha256Hex",
            "isValidOAuthProviderId",
            "loginInput",
            "loginPassword",
            "mapMembershipSummary",
            "normalizeEmail",
            "normalizeInviteToken",
            "normalizeMembershipForAccess",
            "normalizeOAuthIntent",
            "normalizeOAuthProviderId",
            "normalizeOAuthProviderList",
            "normalizePermissions",
            "normalizeReturnToPath",
            "parseAuthMethodId",
            "registerInput",
            "registerPassword",
            "resetPassword",
            "resetPasswordInput",
            "resolveInviteTokenHash",
            "resolveMembershipRoleId",
            "resolveMembershipStatus",
            "validators"
          ],
          "constants": [
            "AUTH_ACCESS_TOKEN_MAX_LENGTH",
            "AUTH_EMAIL_MAX_LENGTH",
            "AUTH_EMAIL_MIN_LENGTH",
            "AUTH_EMAIL_PATTERN",
            "AUTH_EMAIL_REGEX",
            "AUTH_LOGIN_PASSWORD_MAX_LENGTH",
            "AUTH_METHOD_DEFINITIONS",
            "AUTH_METHOD_EMAIL_OTP_ID",
            "AUTH_METHOD_EMAIL_OTP_PROVIDER",
            "AUTH_METHOD_IDS",
            "AUTH_METHOD_KIND_OAUTH",
            "AUTH_METHOD_KIND_OTP",
            "AUTH_METHOD_KIND_PASSWORD",
            "AUTH_METHOD_KINDS",
            "AUTH_METHOD_MINIMUM_ENABLED",
            "AUTH_METHOD_PASSWORD_ID",
            "AUTH_METHOD_PASSWORD_PROVIDER",
            "AUTH_PASSWORD_MAX_LENGTH",
            "AUTH_PASSWORD_MIN_LENGTH",
            "AUTH_RECOVERY_TOKEN_MAX_LENGTH",
            "AUTH_REFRESH_TOKEN_MAX_LENGTH",
            "OAUTH_PROVIDER_ID_PATTERN",
            "OAUTH_PROVIDER_ID_REGEX",
            "OAUTH_QUERY_PARAM_INTENT",
            "OAUTH_QUERY_PARAM_PROVIDER",
            "OAUTH_QUERY_PARAM_RETURN_TO",
            "OPAQUE_INVITE_TOKEN_HASH_PREFIX"
          ]
        },
        {
          "entrypoint": "./authConstraints",
          "constants": [
            "AUTH_ACCESS_TOKEN_MAX_LENGTH",
            "AUTH_EMAIL_MAX_LENGTH",
            "AUTH_EMAIL_MIN_LENGTH",
            "AUTH_EMAIL_PATTERN",
            "AUTH_EMAIL_REGEX",
            "AUTH_LOGIN_PASSWORD_MAX_LENGTH",
            "AUTH_PASSWORD_MAX_LENGTH",
            "AUTH_PASSWORD_MIN_LENGTH",
            "AUTH_RECOVERY_TOKEN_MAX_LENGTH",
            "AUTH_REFRESH_TOKEN_MAX_LENGTH"
          ]
        },
        {
          "entrypoint": "./authMethods",
          "functions": [
            "buildAuthMethodDefinitions",
            "buildAuthMethodIds",
            "buildOAuthMethodDefinitions",
            "buildOAuthMethodId",
            "findAuthMethodDefinition",
            "parseAuthMethodId"
          ],
          "constants": [
            "AUTH_METHOD_DEFINITIONS",
            "AUTH_METHOD_EMAIL_OTP_ID",
            "AUTH_METHOD_EMAIL_OTP_PROVIDER",
            "AUTH_METHOD_IDS",
            "AUTH_METHOD_KIND_OAUTH",
            "AUTH_METHOD_KIND_OTP",
            "AUTH_METHOD_KIND_PASSWORD",
            "AUTH_METHOD_KINDS",
            "AUTH_METHOD_MINIMUM_ENABLED",
            "AUTH_METHOD_PASSWORD_ID",
            "AUTH_METHOD_PASSWORD_PROVIDER"
          ]
        },
        {
          "entrypoint": "./client/authApi",
          "functions": [
            "createApi"
          ]
        },
        {
          "entrypoint": "./inviteTokens",
          "functions": [
            "buildInviteToken",
            "encodeInviteTokenHash",
            "hashInviteToken",
            "isSha256Hex",
            "normalizeInviteToken",
            "resolveInviteTokenHash"
          ],
          "constants": [
            "OPAQUE_INVITE_TOKEN_HASH_PREFIX"
          ]
        },
        {
          "entrypoint": "./oauthCallbackParams",
          "constants": [
            "OAUTH_QUERY_PARAM_INTENT",
            "OAUTH_QUERY_PARAM_PROVIDER",
            "OAUTH_QUERY_PARAM_RETURN_TO"
          ]
        },
        {
          "entrypoint": "./oauthProviders",
          "functions": [
            "isValidOAuthProviderId",
            "normalizeOAuthProviderId",
            "normalizeOAuthProviderList"
          ],
          "constants": [
            "OAUTH_PROVIDER_ID_PATTERN",
            "OAUTH_PROVIDER_ID_REGEX"
          ]
        },
        {
          "entrypoint": "./utils",
          "functions": [
            "normalizeEmail",
            "normalizeOAuthIntent",
            "normalizeReturnToPath"
          ]
        },
        {
          "entrypoint": "./validators",
          "functions": [
            "validators"
          ]
        }
      ]
    },
    "policy": {
      "capabilityId": "auth.policy",
      "kind": "service-contract",
      "summary": "Canonical capability contract for auth.policy.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "authPolicyPlugin",
            "mergeAuthPolicy",
            "withAuthPolicy"
          ]
        }
      ]
    },
    "provider": {
      "capabilityId": "auth.provider",
      "kind": "provider-family",
      "summary": "Provider selection contract for auth.provider.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "createAuthActionContributor",
            "createService"
          ]
        },
        {
          "entrypoint": "./service",
          "functions": [
            "createService"
          ]
        },
        {
          "entrypoint": "./test-utils",
          "functions": [
            "buildAuthMethodsStatusFromProviderIds",
            "buildOAuthLinkRedirectUrl",
            "buildOAuthLoginRedirectUrl",
            "buildOAuthProviderCatalogResponse",
            "buildOAuthRedirectUrl",
            "buildOtpLoginRedirectUrl",
            "buildSecurityStatusFromAuthMethodsStatus",
            "collectProviderIdsFromSupabaseUser",
            "createAccountFlows",
            "createOauthFlows",
            "createPasswordSecurityFlows",
            "findAuthMethodById",
            "findLinkedIdentityByProvider",
            "isTransientAuthMessage",
            "isTransientSupabaseError",
            "isUserNotFoundLikeAuthError",
            "mapAuthError",
            "mapCurrentPasswordError",
            "mapOAuthCallbackError",
            "mapOtpVerifyError",
            "mapPasswordUpdateError",
            "mapProfileUpdateError",
            "mapRecoveryError",
            "normalizeOAuthIntent",
            "normalizeOAuthProviderInput",
            "normalizeReturnToPath",
            "parseOAuthCompletePayload",
            "parseOtpLoginVerifyPayload",
            "resolveOAuthProviderQueryParams",
            "resolveSupabaseOAuthProviderCatalog",
            "validatePasswordRecoveryPayload",
            "validationError"
          ]
        }
      ]
    },
    "rbac": {
      "capabilityId": "auth.rbac",
      "kind": "service-contract",
      "summary": "Canonical capability contract for auth.rbac.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "createOwnerOnlyManifest",
            "hasPermission",
            "listManifestPermissions",
            "loadRbacManifest",
            "manifestIncludesPermission",
            "normalizeManifest",
            "resolveRolePermissions"
          ],
          "constants": [
            "OWNER_ROLE_ID"
          ]
        }
      ]
    },
    "server-routes": {
      "capabilityId": "auth.server-routes",
      "kind": "server-routes",
      "summary": "Transport route-wiring contract for auth.server-routes.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "buildRoutes",
            "createController",
            "schema"
          ]
        }
      ]
    }
  },
  "billing": {
    "core": {
      "capabilityId": "billing.core",
      "kind": "service-contract",
      "summary": "Canonical capability contract for billing.core.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "assertEntitlementValueOrThrow",
            "createBillingCatalogCore",
            "createBillingCatalogProviderPricingCore",
            "resolveSchemaValidator",
            "validateEntitlementValue"
          ]
        },
        {
          "entrypoint": "./catalogCore",
          "functions": [
            "createBillingCatalogCore"
          ]
        },
        {
          "entrypoint": "./entitlementSchema",
          "functions": [
            "assertEntitlementValueOrThrow",
            "resolveSchemaValidator",
            "validateEntitlementValue"
          ]
        },
        {
          "entrypoint": "./providerPricingCore",
          "functions": [
            "createBillingCatalogProviderPricingCore"
          ]
        }
      ]
    },
    "entitlements": {
      "core": {
        "capabilityId": "billing.entitlements.core",
        "kind": "service-contract",
        "summary": "Canonical capability contract for billing.entitlements.core.",
        "api": [
          {
            "entrypoint": ".",
            "functions": [
              "assertClock",
              "assertEntitlementsRepository",
              "assertLogger",
              "createEntitlementsPolicy",
              "createEntitlementsService",
              "isEntitlementsError",
              "normalizeAmount",
              "normalizeBalanceRow",
              "normalizeCodes",
              "normalizeSubjectType",
              "resolveClock",
              "resolveLogger",
              "toDateOrNull",
              "toNonEmptyString",
              "toPositiveInteger",
              "validateClock",
              "validateEntitlementsRepository",
              "validateLogger"
            ],
            "constants": [
              "DEFAULT_SUBJECT_TYPE",
              "ENTITLEMENT_TYPES",
              "EntitlementNotConfiguredError",
              "ENTITLEMENTS_ERROR_CODES",
              "EntitlementsError",
              "EntitlementsValidationError",
              "LIFETIME_WINDOW_END",
              "LIFETIME_WINDOW_START",
              "LOGGER_METHODS",
              "NOOP_LOGGER",
              "OPTIONAL_REPOSITORY_METHODS",
              "RECOMPUTE_SUPPORT_METHODS",
              "REQUIRED_REPOSITORY_METHODS",
              "SYSTEM_CLOCK"
            ]
          }
        ]
      },
      "store": {
        "mysql": {
          "capabilityId": "billing.entitlements.store.mysql",
          "kind": "storage",
          "summary": "Persistence contract for billing.entitlements.store.mysql.",
          "api": [
            {
              "entrypoint": ".",
              "functions": [
                "createEntitlementMigrations",
                "createEntitlementsKnexRepository",
                "withTransaction"
              ]
            }
          ]
        }
      }
    },
    "provider": {
      "capabilityId": "billing.provider",
      "kind": "provider-family",
      "summary": "Provider selection contract for billing.provider.",
      "api": [
        {
          "entrypoint": "./adapterService",
          "functions": [
            "createService"
          ]
        }
      ]
    },
    "provider-contract": {
      "capabilityId": "billing.provider-contract",
      "kind": "provider-contract",
      "summary": "Provider interface contract for billing.provider-contract.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "assertProviderAdapter",
            "assertWebhookTranslator",
            "createBillingProviderError",
            "createProviderRegistry",
            "isBillingProviderError",
            "normalizeProviderCode",
            "normalizeProviderErrorCategory",
            "normalizeWebhookProvider",
            "resolveProviderSdkName",
            "shouldProcessCanonicalWebhookEvent",
            "validateProviderAdapter",
            "validateWebhookTranslator"
          ],
          "constants": [
            "BILLING_DEFAULT_PROVIDER",
            "BILLING_PROVIDER_PADDLE",
            "BILLING_PROVIDER_SDK_NAME_BY_PROVIDER",
            "BILLING_PROVIDER_STRIPE",
            "BillingProviderError",
            "PROVIDER_ERROR_CATEGORIES",
            "REQUIRED_CANONICAL_WEBHOOK_EVENT_TYPES",
            "REQUIRED_PROVIDER_ADAPTER_METHODS",
            "REQUIRED_PROVIDER_ADAPTER_OPERATION_METHODS",
            "REQUIRED_WEBHOOK_TRANSLATOR_METHODS",
            "RETRYABLE_PROVIDER_ERROR_CATEGORIES"
          ],
          "requireContractTest": 1
        }
      ],
      "requireContractTest": 1
    },
    "service": {
      "capabilityId": "billing.service",
      "kind": "service-contract",
      "summary": "Canonical capability contract for billing.service.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "billingCheckoutOrchestratorServiceTestables",
            "billingCheckoutSessionServiceTestables",
            "billingIdempotencyServiceTestables",
            "billingPolicyServiceTestables",
            "billingPricingServiceTestables",
            "billingRealtimePublishServiceTestables",
            "buildConsoleBillingPlanCatalog",
            "buildConsoleBillingProductCatalog",
            "canonicalJsonTestables",
            "canTransitionCheckoutStatus",
            "createBillingCheckoutOrchestratorService",
            "createBillingCheckoutSessionService",
            "createBillingIdempotencyService",
            "createBillingPolicyService",
            "createBillingPricingService",
            "createBillingRealtimePublishService",
            "createBillingService",
            "createBillingSettingsService",
            "createBillingWebhookService",
            "createConsoleBillingActionContributor",
            "createConsoleBillingApi",
            "createConsoleBillingService",
            "createWebhookProjectionService",
            "createWorkspaceBillingActionContributor",
            "createWorkspaceBillingApi",
            "ensureBillingCatalogRepository",
            "ensureBillingProductCatalogRepository",
            "isBlockingCheckoutStatus",
            "isCheckoutTerminalStatus",
            "mapBillingPlanDuplicateError",
            "mapBillingProductDuplicateError",
            "mapBillingSettingsResponse",
            "mapPlanEntitlementsToTemplates",
            "mapPlanTemplatesToConsoleEntitlements",
            "mapProductEntitlementsToTemplates",
            "mapProductTemplatesToConsoleEntitlements",
            "normalizeBillingCatalogPlanCreatePayload",
            "normalizeBillingCatalogPlanUpdatePayload",
            "normalizeBillingCatalogProductCreatePayload",
            "normalizeBillingCatalogProductUpdatePayload",
            "normalizePaidPlanChangePaymentMethodPolicy",
            "resolveBillingProvider",
            "resolveBillingSettingsFromConsoleSettings",
            "resolveCatalogCorePriceForCreate",
            "resolveCatalogCorePriceForUpdate",
            "resolveCatalogProductPriceForCreate",
            "resolveCatalogProductPriceForUpdate",
            "resolveProviderRequestSchemaVersion",
            "resolveProviderSdkName",
            "safeParseJson",
            "statusFromFailureCode",
            "toCanonicalJson",
            "toSha256Hex",
            "webhookProjectionServiceTestables"
          ],
          "constants": [
            "BILLING_ACTIONS",
            "BILLING_CHECKOUT_SESSION_STATUS",
            "BILLING_DEFAULT_PROVIDER",
            "BILLING_FAILURE_CODES",
            "BILLING_IDEMPOTENCY_STATUS",
            "BILLING_PROVIDER_PADDLE",
            "BILLING_PROVIDER_REQUEST_SCHEMA_VERSION_BY_PROVIDER",
            "BILLING_PROVIDER_SDK_NAME_BY_PROVIDER",
            "BILLING_PROVIDER_STRIPE",
            "BILLING_RUNTIME_DEFAULTS",
            "BILLING_SUBSCRIPTION_STATUS",
            "CHECKOUT_BLOCKING_STATUS_SET",
            "CHECKOUT_STATUS_TRANSITIONS",
            "CHECKOUT_TERMINAL_STATUS_SET",
            "DEFAULT_BILLING_PROVIDER",
            "LOCK_ORDER",
            "NON_TERMINAL_CURRENT_SUBSCRIPTION_STATUS_SET",
            "PAID_PLAN_CHANGE_POLICY_ALLOW_WITHOUT_PAYMENT_METHOD",
            "PAID_PLAN_CHANGE_POLICY_REQUIRED_NOW",
            "TERMINAL_SUBSCRIPTION_STATUS_SET"
          ]
        },
        {
          "entrypoint": "./actions/consoleBilling",
          "functions": [
            "createConsoleBillingActionContributor"
          ]
        },
        {
          "entrypoint": "./appCapabilityLimits",
          "functions": [
            "resolveCapabilityLimitConfig"
          ],
          "constants": [
            "APP_CAPABILITY_LIMIT_CONFIG"
          ]
        },
        {
          "entrypoint": "./canonicalJson",
          "functions": [
            "safeParseJson",
            "toCanonicalJson",
            "toHmacSha256Hex",
            "toSha256Hex"
          ]
        },
        {
          "entrypoint": "./checkoutOrchestratorService",
          "functions": [
            "createService"
          ]
        },
        {
          "entrypoint": "./checkoutSessionService",
          "functions": [
            "createService"
          ]
        },
        {
          "entrypoint": "./client/consoleBillingApi",
          "functions": [
            "createApi"
          ]
        },
        {
          "entrypoint": "./client/workspaceBillingApi",
          "functions": [
            "createApi"
          ]
        },
        {
          "entrypoint": "./constants",
          "functions": [
            "canTransitionCheckoutStatus",
            "isBlockingCheckoutStatus",
            "isCheckoutTerminalStatus",
            "resolveProviderRequestSchemaVersion",
            "resolveProviderSdkName",
            "statusFromFailureCode"
          ],
          "constants": [
            "BILLING_ACTIONS",
            "BILLING_CHECKOUT_SESSION_STATUS",
            "BILLING_DEFAULT_PROVIDER",
            "BILLING_FAILURE_CODES",
            "BILLING_IDEMPOTENCY_STATUS",
            "BILLING_PROVIDER_PADDLE",
            "BILLING_PROVIDER_REQUEST_SCHEMA_VERSION_BY_PROVIDER",
            "BILLING_PROVIDER_SDK_NAME_BY_PROVIDER",
            "BILLING_PROVIDER_STRIPE",
            "BILLING_RUNTIME_DEFAULTS",
            "BILLING_SUBSCRIPTION_STATUS",
            "CHECKOUT_BLOCKING_STATUS_SET",
            "CHECKOUT_STATUS_TRANSITIONS",
            "CHECKOUT_TERMINAL_STATUS_SET",
            "LOCK_ORDER",
            "NON_TERMINAL_CURRENT_SUBSCRIPTION_STATUS_SET",
            "TERMINAL_SUBSCRIPTION_STATUS_SET"
          ]
        },
        {
          "entrypoint": "./idempotencyService",
          "functions": [
            "createService"
          ]
        },
        {
          "entrypoint": "./policyService",
          "functions": [
            "createService"
          ],
          "constants": [
            "BILLING_MANAGE_PERMISSION"
          ]
        },
        {
          "entrypoint": "./pricingService",
          "functions": [
            "createService"
          ]
        },
        {
          "entrypoint": "./providerOutcomePolicy",
          "functions": [
            "isDeterministicProviderRejection",
            "isIndeterminateProviderOutcome",
            "isProviderErrorNormalized",
            "resolveProviderErrorOutcome",
            "resolveProviderOperationFamily"
          ],
          "constants": [
            "PROVIDER_OPERATION_FAMILIES",
            "PROVIDER_OUTCOME_ACTIONS"
          ]
        },
        {
          "entrypoint": "./service",
          "functions": [
            "createService"
          ]
        },
        {
          "entrypoint": "./webhookCheckoutProjectionService",
          "functions": [
            "createService"
          ]
        },
        {
          "entrypoint": "./webhookProjectionService",
          "functions": [
            "buildCheckoutResponseJson",
            "createService",
            "hasSameTimestampOrderingConflict",
            "isIncomingEventOlder",
            "normalizeProviderSubscriptionStatus",
            "parseUnixEpochSeconds",
            "toNullableString",
            "toPositiveInteger",
            "toSafeMetadata"
          ],
          "constants": [
            "CHECKOUT_CORRELATION_ERROR_CODE"
          ]
        },
        {
          "entrypoint": "./webhookProjectionUtils",
          "functions": [
            "buildCheckoutCorrelationError",
            "buildCheckoutResponseJson",
            "hasSameTimestampOrderingConflict",
            "isIncomingEventOlder",
            "isSubscriptionStatusCurrent",
            "mapProviderCheckoutStatusToLocal",
            "normalizeProviderSubscriptionStatus",
            "parseUnixEpochSeconds",
            "resolveInvoicePrimaryLineDescription",
            "resolveInvoicePrimaryPriceId",
            "resolveInvoiceSubscriptionId",
            "sortDuplicateCandidatesForCanonicalSelection",
            "toNullableString",
            "toPositiveInteger",
            "toSafeMetadata"
          ],
          "constants": [
            "CHECKOUT_CORRELATION_ERROR_CODE"
          ]
        },
        {
          "entrypoint": "./webhookService",
          "functions": [
            "createService"
          ]
        },
        {
          "entrypoint": "./webhookSubscriptionProjectionService",
          "functions": [
            "createService"
          ]
        }
      ]
    }
  },
  "chat": {
    "client-runtime": {
      "capabilityId": "chat.client-runtime",
      "kind": "client-runtime",
      "summary": "Headless client runtime contract for chat.client-runtime.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "chatRuntimeTestables",
            "createApi",
            "createChatApi",
            "createChatRuntime"
          ]
        }
      ]
    },
    "core": {
      "capabilityId": "chat.core",
      "kind": "service-contract",
      "summary": "Canonical capability contract for chat.core.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "canonicalJsonTestables",
            "chatRealtimeServiceTestables",
            "chatServiceTestables",
            "createAttachmentsRepository",
            "createBlocksRepository",
            "createChatActionContributor",
            "createChatRealtimeService",
            "createChatService",
            "createIdempotencyTombstonesRepository",
            "createMessagesRepository",
            "createParticipantsRepository",
            "createReactionsRepository",
            "createThreadsRepository",
            "createUserSettingsRepository",
            "toCanonicalJson",
            "toSha256Hex"
          ]
        },
        {
          "entrypoint": "./repositories/attachments",
          "functions": [
            "createAttachmentsRepository",
            "createRepository"
          ]
        },
        {
          "entrypoint": "./repositories/blocks",
          "functions": [
            "createBlocksRepository",
            "createRepository"
          ]
        },
        {
          "entrypoint": "./repositories/idempotencyTombstones",
          "functions": [
            "createIdempotencyTombstonesRepository",
            "createRepository"
          ]
        },
        {
          "entrypoint": "./repositories/messages",
          "functions": [
            "createMessagesRepository",
            "createRepository"
          ]
        },
        {
          "entrypoint": "./repositories/participants",
          "functions": [
            "createParticipantsRepository",
            "createRepository"
          ]
        },
        {
          "entrypoint": "./repositories/reactions",
          "functions": [
            "createReactionsRepository",
            "createRepository"
          ]
        },
        {
          "entrypoint": "./repositories/shared",
          "functions": [
            "normalizeClientKey",
            "normalizeCountRow",
            "normalizeIdList",
            "normalizeNullableDate",
            "normalizeNullablePositiveInteger",
            "normalizeNullableString",
            "normalizePagination",
            "parseJsonObject",
            "resolveClient",
            "stringifyJsonObject"
          ]
        },
        {
          "entrypoint": "./repositories/threads",
          "functions": [
            "createRepository",
            "createThreadsRepository"
          ]
        },
        {
          "entrypoint": "./repositories/userSettings",
          "functions": [
            "createRepository",
            "createUserSettingsRepository"
          ]
        }
      ]
    },
    "storage": {
      "capabilityId": "chat.storage",
      "kind": "storage",
      "summary": "Persistence contract for chat.storage.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "createService"
          ]
        }
      ]
    }
  },
  "communications": {
    "core": {
      "capabilityId": "communications.core",
      "kind": "service-contract",
      "summary": "Canonical capability contract for communications.core.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "createDispatchRegistry",
            "createOrchestrator",
            "createService"
          ]
        }
      ]
    },
    "provider-contract": {
      "capabilityId": "communications.provider-contract",
      "kind": "provider-contract",
      "summary": "Provider interface contract for communications.provider-contract.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "assertDispatchProvider",
            "normalizeChannel"
          ],
          "constants": [
            "COMMUNICATION_CHANNELS",
            "COMMUNICATION_PROVIDER_RESULT_REASONS"
          ],
          "requireContractTest": 1
        }
      ],
      "requireContractTest": 1
    }
  },
  "contracts": {
    "assistant": {
      "capabilityId": "contracts.assistant",
      "kind": "schema-contract",
      "summary": "Shared schema contract for contracts.assistant.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "assistantConversationMessagesQueryKey",
            "assistantConversationsListQueryKey",
            "assistantRootQueryKey",
            "assistantWorkspaceScopeQueryKey",
            "isAssistantStreamEventType",
            "normalizeAssistantStreamEvent",
            "normalizeAssistantStreamEventType",
            "workspaceAiTranscriptMessagesQueryKey",
            "workspaceAiTranscriptsListQueryKey",
            "workspaceAiTranscriptsRootQueryKey",
            "workspaceAiTranscriptsScopeQueryKey"
          ],
          "constants": [
            "ASSISTANT_QUERY_KEY_PREFIX",
            "ASSISTANT_STREAM_EVENT_TYPE_VALUES",
            "ASSISTANT_STREAM_EVENT_TYPES",
            "WORKSPACE_AI_TRANSCRIPTS_QUERY_KEY_PREFIX"
          ]
        }
      ]
    },
    "chat": {
      "capabilityId": "contracts.chat",
      "kind": "schema-contract",
      "summary": "Shared schema contract for contracts.chat.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "chatErrorTestables",
            "chatInboxInfiniteQueryKey",
            "chatRootQueryKey",
            "chatScopeQueryKey",
            "chatThreadMessagesInfiniteQueryKey",
            "chatThreadQueryKey",
            "mapChatError"
          ],
          "constants": [
            "CHAT_QUERY_KEY_PREFIX"
          ]
        }
      ]
    },
    "communications": {
      "capabilityId": "contracts.communications",
      "kind": "schema-contract",
      "summary": "Shared schema contract for contracts.communications.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "schema"
          ]
        }
      ]
    },
    "http": {
      "capabilityId": "contracts.http",
      "kind": "schema-contract",
      "summary": "Shared schema contract for contracts.http.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "apiErrorDetailsSchema",
            "apiErrorResponseSchema",
            "apiValidationErrorResponseSchema",
            "createPaginationQuerySchema",
            "enumSchema",
            "fastifyDefaultErrorResponseSchema",
            "fieldErrorsSchema",
            "registerTypeBoxFormats",
            "withStandardErrorResponses"
          ],
          "constants": [
            "STANDARD_ERROR_STATUS_CODES"
          ]
        },
        {
          "entrypoint": "./errorResponses",
          "functions": [
            "apiErrorDetailsSchema",
            "apiErrorResponseSchema",
            "apiValidationErrorResponseSchema",
            "enumSchema",
            "fastifyDefaultErrorResponseSchema",
            "fieldErrorsSchema",
            "withStandardErrorResponses"
          ],
          "constants": [
            "STANDARD_ERROR_STATUS_CODES"
          ]
        },
        {
          "entrypoint": "./paginationQuery",
          "functions": [
            "createPaginationQuerySchema"
          ]
        },
        {
          "entrypoint": "./typeboxFormats",
          "functions": [
            "registerTypeBoxFormats"
          ]
        }
      ]
    },
    "realtime": {
      "capabilityId": "contracts.realtime",
      "kind": "schema-contract",
      "summary": "Shared schema contract for contracts.realtime.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "createTopicCatalog",
            "getAppTopicRule",
            "getAppTopicScope",
            "getTopicRule",
            "hasAppTopicPermission",
            "hasTopicPermission",
            "isAppSupportedTopic",
            "isAppTopicAllowedForSurface",
            "isAppUserScopedTopic",
            "isSupportedTopic",
            "isTopicAllowedForSurface",
            "isUserScopedTopic",
            "isWorkspaceScopedTopic",
            "listRealtimeTopics",
            "listRealtimeTopicsForSurface",
            "listTopics",
            "listTopicsForSurface",
            "resolveRequiredPermissions",
            "resolveTopicScope"
          ],
          "constants": [
            "REALTIME_ERROR_CODES",
            "REALTIME_EVENT_TYPES",
            "REALTIME_MESSAGE_TYPES",
            "REALTIME_TOPIC_REGISTRY",
            "REALTIME_TOPICS",
            "TOPIC_SCOPES"
          ]
        },
        {
          "entrypoint": "./appTopics",
          "functions": [
            "getTopicRule",
            "getTopicScope",
            "hasTopicPermission",
            "isSupportedTopic",
            "isTopicAllowedForSurface",
            "isUserScopedTopic",
            "listRealtimeTopics",
            "listRealtimeTopicsForSurface"
          ],
          "constants": [
            "REALTIME_EVENT_TYPES",
            "REALTIME_TOPIC_REGISTRY",
            "REALTIME_TOPICS"
          ]
        }
      ]
    },
    "social": {
      "capabilityId": "contracts.social",
      "kind": "schema-contract",
      "summary": "Shared schema contract for contracts.social.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "mapSocialError",
            "socialActorSearchQueryKey",
            "socialErrorTestables",
            "socialFeedQueryKey",
            "socialNotificationsQueryKey",
            "socialPostQueryKey",
            "socialRootQueryKey",
            "socialScopeQueryKey"
          ],
          "constants": [
            "SOCIAL_QUERY_KEY_PREFIX"
          ]
        }
      ]
    }
  },
  "db": {
    "core": {
      "capabilityId": "db.core",
      "kind": "database-contract",
      "summary": "Database contract for db.core.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "deleteRowsOlderThan",
            "detectDialectFromClient",
            "isDuplicateEntryError",
            "jsonTextExpression",
            "normalizeBatchSize",
            "normalizeCutoffDateOrThrow",
            "normalizeDeletedRowCount",
            "normalizeDialect",
            "normalizePath",
            "retentionTestables",
            "toDatabaseDateTimeUtc",
            "toIsoString",
            "whereJsonTextEquals"
          ]
        },
        {
          "entrypoint": "./dateUtils",
          "functions": [
            "toDatabaseDateTimeUtc",
            "toIsoString"
          ]
        },
        {
          "entrypoint": "./errors",
          "functions": [
            "isDuplicateEntryError"
          ]
        },
        {
          "entrypoint": "./json",
          "functions": [
            "jsonTextExpression",
            "normalizePath",
            "whereJsonTextEquals"
          ]
        },
        {
          "entrypoint": "./retention",
          "functions": [
            "deleteRowsOlderThan",
            "normalizeBatchSize",
            "normalizeCutoffDateOrThrow",
            "normalizeDeletedRowCount"
          ]
        }
      ]
    }
  },
  "global": {
    "db-provider": {
      "capabilityId": "db-provider",
      "kind": "provider-family",
      "summary": "Provider selection contract for db-provider.",
      "api": [
        {
          "entrypoint": "descriptor:package.descriptor.mjs",
          "functions": [
            "capabilities.provides"
          ]
        }
      ]
    }
  },
  "observability": {
    "core": {
      "capabilityId": "observability.core",
      "kind": "service-contract",
      "summary": "Canonical capability contract for observability.core.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "createBrowserErrorPayloadTools",
            "createConsoleErrorPayloadNormalizer",
            "createConsoleErrorsApi",
            "createConsoleErrorsService",
            "createMetricsRegistry",
            "createScopeDebugMatcher",
            "createScopedLogger",
            "createService",
            "normalizeBrowserPayload",
            "normalizeErrorEntryId",
            "normalizeMetricLabel",
            "normalizePagination",
            "normalizeServerPayload",
            "normalizeSimulationKind"
          ],
          "constants": [
            "BROWSER_ERRORS_READ_PERMISSION",
            "SERVER_ERRORS_READ_PERMISSION",
            "SERVER_SIMULATION_KINDS"
          ]
        },
        {
          "entrypoint": "./browserPayload",
          "functions": [
            "createBrowserErrorPayloadTools"
          ]
        },
        {
          "entrypoint": "./client/consoleErrorsApi",
          "functions": [
            "createApi"
          ]
        },
        {
          "entrypoint": "./scopeLogger",
          "functions": [
            "createScopeDebugMatcher",
            "createScopedLogger"
          ]
        },
        {
          "entrypoint": "./serverPayload",
          "functions": [
            "createConsoleErrorPayloadNormalizer"
          ],
          "constants": [
            "SERVER_SIMULATION_KINDS"
          ]
        },
        {
          "entrypoint": "./service",
          "functions": [
            "createService"
          ]
        },
        {
          "entrypoint": "./services/consoleErrors",
          "functions": [
            "createService",
            "normalizeBrowserPayload",
            "normalizeErrorEntryId",
            "normalizePagination",
            "normalizeServerPayload",
            "normalizeSimulationKind"
          ],
          "constants": [
            "BROWSER_ERRORS_READ_PERMISSION",
            "SERVER_ERRORS_READ_PERMISSION",
            "SERVER_SIMULATION_KINDS"
          ]
        }
      ]
    }
  },
  "ops": {
    "redis": {
      "capabilityId": "ops.redis",
      "kind": "worker-runtime",
      "summary": "Worker/operations contract for ops.redis.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "acquireDistributedLock",
            "buildRedisScopedKey",
            "closeWorkerRedisConnection",
            "createRateLimitPluginOptions",
            "createRetentionDeadLetterQueue",
            "createRetentionQueue",
            "createRetentionSweepLockKey",
            "createRetentionSweepOrchestrator",
            "createRetentionSweepProcessor",
            "createWorkerRedisConnection",
            "createWorkerRedisPrefix",
            "createWorkerRuntime",
            "enqueueRetentionDeadLetterJob",
            "enqueueRetentionSweep",
            "extendDistributedLock",
            "isRetentionLockHeldError",
            "normalizeBoolean",
            "normalizeLockTtlMs",
            "normalizeRedisNamespace",
            "normalizeRetentionBatchSize",
            "normalizeRetentionDays",
            "normalizeRetentionHours",
            "normalizeRetentionSweepPayload",
            "releaseDistributedLock",
            "resolveCutoffDate",
            "resolveRateLimitStartupError",
            "resolveRateLimitStartupWarning",
            "runBatchedDeletion"
          ],
          "constants": [
            "RATE_LIMIT_MODE_MEMORY",
            "RATE_LIMIT_MODE_REDIS",
            "RATE_LIMIT_REDIS_NAMESPACE_SEGMENT",
            "RETENTION_DEAD_LETTER_JOB_NAME",
            "RETENTION_DEAD_LETTER_QUEUE_NAME",
            "RETENTION_QUEUE_NAME",
            "RETENTION_SWEEP_JOB_NAME",
            "RetentionLockHeldError"
          ]
        },
        {
          "entrypoint": "./deadLetterQueue",
          "functions": [
            "createRetentionDeadLetterQueue",
            "enqueueRetentionDeadLetterJob"
          ]
        },
        {
          "entrypoint": "./rateLimit",
          "functions": [
            "createRateLimitPluginOptions",
            "resolveRateLimitStartupError",
            "resolveRateLimitStartupWarning"
          ],
          "constants": [
            "RATE_LIMIT_MODE_MEMORY",
            "RATE_LIMIT_MODE_REDIS",
            "RATE_LIMIT_REDIS_NAMESPACE_SEGMENT"
          ]
        },
        {
          "entrypoint": "./retentionOrchestrator",
          "functions": [
            "createRetentionSweepOrchestrator",
            "normalizeBoolean",
            "normalizeRetentionBatchSize",
            "normalizeRetentionDays",
            "normalizeRetentionHours",
            "resolveCutoffDate",
            "runBatchedDeletion"
          ]
        },
        {
          "entrypoint": "./retentionProcessor",
          "functions": [
            "createRetentionSweepProcessor",
            "isRetentionLockHeldError"
          ],
          "constants": [
            "RetentionLockHeldError"
          ]
        },
        {
          "entrypoint": "./retentionQueue",
          "functions": [
            "createRetentionQueue",
            "enqueueRetentionSweep",
            "normalizeRetentionSweepPayload"
          ]
        },
        {
          "entrypoint": "./workerConstants",
          "functions": [
            "createRetentionSweepLockKey",
            "createWorkerRedisPrefix"
          ],
          "constants": [
            "RETENTION_DEAD_LETTER_JOB_NAME",
            "RETENTION_DEAD_LETTER_QUEUE_NAME",
            "RETENTION_QUEUE_NAME",
            "RETENTION_SWEEP_JOB_NAME"
          ]
        },
        {
          "entrypoint": "./workerLocking",
          "functions": [
            "acquireDistributedLock",
            "extendDistributedLock",
            "normalizeLockTtlMs",
            "releaseDistributedLock"
          ]
        },
        {
          "entrypoint": "./workerRedisConnection",
          "functions": [
            "closeWorkerRedisConnection",
            "createWorkerRedisConnection"
          ]
        },
        {
          "entrypoint": "./workerRuntime",
          "functions": [
            "createWorkerRuntime"
          ]
        }
      ]
    }
  },
  "runtime": {
    "actions": {
      "capabilityId": "runtime.actions",
      "kind": "runtime-primitive",
      "summary": "Runtime infrastructure contract for runtime.actions.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "applyRealtimePublishToCommandAction",
            "createActionRegistry",
            "createActionRuntimeError",
            "createActionVersionKey",
            "createNoopAuditAdapter",
            "createNoopIdempotencyAdapter",
            "createNoopObservabilityAdapter",
            "createPermissionEvaluator",
            "ensureActionChannelAllowed",
            "ensureActionSurfaceAllowed",
            "ensureActionVisibilityAllowed",
            "ensureIdempotencyKeyIfRequired",
            "executeActionPipeline",
            "normalizeActionContributor",
            "normalizeActionDefinition",
            "normalizeActionInput",
            "normalizeActionOutput",
            "normalizeExecutionContext",
            "publishRealtimeCommandEvent",
            "resolveActionIdempotencyKey",
            "resolveCommandId",
            "resolveSourceClientId"
          ],
          "constants": [
            "ACTION_CHANNELS",
            "ACTION_DOMAINS",
            "ACTION_ID_VALUES",
            "ACTION_IDEMPOTENCY_POLICIES",
            "ACTION_IDS",
            "ACTION_KINDS",
            "ACTION_SURFACES",
            "ACTION_VISIBILITY_LEVELS",
            "ActionRuntimeError"
          ]
        },
        {
          "entrypoint": "./actionIds",
          "constants": [
            "ACTION_ID_VALUES",
            "ACTION_IDS"
          ]
        },
        {
          "entrypoint": "./realtimePublish",
          "functions": [
            "applyRealtimePublishToCommandAction",
            "publishRealtimeCommandEvent",
            "resolveCommandId",
            "resolveSourceClientId"
          ]
        }
      ]
    },
    "env": {
      "capabilityId": "runtime.env",
      "kind": "runtime-primitive",
      "summary": "Runtime infrastructure contract for runtime.env.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "assertEnabledSubsystemStartupPreflight",
            "createAiRuntimeSpec",
            "createAuthRuntimeSpec",
            "createBillingRuntimeSpec",
            "createCoreRuntimeSpec",
            "createDatabaseRuntimeSpec",
            "createEmailRuntimeSpec",
            "createObservabilityRuntimeSpec",
            "createPlatformRuntimeEnv",
            "createPlatformRuntimeEnvSpec",
            "createRedisRuntimeSpec",
            "createSmsRuntimeSpec",
            "createSocialRuntimeSpec",
            "createStorageRuntimeSpec",
            "createWorkerRuntimeSpec",
            "hasNonEmptyEnvValue",
            "loadDotenvFiles",
            "resolveAppConfig",
            "resolveAuthJwtAudience",
            "resolveAuthProviderId",
            "resolveDotenvPaths",
            "resolveSupabaseAuthUrl",
            "toBrowserConfig"
          ],
          "constants": [
            "PLATFORM_RUNTIME_DEFAULTS"
          ]
        },
        {
          "entrypoint": "./appRuntimePolicy",
          "functions": [
            "resolveAppConfig",
            "toBrowserConfig"
          ]
        },
        {
          "entrypoint": "./platformRuntimeEnv",
          "functions": [
            "createPlatformRuntimeEnv",
            "loadDotenvFiles",
            "resolveDotenvPaths"
          ]
        },
        {
          "entrypoint": "./startupPreflight",
          "functions": [
            "assertEnabledSubsystemStartupPreflight",
            "hasNonEmptyEnvValue",
            "resolveAuthJwtAudience",
            "resolveAuthProviderId",
            "resolveSupabaseAuthUrl"
          ]
        }
      ]
    },
    "http-client": {
      "capabilityId": "runtime.http-client",
      "kind": "runtime-primitive",
      "summary": "Runtime infrastructure contract for runtime.http-client.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "createHttpClient",
            "createHttpError",
            "createNetworkError",
            "hasHeader",
            "normalizeHeaderName",
            "setHeaderIfMissing",
            "shouldRetryForCsrfFailure"
          ],
          "constants": [
            "DEFAULT_RETRYABLE_CSRF_ERROR_CODES"
          ]
        }
      ]
    },
    "module-framework": {
      "capabilityId": "runtime.module-framework",
      "kind": "runtime-primitive",
      "summary": "Runtime infrastructure contract for runtime.module-framework.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "assertUniqueModuleIds",
            "composeClientModules",
            "composeServerModules",
            "createDiagnostic",
            "createDiagnosticsCollector",
            "defineModule",
            "detectActionConflicts",
            "detectRouteConflicts",
            "detectTopicConflicts",
            "loadClientAppDropinsFromModules",
            "loadServerAppDropins",
            "mergeClientModuleRegistry",
            "resolveCapabilityGraph",
            "resolveConflicts",
            "resolveDependencyGraph",
            "resolveMounts",
            "satisfiesVersion",
            "throwOnDiagnosticErrors",
            "validateModuleDescriptor",
            "validateModuleDescriptors"
          ],
          "constants": [
            "DIAGNOSTIC_LEVELS",
            "MODULE_ENABLEMENT_MODES",
            "MODULE_TIERS"
          ]
        },
        {
          "entrypoint": "./appDropins",
          "functions": [
            "loadClientAppDropinsFromModules",
            "loadServerAppDropins",
            "mergeClientModuleRegistry"
          ]
        }
      ]
    },
    "server": {
      "capabilityId": "runtime.server",
      "kind": "runtime-primitive",
      "summary": "Runtime infrastructure contract for runtime.server.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "buildAuditError",
            "buildAuditEventBase",
            "buildLoginRedirectPathFromRequest",
            "buildPublishRequestMeta",
            "buildRoutesFromManifest",
            "createControllerRegistry",
            "createFastifyLoggerOptions",
            "createRealtimeEventEnvelope",
            "createRealtimeEventsBus",
            "createRepositoryRegistry",
            "createRuntimeAssembly",
            "createRuntimeComposition",
            "createRuntimeKernel",
            "createService",
            "createServiceRegistry",
            "createTargetedChatEventEnvelope",
            "isAppError",
            "mergeRuntimeBundles",
            "normalizeEntityId",
            "normalizeHeaderValue",
            "normalizePagination",
            "normalizePositiveIntegerArray",
            "normalizePositiveIntegerOrNull",
            "normalizeRuntimeBundle",
            "normalizeScopeKind",
            "normalizeStringifiedPositiveIntegerOrNull",
            "normalizeStringOrNull",
            "parsePositiveInteger",
            "publishSafely",
            "recordAuditEvent",
            "recordDbErrorBestEffort",
            "registerApiErrorHandler",
            "registerApiRouteDefinitions",
            "registerRequestLoggingHooks",
            "resolveClientIpAddress",
            "resolveDatabaseErrorCode",
            "resolveLoggerLevel",
            "resolvePublishMethod",
            "runGracefulShutdown",
            "safePathnameFromRequest",
            "safeRequestUrl",
            "selectRuntimeServices",
            "warnPublishFailure",
            "withAuditEvent"
          ],
          "constants": [
            "AppError"
          ]
        },
        {
          "entrypoint": "./apiRouteRegistration",
          "functions": [
            "registerApiRouteDefinitions"
          ]
        },
        {
          "entrypoint": "./composition",
          "functions": [
            "createControllerRegistry",
            "createRepositoryRegistry",
            "createRuntimeComposition",
            "createServiceRegistry",
            "selectRuntimeServices"
          ]
        },
        {
          "entrypoint": "./errors",
          "functions": [
            "isAppError"
          ],
          "constants": [
            "AppError"
          ]
        },
        {
          "entrypoint": "./fastifyBootstrap",
          "functions": [
            "createFastifyLoggerOptions",
            "recordDbErrorBestEffort",
            "registerApiErrorHandler",
            "registerRequestLoggingHooks",
            "resolveDatabaseErrorCode",
            "resolveLoggerLevel",
            "runGracefulShutdown"
          ]
        },
        {
          "entrypoint": "./integers",
          "functions": [
            "parsePositiveInteger"
          ]
        },
        {
          "entrypoint": "./pagination",
          "functions": [
            "normalizePagination"
          ]
        },
        {
          "entrypoint": "./realtimeEvents",
          "functions": [
            "createRealtimeEventEnvelope",
            "createRealtimeEventsBus",
            "createTargetedChatEventEnvelope",
            "normalizeEntityId",
            "normalizePositiveIntegerArray",
            "normalizePositiveIntegerOrNull",
            "normalizeScopeKind",
            "normalizeStringifiedPositiveIntegerOrNull",
            "normalizeStringOrNull"
          ]
        },
        {
          "entrypoint": "./realtimeEventsService",
          "functions": [
            "createService"
          ]
        },
        {
          "entrypoint": "./realtimePublish",
          "functions": [
            "buildPublishRequestMeta",
            "normalizeHeaderValue",
            "publishSafely",
            "resolvePublishMethod",
            "warnPublishFailure"
          ]
        },
        {
          "entrypoint": "./requestUrl",
          "functions": [
            "buildLoginRedirectPathFromRequest",
            "resolveClientIpAddress",
            "safePathnameFromRequest",
            "safeRequestUrl"
          ]
        },
        {
          "entrypoint": "./runtimeAssembly",
          "functions": [
            "buildRoutesFromManifest",
            "createRuntimeAssembly",
            "mergeRuntimeBundles"
          ]
        },
        {
          "entrypoint": "./securityAudit",
          "functions": [
            "buildAuditError",
            "buildAuditEventBase",
            "recordAuditEvent",
            "withAuditEvent"
          ]
        }
      ]
    },
    "surface-routing": {
      "capabilityId": "runtime.surface-routing",
      "kind": "runtime-primitive",
      "summary": "Runtime infrastructure contract for runtime.surface-routing.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "buildVersionedApiPath",
            "createDefaultAppSurfacePaths",
            "createDefaultAppSurfaceRegistry",
            "createSurfacePathHelpers",
            "createSurfaceRegistry",
            "isApiPath",
            "isVersionedApiPath",
            "isVersionedApiPrefixMatch",
            "normalizePathname",
            "toVersionedApiPath",
            "toVersionedApiPrefix"
          ],
          "constants": [
            "API_BASE_PATH",
            "API_DOCS_PATH",
            "API_MAJOR_VERSION",
            "API_PREFIX",
            "API_PREFIX_SLASH",
            "API_REALTIME_PATH",
            "API_VERSION_SEGMENT",
            "DEFAULT_ROUTES",
            "DEFAULT_SURFACES"
          ]
        },
        {
          "entrypoint": "./apiPaths",
          "functions": [
            "buildVersionedApiPath",
            "isApiPath",
            "isVersionedApiPath",
            "isVersionedApiPrefixMatch",
            "normalizePathname",
            "toVersionedApiPath",
            "toVersionedApiPrefix"
          ],
          "constants": [
            "API_BASE_PATH",
            "API_DOCS_PATH",
            "API_MAJOR_VERSION",
            "API_PREFIX",
            "API_PREFIX_SLASH",
            "API_REALTIME_PATH",
            "API_VERSION_SEGMENT"
          ]
        },
        {
          "entrypoint": "./appSurfaces",
          "functions": [
            "createDefaultAppSurfacePaths",
            "createDefaultAppSurfaceRegistry"
          ],
          "constants": [
            "DEFAULT_ROUTES",
            "DEFAULT_SURFACES"
          ]
        },
        {
          "entrypoint": "./paths",
          "functions": [
            "createSurfacePathHelpers"
          ]
        },
        {
          "entrypoint": "./registry",
          "functions": [
            "createSurfaceRegistry"
          ]
        }
      ]
    },
    "web": {
      "capabilityId": "runtime.web",
      "kind": "runtime-primitive",
      "summary": "Runtime infrastructure contract for runtime.web.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "composeClientApiFromModules",
            "composeFilesystemRoutesFromModules",
            "composeGuardPoliciesFromModules",
            "composeNavigationFragmentsFromModules",
            "composeRealtimeInvalidationDefinitionsFromModules",
            "composeRealtimeTopicContributionsFromModules",
            "composeShellEntriesBySlotFromModules",
            "composeShellEntriesFromModules",
            "composeSurfaceRouteFragmentsFromModules",
            "composeSurfaceRouteMountsFromContributions",
            "composeSurfaceRouterOptionsFromModules",
            "createTransportRuntime",
            "getFirstPage",
            "getNextPage",
            "getPreviousPage",
            "normalizePage",
            "normalizePageSize",
            "parseRouteFilePath",
            "parseShellEntryFilePath",
            "resolveActiveClientModules",
            "resolveErrorMessage",
            "resolveNavigationDestinationTitle",
            "resolveRouteMountPathByKey",
            "useGlobalNetworkActivity",
            "useListPagination",
            "useListQueryState",
            "useQueryErrorMessage",
            "useUrlListPagination"
          ],
          "constants": [
            "DEFAULT_AI_STREAM_URL",
            "DEFAULT_API_PATH_PREFIX",
            "DEFAULT_DELAY_MS",
            "DEFAULT_ERROR_MESSAGE",
            "DEFAULT_MIN_VISIBLE_MS",
            "DEFAULT_REALTIME_CORRELATED_WRITE_ROUTES",
            "KNOWN_SLOTS",
            "KNOWN_SURFACES"
          ]
        },
        {
          "entrypoint": "./clientComposition",
          "functions": [
            "composeClientApiFromModules",
            "composeGuardPoliciesFromModules",
            "composeNavigationFragmentsFromModules",
            "composeRealtimeInvalidationDefinitionsFromModules",
            "composeRealtimeTopicContributionsFromModules",
            "composeSurfaceRouteFragmentsFromModules",
            "composeSurfaceRouteMountsFromContributions",
            "composeSurfaceRouterOptionsFromModules",
            "resolveActiveClientModules",
            "resolveNavigationDestinationTitle",
            "resolveRouteMountPathByKey"
          ]
        },
        {
          "entrypoint": "./filesystemComposition",
          "functions": [
            "composeFilesystemRoutesFromModules",
            "composeShellEntriesBySlotFromModules",
            "composeShellEntriesFromModules",
            "parseRouteFilePath",
            "parseShellEntryFilePath"
          ],
          "constants": [
            "KNOWN_SLOTS",
            "KNOWN_SURFACES"
          ]
        },
        {
          "entrypoint": "./transportRuntime",
          "functions": [
            "createTransportRuntime"
          ],
          "constants": [
            "DEFAULT_AI_STREAM_URL",
            "DEFAULT_API_PATH_PREFIX",
            "DEFAULT_CSRF_SESSION_PATH",
            "DEFAULT_REALTIME_CORRELATED_WRITE_ROUTES"
          ]
        },
        {
          "entrypoint": "./useGlobalNetworkActivity",
          "functions": [
            "useGlobalNetworkActivity"
          ],
          "constants": [
            "DEFAULT_DELAY_MS",
            "DEFAULT_MIN_VISIBLE_MS"
          ]
        },
        {
          "entrypoint": "./useListPagination",
          "functions": [
            "useListPagination"
          ]
        },
        {
          "entrypoint": "./useListQueryState",
          "functions": [
            "useListQueryState"
          ]
        },
        {
          "entrypoint": "./useUrlListPagination",
          "functions": [
            "useUrlListPagination"
          ]
        },
        {
          "entrypoint": "descriptor:package.descriptor.mjs",
          "functions": [
            "capabilities.provides"
          ]
        }
      ]
    }
  },
  "social": {
    "core": {
      "capabilityId": "social.core",
      "kind": "service-contract",
      "summary": "Canonical capability contract for social.core.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "createRepository",
            "createSocialActionContributor",
            "createSocialOutboxWorkerRuntimeService",
            "createSocialService",
            "socialRepositoryTestables",
            "socialServiceTestables"
          ]
        },
        {
          "entrypoint": "./outboxWorkerRuntimeService",
          "functions": [
            "createSocialOutboxWorkerRuntimeService"
          ]
        }
      ]
    }
  },
  "users": {
    "profile": {
      "core": {
        "capabilityId": "users.profile.core",
        "kind": "service-contract",
        "summary": "Canonical capability contract for users.profile.core.",
        "api": [
          {
            "entrypoint": ".",
            "functions": [
              "createRepository",
              "resolveProfileIdentity"
            ]
          },
          {
            "entrypoint": "./avatarService",
            "functions": [
              "createService"
            ]
          },
          {
            "entrypoint": "./avatarStorageService",
            "functions": [
              "createService"
            ]
          },
          {
            "entrypoint": "./profileIdentity",
            "functions": [
              "resolveProfileIdentity"
            ]
          }
        ]
      }
    }
  },
  "workspace": {
    "console": {
      "core": {
        "capabilityId": "workspace.console.core",
        "kind": "service-contract",
        "summary": "Canonical capability contract for workspace.console.core.",
        "api": [
          {
            "entrypoint": ".",
            "functions": [
              "addFieldError",
              "buildFieldSchema",
              "buildPatch",
              "buildSchema",
              "coerceWorkspaceColor",
              "createFieldErrorBag",
              "createMembershipIndexes",
              "createWorkspaceSettingsPatchPolicy",
              "getRoleCatalog",
              "hasFieldErrors",
              "hasOwn",
              "hasPermission",
              "isAllowedAvatarMimeType",
              "isObjectRecord",
              "isValidCurrencyCode",
              "isValidLocale",
              "isValidTimeZone",
              "isWorkspaceColor",
              "listRoleDescriptors",
              "mapMembershipSummary",
              "normalizeAvatarSize",
              "normalizeMembershipForAccess",
              "normalizePermissions",
              "normalizeRoleId",
              "resolveMembershipRoleId",
              "resolveMembershipStatus",
              "resolveRolePermissions",
              "toBoolean",
              "toCurrencyCode",
              "toEnum",
              "toLocale",
              "toNullableString",
              "toPositiveInt",
              "toRoleDescriptor",
              "toTimeZone",
              "toTrimmedString",
              "toValidationError",
              "validateAvatarUpload"
            ],
            "constants": [
              "CONSOLE_AI_TRANSCRIPTS_PERMISSIONS",
              "CONSOLE_ASSISTANT_SETTINGS_PERMISSIONS",
              "CONSOLE_BILLING_PERMISSIONS",
              "CONSOLE_MANAGEMENT_PERMISSIONS",
              "CONSOLE_ROLE_DEFINITIONS",
              "CONSOLE_ROLE_ID",
              "DEFAULT_WORKSPACE_COLOR",
              "DEVOP_ROLE_ID",
              "MODERATOR_ROLE_ID",
              "WORKSPACE_COLOR_PATTERN"
            ]
          },
          {
            "entrypoint": "./consoleRoles",
            "functions": [
              "getRoleCatalog",
              "hasPermission",
              "normalizeRoleId",
              "resolveAssignableRoleIds",
              "resolveRolePermissions"
            ],
            "constants": [
              "CONSOLE_AI_TRANSCRIPTS_PERMISSIONS",
              "CONSOLE_ASSISTANT_SETTINGS_PERMISSIONS",
              "CONSOLE_BILLING_PERMISSIONS",
              "CONSOLE_MANAGEMENT_PERMISSIONS",
              "CONSOLE_ROLE_DEFINITIONS",
              "CONSOLE_ROLE_ID",
              "DEVOP_ROLE_ID",
              "MODERATOR_ROLE_ID"
            ]
          },
          {
            "entrypoint": "./settingsModel",
            "functions": [
              "createSettingsModel"
            ],
            "constants": [
              "PLATFORM_AVATAR_SETTINGS",
              "PLATFORM_SETTINGS_MODEL",
              "SETTINGS_CHAT_DEFAULTS",
              "SETTINGS_CHAT_KEYS",
              "SETTINGS_CURRENCY_CODE_PATTERN",
              "SETTINGS_DATE_FORMAT_OPTIONS",
              "SETTINGS_DEFAULTS",
              "SETTINGS_FEATURE_FLAGS",
              "SETTINGS_FIELD_SPECS",
              "SETTINGS_LIMITS",
              "SETTINGS_LOCALE_PATTERN",
              "SETTINGS_MODE_OPTIONS",
              "SETTINGS_NOTIFICATION_KEYS",
              "SETTINGS_NOTIFICATIONS_DEFAULTS",
              "SETTINGS_NUMBER_FORMAT_OPTIONS",
              "SETTINGS_PREFERENCE_KEYS",
              "SETTINGS_PREFERENCES_OPTIONS",
              "SETTINGS_PROFILE_KEYS",
              "SETTINGS_THEME_OPTIONS",
              "SETTINGS_TIMING_OPTIONS"
            ]
          },
          {
            "entrypoint": "./settingsPatchBuilder",
            "functions": [
              "buildPatch"
            ]
          },
          {
            "entrypoint": "./settingsSchemaBuilder",
            "functions": [
              "buildFieldSchema",
              "buildSchema"
            ]
          },
          {
            "entrypoint": "./settingsValidation",
            "functions": [
              "isValidCurrencyCode",
              "isValidLocale",
              "isValidTimeZone",
              "toBoolean",
              "toCurrencyCode",
              "toEnum",
              "toLocale",
              "toNullableString",
              "toPositiveInt",
              "toTimeZone",
              "toTrimmedString"
            ]
          },
          {
            "entrypoint": "./workspaceAccess",
            "functions": [
              "createMembershipIndexes",
              "mapMembershipSummary",
              "normalizeMembershipForAccess",
              "normalizePermissions",
              "resolveMembershipRoleId",
              "resolveMembershipStatus"
            ]
          },
          {
            "entrypoint": "./workspaceColors",
            "functions": [
              "coerceWorkspaceColor",
              "isWorkspaceColor"
            ],
            "constants": [
              "DEFAULT_WORKSPACE_COLOR",
              "WORKSPACE_COLOR_PATTERN"
            ]
          },
          {
            "entrypoint": "./workspaceRoleCatalog",
            "functions": [
              "listRoleDescriptors",
              "resolveAssignableRoleIds",
              "toRoleDescriptor"
            ]
          },
          {
            "entrypoint": "./workspaceSettingsPatch",
            "functions": [
              "createWorkspaceSettingsPatchPolicy"
            ]
          }
        ]
      }
    },
    "service": {
      "capabilityId": "workspace.service",
      "kind": "service-contract",
      "summary": "Canonical capability contract for workspace.service.",
      "api": [
        {
          "entrypoint": ".",
          "functions": [
            "buildWorkspaceBaseSlug",
            "buildWorkspaceName",
            "collectInviteWorkspaceIds",
            "createWorkspaceActionContributor",
            "createWorkspaceApi",
            "createWorkspaceInvitesRepository",
            "createWorkspaceMembershipsRepository",
            "createWorkspaceSettingsDefaults",
            "createWorkspaceSettingsRepository",
            "createWorkspacesRepository",
            "listInviteMembershipsByWorkspaceId",
            "mapPendingInviteSummary",
            "mapUserSettingsPublic",
            "mapWorkspaceAdminSummary",
            "mapWorkspaceInviteSummary",
            "mapWorkspaceMembershipSummary",
            "mapWorkspaceMemberSummary",
            "mapWorkspacePayloadSummary",
            "mapWorkspaceSettingsPublic",
            "mapWorkspaceSettingsResponse",
            "normalizeWorkspaceColor",
            "parseWorkspaceSettingsPatch",
            "resolveInviteExpiresAt",
            "resolveRequestedWorkspaceSlug",
            "resolveRequestSurfaceId",
            "toSlugPart",
            "workspaceInvitesRepositoryTestables",
            "workspaceMembershipsRepositoryTestables",
            "workspaceSettingsRepositoryTestables",
            "workspacesRepositoryTestables"
          ],
          "constants": [
            "DEFAULT_INVITE_EXPIRY_DAYS"
          ]
        },
        {
          "entrypoint": "./client/workspaceApi",
          "functions": [
            "createApi"
          ]
        },
        {
          "entrypoint": "./lookups/workspaceMembershipLookup",
          "functions": [
            "collectInviteWorkspaceIds",
            "listInviteMembershipsByWorkspaceId"
          ]
        },
        {
          "entrypoint": "./lookups/workspaceRequestContext",
          "functions": [
            "resolveRequestedWorkspaceSlug",
            "resolveRequestSurfaceId"
          ]
        },
        {
          "entrypoint": "./mappers/workspaceAdminMappers",
          "functions": [
            "mapWorkspaceInviteSummary",
            "mapWorkspaceMemberSummary",
            "mapWorkspacePayloadSummary",
            "mapWorkspaceSettingsResponse"
          ]
        },
        {
          "entrypoint": "./mappers/workspaceMappers",
          "functions": [
            "mapPendingInviteSummary",
            "mapUserSettingsPublic",
            "mapWorkspaceAdminSummary",
            "mapWorkspaceMembershipSummary",
            "mapWorkspaceSettingsPublic",
            "normalizeWorkspaceColor"
          ]
        },
        {
          "entrypoint": "./policies/workspaceInvitePolicy",
          "functions": [
            "resolveInviteExpiresAt"
          ],
          "constants": [
            "DEFAULT_INVITE_EXPIRY_DAYS"
          ]
        },
        {
          "entrypoint": "./policies/workspaceNaming",
          "functions": [
            "buildWorkspaceBaseSlug",
            "buildWorkspaceName",
            "toSlugPart"
          ]
        },
        {
          "entrypoint": "./policies/workspacePolicyDefaults",
          "functions": [
            "createWorkspaceSettingsDefaults"
          ]
        },
        {
          "entrypoint": "./policies/workspaceSettingsPatch",
          "functions": [
            "parseWorkspaceSettingsPatch"
          ]
        },
        {
          "entrypoint": "./repositories/invites",
          "functions": [
            "createRepository"
          ]
        },
        {
          "entrypoint": "./repositories/memberships",
          "functions": [
            "createRepository"
          ]
        },
        {
          "entrypoint": "./repositories/settings",
          "functions": [
            "createRepository"
          ]
        },
        {
          "entrypoint": "./repositories/workspaces",
          "functions": [
            "createRepository"
          ]
        },
        {
          "entrypoint": "./services/admin",
          "functions": [
            "createService"
          ]
        },
        {
          "entrypoint": "./services/inviteEmail",
          "functions": [
            "createService"
          ]
        },
        {
          "entrypoint": "./services/workspace",
          "functions": [
            "createService"
          ]
        }
      ]
    }
  }
});

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeContracts(contractsByDomain, { sourceLabel = "contracts" } = {}) {
  const rootNode = isPlainRecord(contractsByDomain) ? contractsByDomain : {};
  const byDomain = {};
  const byCapabilityId = {};

  const normalizeApiEntries = (apiEntries, capabilityId) => {
    if (!Array.isArray(apiEntries)) {
      return [];
    }
    const normalizedEntries = [];
    for (const [entryIndex, rawEntry] of apiEntries.entries()) {
      if (!isPlainRecord(rawEntry)) {
        throw new Error(
          `Capability ${capabilityId} api[${entryIndex}] in ${sourceLabel} must be an object.`
        );
      }

      const entrypoint = String(rawEntry.entrypoint || "").trim();
      if (!entrypoint) {
        throw new Error(
          `Capability ${capabilityId} api[${entryIndex}] in ${sourceLabel} must define entrypoint.`
        );
      }

      const functions = toSortedUniqueStrings(rawEntry.functions || []);
      const constants = toSortedUniqueStrings(rawEntry.constants || []);
      const symbols = toSortedUniqueStrings(rawEntry.symbols || []);
      const requireContractTest = Number(rawEntry.requireContractTest || 0);
      if (requireContractTest !== 0 && requireContractTest !== 1) {
        throw new Error(
          `Capability ${capabilityId} api[${entryIndex}] in ${sourceLabel} has invalid requireContractTest value ${rawEntry.requireContractTest}.`
        );
      }

      const normalizedEntry = {
        entrypoint
      };
      if (functions.length > 0) {
        normalizedEntry.functions = functions;
      }
      if (constants.length > 0) {
        normalizedEntry.constants = constants;
      }
      if (symbols.length > 0) {
        normalizedEntry.symbols = symbols;
      }
      if (requireContractTest === 1) {
        normalizedEntry.requireContractTest = 1;
      }
      normalizedEntries.push(normalizedEntry);
    }
    return normalizedEntries;
  };

  const visit = (inputNode, outputNode, pathSegments) => {
    for (const key of Object.keys(inputNode).sort((left, right) => left.localeCompare(right))) {
      const value = inputNode[key];
      if (!isPlainRecord(value)) {
        throw new Error(
          `Invalid contract node ${[...pathSegments, key].join(".")} in ${sourceLabel}; expected object.`
        );
      }

      const kind = String(value.kind || "").trim();
      const summary = String(value.summary || "").trim();
      const looksLikeContractLeaf =
        kind.length > 0 ||
        summary.length > 0 ||
        Array.isArray(value.api) ||
        Object.prototype.hasOwnProperty.call(value, "capabilityId");

      if (!looksLikeContractLeaf) {
        const childNode = {};
        outputNode[key] = childNode;
        visit(value, childNode, [...pathSegments, key]);
        continue;
      }

      if (!kind || !summary) {
        throw new Error(
          `Contract leaf ${[...pathSegments, key].join(".")} in ${sourceLabel} must define kind and summary.`
        );
      }

      const derivedCapabilityId = [...pathSegments, key].join(".");
      const capabilityId = String(value.capabilityId || derivedCapabilityId).trim();
      if (!capabilityId) {
        throw new Error(
          `Contract leaf ${[...pathSegments, key].join(".")} in ${sourceLabel} resolved empty capabilityId.`
        );
      }
      if (byCapabilityId[capabilityId]) {
        throw new Error(`Duplicate contract capabilityId ${capabilityId} in ${sourceLabel}.`);
      }

      const requireContractTest = Number(value.requireContractTest || 0);
      if (requireContractTest !== 0 && requireContractTest !== 1) {
        throw new Error(
          `Capability ${capabilityId} in ${sourceLabel} has invalid requireContractTest value ${value.requireContractTest}.`
        );
      }

      const normalizedContract = {
        capabilityId,
        kind,
        summary
      };
      if (Array.isArray(value.api)) {
        normalizedContract.api = normalizeApiEntries(value.api, capabilityId);
      }
      if (requireContractTest === 1) {
        normalizedContract.requireContractTest = 1;
      }

      outputNode[key] = normalizedContract;
      byCapabilityId[capabilityId] = normalizedContract;
    }
  };

  visit(rootNode, byDomain, []);

  return {
    byDomain: deepFreeze(byDomain),
    byCapabilityId: deepFreeze(byCapabilityId)
  };
}

const BUILTIN_CONTRACT_NORMALIZATION = normalizeContracts(CAPABILITY_CONTRACTS_BY_DOMAIN, {
  sourceLabel: "built-in capability contracts"
});
const CAPABILITY_CONTRACTS = BUILTIN_CONTRACT_NORMALIZATION.byCapabilityId;

const CAPABILITY_CONTRACT_IDS = Object.freeze(
  Object.keys(CAPABILITY_CONTRACTS).sort((left, right) => left.localeCompare(right))
);

const IMPLICIT_TESTABLE_SYMBOL = "__testables";
const IMPLICIT_CONTRACT_SYMBOLS = Object.freeze([IMPLICIT_TESTABLE_SYMBOL]);

function normalizeCapabilityId(capabilityId) {
  return String(capabilityId || "").trim();
}

function normalizeEntrypoint(entrypoint) {
  const normalized = String(entrypoint || "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith("descriptor:")) {
    return normalized;
  }
  if (normalized === ".") {
    return ".";
  }
  return normalized.startsWith("./") ? normalized : `./${normalized}`;
}

function toSortedUniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function toNormalizedContractSymbolList(values) {
  return toSortedUniqueStrings(values).filter((symbol) => symbol !== IMPLICIT_TESTABLE_SYMBOL);
}

function isConstantLikeSymbol(symbol) {
  return /^[A-Z]/.test(symbol) || /^[A-Z0-9_]+$/.test(symbol);
}

function splitLegacySymbols(symbols) {
  const functions = [];
  const constants = [];
  for (const symbol of toNormalizedContractSymbolList(symbols)) {
    if (isConstantLikeSymbol(symbol)) {
      constants.push(symbol);
      continue;
    }
    functions.push(symbol);
  }
  return {
    functions: toSortedUniqueStrings(functions),
    constants: toSortedUniqueStrings(constants)
  };
}

function buildApiEntry({ entry, baseRequireContractTest }) {
  const normalizedEntrypoint = normalizeEntrypoint(entry.entrypoint);
  const explicitFunctions = toNormalizedContractSymbolList(entry.functions);
  const explicitConstants = toNormalizedContractSymbolList(entry.constants);
  const legacySymbols = toNormalizedContractSymbolList(entry.symbols);

  let functions = explicitFunctions;
  let constants = explicitConstants;
  if (functions.length < 1 && constants.length < 1 && legacySymbols.length > 0) {
    const split = splitLegacySymbols(legacySymbols);
    functions = split.functions;
    constants = split.constants;
  }

  const normalizedFunctions = Object.freeze(toSortedUniqueStrings(functions));
  const normalizedConstants = Object.freeze(toSortedUniqueStrings(constants));

  return Object.freeze({
    entrypoint: normalizedEntrypoint,
    functions: normalizedFunctions,
    constants: normalizedConstants,
    symbols: Object.freeze(toSortedUniqueStrings([
      ...normalizedFunctions,
      ...normalizedConstants
    ])),
    implicitSymbols: IMPLICIT_CONTRACT_SYMBOLS,
    requireContractTest: Number(
      entry.requireContractTest == null ? baseRequireContractTest : entry.requireContractTest
    )
  });
}

function getCapabilityContractApiEntries(capabilityId, contractsMap = CAPABILITY_CONTRACTS) {
  const contract = getCapabilityContract(capabilityId, contractsMap);
  if (!contract) {
    return [];
  }

  const baseRequireContractTest = Number(contract.requireContractTest || 0);
  const entries = [];

  if (Array.isArray(contract.api)) {
    for (const entry of contract.api) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      entries.push(buildApiEntry({ entry, baseRequireContractTest }));
    }
  }

  if (entries.length > 0) {
    return Object.freeze(entries);
  }

  return Object.freeze([
    buildApiEntry({
      entry: {
        entrypoint: contract.entrypoint,
        functions: contract.functions,
        constants: contract.constants,
        symbols: contract.symbols,
        requireContractTest: contract.requireContractTest
      },
      baseRequireContractTest
    })
  ]);
}

function getCapabilityContractRequiredSymbols(apiEntry) {
  return toSortedUniqueStrings([
    ...toNormalizedContractSymbolList(apiEntry?.functions),
    ...toNormalizedContractSymbolList(apiEntry?.constants)
  ]);
}

function getCapabilityContract(capabilityId, contractsMap = CAPABILITY_CONTRACTS) {
  const normalized = normalizeCapabilityId(capabilityId);
  if (!normalized || !contractsMap || typeof contractsMap !== "object") {
    return null;
  }
  return contractsMap[normalized] || null;
}

function listCapabilityContracts(contractsMap = CAPABILITY_CONTRACTS) {
  const ids = Object.keys(contractsMap || {}).sort((left, right) => left.localeCompare(right));
  return ids.map((capabilityId) => contractsMap[capabilityId]);
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
  IMPLICIT_CONTRACT_SYMBOLS,
  normalizeContracts,
  normalizeCapabilityId,
  getCapabilityContractApiEntries,
  getCapabilityContractRequiredSymbols,
  getCapabilityContract,
  listCapabilityContracts,
  getCapabilityContractTestRelativePath
};
