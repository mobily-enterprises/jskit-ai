import { db } from "../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../lib/dateUtils.js";

function isMysqlDuplicateEntryError(error) {
  if (!error) {
    return false;
  }

  const code = String(error.code || "");
  return code === "ER_DUP_ENTRY";
}

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

function isMysqlDuplicateSupabaseUserIdError(error) {
  return duplicateEntryTargetsField(error, "supabase_user_id");
}

function createDuplicateEmailConflictError() {
  const error = new Error("Email is already linked to a different profile.");
  error.code = "USER_PROFILE_EMAIL_CONFLICT";
  return error;
}

function mapProfileRowRequired(row) {
  if (!row) {
    throw new TypeError("mapProfileRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    supabaseUserId: row.supabase_user_id,
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

function createUserProfilesRepository(dbClient) {
  async function repoFindById(userId) {
    const row = await dbClient("user_profiles").where({ id: userId }).first();
    return mapProfileRowNullable(row);
  }

  async function repoFindBySupabaseUserId(supabaseUserId) {
    const row = await dbClient("user_profiles").where({ supabase_user_id: supabaseUserId }).first();
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
    await dbClient("user_profiles")
      .where({ id: userId })
      .update({
        avatar_storage_key: null,
        avatar_version: null,
        avatar_updated_at: null
      });

    const row = await dbClient("user_profiles").where({ id: userId }).first();
    return mapProfileRowRequired(row);
  }

  async function repoUpsert(profile) {
    return dbClient.transaction(async (trx) => {
      const existing = await trx("user_profiles").where({ supabase_user_id: profile.supabaseUserId }).first();

      let duplicateSupabaseUserIdObserved = false;

      try {
        if (existing) {
          await trx("user_profiles").where({ id: existing.id }).update({
            email: profile.email,
            display_name: profile.displayName
          });
        } else {
          await trx("user_profiles").insert({
            supabase_user_id: profile.supabaseUserId,
            email: profile.email,
            display_name: profile.displayName
          });
        }
      } catch (error) {
        if (isMysqlDuplicateEmailError(error)) {
          throw createDuplicateEmailConflictError();
        }
        if (isMysqlDuplicateSupabaseUserIdError(error)) {
          duplicateSupabaseUserIdObserved = true;
        } else {
          throw error;
        }
      }

      if (duplicateSupabaseUserIdObserved) {
        const racedRow = await trx("user_profiles").where({ supabase_user_id: profile.supabaseUserId }).first();
        if (!racedRow) {
          throw new Error("Duplicate supabase_user_id detected but row could not be reloaded.");
        }

        try {
          await trx("user_profiles").where({ id: racedRow.id }).update({
            email: profile.email,
            display_name: profile.displayName
          });
        } catch (error) {
          if (isMysqlDuplicateEmailError(error)) {
            throw createDuplicateEmailConflictError();
          }
          throw error;
        }
      }

      try {
        const row = await trx("user_profiles").where({ supabase_user_id: profile.supabaseUserId }).first();
        return mapProfileRowRequired(row);
      } catch (error) {
        if (isMysqlDuplicateEmailError(error)) {
          throw createDuplicateEmailConflictError();
        }
        throw error;
      }
    });
  }

  return {
    findById: repoFindById,
    findBySupabaseUserId: repoFindBySupabaseUserId,
    updateDisplayNameById: repoUpdateDisplayNameById,
    updateAvatarById: repoUpdateAvatarById,
    clearAvatarById: repoClearAvatarById,
    upsert: repoUpsert
  };
}

const repository = createUserProfilesRepository(db);

const __testables = {
  mapProfileRowRequired,
  mapProfileRowNullable,
  isMysqlDuplicateEntryError,
  duplicateEntryTargetsField,
  isMysqlDuplicateEmailError,
  isMysqlDuplicateSupabaseUserIdError,
  createDuplicateEmailConflictError,
  createUserProfilesRepository
};

export const { findById, findBySupabaseUserId, updateDisplayNameById, updateAvatarById, clearAvatarById, upsert } =
  repository;
export { __testables };
