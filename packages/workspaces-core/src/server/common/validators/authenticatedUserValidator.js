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
  schema: {
    type: "object",
    additionalProperties: true,
    required: ["id", "email"],
    properties: {
      id: recordIdInputSchema,
      email: {
        type: "string",
        minLength: 1
      },
      username: {
        type: "string"
      },
      displayName: {
        type: "string"
      },
      authProvider: {
        type: "string"
      },
      authProviderUserSid: {
        type: "string"
      },
      avatarStorageKey: {
        anyOf: [
          { type: "string" },
          { type: "null" }
        ]
      },
      avatarVersion: {
        anyOf: [
          { type: "string" },
          { type: "number" },
          { type: "null" }
        ]
      }
    }
  },
  normalize: normalizeAuthenticatedUser
});

export { authenticatedUserValidator };
