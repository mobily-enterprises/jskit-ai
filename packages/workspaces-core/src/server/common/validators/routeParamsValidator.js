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

// No mode: an action takes it as create, a route or a composition as patch; with
// no required field and no default, both validate it the same.
const workspaceSlugParamsValidator = deepFreeze({
  schema: workspaceSlugParamsSchema
});

export { routeParamsValidator, workspaceSlugParamsValidator };
