import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function serializeNullableDateTime(value) {
  if (value == null) {
    return null;
  }

  return toDatabaseDateTimeUtc(value);
}

const workspaceInvitesResource = Object.freeze({
  tableName: "workspace_invites",
  searchSchema: {
    id: { type: "id", actualField: "id" }
  },
  schema: {
    workspaceId: {
      type: "id",
      required: true,
      search: true,
      belongsTo: "workspaces",
      as: "workspace",
      storage: { column: "workspace_id" }
    },
    email: {
      type: "string",
      required: true,
      max: 255,
      search: true,
      setter: (value) => normalizeLowerText(value)
    },
    roleSid: {
      type: "string",
      required: true,
      max: 64,
      defaultTo: "member",
      search: true,
      storage: { column: "role_sid" },
      setter: (value) => normalizeLowerText(value)
    },
    status: {
      type: "string",
      required: true,
      max: 64,
      defaultTo: "pending",
      search: true,
      setter: (value) => normalizeLowerText(value)
    },
    tokenHash: {
      type: "string",
      required: true,
      max: 255,
      search: true,
      storage: { column: "token_hash" },
      setter: (value) => normalizeText(value)
    },
    invitedByUserId: {
      type: "id",
      nullable: true,
      belongsTo: "userProfiles",
      as: "invitedByUser",
      storage: { column: "invited_by_user_id" }
    },
    expiresAt: {
      type: "dateTime",
      nullable: true,
      storage: {
        column: "expires_at",
        serialize: serializeNullableDateTime
      }
    },
    acceptedAt: {
      type: "dateTime",
      nullable: true,
      storage: {
        column: "accepted_at",
        serialize: serializeNullableDateTime
      }
    },
    revokedAt: {
      type: "dateTime",
      nullable: true,
      storage: {
        column: "revoked_at",
        serialize: serializeNullableDateTime
      }
    },
    createdAt: {
      type: "dateTime",
      default: "now()",
      storage: {
        column: "created_at",
        serialize: serializeNullableDateTime
      }
    },
    updatedAt: {
      type: "dateTime",
      default: "now()",
      storage: {
        column: "updated_at",
        serialize: serializeNullableDateTime
      }
    }
  }
});

export { workspaceInvitesResource };
