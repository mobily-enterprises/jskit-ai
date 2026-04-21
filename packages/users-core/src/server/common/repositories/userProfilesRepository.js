import { createCrudResourceRuntime } from "@jskit-ai/crud-core/server/resourceRuntime";
import {
  isDuplicateEntryError,
  normalizeDbRecordId,
  normalizeLowerText,
  normalizeRecordId,
  nowDb
} from "./repositoryUtils.js";
import { normalizeIdentity } from "../support/identity.js";
import { resource } from "../resources/userProfilesResource.js";

const USERNAME_MAX_LENGTH = 120;
const REPOSITORY_CONFIG = Object.freeze({
  context: "internal.repository.user-profiles"
});

function normalizeProfileRecord(payload = {}) {
  return resource.operations.view.outputValidator.normalize(payload);
}

function normalizeCreatePayload(payload = {}) {
  return resource.operations.create.bodyValidator.normalize(payload);
}

function normalizeUsername(value) {
  return normalizeCreatePayload({ username: value }).username || "";
}

function usernameBaseFromEmail(email) {
  const normalizedEmail = normalizeLowerText(email);
  const emailLocalPart = normalizedEmail.includes("@") ? normalizedEmail.split("@")[0] : normalizedEmail;
  const username = normalizeUsername(emailLocalPart);
  return username || "user";
}

function buildUsernameCandidate(baseUsername, suffix) {
  const normalizedBase = normalizeUsername(baseUsername) || "user";
  if (suffix < 1) {
    return normalizedBase;
  }

  const suffixText = `-${suffix + 1}`;
  const allowedBaseLength = USERNAME_MAX_LENGTH - suffixText.length;
  const trimmedBase = normalizedBase.slice(0, allowedBaseLength);
  return `${trimmedBase}${suffixText}`;
}

function duplicateTargetsEmail(error) {
  if (!isDuplicateEntryError(error)) {
    return false;
  }

  const message = normalizeLowerText(error?.sqlMessage || error?.message);
  return message.includes("email");
}

function duplicateTargetsUsername(error) {
  if (!isDuplicateEntryError(error)) {
    return false;
  }

  const message = normalizeLowerText(error?.sqlMessage || error?.message);
  return message.includes("username");
}

function createDuplicateEmailConflictError() {
  const error = new Error("Email is already linked to a different profile.");
  error.code = "USER_PROFILE_EMAIL_CONFLICT";
  return error;
}

async function resolveUniqueUsername(client, baseUsername, { excludeUserId = null } = {}) {
  const normalizedExcludeUserId = normalizeDbRecordId(excludeUserId, { fallback: null });
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = buildUsernameCandidate(baseUsername, suffix);
    const existing = await client("users").where({ username: candidate }).first();
    const existingId = normalizeDbRecordId(existing?.id, { fallback: null });
    if (!existing || existingId === normalizedExcludeUserId) {
      return candidate;
    }
  }

  throw new Error("Unable to generate unique username.");
}

function createRepository(knex) {
  if (typeof knex !== "function") {
    throw new TypeError("internal.repository.user-profiles requires knex.");
  }

  const resourceRuntime = createCrudResourceRuntime(resource, knex, REPOSITORY_CONFIG);
  const withTransaction = resourceRuntime.withTransaction;

  async function findById(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return null;
    }

    return resourceRuntime.findById(normalizedUserId, {
      ...options,
      include: "none"
    });
  }

  async function findByEmail(email, options = {}) {
    const normalizedEmail = normalizeCreatePayload({ email }).email || "";
    if (!normalizedEmail) {
      return null;
    }

    const client = options?.trx || knex;
    const row = await client("users").where({ email: normalizedEmail }).first();
    return row ? normalizeProfileRecord(row) : null;
  }

  async function findByIdentity(identityLike, options = {}) {
    const identity = normalizeIdentity(identityLike);
    if (!identity) {
      return null;
    }

    const client = options?.trx || knex;
    const row = await client("users")
      .where({
        auth_provider: identity.provider,
        auth_provider_user_sid: identity.providerUserId
      })
      .first();

    return row ? normalizeProfileRecord(row) : null;
  }

  async function updateDisplayNameById(userId, displayName, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return null;
    }

    return resourceRuntime.updateById(
      normalizedUserId,
      { displayName },
      {
        ...options,
        include: "none"
      }
    );
  }

  async function updateAvatarById(userId, avatar = {}, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return null;
    }

    return resourceRuntime.updateById(
      normalizedUserId,
      {
        avatarStorageKey: avatar.avatarStorageKey ?? null,
        avatarVersion: avatar.avatarVersion ?? null,
        avatarUpdatedAt: avatar.avatarUpdatedAt ?? nowDb()
      },
      {
        ...options,
        include: "none"
      }
    );
  }

  async function clearAvatarById(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return null;
    }

    return resourceRuntime.updateById(
      normalizedUserId,
      {
        avatarStorageKey: null,
        avatarVersion: null,
        avatarUpdatedAt: null
      },
      {
        ...options,
        include: "none"
      }
    );
  }

  async function upsert(profileLike = {}, options = {}) {
    const normalizedPayload = normalizeCreatePayload(profileLike);
    const identity = normalizeIdentity({
      provider: normalizedPayload.authProvider,
      providerUserId: normalizedPayload.authProviderUserSid
    });
    if (!identity) {
      throw new TypeError("upsert requires provider/authProvider and providerUserId/authProviderUserSid.");
    }

    const email = normalizedPayload.email || "";
    const displayName = normalizedPayload.displayName || "";
    const requestedUsername = normalizeUsername(normalizedPayload.username);
    if (!email || !displayName) {
      throw new TypeError("upsert requires email and displayName.");
    }

    const executeUpsert = async (trx) => {
      const where = {
        auth_provider: identity.provider,
        auth_provider_user_sid: identity.providerUserId
      };
      const existing = await trx("users").where(where).first();

      try {
        if (existing) {
          const existingUsername = normalizeUsername(existing.username);
          const username = existingUsername || (
            await resolveUniqueUsername(
              trx,
              requestedUsername || usernameBaseFromEmail(email),
              { excludeUserId: existing.id }
            )
          );
          return resourceRuntime.updateById(
            normalizeDbRecordId(existing.id, { fallback: null }),
            {
              email,
              displayName,
              username
            },
            {
              trx,
              include: "none"
            }
          );
        }

        const username = await resolveUniqueUsername(
          trx,
          requestedUsername || usernameBaseFromEmail(email)
        );
        return resourceRuntime.create(
          {
            authProvider: identity.provider,
            authProviderUserSid: identity.providerUserId,
            email,
            displayName,
            username
          },
          {
            trx,
            include: "none"
          }
        );
      } catch (error) {
        if (duplicateTargetsEmail(error)) {
          throw createDuplicateEmailConflictError();
        }
        if (duplicateTargetsUsername(error)) {
          throw error;
        }
        if (!isDuplicateEntryError(error)) {
          throw error;
        }
      }

      const resolved = await trx("users").where(where).first();
      return resolved ? normalizeProfileRecord(resolved) : null;
    };

    if (options?.trx) {
      return executeUpsert(options.trx);
    }

    return knex.transaction(executeUpsert);
  }

  return Object.freeze({
    withTransaction,
    findById,
    findByEmail,
    findByIdentity,
    updateDisplayNameById,
    updateAvatarById,
    clearAvatarById,
    upsert
  });
}

export { createRepository };
