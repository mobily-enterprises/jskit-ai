import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";

const resource = defineCrudResource({
  namespace: "rewarded_provider_configs",
  tableName: "rewarded_provider_configs",
  schema: {
  workspaceId: {
    type: "id",
    required: true,
    search: true,
    hidden: true,
    operations: {}
  },
  surface: {
    type: "string",
    maxLength: 64,
    required: true,
    search: true,
    operations: {
      output: { required: true },
      create: { required: true },
      patch: { required: false }
    }
  },
  enabled: {
    type: "boolean",
    search: true,
    operations: {
      output: { required: true },
      create: { required: false },
      patch: { required: false }
    }
  },
  placement: {
    type: "string",
    maxLength: 255,
    required: true,
    search: true,
    operations: {
      output: { required: true },
      create: { required: true },
      patch: { required: false }
    }
  },
  provider: {
    type: "string",
    maxLength: 64,
    required: true,
    search: true,
    operations: {
      output: { required: true },
      create: { required: true },
      patch: { required: false }
    }
  },
  createdAt: {
    type: "dateTime",
    default: "now()",
    storage: { writeSerializer: "datetime-utc" },
    operations: {
      output: { required: true }
    }
  },
  updatedAt: {
    type: "dateTime",
    default: "now()",
    storage: { writeSerializer: "datetime-utc" },
    operations: {
      output: { required: true }
    }
  },
  },
  searchSchema: {
    id: { type: "id", actualField: "id" },
    q: { type: "string", oneOf: ["surface","placement","provider"], filterOperator: "like", splitBy: " ", matchAll: true },
  },
  defaultSort: ["-createdAt"],
  autofilter: "workspace",
  messages: {
    validation: "jskit.rewarded.feedback.fixInvalidValues",
    saveSuccess: "jskit.rewarded.feedback.recordSaved",
    saveError: "jskit.rewarded.feedback.recordSaveFailed",
    deleteSuccess: "jskit.rewarded.feedback.recordDeleted",
    deleteError: "jskit.rewarded.feedback.recordDeleteFailed"
  },
  contract: {
    lookup: {
      containerKey: "lookups",
      defaultInclude: "*",
      maxDepth: 3
    }
  }
});

export { resource };
