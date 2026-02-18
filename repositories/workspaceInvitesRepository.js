import { db } from "../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../lib/dateUtils.js";
import { normalizeEmail } from "../shared/auth/utils.js";
import { coerceWorkspaceColor } from "../shared/workspace/colors.js";

function isMysqlDuplicateEntryError(error) {
  if (!error) {
    return false;
  }

  return String(error.code || "") === "ER_DUP_ENTRY";
}

function mapWorkspaceInviteRowRequired(row) {
  if (!row) {
    throw new TypeError("mapWorkspaceInviteRowRequired expected a row object.");
  }

  const workspaceDataPresent =
    row.workspace_slug != null ||
    row.workspace_name != null ||
    row.workspace_avatar_url != null ||
    row.workspace_color != null;
  const inviterDataPresent = row.invited_by_display_name != null || row.invited_by_email != null;

  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    email: String(row.email || ""),
    roleId: String(row.role_id || ""),
    tokenHash: String(row.token_hash || ""),
    invitedByUserId: row.invited_by_user_id == null ? null : Number(row.invited_by_user_id),
    expiresAt: toIsoString(row.expires_at),
    status: String(row.status || ""),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    invitedBy: inviterDataPresent
      ? {
          displayName: row.invited_by_display_name == null ? "" : String(row.invited_by_display_name || ""),
          email: row.invited_by_email == null ? "" : String(row.invited_by_email || "")
        }
      : null,
    workspace: workspaceDataPresent
      ? {
          id: Number(row.workspace_id),
          slug: String(row.workspace_slug || ""),
          name: String(row.workspace_name || ""),
          color: coerceWorkspaceColor(row.workspace_color),
          avatarUrl: row.workspace_avatar_url ? String(row.workspace_avatar_url) : ""
        }
      : null
  };
}

function mapWorkspaceInviteRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapWorkspaceInviteRowRequired(row);
}

function createInviteBaseQuery(dbClient, withWorkspace = false) {
  const query = dbClient("workspace_invites as wi")
    .leftJoin("user_profiles as inviter", "inviter.id", "wi.invited_by_user_id")
    .select(
      "wi.id",
      "wi.workspace_id",
      "wi.email",
      "wi.role_id",
      "wi.token_hash",
      "wi.invited_by_user_id",
      "wi.expires_at",
      "wi.status",
      "wi.created_at",
      "wi.updated_at",
      "inviter.display_name as invited_by_display_name",
      "inviter.email as invited_by_email"
    );

  if (withWorkspace) {
    query
      .innerJoin("workspaces as w", "w.id", "wi.workspace_id")
      .select(
        "w.slug as workspace_slug",
        "w.name as workspace_name",
        "w.color as workspace_color",
        "w.avatar_url as workspace_avatar_url"
      );
  }

  return query;
}

