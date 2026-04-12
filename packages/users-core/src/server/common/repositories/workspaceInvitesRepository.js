import { resolveInsertedRecordId } from "@jskit-ai/database-runtime/shared";
import {
  normalizeLowerText,
  normalizeDbRecordId,
  normalizeRecordId,
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
    id: normalizeDbRecordId(row.id, { fallback: "" }),
    workspaceId: normalizeDbRecordId(row.workspace_id, { fallback: "" }),
    email: normalizeLowerText(row.email),
    roleSid: normalizeLowerText(row.role_sid || "member") || "member",
    status: normalizeLowerText(row.status || "pending") || "pending",
    tokenHash: normalizeText(row.token_hash),
    invitedByUserId: row.invited_by_user_id == null ? null : normalizeDbRecordId(row.invited_by_user_id, { fallback: null }),
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

const WORKSPACE_INVITE_WITH_WORKSPACE_SELECT = Object.freeze([
  "wi.*",
  "w.slug as workspace_slug",
  "w.name as workspace_name",
  "w.avatar_url as workspace_avatar_url"
]);

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
      .select(WORKSPACE_INVITE_WITH_WORKSPACE_SELECT);

    return rows.map(mapRow).filter(Boolean);
  }

  async function listPendingByWorkspaceIdWithWorkspace(workspaceId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return [];
    }

    const client = options?.trx || knex;
    const rows = await client("workspace_invites as wi")
      .join("workspaces as w", "w.id", "wi.workspace_id")
      .where({ "wi.workspace_id": normalizedWorkspaceId, "wi.status": "pending" })
      .orderBy("wi.created_at", "desc")
      .select(WORKSPACE_INVITE_WITH_WORKSPACE_SELECT);

    return rows.map(mapRow).filter(Boolean);
  }

  async function insert(payload = {}, options = {}) {
    const client = options?.trx || knex;
    const source = payload && typeof payload === "object" ? payload : {};
    const workspaceId = normalizeRecordId(source.workspaceId, { fallback: null });
    if (!workspaceId) {
      throw new TypeError("workspaceInvitesRepository.insert requires workspaceId.");
    }

    const insertPayload = {
      workspace_id: workspaceId,
      email: normalizeLowerText(source.email),
      role_sid: normalizeLowerText(source.roleSid || "member") || "member",
      status: normalizeLowerText(source.status || "pending") || "pending",
      token_hash: normalizeText(source.tokenHash),
      invited_by_user_id: source.invitedByUserId == null ? null : normalizeRecordId(source.invitedByUserId, { fallback: null }),
      expires_at: toNullableDateTime(source.expiresAt),
      accepted_at: null,
      revoked_at: null,
      created_at: nowDb(),
      updated_at: nowDb()
    };

    try {
      const result = await client("workspace_invites").insert(insertPayload);
      const insertedId = resolveInsertedRecordId(result, { fallback: null });
      if (insertedId) {
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
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return;
    }

    const client = options?.trx || knex;
    await client("workspace_invites")
      .where({ workspace_id: normalizedWorkspaceId, email: normalizeLowerText(email), status: "pending" })
      .update({
        status: "expired",
        updated_at: nowDb()
      });
  }

  async function markAcceptedById(inviteId, options = {}) {
    const normalizedInviteId = normalizeRecordId(inviteId, { fallback: null });
    if (!normalizedInviteId) {
      return;
    }

    const client = options?.trx || knex;
    await client("workspace_invites")
      .where({ id: normalizedInviteId })
      .update({
        status: "accepted",
        accepted_at: nowDb(),
        updated_at: nowDb()
      });
  }

  async function revokeById(inviteId, options = {}) {
    const normalizedInviteId = normalizeRecordId(inviteId, { fallback: null });
    if (!normalizedInviteId) {
      return;
    }

    const client = options?.trx || knex;
    await client("workspace_invites")
      .where({ id: normalizedInviteId })
      .update({
        status: "revoked",
        revoked_at: nowDb(),
        updated_at: nowDb()
      });
  }

  async function findPendingByIdForWorkspace(inviteId, workspaceId, options = {}) {
    const normalizedInviteId = normalizeRecordId(inviteId, { fallback: null });
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedInviteId || !normalizedWorkspaceId) {
      return null;
    }

    const client = options?.trx || knex;
    const row = await client("workspace_invites")
      .where({ id: normalizedInviteId, workspace_id: normalizedWorkspaceId, status: "pending" })
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
