import { Type } from "@fastify/type-provider-typebox";
import { createPaginationQuerySchema } from "../api/schema/paginationQuery.schema.js";
import { enumSchema } from "../api/schemas.js";

const query = createPaginationQuerySchema({
  defaultPage: 1,
  defaultPageSize: 10,
  maxPageSize: 100
});

const status = enumSchema(["draft", "active", "archived"]);
const projectId = Type.Integer({ minimum: 1 });

const params = Type.Object(
  {
    projectId
  },
  {
    additionalProperties: false
  }
);

const entity = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    workspaceId: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    status,
    owner: Type.String({ maxLength: 120 }),
    notes: Type.String({ maxLength: 5000 }),
    createdAt: Type.String({ format: "iso-utc-date-time" }),
    updatedAt: Type.String({ format: "iso-utc-date-time" })
  },
  {
    additionalProperties: false
  }
);

const list = Type.Object(
  {
    entries: Type.Array(entity),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 1 })
  },
  {
    additionalProperties: false
  }
);

const single = Type.Object(
  {
    project: entity
  },
  {
    additionalProperties: false
  }
);

const create = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 160 }),
    status: Type.Optional(status),
    owner: Type.Optional(Type.String({ maxLength: 120 })),
    notes: Type.Optional(Type.String({ maxLength: 5000 }))
  },
  {
    additionalProperties: false
  }
);

const replace = create;

const update = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    status: Type.Optional(status),
    owner: Type.Optional(Type.String({ maxLength: 120 })),
    notes: Type.Optional(Type.String({ maxLength: 5000 }))
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

const schema = {
  query,
  params,
  response: {
    list,
    single
  },
  body: {
    create,
    replace,
    update
  }
};

export { schema };
