import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { normalizeLowerText } from "@jskit-ai/kernel/shared/support/normalize";

const workspaceMembershipsResource = deepFreeze({
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
      as: "workspace"
    },
    userId: {
      type: "id",
      required: true,
      search: true,
      belongsTo: "userProfiles",
      as: "user"
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

export { workspaceMembershipsResource };
