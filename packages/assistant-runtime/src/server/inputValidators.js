import { Type } from "typebox";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const assistantSurfaceRouteParamsValidator = Object.freeze({
  schema: Type.Object(
    {
      surfaceId: Type.String({ minLength: 1, maxLength: 64 })
    },
    { additionalProperties: false }
  ),
  normalize(value = {}) {
    return {
      surfaceId: normalizeSurfaceId(value?.surfaceId)
    };
  }
});

const assistantTargetSurfaceInputValidator = Object.freeze({
  schema: Type.Object(
    {
      targetSurfaceId: Type.String({ minLength: 1, maxLength: 64 }),
      workspaceSlug: Type.Optional(Type.String({ minLength: 1, maxLength: 160 }))
    },
    { additionalProperties: false }
  ),
  normalize(value = {}) {
    const targetSurfaceId = normalizeSurfaceId(value?.targetSurfaceId);
    const workspaceSlug = normalizeText(value?.workspaceSlug).toLowerCase();

    return {
      targetSurfaceId,
      ...(workspaceSlug ? { workspaceSlug } : {})
    };
  }
});

export {
  assistantSurfaceRouteParamsValidator,
  assistantTargetSurfaceInputValidator
};
