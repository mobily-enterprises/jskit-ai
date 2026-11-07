import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";

const rewardedRuleResource = defineTableResource({
  name: "rewardedRules",
  tableName: "rewarded_rules",
  ownership: "workspace",
  schema: {
    workspaceId: {
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
    surface: {
      type: "string",
      maxLength: 64,
      required: true,
      search: true
    },
    enabled: {
      type: "boolean",
      search: true
    },
    unlockMinutes: {
      type: "integer",
      min: 0,
      search: true
    },
    cooldownMinutes: {
      type: "integer",
      min: 0,
      search: true
    },
    dailyLimit: {
      type: "integer",
      min: 0,
      nullable: true,
      search: true
    },
    title: {
      type: "string",
      maxLength: 160,
      search: true
    },
    description: {
      type: "string",
      maxLength: 65535,
      nullable: true,
      search: true
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
    q: { type: "string", oneOf: ["gateKey", "surface", "title", "description"], filterOperator: "like", splitBy: " ", matchAll: true }
  },
  defaultSort: ["-createdAt"]
});

const rewardedRuleCrud = defineCrudContract(rewardedRuleResource, {
  namespace: "rewarded_rules",
  fields: {
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

export { rewardedRuleCrud, rewardedRuleResource };
