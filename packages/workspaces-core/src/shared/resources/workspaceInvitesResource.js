import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";

const workspaceInvitesResource = defineCrudResource({
  namespace: "workspaceInvites",
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
      operations: {
        output: { required: true },
        create: { required: true }
      }
    },
    email: {
      type: "string",
      required: true,
      max: 255,
      search: true,
      setter: (value) => normalizeLowerText(value),
      operations: {
        output: { required: true },
        create: { required: true }
      }
    },
    roleSid: {
      type: "string",
      required: true,
      max: 64,
      defaultTo: "member",
      search: true,
      storage: { column: "role_sid" },
      setter: (value) => normalizeLowerText(value),
      operations: {
        output: { required: true },
        create: { required: true },
        patch: { required: false }
      }
    },
    status: {
      type: "string",
      required: true,
      max: 64,
      defaultTo: "pending",
      search: true,
      setter: (value) => normalizeLowerText(value),
      operations: {
        output: { required: true },
        create: { required: true },
        patch: { required: false }
      }
    },
    tokenHash: {
      type: "string",
      required: true,
      max: 255,
      search: true,
      storage: { column: "token_hash" },
      setter: (value) => normalizeText(value),
      operations: {
        output: { required: true },
        create: { required: true }
      }
    },
    invitedByUserId: {
      type: "id",
      nullable: true,
      belongsTo: "userProfiles",
      as: "invitedByUser",
      storage: { column: "invited_by_user_id" },
      operations: {
        output: { required: false },
        create: { required: false }
      }
    },
    expiresAt: {
      type: "dateTime",
      nullable: true,
      storage: {
        column: "expires_at",
        writeSerializer: "datetime-utc"
      },
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    },
    acceptedAt: {
      type: "dateTime",
      nullable: true,
      storage: {
        column: "accepted_at",
        writeSerializer: "datetime-utc"
      },
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    },
    revokedAt: {
      type: "dateTime",
      nullable: true,
      storage: {
        column: "revoked_at",
        writeSerializer: "datetime-utc"
      },
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    },
    createdAt: {
      type: "dateTime",
      default: "now()",
      storage: {
        column: "created_at",
        writeSerializer: "datetime-utc"
      },
      operations: {
        output: { required: true },
        create: { required: false }
      }
    },
    updatedAt: {
      type: "dateTime",
      default: "now()",
      storage: {
        column: "updated_at",
        writeSerializer: "datetime-utc"
      },
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    }
  },
  messages: {
    validation: "Fix invalid values and try again.",
    saveSuccess: "Record saved.",
    saveError: "Unable to save record.",
    deleteSuccess: "Record deleted.",
    deleteError: "Unable to delete record."
  },
  crudOperations: ["list", "view", "create", "patch"]
});

export { workspaceInvitesResource };
