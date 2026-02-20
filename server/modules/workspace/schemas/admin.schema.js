import { Type } from "@fastify/type-provider-typebox";
import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_EMAIL_MIN_LENGTH,
  AUTH_EMAIL_PATTERN
} from "../../../../shared/auth/authConstraints.js";
import { SETTINGS_MODE_OPTIONS, SETTINGS_TIMING_OPTIONS } from "../../../../shared/settings/index.js";
import { enumSchema } from "../../api/schema.js";
import { createPaginationQuerySchema } from "../../api/schema/paginationQuery.schema.js";
import { schema as sharedSchema } from "./shared.schema.js";

const settings = Type.Object(
  {
    workspace: Type.Object(
      {
        id: Type.Integer({ minimum: 1 }),
        slug: Type.String({ minLength: 1, maxLength: 120 }),
        name: Type.String({ minLength: 1, maxLength: 160 }),
        color: Type.String({ minLength: 7, maxLength: 7, pattern: sharedSchema.fields.colorPattern }),
        avatarUrl: Type.String(),
        ownerUserId: Type.Integer({ minimum: 1 }),
        isPersonal: Type.Boolean()
      },
      {
        additionalProperties: false
      }
    ),
    settings: sharedSchema.settingsSummary,
    roleCatalog: sharedSchema.roleCatalog
  },
  {
    additionalProperties: false
  }
);

const settingsUpdate = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    color: Type.Optional(
      Type.String({ minLength: 7, maxLength: 7, pattern: sharedSchema.fields.colorPattern })
    ),
    avatarUrl: Type.Optional(Type.String()),
    invitesEnabled: Type.Optional(Type.Boolean()),
    assistantTranscriptMode: Type.Optional(enumSchema(["standard", "restricted", "disabled"])),
    defaultMode: Type.Optional(enumSchema(SETTINGS_MODE_OPTIONS)),
    defaultTiming: Type.Optional(enumSchema(SETTINGS_TIMING_OPTIONS)),
    defaultPaymentsPerYear: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
    defaultHistoryPageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    appDenyEmails: Type.Optional(
      Type.Array(
        Type.String({
          minLength: AUTH_EMAIL_MIN_LENGTH,
          maxLength: AUTH_EMAIL_MAX_LENGTH,
          pattern: AUTH_EMAIL_PATTERN
        })
      )
    ),
    appDenyUserIds: Type.Optional(Type.Array(Type.Integer({ minimum: 1 })))
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

const members = Type.Object(
  {
    workspace: Type.Object(
      {
        id: Type.Integer({ minimum: 1 }),
        slug: Type.String({ minLength: 1, maxLength: 120 }),
        name: Type.String({ minLength: 1, maxLength: 160 }),
        avatarUrl: Type.String(),
        ownerUserId: Type.Integer({ minimum: 1 }),
        isPersonal: Type.Boolean()
      },
      {
        additionalProperties: false
      }
    ),
    members: Type.Array(sharedSchema.member),
    roleCatalog: sharedSchema.roleCatalog
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

const invites = Type.Object(
  {
    workspace: Type.Object(
      {
        id: Type.Integer({ minimum: 1 }),
        slug: Type.String({ minLength: 1, maxLength: 120 }),
        name: Type.String({ minLength: 1, maxLength: 160 }),
        avatarUrl: Type.String(),
        ownerUserId: Type.Integer({ minimum: 1 }),
        isPersonal: Type.Boolean()
      },
      {
        additionalProperties: false
      }
    ),
    invites: Type.Array(sharedSchema.invite),
    roleCatalog: sharedSchema.roleCatalog,
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

const roles = Type.Object(
  {
    roleCatalog: sharedSchema.roleCatalog
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
    createdByUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    createdByUserDisplayName: Type.String({ maxLength: 120 }),
    createdByUserEmail: Type.String({ maxLength: 320 }),
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
    createdAt: Type.String({ minLength: 1 })
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
    conversation: aiTranscriptConversation,
    entries: Type.Array(aiTranscriptMessage),
    exportedAt: Type.String({ minLength: 1 })
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

const member = Type.Object(
  {
    memberUserId: Type.String({ minLength: 1, maxLength: 32, pattern: "^[0-9]+$" })
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

const aiTranscriptsQuery = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 20 })),
    from: Type.Optional(Type.String({ maxLength: 64 })),
    to: Type.Optional(Type.String({ maxLength: 64 })),
    status: Type.Optional(transcriptStatus),
    createdByUserId: Type.Optional(Type.Integer({ minimum: 1 }))
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
    settings,
    members,
    invites,
    roles,
    aiTranscriptsList,
    aiTranscriptMessages,
    aiTranscriptExport
  },
  body: {
    settingsUpdate,
    memberRoleUpdate,
    createInvite
  },
  query: {
    aiTranscripts: aiTranscriptsQuery,
    aiTranscriptMessages: aiTranscriptMessagesQuery,
    aiTranscriptExport: aiTranscriptExportQuery
  },
  params: {
    invite,
    member,
    conversation
  }
};

export { schema };
