import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
import { normalizeLowerText } from "@jskit-ai/kernel/shared/support/normalize";

function serializeNullableDateTime(value) {
  if (value == null) {
    return null;
  }

  return toDatabaseDateTimeUtc(value);
}

const workspaceMembershipsResource = Object.freeze({
  tableName: "workspace_memberships",
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
    userId: {
      type: "id",
      required: true,
      search: true,
      belongsTo: "userProfiles",
      as: "user",
      storage: { column: "user_id" }
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
      max: 32,
      defaultTo: "active",
      search: true,
      setter: (value) => normalizeLowerText(value)
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

export { workspaceMembershipsResource };
