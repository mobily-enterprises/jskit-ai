import { Type } from "@fastify/type-provider-typebox";
import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_EMAIL_MIN_LENGTH,
  AUTH_EMAIL_PATTERN
} from "@jskit-ai/access-core/server/authConstraints";
import { enumSchema } from "@jskit-ai/http-contracts/errorResponses";
import { createPaginationQuerySchema } from "@jskit-ai/http-contracts/paginationQuery";

const roleDescriptor = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    assignable: Type.Boolean(),
    permissions: Type.Array(Type.String({ minLength: 1 }))
  },
  {
    additionalProperties: false
  }
);

const roleCatalog = Type.Object(
  {
    defaultInviteRole: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
    roles: Type.Array(roleDescriptor),
    assignableRoleIds: Type.Array(Type.String({ minLength: 1, maxLength: 64 }))
  },
  {
    additionalProperties: false
  }
);

const membershipSummary = Type.Object(
  {
    roleId: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.String({ minLength: 1, maxLength: 32 })
  },
  {
    additionalProperties: false
  }
);

const inviteSummary = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    email: Type.String({ minLength: AUTH_EMAIL_MIN_LENGTH, maxLength: AUTH_EMAIL_MAX_LENGTH }),
    roleId: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.String({ minLength: 1, maxLength: 32 }),
    expiresAt: Type.String({ minLength: 1 }),
    invitedByUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    invitedByDisplayName: Type.String(),
    invitedByEmail: Type.String()
  },
  {
    additionalProperties: false
  }
);

const pendingInviteSummary = Type.Object(
  {
    ...inviteSummary.properties,
    token: Type.String({ minLength: 16, maxLength: 256 })
  },
  {
    additionalProperties: false
  }
);

const memberSummary = Type.Object(
  {
    userId: Type.Integer({ minimum: 1 }),
    email: Type.String({ minLength: AUTH_EMAIL_MIN_LENGTH, maxLength: AUTH_EMAIL_MAX_LENGTH }),
    displayName: Type.String(),
    roleId: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.String({ minLength: 1, maxLength: 32 }),
    isConsole: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const bootstrap = Type.Object(
  {
    session: Type.Object(
      {
        authenticated: Type.Boolean(),
        userId: Type.Optional(Type.Integer({ minimum: 1 })),
        username: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 120 }), Type.Null()]))
      },
      {
        additionalProperties: false
      }
    ),
    membership: Type.Union([membershipSummary, Type.Null()]),
    permissions: Type.Array(Type.String({ minLength: 1 })),
    roleCatalog,
    pendingInvites: Type.Array(pendingInviteSummary),
    isConsole: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const members = Type.Object(
  {
    members: Type.Array(memberSummary),
    roleCatalog
  },
  {
    additionalProperties: false
  }
);

const invites = Type.Object(
  {
    invites: Type.Array(inviteSummary),
    roleCatalog,
    createdInvite: Type.Optional(
      Type.Object(
        {
          inviteId: Type.Integer({ minimum: 1 }),
          email: Type.String({ minLength: AUTH_EMAIL_MIN_LENGTH, maxLength: AUTH_EMAIL_MAX_LENGTH }),
          token: Type.String({ minLength: 16, maxLength: 256 })
        },
        {
          additionalProperties: false
        }
      )
    )
  },
  {
    additionalProperties: false
  }
);

const roles = Type.Object(
  {
    roleCatalog
  },
  {
    additionalProperties: false
  }
);

const pendingInvites = Type.Object(
  {
    pendingInvites: Type.Array(pendingInviteSummary)
  },
  {
    additionalProperties: false
  }
);

const respondToInvite = Type.Object(
  {
    ok: Type.Boolean(),
    decision: enumSchema(["accepted", "refused"]),
    inviteId: Type.Integer({ minimum: 1 }),
    membership: Type.Optional(membershipSummary)
  },
  {
    additionalProperties: false
  }
);

const createInvite = Type.Object(
  {
    email: Type.String({
      minLength: AUTH_EMAIL_MIN_LENGTH,
      maxLength: AUTH_EMAIL_MAX_LENGTH,
      pattern: AUTH_EMAIL_PATTERN
    }),
    roleId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 }))
  },
  {
    additionalProperties: false
  }
);

const memberRoleUpdate = Type.Object(
  {
    roleId: Type.String({ minLength: 1, maxLength: 64 })
  },
  {
    additionalProperties: false
  }
);

