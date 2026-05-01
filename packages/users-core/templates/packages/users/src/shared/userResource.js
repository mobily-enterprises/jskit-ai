import { defineCrudResource } from "@jskit-ai/crud-core/shared/crudResource";

const resource = defineCrudResource({
  namespace: "users",
  tableName: "users",
  crudOperations: ["list", "view", "create"],
  schema: {
    name: {
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 160,
      actualField: "display_name",
      search: true,
      operations: {
        output: { required: false }
      }
    },
    email: {
      type: "string",
      required: true,
      search: true,
      operations: {
        output: { required: false }
      }
    },
    username: {
      type: "string",
      required: true,
      search: true,
      operations: {
        output: { required: false }
      }
    },
    createdAt: {
      type: "dateTime",
      required: true,
      storage: { writeSerializer: "datetime-utc" },
      operations: {
        output: { required: true }
      }
    }
  },
  searchSchema: {
    id: {
      type: "id",
      actualField: "id"
    },
    q: {
      type: "string",
      oneOf: ["name", "email", "username"],
      filterOperator: "like",
      splitBy: " ",
      matchAll: true
    }
  },
  defaultSort: ["name", "email"],
  autofilter: "public"
});

export { resource };
