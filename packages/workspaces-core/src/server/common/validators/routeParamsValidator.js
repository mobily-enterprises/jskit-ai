import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const routeParamsSchema = createSchema({
  workspaceSlug: {
    type: "string",
    required: false,
    lowercase: true,
    minLength: 1
  },
  memberUserId: {
    type: "id",
    required: false
  },
  inviteId: {
    type: "id",
    required: false
  },
  provider: {
    type: "string",
    required: false,
    minLength: 1
  }
});

const workspaceSlugParamsSchema = createSchema({
  workspaceSlug: {
    type: "string",
    required: false,
    lowercase: true,
    minLength: 1
  }
});

const routeParamsValidator = deepFreeze({
  schema: routeParamsSchema,
  mode: "patch"
});

const workspaceSlugParamsValidator = deepFreeze({
  schema: workspaceSlugParamsSchema,
  mode: "patch"
});

export { routeParamsValidator, workspaceSlugParamsValidator };