const redeemInvite = Type.Object(
  {
    token: Type.String({ minLength: 16, maxLength: 256 }),
    decision: enumSchema(["accept", "refuse"])
  },
  {
    additionalProperties: false
  }
);

const assistantSettings = Type.Object(
  {
    settings: Type.Object(
      {
        assistantSystemPromptWorkspace: Type.String({ maxLength: 4000 })
      },
      {
        additionalProperties: false
      }
    )
  },
  {
    additionalProperties: false
  }
);

const assistantSettingsUpdate = Type.Object(
  {
    assistantSystemPromptWorkspace: Type.String({ maxLength: 4000 })
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

const billingSettings = Type.Object(
  {
    settings: Type.Object(
      {
        paidPlanChangePaymentMethodPolicy: enumSchema(["required_now", "allow_without_payment_method"])
      },
      {
        additionalProperties: false
      }
    )
  },
  {
    additionalProperties: false
  }
);

const billingSettingsUpdate = Type.Object(
  {
    paidPlanChangePaymentMethodPolicy: enumSchema(["required_now", "allow_without_payment_method"])
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

const member = Type.Object(
  {
    memberUserId: Type.String({ minLength: 1, maxLength: 32, pattern: "^[0-9]+$" })
  },
  {
    additionalProperties: false
  }
);

const invite = Type.Object(
  {
    inviteId: Type.String({ minLength: 1, maxLength: 32, pattern: "^[0-9]+$" })
  },
  {
    additionalProperties: false
  }
);

const conversation = Type.Object(
  {
    conversationId: Type.String({ minLength: 1, maxLength: 32, pattern: "^[0-9]+$" })
  },
  {
    additionalProperties: false
  }
);

const billingPlanParams = Type.Object(
  {
    planId: Type.String({ minLength: 1, maxLength: 32, pattern: "^[0-9]+$" })
  },
  {
    additionalProperties: false
  }
);

const billingProductParams = Type.Object(
  {
    productId: Type.String({ minLength: 1, maxLength: 32, pattern: "^[0-9]+$" })
  },
  {
    additionalProperties: false
  }
);

const billingEntitlementDefinitionParams = Type.Object(
  {
    definitionId: Type.String({ minLength: 1, maxLength: 32, pattern: "^[0-9]+$" })
  },
  {
    additionalProperties: false
  }
);

const billingPurchaseParams = Type.Object(
  {
    purchaseId: Type.String({ minLength: 1, maxLength: 32, pattern: "^[0-9]+$" })
  },
  {
    additionalProperties: false
  }
);

const billingPlanAssignmentParams = Type.Object(
  {
    assignmentId: Type.String({ minLength: 1, maxLength: 32, pattern: "^[0-9]+$" })
  },
  {
    additionalProperties: false
  }
);

const billingSubscriptionParams = Type.Object(
  {
    providerSubscriptionId: Type.String({ minLength: 1, maxLength: 191 })
  },
  {
    additionalProperties: false
  }
);

const transcriptMode = enumSchema(["standard", "restricted", "disabled"]);
const transcriptStatus = enumSchema(["active", "completed", "failed", "aborted"]);
const transcriptExportFormat = enumSchema(["json", "ndjson"]);
const transcriptMetadata = Type.Record(Type.String(), Type.Unknown());

const aiTranscriptConversation = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    workspaceId: Type.Integer({ minimum: 1 }),
    workspaceSlug: Type.String(),
    workspaceName: Type.String(),
    title: Type.Optional(Type.String({ maxLength: 160 })),
    createdByUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    status: transcriptStatus,
    transcriptMode,
    provider: Type.String({ maxLength: 64 }),
    model: Type.String({ maxLength: 128 }),
    startedAt: Type.String({ minLength: 1 }),
    endedAt: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    messageCount: Type.Integer({ minimum: 0 }),
    metadata: transcriptMetadata,
    createdAt: Type.String({ minLength: 1 }),
    updatedAt: Type.String({ minLength: 1 })
  },
  {
    additionalProperties: false
  }
);

const aiTranscriptMessage = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    conversationId: Type.Integer({ minimum: 1 }),
    workspaceId: Type.Integer({ minimum: 1 }),
    workspaceSlug: Type.String(),
    workspaceName: Type.String(),
    seq: Type.Integer({ minimum: 1 }),
    role: Type.String({ minLength: 1, maxLength: 32 }),
    kind: Type.String({ minLength: 1, maxLength: 32 }),
    clientMessageId: Type.String({ maxLength: 128 }),
    actorUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    contentText: Type.Union([Type.String(), Type.Null()]),
    contentRedacted: Type.Boolean(),
    redactionHits: transcriptMetadata,
    metadata: transcriptMetadata,
    createdAt: Type.String({ minLength: 1 }),
    conversation: Type.Optional(
      Type.Object(
        {
          status: transcriptStatus,
          transcriptMode,
          provider: Type.String({ maxLength: 64 }),
          model: Type.String({ maxLength: 128 }),
          startedAt: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
          endedAt: Type.Union([Type.String({ minLength: 1 }), Type.Null()])
        },
        { additionalProperties: false }
      )
    )
  },
  {
    additionalProperties: false
  }
);

