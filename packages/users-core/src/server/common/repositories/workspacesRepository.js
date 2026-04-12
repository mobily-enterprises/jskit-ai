import { resolveInsertedRecordId } from "@jskit-ai/database-runtime/shared";
import {
  normalizeDbRecordId,
  normalizeRecordId,
  normalizeText,
  normalizeLowerText,
  toIsoString,
  toNullableIso,
  nowDb,
  isDuplicateEntryError,
  createWithTransaction
} from "./repositoryUtils.js";

function mapRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: normalizeDbRecordId(row.id, { fallback: "" }),
    slug: normalizeText(row.slug),
    name: normalizeText(row.name),
    ownerUserId: normalizeDbRecordId(row.owner_user_id, { fallback: "" }),
    isPersonal: Boolean(row.is_personal),
    avatarUrl: row.avatar_url ? normalizeText(row.avatar_url) : "",
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
    roleSid: normalizeLowerText(row.role_sid || "member"),
    membershipStatus: normalizeLowerText(row.membership_status || "active") || "active"
  };
}

function createRepository(knex) {
  if (typeof knex !== "function") {
    throw new TypeError("workspacesRepository requires knex.");
  }
  const withTransaction = createWithTransaction(knex);

  function workspaceSelectColumns({ includeMembership = false } = {}) {
    const columns = [
      "w.id",
      "w.slug",
      "w.name",
      "w.owner_user_id",
      "w.is_personal",
      "w.avatar_url",
      "w.created_at",
      "w.updated_at",
      "w.deleted_at"
    ];
    if (includeMembership) {
      columns.push("wm.role_sid", "wm.status as membership_status");
    }
    return columns;
  }

  async function findById(workspaceId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return null;
    }

    const client = options?.trx || knex;
    const row = await client("workspaces as w")
      .where({ "w.id": normalizedWorkspaceId })
      .select(workspaceSelectColumns())
      .first();
    return mapRow(row);
  }

  async function findBySlug(slug, options = {}) {
    const client = options?.trx || knex;
    const normalizedSlug = normalizeLowerText(slug);
    if (!normalizedSlug) {
      return null;
    }

    const row = await client("workspaces as w")
      .where({ "w.slug": normalizedSlug })
      .select(workspaceSelectColumns())
      .first();
    return mapRow(row);
  }

  async function findPersonalByOwnerUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return null;
    }

    const client = options?.trx || knex;
    const row = await client("workspaces as w")
      .where({ "w.owner_user_id": normalizedUserId, "w.is_personal": 1 })
      .orderBy("w.id", "asc")
      .select(workspaceSelectColumns())
      .first();
    return mapRow(row);
  }

  async function insert(payload = {}, options = {}) {
    const client = options?.trx || knex;
    const source = payload && typeof payload === "object" ? payload : {};
    const ownerUserId = normalizeRecordId(source.ownerUserId, { fallback: null });
    if (!ownerUserId) {
      throw new TypeError("workspacesRepository.insert requires ownerUserId.");
    }

    const insertPayload = {
      slug: normalizeLowerText(source.slug),
      name: normalizeText(source.name),
      owner_user_id: ownerUserId,
      is_personal: source.isPersonal ? 1 : 0,
      avatar_url: normalizeText(source.avatarUrl),
      created_at: nowDb(),
      updated_at: nowDb(),
      deleted_at: null
    };

    try {
      const result = await client("workspaces").insert(insertPayload);
      const insertedId = resolveInsertedRecordId(result, { fallback: null });
      if (insertedId) {
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
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return null;
    }

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

    await client("workspaces").where({ id: normalizedWorkspaceId }).update(dbPatch);
    return findById(normalizedWorkspaceId, { trx: client });
  }

  async function listForUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return [];
    }

    const client = options?.trx || knex;
    const rows = await client("workspace_memberships as wm")
      .join("workspaces as w", "w.id", "wm.workspace_id")
      .where({ "wm.user_id": normalizedUserId })
      .whereNull("w.deleted_at")
      .orderBy("w.is_personal", "desc")
      .orderBy("w.id", "asc")
      .select(workspaceSelectColumns({ includeMembership: true }));

    return rows.map(mapMembershipWorkspaceRow).filter(Boolean);
  }

  return Object.freeze({
    withTransaction,
    findById,
    findBySlug,
    findPersonalByOwnerUserId,
    insert,
    updateById,
    listForUserId
  });
}

export { createRepository, mapRow, mapMembershipWorkspaceRow };
