import { createCrudResourceRuntime } from "@jskit-ai/crud-core/server/resourceRuntime";
import {
  normalizeLowerText,
  normalizeRecordId,
  normalizeText,
  nowDb,
  isDuplicateEntryError
} from "./repositoryUtils.js";
import { workspaceInvitesResource } from "../resources/workspaceInvitesResource.js";

const REPOSITORY_CONFIG = Object.freeze({
  context: "internal.repository.workspace-invites"
});

function normalizeInviteRecord(payload) {
  if (!payload) {
    return null;
  }
  return workspaceInvitesResource.operations.view.outputValidator.normalize(payload);
}

function normalizeInvitePatchPayload(payload = {}) {
  return workspaceInvitesResource.operations.patch.bodyValidator.normalize(payload);
}

function normalizeInviteWithWorkspace(payload = {}) {
  const invite = normalizeInviteRecord(payload);
  if (!invite) {
    return null;
  }

  return {
    ...invite,
    workspaceSlug: payload?.workspace_slug ? normalizeText(payload.workspace_slug) : undefined,
    workspaceName: payload?.workspace_name ? normalizeText(payload.workspace_name) : undefined,
    workspaceAvatarUrl: payload?.workspace_avatar_url ? normalizeText(payload.workspace_avatar_url) : undefined
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
  const resourceRuntime = createCrudResourceRuntime(workspaceInvitesResource, knex, REPOSITORY_CONFIG);
  const withTransaction = resourceRuntime.withTransaction;

  async function findPendingByTokenHash(tokenHash, options = {}) {
    const client = options?.trx || knex;
    const row = await client("workspace_invites")
      .where({ token_hash: normalizeText(tokenHash), status: "pending" })
      .first();
    return normalizeInviteRecord(row);
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

    return rows.map(normalizeInviteWithWorkspace).filter(Boolean);
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

    return rows.map(normalizeInviteWithWorkspace).filter(Boolean);
  }

  async function insert(payload = {}, options = {}) {
    const client = options?.trx || knex;
    const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    const workspaceId = normalizeRecordId(source.workspaceId, { fallback: null });
    if (!workspaceId) {
      throw new TypeError("workspaceInvitesRepository.insert requires workspaceId.");
    }

    const createPayload = {
      ...source,
      workspaceId,
      roleSid: normalizeLowerText(source.roleSid || "member") || "member",
      status: normalizeLowerText(source.status || "pending") || "pending",
      acceptedAt: null,
      revokedAt: null
    };

    try {
      return await resourceRuntime.create(createPayload, {
        ...options,
        trx: client,
        include: "none"
      });
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }
    }

    const row = await client("workspace_invites")
      .where({ workspace_id: createPayload.workspaceId, email: createPayload.email, status: "pending" })
      .orderBy("id", "desc")
      .first();
    return normalizeInviteRecord(row);
  }

  async function expirePendingByWorkspaceIdAndEmail(workspaceId, email, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return;
    }

    const client = options?.trx || knex;
    const patch = normalizeInvitePatchPayload({ status: "expired" });
    await client("workspace_invites")
      .where({ workspace_id: normalizedWorkspaceId, email: normalizeLowerText(email), status: "pending" })
      .update({
        status: patch.status,
        updated_at: nowDb()
      });
  }

  async function markAcceptedById(inviteId, options = {}) {
    const normalizedInviteId = normalizeRecordId(inviteId, { fallback: null });
    if (!normalizedInviteId) {
      return;
    }

    await resourceRuntime.updateById(
      normalizedInviteId,
      {
        status: "accepted",
        acceptedAt: new Date()
      },
      {
        ...options,
        include: "none"
      }
    );
  }

  async function revokeById(inviteId, options = {}) {
    const normalizedInviteId = normalizeRecordId(inviteId, { fallback: null });
    if (!normalizedInviteId) {
      return;
    }

    await resourceRuntime.updateById(
      normalizedInviteId,
      {
        status: "revoked",
        revokedAt: new Date()
      },
      {
        ...options,
        include: "none"
      }
    );
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
    return normalizeInviteRecord(row);
  }

  return Object.freeze({
    withTransaction,
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

export { createRepository, normalizeInviteRecord, normalizeInviteWithWorkspace };
