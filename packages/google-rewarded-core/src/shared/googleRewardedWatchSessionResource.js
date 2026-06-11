import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";

const resource = defineCrudResource({
  namespace: "google_rewarded_watch_sessions",
  tableName: "google_rewarded_watch_sessions",
  schema: {
  workspaceId: {
    type: "id",
    required: true,
    search: true,
    hidden: true,
    operations: {}
  },
  userId: {
    type: "id",
    required: true,
    search: true,
    hidden: true,
    operations: {}
  },
  gateKey: {
    type: "string",
    maxLength: 120,
    required: true,
    search: true,
    operations: {
      output: { required: true },
      create: { required: true },
      patch: { required: false }
    }
  },
  providerConfigId: {
    type: "id",
    nullable: true,
    search: true,
    relation: { kind: "lookup", namespace: "google-rewarded-provider-configs", valueKey: "id" },
    belongsTo: "googleRewardedProviderConfigs",
    as: "providerConfig",
    ui: { formControl: "autocomplete" },
    operations: {
      output: { required: true },
      create: { required: false },
      patch: { required: false }
    }
  },
  status: {
    type: "string",
    maxLength: 32,
    search: true,
    operations: {
      output: { required: true },
      create: { required: false },
      patch: { required: false }
    }
  },
  startedAt: {
    type: "dateTime",
    default: "now()",
    search: true,
    storage: { writeSerializer: "datetime-utc" },
    operations: {
      output: { required: true },
      create: { required: false },
      patch: { required: false }
    }
  },
  rewardedAt: {
    type: "dateTime",
    nullable: true,
    search: true,
    storage: { writeSerializer: "datetime-utc" },
    operations: {
      output: { required: true },
      create: { required: false },
      patch: { required: false }
    }
  },
  completedAt: {
    type: "dateTime",
    nullable: true,
    search: true,
    storage: { writeSerializer: "datetime-utc" },
    operations: {
      output: { required: true },
      create: { required: false },
      patch: { required: false }
    }
  },
  closedAt: {
    type: "dateTime",
    nullable: true,
    search: true,
    storage: { writeSerializer: "datetime-utc" },
    operations: {
      output: { required: true },
      create: { required: false },
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
    q: { type: "string", oneOf: ["gateKey","status"], filterOperator: "like", splitBy: " ", matchAll: true },
  },
  defaultSort: ["-createdAt"],
  autofilter: "workspace_user",
  messages: {
    validation: "Fix invalid values and try again.",
    saveSuccess: "Record saved.",
    saveError: "Unable to save record.",
    deleteSuccess: "Record deleted.",
    deleteError: "Unable to delete record."
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
