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

async function findBySupabaseUserId(supabaseUserId) {
  const row = await db("user_profiles").where({ supabase_user_id: supabaseUserId }).first();
  return mapProfileRowNullable(row);
}

async function upsert(profile) {
  return db.transaction(async (trx) => {
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
      // Another transaction inserted the same Supabase user first.
      // Re-read and continue as update path.
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

const __testables = {
  mapProfileRowRequired,
  mapProfileRowNullable
};

export { findBySupabaseUserId, upsert, __testables };
