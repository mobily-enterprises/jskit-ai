import {
  normalizeText,
  normalizeLowerText,
  toIsoString,
  toNullableIso,
  nowDb,
  isDuplicateEntryError
} from "./repositoryUtils.js";
import { coerceWorkspaceColor } from "../../../shared/settings.js";

function mapRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    slug: normalizeText(row.slug),
    name: normalizeText(row.name),
    ownerUserId: Number(row.owner_user_id),
    isPersonal: Boolean(row.is_personal),
    avatarUrl: row.avatar_url ? normalizeText(row.avatar_url) : "",
    color: coerceWorkspaceColor(row.color),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    deletedAt: toNullableIso(row.deleted_at)
  };
}

function mapMembershipWorkspaceRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...mapRow(row),
    roleId: normalizeLowerText(row.role_id || "member"),
    membershipStatus: normalizeLowerText(row.membership_status || "active") || "active"
  };
}

function createRepository(knex) {
  if (typeof knex !== "function") {
    throw new TypeError("workspacesRepository requires knex.");
  }

  async function findById(workspaceId, options = {}) {
    const client = options?.trx || knex;
    const row = await client("workspaces").where({ id: Number(workspaceId) }).first();
    return mapRow(row);
  }

  async function findBySlug(slug, options = {}) {
    const client = options?.trx || knex;
    const normalizedSlug = normalizeLowerText(slug);
    if (!normalizedSlug) {
      return null;
    }

    const row = await client("workspaces").where({ slug: normalizedSlug }).first();
    return mapRow(row);
  }

  async function findPersonalByOwnerUserId(userId, options = {}) {
    const client = options?.trx || knex;
    const row = await client("workspaces")
      .where({ owner_user_id: Number(userId), is_personal: 1 })
      .orderBy("id", "asc")
      .first();
    return mapRow(row);
  }

  async function insert(payload = {}, options = {}) {
    const client = options?.trx || knex;
    const source = payload && typeof payload === "object" ? payload : {};

    const insertPayload = {
      slug: normalizeLowerText(source.slug),
      name: normalizeText(source.name),
      owner_user_id: Number(source.ownerUserId),
      is_personal: source.isPersonal ? 1 : 0,
      avatar_url: normalizeText(source.avatarUrl),
      color: coerceWorkspaceColor(source.color),
      created_at: nowDb(),
      updated_at: nowDb(),
      deleted_at: null
    };

    try {
      const result = await client("workspaces").insert(insertPayload);
      const insertedId = Array.isArray(result) ? Number(result[0]) : Number(result);
      if (Number.isInteger(insertedId) && insertedId > 0) {
        return findById(insertedId, { trx: client });
      }
      const bySlug = await findBySlug(insertPayload.slug, { trx: client });
      return bySlug;
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }
      const bySlug = await findBySlug(insertPayload.slug, { trx: client });
      if (bySlug) {
        return bySlug;
      }
      throw error;
    }
  }

  async function updateById(workspaceId, patch = {}, options = {}) {
    const client = options?.trx || knex;
    const source = patch && typeof patch === "object" ? patch : {};
    const dbPatch = {
      updated_at: nowDb()
    };

    if (Object.hasOwn(source, "name")) {
      dbPatch.name = normalizeText(source.name);
    }
    if (Object.hasOwn(source, "avatarUrl")) {
      dbPatch.avatar_url = normalizeText(source.avatarUrl);
    }
    if (Object.hasOwn(source, "color")) {
      dbPatch.color = coerceWorkspaceColor(source.color);
    }

    await client("workspaces").where({ id: Number(workspaceId) }).update(dbPatch);
    return findById(workspaceId, { trx: client });
  }

  async function listForUserId(userId, options = {}) {
    const client = options?.trx || knex;
    const rows = await client("workspace_memberships as wm")
      .join("workspaces as w", "w.id", "wm.workspace_id")
      .where({ "wm.user_id": Number(userId) })
      .whereNull("w.deleted_at")
      .orderBy("w.is_personal", "desc")
      .orderBy("w.id", "asc")
      .select([
        "w.id",
        "w.slug",
        "w.name",
        "w.owner_user_id",
        "w.is_personal",
        "w.avatar_url",
        "w.color",
        "w.created_at",
        "w.updated_at",
        "w.deleted_at",
        "wm.role_id",
        "wm.status as membership_status"
      ]);

    return rows.map(mapMembershipWorkspaceRow).filter(Boolean);
  }

  return Object.freeze({
    findById,
    findBySlug,
    findPersonalByOwnerUserId,
    insert,
    updateById,
    listForUserId
  });
}

export { createRepository, mapRow, mapMembershipWorkspaceRow };
