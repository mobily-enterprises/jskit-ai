import {
  isDuplicateEntryError,
  normalizeLowerText,
  normalizeText,
  toIsoString,
  toNullableDateTime,
  toNullableIso,
  nowDb
} from "./repositoryUtils.js";

const USERNAME_MAX_LENGTH = 120;

function normalizeIdentity(identityLike) {
  const source = identityLike && typeof identityLike === "object" ? identityLike : {};
  const provider = normalizeLowerText(source.provider || source.authProvider);
  const providerUserId = normalizeText(source.providerUserId || source.authProviderUserSid);
  if (!provider || !providerUserId) {
    return null;
  }
  return {
    provider,
    providerUserId
  };
}

function normalizeUsername(value) {
  const normalized = normalizeLowerText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, USERNAME_MAX_LENGTH);
  return normalized || "";
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

function mapProfileRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    authProvider: normalizeLowerText(row.auth_provider),
    authProviderUserSid: normalizeText(row.auth_provider_user_sid),
    email: normalizeLowerText(row.email),
    username: normalizeLowerText(row.username),
    displayName: normalizeText(row.display_name),
    avatarStorageKey: row.avatar_storage_key ? normalizeText(row.avatar_storage_key) : null,
    avatarVersion: row.avatar_version == null ? null : String(row.avatar_version),
    avatarUpdatedAt: toNullableIso(row.avatar_updated_at),
    createdAt: toIsoString(row.created_at)
  };
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

async function resolveUniqueUsername(client, baseUsername, { excludeUserId = 0 } = {}) {
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = buildUsernameCandidate(baseUsername, suffix);
    const existing = await client("users").where({ username: candidate }).first();
    if (!existing || Number(existing.id) === Number(excludeUserId || 0)) {
      return candidate;
    }
  }

  throw new Error("Unable to generate unique username.");
}

function createRepository(knex) {
  if (typeof knex !== "function") {
    throw new TypeError("userProfilesRepository requires knex.");
  }

  async function findById(userId, options = {}) {
    const client = options?.trx || knex;
    const row = await client("users").where({ id: userId }).first();
    return mapProfileRow(row);
  }

  async function findByIdentity(identityLike, options = {}) {
    const client = options?.trx || knex;
    const identity = normalizeIdentity(identityLike);
    if (!identity) {
      return null;
    }

    const row = await client("users")
      .where({
        auth_provider: identity.provider,
        auth_provider_user_sid: identity.providerUserId
      })
      .first();
    return mapProfileRow(row);
  }

  async function updateDisplayNameById(userId, displayName, options = {}) {
    const client = options?.trx || knex;
    await client("users")
      .where({ id: userId })
      .update({
        display_name: normalizeText(displayName)
      });
    return findById(userId, { trx: client });
  }

  async function updateAvatarById(userId, avatar = {}, options = {}) {
    const client = options?.trx || knex;
    await client("users")
      .where({ id: userId })
      .update({
        avatar_storage_key: avatar.avatarStorageKey || null,
        avatar_version: avatar.avatarVersion == null ? null : String(avatar.avatarVersion),
        avatar_updated_at: toNullableDateTime(avatar.avatarUpdatedAt) || nowDb()
      });

    return findById(userId, { trx: client });
  }

  async function clearAvatarById(userId, options = {}) {
    const client = options?.trx || knex;
    await client("users")
      .where({ id: userId })
      .update({
        avatar_storage_key: null,
        avatar_version: null,
        avatar_updated_at: null
      });
    return findById(userId, { trx: client });
  }

  async function upsert(profileLike = {}, options = {}) {
    const client = options?.trx || knex;
    const identity = normalizeIdentity(profileLike);
    if (!identity) {
      throw new TypeError("upsert requires provider/authProvider and providerUserId/authProviderUserSid.");
    }

    const email = normalizeLowerText(profileLike.email);
    const displayName = normalizeText(profileLike.displayName);
    const requestedUsername = normalizeUsername(profileLike.username);
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
          const username = existingUsername || (await resolveUniqueUsername(trx, requestedUsername || usernameBaseFromEmail(email), {
            excludeUserId: existing.id
          }));
          await trx("users").where({ id: existing.id }).update({
            email,
            display_name: displayName,
            username
          });
        } else {
          const username = await resolveUniqueUsername(trx, requestedUsername || usernameBaseFromEmail(email));
          await trx("users").insert({
            auth_provider: identity.provider,
            auth_provider_user_sid: identity.providerUserId,
            email,
            display_name: displayName,
            username
          });
        }
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

      const reloaded = await trx("users").where(where).first();
      return mapProfileRow(reloaded);
    };

    if (options?.trx) {
      return executeUpsert(client);
    }

    return knex.transaction(executeUpsert);
  }

  async function withTransaction(work) {
    if (typeof work !== "function") {
      throw new TypeError("withTransaction requires a callback.");
    }

    return knex.transaction((trx) => work(trx));
  }

  return Object.freeze({
    findById,
    findByIdentity,
    updateDisplayNameById,
    updateAvatarById,
    clearAvatarById,
    upsert,
    withTransaction
  });
}

export { createRepository, normalizeIdentity, mapProfileRow };
