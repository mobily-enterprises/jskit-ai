import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";

const resource = defineCrudResource({
  namespace: "google_rewarded_unlock_receipts",
  tableName: "google_rewarded_unlock_receipts",
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
  watchSessionId: {
    type: "id",
    nullable: true,
    search: true,
    relation: { kind: "lookup", namespace: "google-rewarded-watch-sessions", valueKey: "id" },
    belongsTo: "googleRewardedWatchSessions",
    as: "watchSession",
    ui: { formControl: "autocomplete" },
    operations: {
      output: { required: true },
      create: { required: false },
      patch: { required: false }
    }
  },
  grantedAt: {
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
  unlockedUntil: {
    type: "dateTime",
    required: true,
    search: true,
    storage: { writeSerializer: "datetime-utc" },
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
  },
  searchSchema: {
    id: { type: "id", actualField: "id" },
    q: { type: "string", oneOf: ["gateKey"], filterOperator: "like", splitBy: " ", matchAll: true },
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
