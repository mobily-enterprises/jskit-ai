import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const assistantSurfaceRouteParamsSchema = createSchema({
  surfaceId: {
    type: "string",
    required: true,
    lowercase: true,
    minLength: 1,
    maxLength: 64
  }
});

const assistantTargetSurfaceInputSchema = createSchema({
  targetSurfaceId: {
    type: "string",
    required: true,
    lowercase: true,
    minLength: 1,
    maxLength: 64
  },
  workspaceSlug: {
    type: "string",
    required: false,
    lowercase: true,
    minLength: 1,
    maxLength: 160
  }
});

const assistantSurfaceRouteParamsValidator = deepFreeze({
  schema: assistantSurfaceRouteParamsSchema,
  mode: "patch"
});

const assistantTargetSurfaceInputValidator = deepFreeze({
  schema: assistantTargetSurfaceInputSchema,
  mode: "patch"
});

export {
  assistantSurfaceRouteParamsValidator,
  assistantTargetSurfaceInputValidator
};