const aiTranscriptsList = Type.Object(
  {
    entries: Type.Array(aiTranscriptConversation),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 200 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 1 })
  },
  {
    additionalProperties: false
  }
);

const aiTranscriptMessages = Type.Object(
  {
    conversation: aiTranscriptConversation,
    entries: Type.Array(aiTranscriptMessage),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 500 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 1 })
  },
  {
    additionalProperties: false
  }
);

const aiTranscriptExport = Type.Object(
  {
    format: transcriptExportFormat,
    entries: Type.Array(aiTranscriptMessage),
    exportedAt: Type.String({ minLength: 1 })
  },
  {
    additionalProperties: false
  }
);

const billingEvent = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    source: Type.String({ minLength: 1, maxLength: 64 }),
    sourceId: Type.Integer({ minimum: 0 }),
    billableEntityId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    workspaceId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    workspaceSlug: Type.Union([Type.String(), Type.Null()]),
    workspaceName: Type.Union([Type.String(), Type.Null()]),
    ownerUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    provider: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    operationKey: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    providerEventId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    eventType: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 }),
    message: Type.Union([Type.String(), Type.Null()]),
    occurredAt: Type.String({ format: "iso-utc-date-time" }),
    detailsJson: Type.Unknown()
  },
  {
    additionalProperties: false
  }
);

const billingEvents = Type.Object(
  {
    entries: Type.Array(billingEvent),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    hasMore: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const billingPurchase = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    billableEntityId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    workspaceId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    provider: Type.String({ minLength: 1, maxLength: 32 }),
    purchaseKind: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.String({ minLength: 1, maxLength: 32 }),
    amountMinor: Type.Integer(),
    currency: Type.String({ minLength: 3, maxLength: 3 }),
    quantity: Type.Integer({ minimum: 1 }),
    operationKey: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
    providerPaymentId: Type.Union([Type.String({ minLength: 1, maxLength: 191 }), Type.Null()]),
    providerInvoiceId: Type.Union([Type.String({ minLength: 1, maxLength: 191 }), Type.Null()]),
    displayName: Type.Union([Type.String(), Type.Null()]),
    metadataJson: Type.Unknown(),
    purchasedAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()])
  },
  {
    additionalProperties: false
  }
);

const billingPurchaseAdjustment = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    purchaseId: Type.Integer({ minimum: 1 }),
    actionType: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.String({ minLength: 1, maxLength: 32 }),
    amountMinor: Type.Union([Type.Integer(), Type.Null()]),
    currency: Type.Union([Type.String({ minLength: 3, maxLength: 3 }), Type.Null()]),
    reasonCode: Type.Union([Type.String({ minLength: 1, maxLength: 120 }), Type.Null()]),
    providerReference: Type.Union([Type.String({ minLength: 1, maxLength: 191 }), Type.Null()]),
    requestedByUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    requestIdempotencyKey: Type.Union([Type.String({ minLength: 1, maxLength: 191 }), Type.Null()]),
    metadataJson: Type.Unknown(),
    createdAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()])
  },
  {
    additionalProperties: false
  }
);

