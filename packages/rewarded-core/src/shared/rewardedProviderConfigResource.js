import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";

const rewardedProviderConfigTableResource = defineTableResource({
  name: "rewardedProviderConfigs",
  tableName: "rewarded_provider_configs",
  ownership: "workspace",
  schema: {
    workspaceId: {
      type: "id",
      required: true,
      search: true,
      hidden: true
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
    placement: {
      type: "string",
      maxLength: 255,
      required: true,
      search: true
    },
    provider: {
      type: "string",
      maxLength: 64,
      required: true,
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
    q: { type: "string", oneOf: ["surface", "placement", "provider"], filterOperator: "like", splitBy: " ", matchAll: true }
  },
  defaultSort: ["-createdAt"]
});

const rewardedProviderConfigCrud = defineCrudContract(rewardedProviderConfigTableResource, {
  namespace: "rewarded_provider_configs",
  fields: {
    surface: { output: "required", create: "required", patch: "optional" },
    enabled: { output: "required", create: "optional", patch: "optional" },
    placement: { output: "required", create: "required", patch: "optional" },
    provider: { output: "required", create: "required", patch: "optional" },
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

export { rewardedProviderConfigCrud, rewardedProviderConfigTableResource };
