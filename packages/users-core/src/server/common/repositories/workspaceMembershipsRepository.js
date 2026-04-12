import {
  normalizeLowerText,
  normalizeRecordId,
  normalizeDbRecordId,
  normalizeText,
  toIsoString,
  nowDb,
  isDuplicateEntryError,
  createWithTransaction
} from "./repositoryUtils.js";
import { OWNER_ROLE_ID } from "../../../shared/roles.js";

function mapRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: normalizeDbRecordId(row.id, { fallback: "" }),
    workspaceId: normalizeDbRecordId(row.workspace_id, { fallback: "" }),
    userId: normalizeDbRecordId(row.user_id, { fallback: "" }),
    roleSid: normalizeLowerText(row.role_sid || "member") || "member",
    status: normalizeLowerText(row.status || "active") || "active",
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapMemberSummaryRow(row) {
  if (!row) {
    return null;
  }

  return {
    userId: normalizeDbRecordId(row.user_id, { fallback: "" }),
    roleSid: normalizeLowerText(row.role_sid || "member") || "member",
    status: normalizeLowerText(row.status || "active") || "active",
    displayName: normalizeText(row.display_name),
    email: normalizeLowerText(row.email)
  };
}

function createRepository(knex) {
  if (typeof knex !== "function") {
    throw new TypeError("workspaceMembershipsRepository requires knex.");
  }
  const withTransaction = createWithTransaction(knex);

  async function findByWorkspaceIdAndUserId(workspaceId, userId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedWorkspaceId || !normalizedUserId) {
      return null;
    }

    const client = options?.trx || knex;
    const row = await client("workspace_memberships")
      .where({ workspace_id: normalizedWorkspaceId, user_id: normalizedUserId })
      .first();
    return mapRow(row);
  }

  async function ensureOwnerMembership(workspaceId, userId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedWorkspaceId || !normalizedUserId) {
      throw new TypeError("workspaceMembershipsRepository.ensureOwnerMembership requires workspaceId and userId.");
    }

    const client = options?.trx || knex;
    const existing = await findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, { trx: client });
    if (existing) {
      if (existing.roleSid !== OWNER_ROLE_ID || existing.status !== "active") {
        await client("workspace_memberships")
          .where({ workspace_id: normalizedWorkspaceId, user_id: normalizedUserId })
          .update({
            role_sid: OWNER_ROLE_ID,
            status: "active",
            updated_at: nowDb()
          });
      }
      return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, { trx: client });
    }

    try {
      await client("workspace_memberships").insert({
        workspace_id: normalizedWorkspaceId,
        user_id: normalizedUserId,
        role_sid: OWNER_ROLE_ID,
        status: "active",
        created_at: nowDb(),
        updated_at: nowDb()
      });
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }
    }

    return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, { trx: client });
  }

  async function upsertMembership(workspaceId, userId, patch = {}, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedWorkspaceId || !normalizedUserId) {
      throw new TypeError("workspaceMembershipsRepository.upsertMembership requires workspaceId and userId.");
    }

    const client = options?.trx || knex;
    const existing = await findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, { trx: client });
    const roleSid = normalizeLowerText(patch.roleSid || existing?.roleSid || "member") || "member";
    const status = normalizeLowerText(patch.status || existing?.status || "active") || "active";

    if (!existing) {
      await client("workspace_memberships").insert({
        workspace_id: normalizedWorkspaceId,
        user_id: normalizedUserId,
        role_sid: roleSid,
        status,
        created_at: nowDb(),
        updated_at: nowDb()
      });
      return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, { trx: client });
    }

    await client("workspace_memberships")
      .where({ workspace_id: normalizedWorkspaceId, user_id: normalizedUserId })
      .update({
        role_sid: roleSid,
        status,
        updated_at: nowDb()
      });

    return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, { trx: client });
  }

  async function listActiveByWorkspaceId(workspaceId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return [];
    }

    const client = options?.trx || knex;
    const rows = await client("workspace_memberships as wm")
      .join("users as up", "up.id", "wm.user_id")
      .where({ "wm.workspace_id": normalizedWorkspaceId, "wm.status": "active" })
      .orderBy("up.display_name", "asc")
      .select([
        "wm.user_id",
        "wm.role_sid",
        "wm.status",
        "up.display_name",
        "up.email"
      ]);

    return rows.map(mapMemberSummaryRow).filter(Boolean);
  }

  async function listActiveWorkspaceIdsByUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return [];
    }

    const client = options?.trx || knex;
    const rows = await client("workspace_memberships")
      .where({
        user_id: normalizedUserId,
        status: "active"
      })
      .select("workspace_id")
      .orderBy("workspace_id", "asc");

    return rows
      .map((row) => normalizeDbRecordId(row.workspace_id, { fallback: null }))
      .filter(Boolean);
  }

  return Object.freeze({
    withTransaction,
    findByWorkspaceIdAndUserId,
    ensureOwnerMembership,
    upsertMembership,
    listActiveByWorkspaceId,
    listActiveWorkspaceIdsByUserId
  });
}

export { createRepository, mapRow, mapMemberSummaryRow };
