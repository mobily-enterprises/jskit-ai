import { Type } from "@fastify/type-provider-typebox";
import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_EMAIL_MIN_LENGTH,
  AUTH_EMAIL_PATTERN
} from "../../../../shared/auth/authConstraints.js";
import { SETTINGS_MODE_OPTIONS, SETTINGS_TIMING_OPTIONS } from "../../../../shared/settings/index.js";
import { enumSchema } from "../../api/schema.js";

const colorPattern = "^#[0-9A-Fa-f]{6}$";

const summary = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    slug: Type.String({ minLength: 1, maxLength: 120 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    color: Type.String({ minLength: 7, maxLength: 7, pattern: colorPattern }),
    avatarUrl: Type.String(),
    roleId: Type.String({ minLength: 1, maxLength: 64 }),
    isAccessible: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const active = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    slug: Type.String({ minLength: 1, maxLength: 120 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    color: Type.String({ minLength: 7, maxLength: 7, pattern: colorPattern }),
    avatarUrl: Type.String()
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

const settingsSummary = Type.Object(
  {
    invitesEnabled: Type.Boolean(),
    invitesAvailable: Type.Boolean(),
    invitesEffective: Type.Boolean(),
    assistantTranscriptMode: enumSchema(["standard", "restricted", "disabled"]),
    assistantSystemPromptApp: Type.Optional(Type.String({ maxLength: 4000 })),
    defaultMode: enumSchema(SETTINGS_MODE_OPTIONS),
    defaultTiming: enumSchema(SETTINGS_TIMING_OPTIONS),
    defaultPaymentsPerYear: Type.Integer({ minimum: 1, maximum: 365 }),
    defaultHistoryPageSize: Type.Integer({ minimum: 1, maximum: 100 }),
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
    additionalProperties: false
  }
);

const pendingInviteSummary = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    workspaceId: Type.Integer({ minimum: 1 }),
    token: Type.String({ minLength: 16, maxLength: 256 }),
    workspaceSlug: Type.String({ minLength: 1, maxLength: 120 }),
    workspaceName: Type.String({ minLength: 1, maxLength: 160 }),
    workspaceAvatarUrl: Type.String(),
    roleId: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.String({ minLength: 1, maxLength: 32 }),
    expiresAt: Type.String({ minLength: 1 }),
    invitedByDisplayName: Type.String(),
    invitedByEmail: Type.String()
  },
  {
    additionalProperties: false
  }
);

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
    collaborationEnabled: Type.Boolean(),
    defaultInviteRole: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
    roles: Type.Array(roleDescriptor),
    assignableRoleIds: Type.Array(Type.String({ minLength: 1, maxLength: 64 }))
  },
  {
    additionalProperties: false
  }
);

const member = Type.Object(
  {
    userId: Type.Integer({ minimum: 1 }),
    email: Type.String({ minLength: AUTH_EMAIL_MIN_LENGTH, maxLength: AUTH_EMAIL_MAX_LENGTH }),
    displayName: Type.String(),
    roleId: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.String({ minLength: 1, maxLength: 32 }),
    isOwner: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const invite = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    workspaceId: Type.Integer({ minimum: 1 }),
    email: Type.String({ minLength: AUTH_EMAIL_MIN_LENGTH, maxLength: AUTH_EMAIL_MAX_LENGTH }),
    roleId: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.String({ minLength: 1, maxLength: 32 }),
    expiresAt: Type.String({ minLength: 1 }),
    invitedByUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    invitedByDisplayName: Type.String(),
    invitedByEmail: Type.String(),
    workspace: Type.Union([
      Type.Object(
        {
          id: Type.Integer({ minimum: 1 }),
          slug: Type.String({ minLength: 1, maxLength: 120 }),
          name: Type.String({ minLength: 1, maxLength: 160 }),
          color: Type.String({ minLength: 7, maxLength: 7, pattern: colorPattern }),
          avatarUrl: Type.String()
        },
        {
          additionalProperties: false
        }
      ),
      Type.Null()
    ])
  },
  {
    additionalProperties: false
  }
);

const schema = {
  fields: {
    colorPattern
  },
  summary,
  active,
  membershipSummary,
  settingsSummary,
  pendingInviteSummary,
  roleDescriptor,
  roleCatalog,
  member,
  invite
};

export { schema };
