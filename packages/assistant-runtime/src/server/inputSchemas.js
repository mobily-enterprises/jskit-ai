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

const assistantSurfaceRouteParams = deepFreeze({
  schema: assistantSurfaceRouteParamsSchema,
  mode: "patch"
});

const assistantTargetSurfaceInput = deepFreeze({
  schema: assistantTargetSurfaceInputSchema,
  mode: "patch"
});

export {
  assistantSurfaceRouteParams,
  assistantTargetSurfaceInput
};
