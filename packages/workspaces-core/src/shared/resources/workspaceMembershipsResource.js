import { normalizeLowerText } from "@jskit-ai/kernel/shared/support/normalize";
import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";

const workspaceMembershipsResource = defineCrudResource({
  namespace: "workspaceMemberships",
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
      operations: {
        output: { required: true },
        create: { required: true }
      }
    },
    userId: {
      type: "id",
      required: true,
      search: true,
      belongsTo: "userProfiles",
      as: "user",
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
      max: 32,
      defaultTo: "active",
      search: true,
      setter: (value) => normalizeLowerText(value),
      operations: {
        output: { required: true },
        create: { required: true },
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

export { workspaceMembershipsResource };
