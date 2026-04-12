import { Type } from "@fastify/type-provider-typebox";
import { normalizeObjectInput, recordIdInputSchema } from "@jskit-ai/kernel/shared/validators";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";

function normalizeAuthenticatedUser(input = {}) {
  const source = normalizeObjectInput(input);
  const id = normalizeRecordId(source.id, { fallback: null });
  if (!id) {
    return null;
  }

  const email = normalizeLowerText(source.email);
  return {
    id,
    email,
    username: normalizeLowerText(source.username),
    displayName: normalizeText(source.displayName) || email || `User ${id}`,
    authProvider: normalizeLowerText(source.authProvider),
    authProviderUserSid: normalizeText(source.authProviderUserSid),
    avatarStorageKey: source.avatarStorageKey ? normalizeText(source.avatarStorageKey) : null,
    avatarVersion: source.avatarVersion == null ? null : String(source.avatarVersion)
  };
}

const authenticatedUserValidator = Object.freeze({
  schema: Type.Object(
    {
      id: recordIdInputSchema,
      email: Type.String({ minLength: 1 }),
      username: Type.Optional(Type.String()),
      displayName: Type.Optional(Type.String()),
      authProvider: Type.Optional(Type.String()),
      authProviderUserSid: Type.Optional(Type.String()),
      avatarStorageKey: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      avatarVersion: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Null()]))
    },
    { additionalProperties: true }
  ),
  normalize: normalizeAuthenticatedUser
});

export { authenticatedUserValidator };
