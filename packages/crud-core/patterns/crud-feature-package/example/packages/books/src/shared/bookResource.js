import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";

const bookResource = defineTableResource({
  name: "books",
  tableName: "books",
  ownership: "user",
  schema: {
    userId: {
      type: "id",
      required: true,
      hidden: true
    },
    title: {
      type: "string",
      maxLength: 255,
      required: true,
      search: true
    },
    author: {
      type: "string",
      maxLength: 255,
      required: true,
      search: true
    },
    notes: {
      type: "string",
      maxLength: 65535,
      nullable: true,
      search: true
    },
    createdAt: {
      type: "dateTime",
      temporalPrecision: 0,
      storage: { writeSerializer: "datetime-utc" }
    },
    updatedAt: {
      type: "dateTime",
      temporalPrecision: 0,
      storage: { writeSerializer: "datetime-utc" }
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
  defaultSort: ["-createdAt"]
});

const bookCrud = defineCrudContract(bookResource, {
  namespace: "books",
  apiAccess: "authenticated",
  messages: {
    validation: "Fix invalid values and try again.",
    saveSuccess: "Book saved.",
    saveError: "Unable to save this book.",
    deleteSuccess: "Book deleted.",
    deleteError: "Unable to delete this book."
  }
});

export { bookCrud, bookResource };
