import {
  isDuplicateEntryError,
  normalizeLowerText,
  normalizeText,
  toIsoString,
  toNullableDateTime,
  toNullableIso,
  nowDb
} from "./repositoryUtils.js";

function normalizeIdentity(identityLike) {
  const source = identityLike && typeof identityLike === "object" ? identityLike : {};
  const provider = normalizeLowerText(source.provider || source.authProvider);
  const providerUserId = normalizeText(source.providerUserId || source.authProviderUserId);
  if (!provider || !providerUserId) {
    return null;
  }
  return {
    provider,
    providerUserId
  };
}

function mapProfileRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    authProvider: normalizeLowerText(row.auth_provider),
    authProviderUserId: normalizeText(row.auth_provider_user_id),
    email: normalizeLowerText(row.email),
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

function createDuplicateEmailConflictError() {
  const error = new Error("Email is already linked to a different profile.");
  error.code = "USER_PROFILE_EMAIL_CONFLICT";
  return error;
}

function createRepository(knex) {
  if (typeof knex !== "function") {
    throw new TypeError("userProfilesRepository requires knex.");
  }

  async function findById(userId) {
    const row = await knex("user_profiles").where({ id: userId }).first();
    return mapProfileRow(row);
  }

  async function findByIdentity(identityLike) {
    const identity = normalizeIdentity(identityLike);
    if (!identity) {
      return null;
    }

    const row = await knex("user_profiles")
      .where({
        auth_provider: identity.provider,
        auth_provider_user_id: identity.providerUserId
      })
      .first();
    return mapProfileRow(row);
  }

  async function updateDisplayNameById(userId, displayName) {
    await knex("user_profiles")
      .where({ id: userId })
      .update({
        display_name: normalizeText(displayName)
      });
    return findById(userId);
  }

  async function updateAvatarById(userId, avatar = {}) {
    await knex("user_profiles")
      .where({ id: userId })
      .update({
        avatar_storage_key: avatar.avatarStorageKey || null,
        avatar_version: avatar.avatarVersion == null ? null : String(avatar.avatarVersion),
        avatar_updated_at: toNullableDateTime(avatar.avatarUpdatedAt) || nowDb()
      });

    return findById(userId);
  }

  async function clearAvatarById(userId) {
    await knex("user_profiles")
      .where({ id: userId })
      .update({
        avatar_storage_key: null,
        avatar_version: null,
        avatar_updated_at: null
      });
    return findById(userId);
  }

  async function upsert(profileLike = {}) {
    const identity = normalizeIdentity(profileLike);
    if (!identity) {
      throw new TypeError("upsert requires provider/authProvider and providerUserId/authProviderUserId.");
    }

    const email = normalizeLowerText(profileLike.email);
    const displayName = normalizeText(profileLike.displayName);
    if (!email || !displayName) {
      throw new TypeError("upsert requires email and displayName.");
    }

    return knex.transaction(async (trx) => {
      const where = {
        auth_provider: identity.provider,
        auth_provider_user_id: identity.providerUserId
      };
      const existing = await trx("user_profiles").where(where).first();

      try {
        if (existing) {
          await trx("user_profiles").where({ id: existing.id }).update({
            email,
            display_name: displayName
          });
        } else {
          await trx("user_profiles").insert({
            auth_provider: identity.provider,
            auth_provider_user_id: identity.providerUserId,
            email,
            display_name: displayName
          });
        }
      } catch (error) {
        if (duplicateTargetsEmail(error)) {
          throw createDuplicateEmailConflictError();
        }
        if (!isDuplicateEntryError(error)) {
          throw error;
        }
      }

      const reloaded = await trx("user_profiles").where(where).first();
      return mapProfileRow(reloaded);
    });
  }

  return Object.freeze({
    findById,
    findByIdentity,
    updateDisplayNameById,
    updateAvatarById,
    clearAvatarById,
    upsert
  });
}

export { createRepository, normalizeIdentity, mapProfileRow };
