import { db } from "../db/knex.js";
import { toIsoString } from "../lib/dateUtils.js";

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
  await db("user_profiles")
    .insert({
      supabase_user_id: profile.supabaseUserId,
      email: profile.email,
      display_name: profile.displayName
    })
    .onConflict("supabase_user_id")
    // MySQL may trigger duplicate-key updates on email uniqueness too.
    .merge({
      supabase_user_id: profile.supabaseUserId,
      email: profile.email,
      display_name: profile.displayName
    });

  return findBySupabaseUserId(profile.supabaseUserId);
}

const __testables = {
  mapProfileRowRequired,
  mapProfileRowNullable
};

export { findBySupabaseUserId, upsert, __testables };