function createWorkspaceInvitesRepository(dbClient) {
  function resolveClient(options = {}) {
    const trx = options && typeof options === "object" ? options.trx || null : null;
    return trx || dbClient;
  }

  async function repoInsert(invite, options = {}) {
    const client = resolveClient(options);
    const now = new Date();
    const [id] = await client("workspace_invites").insert({
      workspace_id: invite.workspaceId,
      email: normalizeEmail(invite.email),
      role_id: String(invite.roleId || "").trim(),
      token_hash: String(invite.tokenHash || "").trim(),
      invited_by_user_id: invite.invitedByUserId || null,
      expires_at: toMysqlDateTimeUtc(new Date(invite.expiresAt)),
      status: invite.status || "pending",
      created_at: toMysqlDateTimeUtc(now),
      updated_at: toMysqlDateTimeUtc(now)
    });

    const row = await client("workspace_invites").where({ id }).first();
    return mapWorkspaceInviteRowRequired(row);
  }

  async function repoListPendingByWorkspaceId(workspaceId, options = {}) {
    const client = resolveClient(options);
    const rows = await createInviteBaseQuery(client)
      .where({
        "wi.workspace_id": workspaceId,
        "wi.status": "pending"
      })
      .andWhere("wi.expires_at", ">", toMysqlDateTimeUtc(new Date()))
      .orderBy("wi.created_at", "desc")
      .orderBy("wi.id", "desc");

    return rows.map(mapWorkspaceInviteRowRequired);
  }

  async function repoListPendingByWorkspaceIdWithWorkspace(workspaceId, options = {}) {
    const client = resolveClient(options);
    const rows = await createInviteBaseQuery(client, true)
      .where({
        "wi.workspace_id": workspaceId,
        "wi.status": "pending"
      })
      .andWhere("wi.expires_at", ">", toMysqlDateTimeUtc(new Date()))
      .orderBy("wi.created_at", "desc")
      .orderBy("wi.id", "desc");

    return rows.map(mapWorkspaceInviteRowRequired);
  }

  async function repoListPendingByEmail(email, options = {}) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return [];
    }

    const client = resolveClient(options);
    const rows = await createInviteBaseQuery(client, true)
      .where({
        "wi.status": "pending",
        "wi.email": normalizedEmail
      })
      .andWhere("wi.expires_at", ">", toMysqlDateTimeUtc(new Date()))
      .orderBy("wi.created_at", "desc")
      .orderBy("wi.id", "desc");

    return rows.map(mapWorkspaceInviteRowRequired);
  }

  async function repoFindById(id, options = {}) {
    const client = resolveClient(options);
    const row = await client("workspace_invites").where({ id }).first();
    return mapWorkspaceInviteRowNullable(row);
  }

  async function repoFindPendingByWorkspaceIdAndEmail(workspaceId, email, options = {}) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return null;
    }

    const client = resolveClient(options);
    const row = await createInviteBaseQuery(client)
      .where({
        "wi.workspace_id": workspaceId,
        "wi.email": normalizedEmail,
        "wi.status": "pending"
      })
      .andWhere("wi.expires_at", ">", toMysqlDateTimeUtc(new Date()))
      .orderBy("wi.id", "desc")
      .first();

    return mapWorkspaceInviteRowNullable(row);
  }

  async function repoFindPendingByIdForWorkspace(inviteId, workspaceId, options = {}) {
    const client = resolveClient(options);
    const row = await createInviteBaseQuery(client)
      .where({
        "wi.id": inviteId,
        "wi.workspace_id": workspaceId,
        "wi.status": "pending"
      })
      .andWhere("wi.expires_at", ">", toMysqlDateTimeUtc(new Date()))
      .first();

    return mapWorkspaceInviteRowNullable(row);
  }

  async function repoFindPendingByIdAndEmail(inviteId, email, options = {}) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return null;
    }

    const client = resolveClient(options);
    const row = await createInviteBaseQuery(client, true)
      .where({
        "wi.id": inviteId,
        "wi.email": normalizedEmail,
        "wi.status": "pending"
      })
      .andWhere("wi.expires_at", ">", toMysqlDateTimeUtc(new Date()))
      .first();

    return mapWorkspaceInviteRowNullable(row);
  }

  async function repoFindPendingByTokenHash(tokenHash, options = {}) {
    const normalizedTokenHash = String(tokenHash || "")
      .trim()
      .toLowerCase();
    if (!normalizedTokenHash) {
      return null;
    }

    const client = resolveClient(options);
    const row = await createInviteBaseQuery(client, true)
      .where({
        "wi.token_hash": normalizedTokenHash,
        "wi.status": "pending"
      })
      .andWhere("wi.expires_at", ">", toMysqlDateTimeUtc(new Date()))
      .first();

    return mapWorkspaceInviteRowNullable(row);
  }

  async function repoUpdateStatusById(id, status, options = {}) {
    const client = resolveClient(options);
    await client("workspace_invites")
      .where({ id })
      .update({
        status: String(status || "")
          .trim()
          .toLowerCase(),
        updated_at: toMysqlDateTimeUtc(new Date())
      });

    return repoFindById(id, options);
  }

  async function repoRevokeById(id, options = {}) {
    return repoUpdateStatusById(id, "revoked", options);
  }

  async function repoMarkAcceptedById(id, options = {}) {
    return repoUpdateStatusById(id, "accepted", options);
  }

  async function repoMarkExpiredPendingInvites(options = {}) {
    const client = resolveClient(options);
    const now = toMysqlDateTimeUtc(new Date());
    const affectedRows = await client("workspace_invites")
      .where({ status: "pending" })
      .andWhere("expires_at", "<=", now)
      .update({
        status: "expired",
        updated_at: now
      });

    return Number(affectedRows || 0);
  }

  async function repoExpirePendingByWorkspaceIdAndEmail(workspaceId, email, options = {}) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return 0;
    }

    const client = resolveClient(options);
    const now = toMysqlDateTimeUtc(new Date());
    const affectedRows = await client("workspace_invites")
      .where({
        workspace_id: workspaceId,
        email: normalizedEmail,
        status: "pending"
      })
      .andWhere("expires_at", "<=", now)
      .update({
        status: "expired",
        updated_at: now
      });

    return Number(affectedRows || 0);
  }

  async function repoTransaction(callback) {
    if (typeof dbClient.transaction === "function") {
      return dbClient.transaction(callback);
    }

    return callback(dbClient);
  }

  return {
    insert: repoInsert,
    listPendingByWorkspaceId: repoListPendingByWorkspaceId,
    listPendingByWorkspaceIdWithWorkspace: repoListPendingByWorkspaceIdWithWorkspace,
    listPendingByEmail: repoListPendingByEmail,
    findById: repoFindById,
    findPendingByWorkspaceIdAndEmail: repoFindPendingByWorkspaceIdAndEmail,
    findPendingByIdForWorkspace: repoFindPendingByIdForWorkspace,
    findPendingByIdAndEmail: repoFindPendingByIdAndEmail,
    findPendingByTokenHash: repoFindPendingByTokenHash,
    updateStatusById: repoUpdateStatusById,
    revokeById: repoRevokeById,
    markAcceptedById: repoMarkAcceptedById,
    markExpiredPendingInvites: repoMarkExpiredPendingInvites,
    expirePendingByWorkspaceIdAndEmail: repoExpirePendingByWorkspaceIdAndEmail,
    transaction: repoTransaction
  };
}

const repository = createWorkspaceInvitesRepository(db);

const __testables = {
  isMysqlDuplicateEntryError,
  normalizeEmail,
  mapWorkspaceInviteRowRequired,
  mapWorkspaceInviteRowNullable,
  createWorkspaceInvitesRepository
};

export const {
  insert,
  listPendingByWorkspaceId,
  listPendingByWorkspaceIdWithWorkspace,
  listPendingByEmail,
  findById,
  findPendingByWorkspaceIdAndEmail,
  findPendingByIdForWorkspace,
  findPendingByIdAndEmail,
  findPendingByTokenHash,
  updateStatusById,
  revokeById,
  markAcceptedById,
  markExpiredPendingInvites,
  expirePendingByWorkspaceIdAndEmail
} = repository;
export { __testables };
