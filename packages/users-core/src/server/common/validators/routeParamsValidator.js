import { Type } from "@fastify/type-provider-typebox";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function normalizeRouteParams(input = {}) {
  const source = normalizeObjectInput(input);
  const normalized = {};

  if (Object.hasOwn(source, "workspaceSlug")) {
    normalized.workspaceSlug = normalizeText(source.workspaceSlug).toLowerCase();
  }

  if (Object.hasOwn(source, "memberUserId")) {
    normalized.memberUserId = normalizeText(source.memberUserId);
  }

  if (Object.hasOwn(source, "inviteId")) {
    normalized.inviteId = normalizeText(source.inviteId);
  }

  if (Object.hasOwn(source, "provider")) {
    normalized.provider = normalizeText(source.provider);
  }

  return normalized;
}

const routeParamsValidator = Object.freeze({
  schema: Type.Object(
    {
      workspaceSlug: Type.Optional(Type.String({ minLength: 1 })),
      memberUserId: Type.Optional(Type.String({ minLength: 1 })),
      inviteId: Type.Optional(Type.String({ minLength: 1 })),
      provider: Type.Optional(Type.String({ minLength: 1 }))
    },
    { additionalProperties: false }
  ),
  normalize: normalizeRouteParams
});

export { routeParamsValidator };
