import {
  normalizeLowerText,
  normalizeText,
  toIsoString,
  nowDb,
  isDuplicateEntryError
} from "./repositoryUtils.js";
import { OWNER_ROLE_ID } from "../../../shared/roles.js";

function mapRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    userId: Number(row.user_id),
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
    userId: Number(row.user_id),
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

  async function findByWorkspaceIdAndUserId(workspaceId, userId, options = {}) {
    const client = options?.trx || knex;
    const row = await client("workspace_memberships")
      .where({ workspace_id: Number(workspaceId), user_id: Number(userId) })
      .first();
    return mapRow(row);
  }

  async function ensureOwnerMembership(workspaceId, userId, options = {}) {
    const client = options?.trx || knex;
    const existing = await findByWorkspaceIdAndUserId(workspaceId, userId, { trx: client });
    if (existing) {
      if (existing.roleSid !== OWNER_ROLE_ID || existing.status !== "active") {
        await client("workspace_memberships")
          .where({ workspace_id: Number(workspaceId), user_id: Number(userId) })
          .update({
            role_sid: OWNER_ROLE_ID,
            status: "active",
            updated_at: nowDb()
          });
      }
      return findByWorkspaceIdAndUserId(workspaceId, userId, { trx: client });
    }

    try {
      await client("workspace_memberships").insert({
        workspace_id: Number(workspaceId),
        user_id: Number(userId),
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

    return findByWorkspaceIdAndUserId(workspaceId, userId, { trx: client });
  }

  async function upsertMembership(workspaceId, userId, patch = {}, options = {}) {
    const client = options?.trx || knex;
    const existing = await findByWorkspaceIdAndUserId(workspaceId, userId, { trx: client });
    const roleSid = normalizeLowerText(patch.roleSid || existing?.roleSid || "member") || "member";
    const status = normalizeLowerText(patch.status || existing?.status || "active") || "active";

    if (!existing) {
      await client("workspace_memberships").insert({
        workspace_id: Number(workspaceId),
        user_id: Number(userId),
        role_sid: roleSid,
        status,
        created_at: nowDb(),
        updated_at: nowDb()
      });
      return findByWorkspaceIdAndUserId(workspaceId, userId, { trx: client });
    }

    await client("workspace_memberships")
      .where({ workspace_id: Number(workspaceId), user_id: Number(userId) })
      .update({
        role_sid: roleSid,
        status,
        updated_at: nowDb()
      });

    return findByWorkspaceIdAndUserId(workspaceId, userId, { trx: client });
  }

  async function listActiveByWorkspaceId(workspaceId, options = {}) {
    const client = options?.trx || knex;
    const rows = await client("workspace_memberships as wm")
      .join("users as up", "up.id", "wm.user_id")
      .where({ "wm.workspace_id": Number(workspaceId), "wm.status": "active" })
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
    const client = options?.trx || knex;
    const rows = await client("workspace_memberships")
      .where({
        user_id: Number(userId),
        status: "active"
      })
      .select("workspace_id")
      .orderBy("workspace_id", "asc");

    return rows
      .map((row) => Number(row.workspace_id))
      .filter((workspaceId) => Number.isInteger(workspaceId) && workspaceId > 0);
  }

  return Object.freeze({
    findByWorkspaceIdAndUserId,
    ensureOwnerMembership,
    upsertMembership,
    listActiveByWorkspaceId,
    listActiveWorkspaceIdsByUserId
  });
}

export { createRepository, mapRow, mapMemberSummaryRow };
