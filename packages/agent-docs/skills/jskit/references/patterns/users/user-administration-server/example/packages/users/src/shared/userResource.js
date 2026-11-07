import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";

const userResource = defineTableResource({
  name: "users",
  tableName: "users",
  schema: {
    name: {
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 160,
      actualField: "display_name",
      search: true
    },
    email: {
      type: "string",
      required: true,
      search: true
    },
    username: {
      type: "string",
      required: true,
      search: true
    },
    createdAt: {
      type: "dateTime",
      required: true,
      storage: { writeSerializer: "datetime-utc" }
    },
    updatedAt: {
      type: "dateTime",
      required: true,
      storage: { writeSerializer: "datetime-utc" }
    }
  },
  searchSchema: {
    id: { type: "id", actualField: "id" },
    q: {
      type: "string",
      oneOf: ["name", "email", "username"],
      filterOperator: "like",
      splitBy: " ",
      matchAll: true
    }
  },
  defaultSort: ["name", "email"]
});

const userCrud = defineCrudContract(userResource, {
  operations: ["list", "view"],
  fields: {
    name: { output: "optional" },
    email: { output: "optional" },
    username: { output: "optional" },
    createdAt: { output: "required" },
    updatedAt: { output: "required" }
  }
});

export { userCrud, userResource };
