import { Type } from "@fastify/type-provider-typebox";
import { createPaginationQuerySchema } from "../api/schema/paginationQuery.schema.js";

const query = createPaginationQuerySchema({
  defaultPage: 1,
  defaultPageSize: 20,
  maxPageSize: 100
});

const params = Type.Object(
  {
    errorId: Type.String({ minLength: 1, maxLength: 32, pattern: "^[0-9]+$" })
  },
  {
    additionalProperties: false
  }
);

const metadata = Type.Record(Type.String(), Type.Unknown());

const browserErrorEntry = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    createdAt: Type.String({ minLength: 1 }),
    occurredAt: Type.String(),
    source: Type.String({ maxLength: 48 }),
    errorName: Type.String({ maxLength: 160 }),
    message: Type.String({ maxLength: 2000 }),
    stack: Type.String(),
    url: Type.String({ maxLength: 2048 }),
    path: Type.String({ maxLength: 2048 }),
    surface: Type.String({ maxLength: 64 }),
    userAgent: Type.String({ maxLength: 1024 }),
    lineNumber: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    columnNumber: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    userId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    username: Type.String({ maxLength: 160 }),
    metadata
  },
  {
    additionalProperties: false
  }
);

const serverErrorEntry = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    createdAt: Type.String({ minLength: 1 }),
    requestId: Type.String({ maxLength: 128 }),
    method: Type.String({ maxLength: 16 }),
    path: Type.String({ maxLength: 2048 }),
    statusCode: Type.Integer({ minimum: 100, maximum: 599 }),
    errorName: Type.String({ maxLength: 160 }),
    message: Type.String({ maxLength: 2000 }),
    stack: Type.String(),
    userId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    username: Type.String({ maxLength: 160 }),
    metadata
  },
  {
    additionalProperties: false
  }
);

const listBrowserErrors = Type.Object(
  {
    entries: Type.Array(browserErrorEntry),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 1 })
  },
  {
    additionalProperties: false
  }
);

const browserErrorSingle = Type.Object(
  {
    entry: browserErrorEntry
  },
  {
    additionalProperties: false
  }
);

const listServerErrors = Type.Object(
  {
    entries: Type.Array(serverErrorEntry),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 1 })
  },
  {
    additionalProperties: false
  }
);

const serverErrorSingle = Type.Object(
  {
    entry: serverErrorEntry
  },
  {
    additionalProperties: false
  }
);

const recordBrowserError = Type.Object(
  {
    occurredAt: Type.Optional(Type.String({ maxLength: 64 })),
    source: Type.Optional(Type.String({ maxLength: 48 })),
    errorName: Type.Optional(Type.String({ maxLength: 160 })),
    name: Type.Optional(Type.String({ maxLength: 160 })),
    message: Type.Optional(Type.String({ maxLength: 2000 })),
    reason: Type.Optional(Type.String({ maxLength: 2000 })),
    stack: Type.Optional(Type.String()),
    url: Type.Optional(Type.String({ maxLength: 2048 })),
    path: Type.Optional(Type.String({ maxLength: 2048 })),
    surface: Type.Optional(Type.String({ maxLength: 64 })),
    userAgent: Type.Optional(Type.String({ maxLength: 1024 })),
    lineNumber: Type.Optional(Type.Integer({ minimum: 1 })),
    columnNumber: Type.Optional(Type.Integer({ minimum: 1 })),
    line: Type.Optional(Type.Integer({ minimum: 1 })),
    column: Type.Optional(Type.Integer({ minimum: 1 })),
    metadata: Type.Optional(Type.Unknown())
  },
  {
    additionalProperties: false
  }
);

const recordBrowserErrorResponse = Type.Object(
  {
    ok: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const simulateServerErrorKindValues = ["app_error", "type_error", "range_error", "async_rejection", "auto"];

const simulateServerError = Type.Object(
  {
    kind: Type.Optional(Type.Union(simulateServerErrorKindValues.map((value) => Type.Literal(value))))
  },
  {
    additionalProperties: false
  }
);

const simulateServerErrorResponse = Type.Object(
  {
    ok: Type.Boolean(),
    simulationId: Type.String({ minLength: 1 }),
    kind: Type.String({ minLength: 1 })
  },
  {
    additionalProperties: false
  }
);

const schema = {
  query,
  params,
  response: {
    listBrowserErrors,
    browserErrorSingle,
    listServerErrors,
    serverErrorSingle,
    recordBrowserError: recordBrowserErrorResponse,
    simulateServerError: simulateServerErrorResponse
  },
  body: {
    recordBrowserError,
    simulateServerError
  }
};

export { schema };