const billingPurchases = Type.Object(
  {
    entries: Type.Array(billingPurchase),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    hasMore: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const billingPurchaseMutationResponse = Type.Object(
  {
    purchase: Type.Union([billingPurchase, Type.Null()]),
    adjustment: Type.Union([billingPurchaseAdjustment, Type.Null()]),
    adjustments: Type.Array(billingPurchaseAdjustment)
  },
  {
    additionalProperties: false
  }
);

const billingPlanAssignment = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    billableEntityId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    workspaceId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    workspaceSlug: Type.Union([Type.String({ minLength: 1, maxLength: 191 }), Type.Null()]),
    planId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    planCode: Type.Union([Type.String({ minLength: 1, maxLength: 120 }), Type.Null()]),
    planName: Type.Union([Type.String({ minLength: 1, maxLength: 160 }), Type.Null()]),
    source: Type.String({ minLength: 1, maxLength: 32 }),
    status: Type.String({ minLength: 1, maxLength: 32 }),
    periodStartAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    periodEndAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    provider: Type.Union([Type.String({ minLength: 1, maxLength: 32 }), Type.Null()]),
    providerSubscriptionId: Type.Union([Type.String({ minLength: 1, maxLength: 191 }), Type.Null()]),
    providerStatus: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
    currentPeriodEnd: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    cancelAtPeriodEnd: Type.Union([Type.Boolean(), Type.Null()]),
    metadataJson: Type.Unknown(),
    createdAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    updatedAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()])
  },
  {
    additionalProperties: false
  }
);

const billingPlanAssignments = Type.Object(
  {
    entries: Type.Array(billingPlanAssignment),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    hasMore: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const billingPlanAssignmentMutationResponse = Type.Object(
  {
    assignment: billingPlanAssignment
  },
  {
    additionalProperties: false
  }
);

const billingSubscription = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 32 }),
    providerSubscriptionId: Type.String({ minLength: 1, maxLength: 191 }),
    providerCustomerId: Type.Union([Type.String({ minLength: 1, maxLength: 191 }), Type.Null()]),
    status: Type.String({ minLength: 1, maxLength: 64 }),
    providerSubscriptionCreatedAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    currentPeriodEnd: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    trialEnd: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    canceledAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    cancelAtPeriodEnd: Type.Boolean(),
    endedAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    assignmentId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    assignmentStatus: Type.String({ minLength: 1, maxLength: 32 }),
    assignmentPeriodStartAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    assignmentPeriodEndAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    billableEntityId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    workspaceId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    workspaceSlug: Type.Union([Type.String({ minLength: 1, maxLength: 191 }), Type.Null()]),
    planId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    planCode: Type.Union([Type.String({ minLength: 1, maxLength: 120 }), Type.Null()]),
    planName: Type.Union([Type.String({ minLength: 1, maxLength: 160 }), Type.Null()]),
    metadataJson: Type.Unknown()
  },
  {
    additionalProperties: false
  }
);

const billingSubscriptions = Type.Object(
  {
    entries: Type.Array(billingSubscription),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    hasMore: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const billingSubscriptionMutationResponse = Type.Object(
  {
    subscription: billingSubscription
  },
  {
    additionalProperties: false
  }
);

const billingPlanCorePrice = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 32 }),
    providerPriceId: Type.String({ minLength: 1, maxLength: 191 }),
    providerProductId: Type.Union([Type.String({ minLength: 1, maxLength: 191 }), Type.Null()]),
    interval: Type.String({ minLength: 1, maxLength: 32 }),
    intervalCount: Type.Integer({ minimum: 1 }),
    currency: Type.String({ minLength: 3, maxLength: 3 }),
    unitAmountMinor: Type.Integer({ minimum: 0 })
  },
  {
    additionalProperties: false
  }
);

const billingProductPrice = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 32 }),
    providerPriceId: Type.String({ minLength: 1, maxLength: 191 }),
    providerProductId: Type.Union([Type.String({ minLength: 1, maxLength: 191 }), Type.Null()]),
    interval: Type.Union([Type.String({ minLength: 1, maxLength: 32 }), Type.Null()]),
    intervalCount: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    currency: Type.String({ minLength: 3, maxLength: 3 }),
    unitAmountMinor: Type.Integer({ minimum: 0 })
  },
  {
    additionalProperties: false
  }
);

const billingPlanEntitlement = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 120 }),
    schemaVersion: Type.String({ minLength: 1, maxLength: 120 }),
    valueJson: Type.Record(Type.String(), Type.Unknown()),
    grantKind: Type.Optional(enumSchema(["plan_base", "plan_bonus"])),
    effectivePolicy: Type.Optional(enumSchema(["on_assignment_current", "on_period_paid"])),
    durationPolicy: Type.Optional(enumSchema(["while_current", "period_window", "fixed_duration"])),
    durationDays: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
    metadataJson: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]))
  },
  {
    additionalProperties: false
  }
);

