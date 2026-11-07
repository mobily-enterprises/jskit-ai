import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";

const rewardedWatchSessionTableResource = defineTableResource({
  name: "rewardedWatchSessions",
  tableName: "rewarded_watch_sessions",
  ownership: "workspace_user",
  schema: {
    workspaceId: {
      type: "id",
      required: true,
      search: true,
      hidden: true
    },
    userId: {
      type: "id",
      required: true,
      search: true,
      hidden: true
    },
    gateKey: {
      type: "string",
      maxLength: 120,
      required: true,
      search: true
    },
    providerConfigId: {
      type: "id",
      nullable: true,
      search: true,
      relation: { kind: "lookup", namespace: "rewarded-provider-configs", valueKey: "id" },
      belongsTo: "rewardedProviderConfigs",
      as: "providerConfig",
      ui: { formControl: "autocomplete" }
    },
    status: {
      type: "string",
      maxLength: 32,
      search: true
    },
    startedAt: {
      type: "dateTime",
      search: true,
      storage: { writeSerializer: "datetime-utc" }
    },
    rewardedAt: {
      type: "dateTime",
      nullable: true,
      search: true,
      storage: { writeSerializer: "datetime-utc" }
    },
    completedAt: {
      type: "dateTime",
      nullable: true,
      search: true,
      storage: { writeSerializer: "datetime-utc" }
    },
    closedAt: {
      type: "dateTime",
      nullable: true,
      search: true,
      storage: { writeSerializer: "datetime-utc" }
    },
    createdAt: {
      type: "dateTime",
      storage: { writeSerializer: "datetime-utc" }
    },
    updatedAt: {
      type: "dateTime",
      storage: { writeSerializer: "datetime-utc" }
    }
  },
  searchSchema: {
    id: { type: "id", actualField: "id" },
    q: { type: "string", oneOf: ["gateKey", "status"], filterOperator: "like", splitBy: " ", matchAll: true }
  },
  defaultSort: ["-createdAt"]
});

const rewardedWatchSessionCrud = defineCrudContract(rewardedWatchSessionTableResource, {
  namespace: "rewarded_watch_sessions",
  fields: {
    gateKey: { output: "required", create: "required", patch: "optional" },
    providerConfigId: { output: "required", create: "optional", patch: "optional" },
    status: { output: "required", create: "optional", patch: "optional" },
    startedAt: { output: "required", create: "optional", patch: "optional" },
    rewardedAt: { output: "required", create: "optional", patch: "optional" },
    completedAt: { output: "required", create: "optional", patch: "optional" },
    closedAt: { output: "required", create: "optional", patch: "optional" },
    createdAt: { output: "required" },
    updatedAt: { output: "required" }
  },
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

export { rewardedWatchSessionCrud, rewardedWatchSessionTableResource };
