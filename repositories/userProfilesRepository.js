import { db } from "../db/knex.js";
import { toIsoString } from "../lib/dateUtils.js";

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
  async function repoFindBySupabaseUserId(supabaseUserId) {
    const row = await dbClient("user_profiles").where({ supabase_user_id: supabaseUserId }).first();
    return mapProfileRowNullable(row);
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
    findBySupabaseUserId: repoFindBySupabaseUserId,
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

export const { findBySupabaseUserId, upsert } = repository;
export { __testables };
