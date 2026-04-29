import { createSchema } from "json-rest-schema";

function createPaginationQuerySchema({
  defaultPage = 1,
  defaultPageSize = 10,
  minPage = 1,
  minPageSize = 1,
  maxPageSize = 100
} = {}) {
  return createSchema({
    page: {
      type: "integer",
      required: false,
      min: minPage,
      default: defaultPage
    },
    pageSize: {
      type: "integer",
      required: false,
      min: minPageSize,
      max: maxPageSize,
      default: defaultPageSize
    }
  });
}

export { createPaginationQuerySchema };
