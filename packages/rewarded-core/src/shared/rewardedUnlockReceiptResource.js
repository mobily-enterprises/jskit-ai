import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";

const rewardedUnlockReceiptTableResource = defineTableResource({
  name: "rewardedUnlockReceipts",
  tableName: "rewarded_unlock_receipts",
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
    watchSessionId: {
      type: "id",
      nullable: true,
      search: true,
      relation: { kind: "lookup", namespace: "rewarded-watch-sessions", valueKey: "id" },
      belongsTo: "rewardedWatchSessions",
      as: "watchSession",
      ui: { formControl: "autocomplete" }
    },
    grantedAt: {
      type: "dateTime",
      search: true,
      storage: { writeSerializer: "datetime-utc" }
    },
    unlockedUntil: {
      type: "dateTime",
      required: true,
      search: true,
      storage: { writeSerializer: "datetime-utc" }
    },
    createdAt: {
      type: "dateTime",
      storage: { writeSerializer: "datetime-utc" }
    }
  },
  searchSchema: {
    id: { type: "id", actualField: "id" },
    q: { type: "string", oneOf: ["gateKey"], filterOperator: "like", splitBy: " ", matchAll: true },
    // Server-only: the rewarded service counts the receipts granted since a day began.
    grantedSince: { type: "dateTime", actualField: "grantedAt", filterOperator: ">=" }
  },
  defaultSort: ["-createdAt"]
});

const rewardedUnlockReceiptCrud = defineCrudContract(rewardedUnlockReceiptTableResource, {
  namespace: "rewarded_unlock_receipts",
  fields: {
    gateKey: { output: "required", create: "required", patch: "optional" },
    providerConfigId: { output: "required", create: "optional", patch: "optional" },
    watchSessionId: { output: "required", create: "optional", patch: "optional" },
    grantedAt: { output: "required", create: "optional", patch: "optional" },
    unlockedUntil: { output: "required", create: "required", patch: "optional" },
    createdAt: { output: "required" }
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

export { rewardedUnlockReceiptCrud, rewardedUnlockReceiptTableResource };
