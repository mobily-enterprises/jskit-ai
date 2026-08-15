import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";

const bookResource = defineCrudResource({
  namespace: "books",
  tableName: "books",
  apiAccess: "authenticated",
  autofilter: "user",
  schema: {
    userId: {
      type: "id",
      required: true,
      hidden: true,
      operations: {}
    },
    title: {
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
    author: {
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
    notes: {
      type: "string",
      maxLength: 65535,
      nullable: true,
      search: true,
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    },
    createdAt: {
      type: "dateTime",
      temporalPrecision: 0,
      default: "now()",
      storage: { writeSerializer: "datetime-utc" },
      operations: { output: { required: true } }
    },
    updatedAt: {
      type: "dateTime",
      temporalPrecision: 0,
      default: "now()",
      storage: { writeSerializer: "datetime-utc" },
      operations: { output: { required: true } }
    }
  },
  searchSchema: {
    id: { type: "id", actualField: "id" },
    q: {
      type: "string",
      oneOf: ["title", "author", "notes"],
      filterOperator: "like",
      splitBy: " ",
      matchAll: true
    }
  },
  defaultSort: ["-createdAt"],
  messages: {
    validation: "Fix invalid values and try again.",
    saveSuccess: "Book saved.",
    saveError: "Unable to save this book.",
    deleteSuccess: "Book deleted.",
    deleteError: "Unable to delete this book."
  }
});

export { bookResource };
