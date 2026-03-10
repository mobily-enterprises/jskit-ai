import {
  normalizeLowerText,
  normalizeText,
  toIsoString,
  nowDb,
  isDuplicateEntryError
} from "../common/repositories/repositoryUtils.js";
import { OWNER_ROLE_ID } from "../../shared/roles.js";

function mapRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    userId: Number(row.user_id),
    roleId: normalizeLowerText(row.role_id || "member") || "member",
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
    roleId: normalizeLowerText(row.role_id || "member") || "member",
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
      if (existing.roleId !== OWNER_ROLE_ID || existing.status !== "active") {
        await client("workspace_memberships")
          .where({ workspace_id: Number(workspaceId), user_id: Number(userId) })
          .update({
            role_id: OWNER_ROLE_ID,
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
        role_id: OWNER_ROLE_ID,
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
    const roleId = normalizeLowerText(patch.roleId || existing?.roleId || "member") || "member";
    const status = normalizeLowerText(patch.status || existing?.status || "active") || "active";

    if (!existing) {
      await client("workspace_memberships").insert({
        workspace_id: Number(workspaceId),
        user_id: Number(userId),
        role_id: roleId,
        status,
        created_at: nowDb(),
        updated_at: nowDb()
      });
      return findByWorkspaceIdAndUserId(workspaceId, userId, { trx: client });
    }

    await client("workspace_memberships")
      .where({ workspace_id: Number(workspaceId), user_id: Number(userId) })
      .update({
        role_id: roleId,
        status,
        updated_at: nowDb()
      });

    return findByWorkspaceIdAndUserId(workspaceId, userId, { trx: client });
  }

  async function listActiveByWorkspaceId(workspaceId, options = {}) {
    const client = options?.trx || knex;
    const rows = await client("workspace_memberships as wm")
      .join("user_profiles as up", "up.id", "wm.user_id")
      .where({ "wm.workspace_id": Number(workspaceId), "wm.status": "active" })
      .orderBy("up.display_name", "asc")
      .select([
        "wm.user_id",
        "wm.role_id",
        "wm.status",
        "up.display_name",
        "up.email"
      ]);

    return rows.map(mapMemberSummaryRow).filter(Boolean);
  }

  return Object.freeze({
    findByWorkspaceIdAndUserId,
    ensureOwnerMembership,
    upsertMembership,
    listActiveByWorkspaceId
  });
}

export { createRepository, mapRow, mapMemberSummaryRow };
