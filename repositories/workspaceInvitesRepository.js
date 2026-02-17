import { db } from "../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../lib/dateUtils.js";

function mapWorkspaceInviteRowRequired(row) {
  if (!row) {
    throw new TypeError("mapWorkspaceInviteRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    email: row.email,
    roleId: row.role_id,
    tokenHash: row.token_hash,
    invitedByUserId: row.invited_by_user_id == null ? null : Number(row.invited_by_user_id),
    expiresAt: toIsoString(row.expires_at),
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapWorkspaceInviteRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapWorkspaceInviteRowRequired(row);
}

function createWorkspaceInvitesRepository(dbClient) {
  async function repoInsert(invite) {
    const now = new Date();
    const [id] = await dbClient("workspace_invites").insert({
      workspace_id: invite.workspaceId,
      email: invite.email,
      role_id: invite.roleId,
      token_hash: invite.tokenHash,
      invited_by_user_id: invite.invitedByUserId || null,
      expires_at: toMysqlDateTimeUtc(new Date(invite.expiresAt)),
      status: invite.status || "pending",
      created_at: toMysqlDateTimeUtc(now),
      updated_at: toMysqlDateTimeUtc(now)
    });

    const row = await dbClient("workspace_invites").where({ id }).first();
    return mapWorkspaceInviteRowRequired(row);
  }

  async function repoListPendingByWorkspaceId(workspaceId) {
    const rows = await dbClient("workspace_invites")
      .where({
        workspace_id: workspaceId,
        status: "pending"
      })
      .orderBy("created_at", "desc")
      .orderBy("id", "desc");

    return rows.map(mapWorkspaceInviteRowRequired);
  }

  async function repoFindById(id) {
    const row = await dbClient("workspace_invites").where({ id }).first();
    return mapWorkspaceInviteRowNullable(row);
  }

  async function repoRevokeById(id) {
    await dbClient("workspace_invites").where({ id }).update({
      status: "revoked",
      updated_at: toMysqlDateTimeUtc(new Date())
    });

    const row = await dbClient("workspace_invites").where({ id }).first();
    return mapWorkspaceInviteRowNullable(row);
  }

  return {
    insert: repoInsert,
    listPendingByWorkspaceId: repoListPendingByWorkspaceId,
    findById: repoFindById,
    revokeById: repoRevokeById
  };
}

const repository = createWorkspaceInvitesRepository(db);

const __testables = {
  mapWorkspaceInviteRowRequired,
  mapWorkspaceInviteRowNullable,
  createWorkspaceInvitesRepository
};

export const { insert, listPendingByWorkspaceId, findById, revokeById } = repository;
export { __testables };
