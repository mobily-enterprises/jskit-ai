import { createSchema } from "json-rest-schema";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { RECORD_ID_PATTERN } from "@jskit-ai/kernel/shared/validators";

const authenticatedProfileSchema = createSchema({
  id: {
    type: "string",
    required: true,
    minLength: 1,
    pattern: RECORD_ID_PATTERN
  },
  email: {
    type: "string",
    required: true,
    minLength: 1,
    lowercase: true
  },
  username: {
    type: "string",
    required: false,
    lowercase: true
  },
  displayName: {
    type: "string",
    required: true,
    minLength: 1
  },
  authProvider: {
    type: "string",
    required: true,
    minLength: 1,
    lowercase: true
  },
  authProviderUserSid: {
    type: "string",
    required: true,
    minLength: 1
  },
  avatarStorageKey: {
    type: "string",
    required: false,
    nullable: true
  },
  avatarVersion: {
    type: "string",
    required: false,
    nullable: true
  }
});

function requireAuthenticatedProfile(profileLike, { context = "authenticated profile" } = {}) {
  const source = profileLike && typeof profileLike === "object" && !Array.isArray(profileLike) ? profileLike : {};
  const candidate = {
    id: source.id,
    email: source.email,
    displayName: source.displayName,
    authProvider: source.authProvider,
    authProviderUserSid: source.authProviderUserSid
  };
  if (Object.hasOwn(source, "username")) {
    candidate.username = source.username;
  }
  if (Object.hasOwn(source, "avatarStorageKey")) {
    candidate.avatarStorageKey = source.avatarStorageKey;
  }
  if (Object.hasOwn(source, "avatarVersion")) {
    candidate.avatarVersion = source.avatarVersion;
  }

  const { validatedObject, errors } = authenticatedProfileSchema.create(candidate);
  if (Object.keys(errors).length > 0) {
    throw new AppError(500, `${context} is invalid.`);
  }

  return validatedObject;
}

export { requireAuthenticatedProfile };
