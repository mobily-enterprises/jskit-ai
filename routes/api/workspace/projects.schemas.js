import { Type } from "@fastify/type-provider-typebox";
import { createPaginationQuerySchema } from "../../../lib/schemas/paginationQuerySchema.js";
import { enumSchema } from "../common.schemas.js";

const querySchema = createPaginationQuerySchema({
  defaultPage: 1,
  defaultPageSize: 10,
  maxPageSize: 100
});

const statusFieldSchema = enumSchema(["draft", "active", "archived"]);
const projectIdFieldSchema = Type.Integer({ minimum: 1 });

const paramsSchema = Type.Object(
  {
    projectId: projectIdFieldSchema
  },
  {
    additionalProperties: false
  }
);

const entitySchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    workspaceId: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    status: statusFieldSchema,
    owner: Type.String({ maxLength: 120 }),
    notes: Type.String({ maxLength: 5000 }),
    createdAt: Type.String({ format: "iso-utc-date-time" }),
    updatedAt: Type.String({ format: "iso-utc-date-time" })
  },
  {
    additionalProperties: false
  }
);

const listResponseSchema = Type.Object(
  {
    entries: Type.Array(entitySchema),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 1 })
  },
  {
    additionalProperties: false
  }
);

const singleResponseSchema = Type.Object(
  {
    project: entitySchema
  },
  {
    additionalProperties: false
  }
);

const createBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 160 }),
    status: Type.Optional(statusFieldSchema),
    owner: Type.Optional(Type.String({ maxLength: 120 })),
    notes: Type.Optional(Type.String({ maxLength: 5000 }))
  },
  {
    additionalProperties: false
  }
);

const updateBodySchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    status: Type.Optional(statusFieldSchema),
    owner: Type.Optional(Type.String({ maxLength: 120 })),
    notes: Type.Optional(Type.String({ maxLength: 5000 }))
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

export {
  querySchema,
  paramsSchema,
  statusFieldSchema,
  projectIdFieldSchema,
  entitySchema,
  listResponseSchema,
  singleResponseSchema,
  createBodySchema,
  updateBodySchema
};
