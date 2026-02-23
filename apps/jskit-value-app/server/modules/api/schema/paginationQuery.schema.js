import { Type } from "@fastify/type-provider-typebox";

export function createPaginationQuerySchema({
  defaultPage = 1,
  defaultPageSize = 10,
  minPage = 1,
  minPageSize = 1,
  maxPageSize = 100
} = {}) {
  return Type.Object(
    {
      page: Type.Optional(
        Type.Integer({
          minimum: minPage,
          default: defaultPage
        })
      ),
      pageSize: Type.Optional(
        Type.Integer({
          minimum: minPageSize,
          maximum: maxPageSize,
          default: defaultPageSize
        })
      )
    },
    {
      additionalProperties: false
    }
  );
}
