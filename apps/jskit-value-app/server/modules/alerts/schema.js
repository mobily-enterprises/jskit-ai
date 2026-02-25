import { Type } from "@fastify/type-provider-typebox";
import { createPaginationQuerySchema } from "@jskit-ai/http-contracts/paginationQuery";

const query = createPaginationQuerySchema({
  defaultPage: 1,
  defaultPageSize: 20,
  maxPageSize: 100
});

const nullableInteger = Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]);

const entry = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    userId: Type.Integer({ minimum: 1 }),
    type: Type.String({ minLength: 1, maxLength: 80 }),
    title: Type.String({ minLength: 1, maxLength: 200 }),
    message: Type.Union([Type.String({ maxLength: 1000 }), Type.Null()]),
    targetUrl: Type.String({ minLength: 1, maxLength: 2048 }),
    payloadJson: Type.Union([Type.Any(), Type.Null()]),
    actorUserId: nullableInteger,
    workspaceId: nullableInteger,
    createdAt: Type.String({ format: "iso-utc-date-time" }),
    isUnread: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const list = Type.Object(
  {
    entries: Type.Array(entry),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 1 }),
    unreadCount: Type.Integer({ minimum: 0 }),
    readThroughAlertId: nullableInteger
  },
  {
    additionalProperties: false
  }
);

const readAll = Type.Object(
  {
    unreadCount: Type.Integer({ minimum: 0 }),
    readThroughAlertId: nullableInteger
  },
  {
    additionalProperties: false
  }
);

const schema = {
  query,
  entry,
  response: {
    list,
    readAll
  }
};

export { schema };
