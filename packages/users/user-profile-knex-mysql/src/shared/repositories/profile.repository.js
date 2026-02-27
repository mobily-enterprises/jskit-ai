import { toIsoString, toMysqlDateTimeUtc } from "@jskit-ai/knex-mysql-core/dateUtils";
import { isMysqlDuplicateEntryError } from "@jskit-ai/knex-mysql-core/mysqlErrors";

function duplicateEntryTargetsField(error, fieldName) {
  if (!isMysqlDuplicateEntryError(error)) {
    return false;
  }

  const message = String(error.sqlMessage || error.message || "").toLowerCase();
  return message.includes(String(fieldName || "").toLowerCase());
}

function isMysqlDuplicateEmailError(error) {
  return duplicateEntryTargetsField(error, "email");
}

function isMysqlDuplicateAuthProviderIdentityError(error) {
  return (
    duplicateEntryTargetsField(error, "auth_provider_user_id") ||
    duplicateEntryTargetsField(error, "uq_user_profiles_auth_provider_user_id")
  );
}

function createDuplicateEmailConflictError() {
  const error = new Error("Email is already linked to a different profile.");
  error.code = "USER_PROFILE_EMAIL_CONFLICT";
  return error;
}

function normalizeProviderId(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeProviderUserId(value) {
  return String(value || "").trim();
}

function normalizeIdentity(identityLike) {
  const source = identityLike && typeof identityLike === "object" ? identityLike : {};
  const provider = normalizeProviderId(source.provider || source.authProvider);
  const providerUserId = normalizeProviderUserId(source.providerUserId || source.authProviderUserId);

  if (!provider || !providerUserId) {
    return null;
  }

  return {
    provider,
    providerUserId
  };
}

function mapProfileRowRequired(row) {
  if (!row) {
    throw new TypeError("mapProfileRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    authProvider: String(row.auth_provider || "").trim().toLowerCase(),
    authProviderUserId: String(row.auth_provider_user_id || ""),
    email: row.email,
    displayName: row.display_name,
    avatarStorageKey: row.avatar_storage_key || null,
    avatarVersion: row.avatar_version == null ? null : String(row.avatar_version),
    avatarUpdatedAt: row.avatar_updated_at == null ? null : toIsoString(row.avatar_updated_at),
    createdAt: toIsoString(row.created_at)
  };
}

function mapProfileRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapProfileRowRequired(row);
}

function assertProfileUpsertPayload(profileLike) {
  const source = profileLike && typeof profileLike === "object" ? profileLike : {};
  const identity = normalizeIdentity(source);
  if (!identity) {
    throw new TypeError("upsert requires authProvider/provider and authProviderUserId/providerUserId.");
  }

  const email = String(source.email || "")
    .trim()
    .toLowerCase();
  const displayName = String(source.displayName || "").trim();
  if (!email || !displayName) {
    throw new TypeError("upsert requires email and displayName.");
  }

  return {
    identity,
    email,
    displayName
  };
}

function createUserProfilesRepository(dbClient) {
  async function repoFindById(userId) {
    const row = await dbClient("user_profiles").where({ id: userId }).first();
    return mapProfileRowNullable(row);
  }

  async function repoFindByEmail(email) {
    const normalized = String(email || "")
      .trim()
      .toLowerCase();
    if (!normalized) {
      return null;
    }

    const row = await dbClient("user_profiles").whereRaw("LOWER(email) = ?", [normalized]).first();
    return mapProfileRowNullable(row);
  }

  async function repoFindByIdentity(identityLike) {
    const identity = normalizeIdentity(identityLike);
    if (!identity) {
      return null;
    }

    const row = await dbClient("user_profiles")
      .where({
        auth_provider: identity.provider,
        auth_provider_user_id: identity.providerUserId
      })
      .first();

    return mapProfileRowNullable(row);
  }

  async function repoUpdateDisplayNameById(userId, displayName) {
    await dbClient("user_profiles").where({ id: userId }).update({
      display_name: displayName
    });

    const row = await dbClient("user_profiles").where({ id: userId }).first();
    return mapProfileRowRequired(row);
  }

  async function repoUpdateAvatarById(userId, avatar) {
    await dbClient("user_profiles")
      .where({ id: userId })
      .update({
        avatar_storage_key: avatar.avatarStorageKey,
        avatar_version: avatar.avatarVersion,
        avatar_updated_at: toMysqlDateTimeUtc(avatar.avatarUpdatedAt)
      });

    const row = await dbClient("user_profiles").where({ id: userId }).first();
    return mapProfileRowRequired(row);
  }

  async function repoClearAvatarById(userId) {
    await dbClient("user_profiles").where({ id: userId }).update({
      avatar_storage_key: null,
      avatar_version: null,
      avatar_updated_at: null
    });

    const row = await dbClient("user_profiles").where({ id: userId }).first();
    return mapProfileRowRequired(row);
  }

  async function repoUpsert(profileLike) {
    const normalizedProfile = assertProfileUpsertPayload(profileLike);
    const { identity } = normalizedProfile;

    return dbClient.transaction(async (trx) => {
      const whereByIdentity = {
        auth_provider: identity.provider,
        auth_provider_user_id: identity.providerUserId
      };

      const existing = await trx("user_profiles").where(whereByIdentity).first();
      let duplicateIdentityObserved = false;

      try {
        if (existing) {
          await trx("user_profiles").where({ id: existing.id }).update({
            email: normalizedProfile.email,
            display_name: normalizedProfile.displayName
          });
        } else {
          await trx("user_profiles").insert({
            auth_provider: identity.provider,
            auth_provider_user_id: identity.providerUserId,
            email: normalizedProfile.email,
            display_name: normalizedProfile.displayName
          });
        }
      } catch (error) {
        if (isMysqlDuplicateEmailError(error)) {
          throw createDuplicateEmailConflictError();
        }
        if (isMysqlDuplicateAuthProviderIdentityError(error)) {
          duplicateIdentityObserved = true;
        } else {
          throw error;
        }
      }

      if (duplicateIdentityObserved) {
        const racedRow = await trx("user_profiles").where(whereByIdentity).first();
        if (!racedRow) {
          throw new Error("Duplicate auth provider identity detected but row could not be reloaded.");
        }

        try {
          await trx("user_profiles").where({ id: racedRow.id }).update({
            email: normalizedProfile.email,
            display_name: normalizedProfile.displayName
          });
        } catch (error) {
          if (isMysqlDuplicateEmailError(error)) {
            throw createDuplicateEmailConflictError();
          }
          throw error;
        }
      }

      const row = await trx("user_profiles").where(whereByIdentity).first();
      return mapProfileRowRequired(row);
    });
  }

  return {
    findById: repoFindById,
    findByEmail: repoFindByEmail,
    findByIdentity: repoFindByIdentity,
    updateDisplayNameById: repoUpdateDisplayNameById,
    updateAvatarById: repoUpdateAvatarById,
    clearAvatarById: repoClearAvatarById,
    upsert: repoUpsert
  };
}

function createRepository(dbClient) {
  if (typeof dbClient !== "function") {
    throw new TypeError("createRepository requires a dbClient function.");
  }

  return createUserProfilesRepository(dbClient);
}

const __testables = {
  mapProfileRowRequired,
  mapProfileRowNullable,
  isMysqlDuplicateEntryError,
  duplicateEntryTargetsField,
  isMysqlDuplicateEmailError,
  isMysqlDuplicateAuthProviderIdentityError,
  createDuplicateEmailConflictError,
  normalizeProviderId,
  normalizeProviderUserId,
  normalizeIdentity,
  createUserProfilesRepository
};

export { createRepository, __testables };