const billingProductEntitlement = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 120 }),
    amount: Type.Integer({ minimum: 1 }),
    grantKind: enumSchema(["one_off_topup", "timeboxed_addon"]),
    durationDays: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    metadataJson: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]))
  },
  {
    additionalProperties: false
  }
);

const billingPlan = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    code: Type.String({ minLength: 1, maxLength: 120 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    description: Type.Union([Type.String(), Type.Null()]),
    appliesTo: Type.String({ minLength: 1, maxLength: 32 }),
    corePrice: Type.Union([billingPlanCorePrice, Type.Null()]),
    isActive: Type.Boolean(),
    metadataJson: Type.Unknown(),
    createdAt: Type.String({ format: "iso-utc-date-time" }),
    updatedAt: Type.String({ format: "iso-utc-date-time" }),
    entitlements: Type.Array(billingPlanEntitlement)
  },
  {
    additionalProperties: false
  }
);

const billingEntitlementDefinition = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    code: Type.String({ minLength: 1, maxLength: 120 }),
    name: Type.String({ minLength: 1, maxLength: 191 }),
    description: Type.Union([Type.String(), Type.Null()]),
    entitlementType: Type.String({ minLength: 1, maxLength: 64 }),
    unit: Type.String({ minLength: 1, maxLength: 64 }),
    windowInterval: Type.Union([Type.String({ minLength: 1, maxLength: 32 }), Type.Null()]),
    enforcementMode: Type.String({ minLength: 1, maxLength: 64 }),
    isActive: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const billingPlans = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 32 }),
    plans: Type.Array(billingPlan),
    entitlementDefinitions: Type.Array(billingEntitlementDefinition)
  },
  {
    additionalProperties: false
  }
);

const billingEntitlementDefinitions = Type.Object(
  {
    entries: Type.Array(billingEntitlementDefinition)
  },
  {
    additionalProperties: false
  }
);

const billingEntitlementDefinitionResponse = Type.Object(
  {
    definition: billingEntitlementDefinition
  },
  {
    additionalProperties: false
  }
);

const billingProduct = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    code: Type.String({ minLength: 1, maxLength: 120 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    description: Type.Union([Type.String(), Type.Null()]),
    productKind: Type.String({ minLength: 1, maxLength: 64 }),
    price: billingProductPrice,
    entitlements: Type.Array(billingProductEntitlement),
    isActive: Type.Boolean(),
    metadataJson: Type.Unknown(),
    createdAt: Type.String({ format: "iso-utc-date-time" }),
    updatedAt: Type.String({ format: "iso-utc-date-time" })
  },
  {
    additionalProperties: false
  }
);

const billingProducts = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 32 }),
    products: Type.Array(billingProduct)
  },
  {
    additionalProperties: false
  }
);

const billingProviderPrice = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 191 }),
    provider: Type.String({ minLength: 1, maxLength: 32 }),
    productId: Type.Union([Type.String({ minLength: 1, maxLength: 191 }), Type.Null()]),
    productName: Type.Union([Type.String(), Type.Null()]),
    nickname: Type.Union([Type.String(), Type.Null()]),
    currency: Type.Union([Type.String({ minLength: 3, maxLength: 3 }), Type.Null()]),
    unitAmountMinor: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    interval: Type.Union([Type.String({ minLength: 1, maxLength: 32 }), Type.Null()]),
    intervalCount: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    usageType: Type.Union([Type.String({ minLength: 1, maxLength: 32 }), Type.Null()]),
    active: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const billingProviderPrices = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 32 }),
    prices: Type.Array(billingProviderPrice)
  },
  {
    additionalProperties: false
  }
);

const billingPlanCreateResponse = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 32 }),
    plan: billingPlan
  },
  {
    additionalProperties: false
  }
);

const billingProductCreateResponse = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 32 }),
    product: billingProduct
  },
  {
    additionalProperties: false
  }
);

