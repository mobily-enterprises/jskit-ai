import { createSchema } from "json-rest-schema";

const cursorPaginationQuerySchema = createSchema({
  cursor: {
    type: "id",
    required: false
  },
  limit: {
    type: "number",
    required: false,
    min: 1,
    unsigned: true
  }
});

const cursorPaginationQueryValidator = Object.freeze({
  schema: cursorPaginationQuerySchema,
  mode: "patch"
});

export {
  cursorPaginationQueryValidator
};
