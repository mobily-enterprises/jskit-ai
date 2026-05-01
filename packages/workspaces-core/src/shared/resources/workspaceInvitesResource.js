import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const workspaceInvitesResource = deepFreeze({
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
      as: "workspace"
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
        writeSerializer: "datetime-utc"
      }
    },
    acceptedAt: {
      type: "dateTime",
      nullable: true,
      storage: {
        column: "accepted_at",
        writeSerializer: "datetime-utc"
      }
    },
    revokedAt: {
      type: "dateTime",
      nullable: true,
      storage: {
        column: "revoked_at",
        writeSerializer: "datetime-utc"
      }
    },
    createdAt: {
      type: "dateTime",
      default: "now()",
      storage: {
        column: "created_at",
        writeSerializer: "datetime-utc"
      }
    },
    updatedAt: {
      type: "dateTime",
      default: "now()",
      storage: {
        column: "updated_at",
        writeSerializer: "datetime-utc"
      }
    }
  }
});

export { workspaceInvitesResource };
