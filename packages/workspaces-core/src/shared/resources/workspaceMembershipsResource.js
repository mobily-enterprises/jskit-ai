import { normalizeLowerText } from "@jskit-ai/kernel/shared/support/normalize";
import { RECORD_ID_PATTERN } from "@jskit-ai/kernel/shared/validators";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";

// The workspace_memberships table.
const workspaceMembershipsResource = defineTableResource({
  name: "workspaceMemberships",
  tableName: "workspace_memberships",
  ownership: "public",
  searchSchema: {
    workspace: { type: "id", actualField: "workspace_id", filterOperator: "=" },
    user: { type: "id", actualField: "user_id", filterOperator: "=" },
    users: {
      type: "array",
      actualField: "user_id",
      filterOperator: "in",
      items: { type: "string", pattern: RECORD_ID_PATTERN }
    },
    status: { type: "string", actualField: "status", filterOperator: "=" }
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
      max: 64,
      defaultTo: "member",
      search: true,
      storage: { column: "role_sid" },
      setter: (value) => normalizeLowerText(value)
    },
    status: {
      type: "string",
      max: 32,
      defaultTo: "active",
      search: true,
      setter: (value) => normalizeLowerText(value)
    },
    createdAt: {
      type: "dateTime",
      storage: {
        column: "created_at",
        writeSerializer: "datetime-utc"
      }
    },
    updatedAt: {
      type: "dateTime",
      storage: {
        column: "updated_at",
        writeSerializer: "datetime-utc"
      }
    }
  }
});

export { workspaceMembershipsResource };