const billingPlanCreateBody = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 120 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    description: Type.Optional(Type.String({ maxLength: 10000 })),
    isActive: Type.Optional(Type.Boolean()),
    metadataJson: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    corePrice: Type.Union([
      Type.Object(
        {
          providerPriceId: Type.String({ minLength: 1, maxLength: 191 }),
          providerProductId: Type.Optional(Type.String({ maxLength: 191 })),
          currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
          unitAmountMinor: Type.Optional(Type.Integer({ minimum: 0 })),
          interval: Type.Optional(enumSchema(["day", "week", "month", "year"])),
          intervalCount: Type.Optional(Type.Integer({ minimum: 1 }))
        },
        {
          additionalProperties: false
        }
      ),
      Type.Null()
    ]),
    entitlements: Type.Optional(
      Type.Array(
        Type.Object(
          {
            code: Type.String({ minLength: 1, maxLength: 120 }),
            schemaVersion: Type.String({ minLength: 1, maxLength: 120 }),
            valueJson: Type.Record(Type.String(), Type.Unknown()),
            grantKind: Type.Optional(enumSchema(["plan_base", "plan_bonus"])),
            effectivePolicy: Type.Optional(enumSchema(["on_assignment_current", "on_period_paid"])),
            durationPolicy: Type.Optional(enumSchema(["while_current", "period_window", "fixed_duration"])),
            durationDays: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
            metadataJson: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
          },
          {
            additionalProperties: false
          }
        )
      )
    )
  },
  {
    additionalProperties: false
  }
);

const billingPlanUpdateBody = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    description: Type.Optional(Type.Union([Type.String({ maxLength: 10000 }), Type.Null()])),
    isActive: Type.Optional(Type.Boolean()),
    corePrice: Type.Optional(
      Type.Union([
        Type.Object(
          {
            providerPriceId: Type.String({ minLength: 1, maxLength: 191 }),
            providerProductId: Type.Optional(Type.String({ maxLength: 191 })),
            currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
            unitAmountMinor: Type.Optional(Type.Integer({ minimum: 0 })),
            interval: Type.Optional(enumSchema(["day", "week", "month", "year"])),
            intervalCount: Type.Optional(Type.Integer({ minimum: 1 }))
          },
          {
            additionalProperties: false
          }
        ),
        Type.Null()
      ])
    ),
    entitlements: Type.Optional(
      Type.Array(
        Type.Object(
          {
            code: Type.String({ minLength: 1, maxLength: 120 }),
            schemaVersion: Type.String({ minLength: 1, maxLength: 120 }),
            valueJson: Type.Record(Type.String(), Type.Unknown()),
            grantKind: Type.Optional(enumSchema(["plan_base", "plan_bonus"])),
            effectivePolicy: Type.Optional(enumSchema(["on_assignment_current", "on_period_paid"])),
            durationPolicy: Type.Optional(enumSchema(["while_current", "period_window", "fixed_duration"])),
            durationDays: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
            metadataJson: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
          },
          {
            additionalProperties: false
          }
        )
      )
    )
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

const billingProductCreateBody = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 120 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    description: Type.Optional(Type.String({ maxLength: 10000 })),
    productKind: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    isActive: Type.Optional(Type.Boolean()),
    metadataJson: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    price: Type.Object(
      {
        providerPriceId: Type.String({ minLength: 1, maxLength: 191 }),
        providerProductId: Type.Optional(Type.String({ maxLength: 191 })),
        currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
        unitAmountMinor: Type.Optional(Type.Integer({ minimum: 0 })),
        interval: Type.Optional(Type.Union([enumSchema(["day", "week", "month", "year"]), Type.Null()])),
        intervalCount: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]))
      },
      {
        additionalProperties: false
      }
    ),
    entitlements: Type.Optional(
      Type.Array(
        Type.Object(
          {
            code: Type.String({ minLength: 1, maxLength: 120 }),
            amount: Type.Integer({ minimum: 1 }),
            grantKind: enumSchema(["one_off_topup", "timeboxed_addon"]),
            durationDays: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
            metadataJson: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
          },
          {
            additionalProperties: false
          }
        )
      )
    )
  },
  {
    additionalProperties: false
  }
);

const billingProductUpdateBody = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    description: Type.Optional(Type.Union([Type.String({ maxLength: 10000 }), Type.Null()])),
    productKind: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    isActive: Type.Optional(Type.Boolean()),
    price: Type.Optional(
      Type.Object(
        {
          providerPriceId: Type.String({ minLength: 1, maxLength: 191 }),
          providerProductId: Type.Optional(Type.String({ maxLength: 191 })),
          currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
          unitAmountMinor: Type.Optional(Type.Integer({ minimum: 0 })),
          interval: Type.Optional(Type.Union([enumSchema(["day", "week", "month", "year"]), Type.Null()])),
          intervalCount: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]))
        },
        {
          additionalProperties: false
        }
      )
    ),
    entitlements: Type.Optional(
      Type.Array(
        Type.Object(
          {
            code: Type.String({ minLength: 1, maxLength: 120 }),
            amount: Type.Integer({ minimum: 1 }),
            grantKind: enumSchema(["one_off_topup", "timeboxed_addon"]),
            durationDays: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
            metadataJson: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
          },
          {
            additionalProperties: false
          }
        )
      )
    )
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

