import {
  normalizeLowerText,
  normalizeText,
  toIsoString,
  toNullableIso,
  toNullableDateTime,
  nowDb,
  isDuplicateEntryError
} from "./repositoryUtils.js";

function mapRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    email: normalizeLowerText(row.email),
    roleId: normalizeLowerText(row.role_id || "member") || "member",
    status: normalizeLowerText(row.status || "pending") || "pending",
    tokenHash: normalizeText(row.token_hash),
    invitedByUserId: row.invited_by_user_id == null ? null : Number(row.invited_by_user_id),
    expiresAt: toNullableIso(row.expires_at),
    acceptedAt: toNullableIso(row.accepted_at),
    revokedAt: toNullableIso(row.revoked_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    workspaceSlug: row.workspace_slug ? normalizeText(row.workspace_slug) : undefined,
    workspaceName: row.workspace_name ? normalizeText(row.workspace_name) : undefined,
    workspaceAvatarUrl: row.workspace_avatar_url ? normalizeText(row.workspace_avatar_url) : undefined
  };
}

function createRepository(knex) {
  if (typeof knex !== "function") {
    throw new TypeError("workspaceInvitesRepository requires knex.");
  }

  async function findPendingByTokenHash(tokenHash, options = {}) {
    const client = options?.trx || knex;
    const row = await client("workspace_invites")
      .where({ token_hash: normalizeText(tokenHash), status: "pending" })
      .first();
    return mapRow(row);
  }

  async function listPendingByEmail(email, options = {}) {
    const client = options?.trx || knex;
    const normalizedEmail = normalizeLowerText(email);
    if (!normalizedEmail) {
      return [];
    }

    const rows = await client("workspace_invites as wi")
      .join("workspaces as w", "w.id", "wi.workspace_id")
      .where({ "wi.email": normalizedEmail, "wi.status": "pending" })
      .orderBy("wi.created_at", "desc")
      .select([
        "wi.id",
        "wi.workspace_id",
        "wi.email",
        "wi.role_id",
        "wi.status",
        "wi.token_hash",
        "wi.invited_by_user_id",
        "wi.expires_at",
        "wi.accepted_at",
        "wi.revoked_at",
        "wi.created_at",
        "wi.updated_at",
        "w.slug as workspace_slug",
        "w.name as workspace_name",
        "w.avatar_url as workspace_avatar_url"
      ]);

    return rows.map(mapRow).filter(Boolean);
  }

  async function listPendingByWorkspaceIdWithWorkspace(workspaceId, options = {}) {
    const client = options?.trx || knex;
    const rows = await client("workspace_invites as wi")
      .join("workspaces as w", "w.id", "wi.workspace_id")
      .where({ "wi.workspace_id": Number(workspaceId), "wi.status": "pending" })
      .orderBy("wi.created_at", "desc")
      .select([
        "wi.id",
        "wi.workspace_id",
        "wi.email",
        "wi.role_id",
        "wi.status",
        "wi.token_hash",
        "wi.invited_by_user_id",
        "wi.expires_at",
        "wi.accepted_at",
        "wi.revoked_at",
        "wi.created_at",
        "wi.updated_at",
        "w.slug as workspace_slug",
        "w.name as workspace_name",
        "w.avatar_url as workspace_avatar_url"
      ]);

    return rows.map(mapRow).filter(Boolean);
  }

  async function insert(payload = {}, options = {}) {
    const client = options?.trx || knex;
    const source = payload && typeof payload === "object" ? payload : {};

    const insertPayload = {
      workspace_id: Number(source.workspaceId),
      email: normalizeLowerText(source.email),
      role_id: normalizeLowerText(source.roleId || "member") || "member",
      status: normalizeLowerText(source.status || "pending") || "pending",
      token_hash: normalizeText(source.tokenHash),
      invited_by_user_id: source.invitedByUserId == null ? null : Number(source.invitedByUserId),
      expires_at: toNullableDateTime(source.expiresAt),
      accepted_at: null,
      revoked_at: null,
      created_at: nowDb(),
      updated_at: nowDb()
    };

    try {
      const result = await client("workspace_invites").insert(insertPayload);
      const insertedId = Array.isArray(result) ? Number(result[0]) : Number(result);
      if (Number.isInteger(insertedId) && insertedId > 0) {
        const row = await client("workspace_invites").where({ id: insertedId }).first();
        return mapRow(row);
      }
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }
    }

    const row = await client("workspace_invites")
      .where({ workspace_id: insertPayload.workspace_id, email: insertPayload.email, status: "pending" })
      .orderBy("id", "desc")
      .first();
    return mapRow(row);
  }

  async function expirePendingByWorkspaceIdAndEmail(workspaceId, email, options = {}) {
    const client = options?.trx || knex;
    await client("workspace_invites")
      .where({ workspace_id: Number(workspaceId), email: normalizeLowerText(email), status: "pending" })
      .update({
        status: "expired",
        updated_at: nowDb()
      });
  }

  async function markAcceptedById(inviteId, options = {}) {
    const client = options?.trx || knex;
    await client("workspace_invites")
      .where({ id: Number(inviteId) })
      .update({
        status: "accepted",
        accepted_at: nowDb(),
        updated_at: nowDb()
      });
  }

  async function revokeById(inviteId, options = {}) {
    const client = options?.trx || knex;
    await client("workspace_invites")
      .where({ id: Number(inviteId) })
      .update({
        status: "revoked",
        revoked_at: nowDb(),
        updated_at: nowDb()
      });
  }

  async function findPendingByIdForWorkspace(inviteId, workspaceId, options = {}) {
    const client = options?.trx || knex;
    const row = await client("workspace_invites")
      .where({ id: Number(inviteId), workspace_id: Number(workspaceId), status: "pending" })
      .first();
    return mapRow(row);
  }

  return Object.freeze({
    findPendingByTokenHash,
    listPendingByEmail,
    listPendingByWorkspaceIdWithWorkspace,
    insert,
    expirePendingByWorkspaceIdAndEmail,
    markAcceptedById,
    revokeById,
    findPendingByIdForWorkspace
  });
}

export { createRepository, mapRow };
