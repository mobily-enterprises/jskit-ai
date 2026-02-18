import { Type } from "@fastify/type-provider-typebox";
import { createPaginationQuerySchema } from "../../lib/schemas/paginationQuerySchema.js";
import { enumSchema } from "./common.schemas.js";

const workspaceProjectsQuerySchema = createPaginationQuerySchema({
  defaultPage: 1,
  defaultPageSize: 10,
  maxPageSize: 100
});

const workspaceProjectStatusSchema = enumSchema(["draft", "active", "archived"]);

const projectIdParamsSchema = Type.Object(
  {
    projectId: Type.Integer({ minimum: 1 })
  },
  {
    additionalProperties: false
  }
);

const workspaceProjectSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    workspaceId: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    status: workspaceProjectStatusSchema,
    owner: Type.String({ maxLength: 120 }),
    notes: Type.String({ maxLength: 5000 }),
    createdAt: Type.String({ format: "iso-utc-date-time" }),
    updatedAt: Type.String({ format: "iso-utc-date-time" })
  },
  {
    additionalProperties: false
  }
);

const workspaceProjectsListResponseSchema = Type.Object(
  {
    entries: Type.Array(workspaceProjectSchema),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 1 })
  },
  {
    additionalProperties: false
  }
);

const workspaceProjectResponseSchema = Type.Object(
  {
    project: workspaceProjectSchema
  },
  {
    additionalProperties: false
  }
);

const workspaceProjectCreateBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 160 }),
    status: Type.Optional(workspaceProjectStatusSchema),
    owner: Type.Optional(Type.String({ maxLength: 120 })),
    notes: Type.Optional(Type.String({ maxLength: 5000 }))
  },
  {
    additionalProperties: false
  }
);

const workspaceProjectUpdateBodySchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    status: Type.Optional(workspaceProjectStatusSchema),
    owner: Type.Optional(Type.String({ maxLength: 120 })),
    notes: Type.Optional(Type.String({ maxLength: 5000 }))
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

export {
  workspaceProjectsQuerySchema,
  projectIdParamsSchema,
  workspaceProjectSchema,
  workspaceProjectsListResponseSchema,
  workspaceProjectResponseSchema,
  workspaceProjectCreateBodySchema,
  workspaceProjectUpdateBodySchema
};
