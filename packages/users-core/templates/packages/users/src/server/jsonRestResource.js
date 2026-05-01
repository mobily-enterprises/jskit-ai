import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";

function serializeNullableDateTime(value) {
  if (value == null) {
    return null;
  }

  return toDatabaseDateTimeUtc(value);
}

const jsonRestResource = Object.freeze({
  tableName: "users",
  searchSchema: {
    id: { type: "id", actualField: "id" },
    q: { type: "string", oneOf: ["name", "email", "username"], filterOperator: "like", splitBy: " ", matchAll: true }
  },
  defaultSort: ["name", "email"],
  autofilter: "public",
  schema: {
    name: {
      type: "string",
      required: true,
      search: true,
      max: 160,
      storage: { column: "display_name" }
    },
    email: {
      type: "string",
      required: true,
      search: true,
      max: 255
    },
    username: {
      type: "string",
      required: true,
      search: true,
      max: 120
    },
    createdAt: {
      type: "dateTime",
      required: true,
      storage: {
        column: "created_at",
        serialize: serializeNullableDateTime
      }
    }
  }
});

export { jsonRestResource };