const aiTranscriptsQuery = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 20 })),
    workspaceId: Type.Optional(Type.Integer({ minimum: 1 })),
    from: Type.Optional(Type.String({ maxLength: 64 })),
    to: Type.Optional(Type.String({ maxLength: 64 })),
    status: Type.Optional(transcriptStatus)
  },
  {
    additionalProperties: false
  }
);

const billingEventsQuery = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
    workspaceSlug: Type.Optional(Type.String({ minLength: 1, maxLength: 191 })),
    userId: Type.Optional(Type.Integer({ minimum: 1 })),
    billableEntityId: Type.Optional(Type.Integer({ minimum: 1 })),
    operationKey: Type.Optional(Type.String({ minLength: 1, maxLength: 191 })),
    providerEventId: Type.Optional(Type.String({ minLength: 1, maxLength: 191 })),
    source: Type.Optional(Type.String({ minLength: 1, maxLength: 64 }))
  },
  {
    additionalProperties: false
  }
);

const billingProviderPricesQuery = Type.Object(
  {
    active: Type.Optional(Type.Boolean({ default: true })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 100 })),
    target: Type.Optional(enumSchema(["plan", "product"]))
  },
  {
    additionalProperties: false
  }
);

const billingPurchasesQuery = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
    workspaceSlug: Type.Optional(Type.String({ minLength: 1, maxLength: 191 })),
    userId: Type.Optional(Type.Integer({ minimum: 1 })),
    billableEntityId: Type.Optional(Type.Integer({ minimum: 1 })),
    status: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
    provider: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
    operationKey: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    purchaseKind: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    from: Type.Optional(Type.String({ maxLength: 64 })),
    to: Type.Optional(Type.String({ maxLength: 64 }))
  },
  {
    additionalProperties: false
  }
);

const billingPlanAssignmentsQuery = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
    billableEntityId: Type.Optional(Type.Integer({ minimum: 1 })),
    workspaceSlug: Type.Optional(Type.String({ minLength: 1, maxLength: 191 })),
    status: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
    statuses: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    source: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
    planCode: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    from: Type.Optional(Type.String({ maxLength: 64 })),
    to: Type.Optional(Type.String({ maxLength: 64 }))
  },
  {
    additionalProperties: false
  }
);

const billingSubscriptionsQuery = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
    provider: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
    providerSubscriptionId: Type.Optional(Type.String({ minLength: 1, maxLength: 191 })),
    billableEntityId: Type.Optional(Type.Integer({ minimum: 1 })),
    workspaceSlug: Type.Optional(Type.String({ minLength: 1, maxLength: 191 })),
    status: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    planCode: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    from: Type.Optional(Type.String({ maxLength: 64 })),
    to: Type.Optional(Type.String({ maxLength: 64 }))
  },
  {
    additionalProperties: false
  }
);

const billingPurchaseMutationBody = Type.Object(
  {
    reasonCode: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    metadataJson: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
  },
  {
    additionalProperties: false
  }
);

const billingPlanAssignmentCreateBody = Type.Object(
  {
    billableEntityId: Type.Integer({ minimum: 1 }),
    planId: Type.Integer({ minimum: 1 }),
    source: Type.Optional(enumSchema(["internal", "promo", "manual"])),
    status: Type.Optional(enumSchema(["current", "upcoming", "past", "canceled"])),
    periodStartAt: Type.Optional(Type.String({ maxLength: 64 })),
    periodEndAt: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
    metadataJson: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
  },
  {
    additionalProperties: false
  }
);

const billingPlanAssignmentUpdateBody = Type.Object(
  {
    planId: Type.Optional(Type.Integer({ minimum: 1 })),
    source: Type.Optional(enumSchema(["internal", "promo", "manual"])),
    status: Type.Optional(enumSchema(["current", "upcoming", "past", "canceled"])),
    periodStartAt: Type.Optional(Type.String({ maxLength: 64 })),
    periodEndAt: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
    metadataJson: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]))
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

const billingPlanAssignmentCancelBody = Type.Object(
  {
    reasonCode: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    metadataJson: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
  },
  {
    additionalProperties: false
  }
);

