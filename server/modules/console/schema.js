import { Type } from "@fastify/type-provider-typebox";
import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_EMAIL_MIN_LENGTH,
  AUTH_EMAIL_PATTERN
} from "../../../shared/auth/authConstraints.js";
import { enumSchema } from "../api/schema.js";
import { createPaginationQuerySchema } from "../api/schema/paginationQuery.schema.js";

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

const billingPlanEntitlement = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    planId: Type.Integer({ minimum: 1 }),
    code: Type.String({ minLength: 1, maxLength: 120 }),
    schemaVersion: Type.String({ minLength: 1, maxLength: 120 }),
    valueJson: Type.Record(Type.String(), Type.Unknown()),
    createdAt: Type.String({ format: "iso-utc-date-time" }),
    updatedAt: Type.String({ format: "iso-utc-date-time" })
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
    corePrice: billingPlanCorePrice,
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

const billingPlans = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 32 }),
    plans: Type.Array(billingPlan)
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

const billingPlanCreateBody = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 120 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    description: Type.Optional(Type.String({ maxLength: 10000 })),
    isActive: Type.Optional(Type.Boolean()),
    metadataJson: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    corePrice: Type.Object(
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
    entitlements: Type.Optional(
      Type.Array(
        Type.Object(
          {
            code: Type.String({ minLength: 1, maxLength: 120 }),
            schemaVersion: Type.String({ minLength: 1, maxLength: 120 }),
            valueJson: Type.Record(Type.String(), Type.Unknown())
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
    corePrice: Type.Object(
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
    )
  },
  {
    additionalProperties: false
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
    workspaceId: Type.Optional(Type.Integer({ minimum: 1 })),
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
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 100 }))
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
    pendingInvites,
    respondToInvite,
    aiTranscriptsList,
    aiTranscriptMessages,
    aiTranscriptExport,
    billingEvents,
    billingPlans,
    billingPlanCreate: billingPlanCreateResponse,
    billingProviderPrices,
    billingPlanUpdate: billingPlanCreateResponse
  },
  body: {
    createInvite,
    memberRoleUpdate,
    assistantSettingsUpdate,
    redeemInvite,
    billingPlanCreate: billingPlanCreateBody,
    billingPlanUpdate: billingPlanUpdateBody
  },
  query: {
    aiTranscripts: aiTranscriptsQuery,
    aiTranscriptMessages: aiTranscriptMessagesQuery,
    aiTranscriptExport: aiTranscriptExportQuery,
    billingEvents: billingEventsQuery,
    billingProviderPrices: billingProviderPricesQuery
  },
  params: {
    member,
    invite,
    conversation,
    billingPlan: billingPlanParams
  }
};

export { schema };
