import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";

const resource = defineCrudResource({
  namespace: "google_rewarded_provider_configs",
  tableName: "google_rewarded_provider_configs",
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
  adUnitPath: {
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
  scriptMode: {
    type: "string",
    maxLength: 64,
    search: true,
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
    q: { type: "string", oneOf: ["surface","adUnitPath","scriptMode"], filterOperator: "like", splitBy: " ", matchAll: true },
  },
  defaultSort: ["-createdAt"],
  autofilter: "workspace",
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