const billingSubscriptionChangePlanBody = Type.Object(
  {
    planId: Type.Optional(Type.Integer({ minimum: 1 })),
    planCode: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    prorationBehavior: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    billingCycleAnchor: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    metadataJson: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

const billingSubscriptionCancelBody = Type.Object(
  {
    reasonCode: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    metadataJson: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
  },
  {
    additionalProperties: false
  }
);

const billingSubscriptionCancelAtPeriodEndBody = Type.Object(
  {
    reasonCode: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    metadataJson: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
  },
  {
    additionalProperties: false
  }
);

const billingPurchaseCorrectionCreateBody = Type.Object(
  {
    amountMinor: Type.Integer(),
    currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
    reasonCode: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    metadataJson: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
  },
  {
    additionalProperties: false
  }
);

const aiTranscriptMessagesQuery = createPaginationQuerySchema({
  defaultPage: 1,
  defaultPageSize: 100,
  maxPageSize: 500
});

const aiTranscriptExportQuery = Type.Object(
  {
    workspaceId: Type.Optional(Type.Integer({ minimum: 1 })),
    conversationId: Type.Optional(Type.Integer({ minimum: 1 })),
    role: Type.Optional(Type.String({ maxLength: 32 })),
    from: Type.Optional(Type.String({ maxLength: 64 })),
    to: Type.Optional(Type.String({ maxLength: 64 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
    format: Type.Optional(transcriptExportFormat)
  },
  {
    additionalProperties: false
  }
);

const schema = {
  response: {
    bootstrap,
    members,
    invites,
    roles,
    assistantSettings,
    billingSettings,
    pendingInvites,
    respondToInvite,
    aiTranscriptsList,
    aiTranscriptMessages,
    aiTranscriptExport,
    billingEvents,
    billingPurchases,
    billingPurchaseMutation: billingPurchaseMutationResponse,
    billingPlanAssignments,
    billingPlanAssignmentMutation: billingPlanAssignmentMutationResponse,
    billingSubscriptions,
    billingSubscriptionMutation: billingSubscriptionMutationResponse,
    billingPlans,
    billingProducts,
    billingEntitlementDefinitions,
    billingEntitlementDefinition: billingEntitlementDefinitionResponse,
    billingPlanCreate: billingPlanCreateResponse,
    billingProductCreate: billingProductCreateResponse,
    billingProviderPrices,
    billingPlanUpdate: billingPlanCreateResponse,
    billingProductUpdate: billingProductCreateResponse
  },
  body: {
    createInvite,
    memberRoleUpdate,
    assistantSettingsUpdate,
    billingSettingsUpdate,
    redeemInvite,
    billingPurchaseMutation: billingPurchaseMutationBody,
    billingPurchaseCorrectionCreate: billingPurchaseCorrectionCreateBody,
    billingPlanAssignmentCreate: billingPlanAssignmentCreateBody,
    billingPlanAssignmentUpdate: billingPlanAssignmentUpdateBody,
    billingPlanAssignmentCancel: billingPlanAssignmentCancelBody,
    billingSubscriptionChangePlan: billingSubscriptionChangePlanBody,
    billingSubscriptionCancel: billingSubscriptionCancelBody,
    billingSubscriptionCancelAtPeriodEnd: billingSubscriptionCancelAtPeriodEndBody,
    billingPlanCreate: billingPlanCreateBody,
    billingPlanUpdate: billingPlanUpdateBody,
    billingProductCreate: billingProductCreateBody,
    billingProductUpdate: billingProductUpdateBody
  },
  query: {
    aiTranscripts: aiTranscriptsQuery,
    aiTranscriptMessages: aiTranscriptMessagesQuery,
    aiTranscriptExport: aiTranscriptExportQuery,
    billingEvents: billingEventsQuery,
    billingPurchases: billingPurchasesQuery,
    billingPlanAssignments: billingPlanAssignmentsQuery,
    billingSubscriptions: billingSubscriptionsQuery,
    billingProviderPrices: billingProviderPricesQuery
  },
  params: {
    member,
    invite,
    conversation,
    billingPlan: billingPlanParams,
    billingProduct: billingProductParams,
    billingEntitlementDefinition: billingEntitlementDefinitionParams,
    billingPurchase: billingPurchaseParams,
    billingPlanAssignment: billingPlanAssignmentParams,
    billingSubscription: billingSubscriptionParams
  }
};

export { schema };
