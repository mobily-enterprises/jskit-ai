import { Type } from "@fastify/type-provider-typebox";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";

function normalizeAuthenticatedUser(input = {}) {
  const source = normalizeObjectInput(input);
  const id = Number(source.id);
  if (!Number.isInteger(id) || id < 1) {
    return null;
  }

  const email = normalizeLowerText(source.email);
  return {
    id,
    email,
    username: normalizeLowerText(source.username),
    displayName: normalizeText(source.displayName) || email || `User ${id}`,
    authProvider: normalizeLowerText(source.authProvider),
    authProviderUserId: normalizeText(source.authProviderUserId),
    avatarStorageKey: source.avatarStorageKey ? normalizeText(source.avatarStorageKey) : null,
    avatarVersion: source.avatarVersion == null ? null : String(source.avatarVersion)
  };
}

const authenticatedUserValidator = Object.freeze({
  schema: Type.Object(
    {
      id: Type.Integer({ minimum: 1 }),
      email: Type.String({ minLength: 1 }),
      username: Type.Optional(Type.String()),
      displayName: Type.Optional(Type.String()),
      authProvider: Type.Optional(Type.String()),
      authProviderUserId: Type.Optional(Type.String()),
      avatarStorageKey: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      avatarVersion: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Null()]))
    },
    { additionalProperties: true }
  ),
  normalize: normalizeAuthenticatedUser
});

export { authenticatedUserValidator };
