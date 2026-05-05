import {
  createWithTransaction,
  normalizeLowerText,
  normalizeRecordId,
  normalizeDbRecordId,
  normalizeText,
  nowDb,
  isDuplicateEntryError,
  toIsoString
} from "./repositoryUtils.js";
import {
  createJsonApiInputRecord,
  createJsonApiRelationship,
  createJsonRestContext,
  extractJsonRestCollectionRows
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";

const RESOURCE_TYPE = "workspaceInvites";

function normalizeInviteRecord(payload) {
  if (!payload) {
    return null;
  }

  return {
    id: normalizeDbRecordId(payload.id, { fallback: null }),
    workspaceId: normalizeDbRecordId(payload?.workspace?.id || payload?.workspaceId, { fallback: null }),
    email: normalizeLowerText(payload.email),
    roleSid: normalizeLowerText(payload.roleSid || "member") || "member",
    status: normalizeLowerText(payload.status || "pending") || "pending",
    tokenHash: normalizeText(payload.tokenHash),
    invitedByUserId: normalizeDbRecordId(payload?.invitedByUser?.id || payload?.invitedByUserId, { fallback: null }),
    expiresAt: payload.expiresAt ? toIsoString(payload.expiresAt) : null,
    acceptedAt: payload.acceptedAt ? toIsoString(payload.acceptedAt) : null,
    revokedAt: payload.revokedAt ? toIsoString(payload.revokedAt) : null,
    createdAt: payload.createdAt ? toIsoString(payload.createdAt) : null,
    updatedAt: payload.updatedAt ? toIsoString(payload.updatedAt) : null
  };
}

function normalizeInvitePatchPayload(payload = {}) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const normalized = {};

  if (Object.hasOwn(source, "roleSid")) {
    normalized.roleSid = normalizeLowerText(source.roleSid);
  }
  if (Object.hasOwn(source, "status")) {
    normalized.status = normalizeLowerText(source.status);
  }
  if (Object.hasOwn(source, "invitedByUserId")) {
    normalized.invitedByUserId =
      source.invitedByUserId == null
        ? null
        : normalizeRecordId(source.invitedByUserId, { fallback: null });
  }
  if (Object.hasOwn(source, "expiresAt")) {
    normalized.expiresAt = source.expiresAt == null ? null : new Date(source.expiresAt);
  }
  if (Object.hasOwn(source, "acceptedAt")) {
    normalized.acceptedAt = source.acceptedAt == null ? null : new Date(source.acceptedAt);
  }
  if (Object.hasOwn(source, "revokedAt")) {
    normalized.revokedAt = source.revokedAt == null ? null : new Date(source.revokedAt);
  }

  return normalized;
}

function normalizeInviteWithWorkspace(payload = {}) {
  const invite = normalizeInviteRecord(payload);
  if (!invite) {
    return null;
  }

  return {
    ...invite,
    workspaceSlug: payload?.workspace?.slug ? normalizeText(payload.workspace.slug) : undefined,
    workspaceName: payload?.workspace?.name ? normalizeText(payload.workspace.name) : undefined,
    workspaceAvatarUrl: payload?.workspace?.avatarUrl ? normalizeText(payload.workspace.avatarUrl) : undefined
  };
}

function createInviteRelationships({ workspaceId = null, invitedByUserId = undefined } = {}) {
  const relationships = {};

  if (workspaceId) {
    relationships.workspace = createJsonApiRelationship("workspaces", workspaceId);
  }
  if (invitedByUserId !== undefined) {
    relationships.invitedByUser = createJsonApiRelationship("userProfiles", invitedByUserId);
  }

  return relationships;
}

function createRepository({ api, knex } = {}) {
  if (!api?.resources?.workspaceInvites) {
    throw new TypeError("workspaceInvitesRepository requires json-rest-api workspaceInvites resource.");
  }
  if (typeof knex !== "function") {
    throw new TypeError("workspaceInvitesRepository requires knex.");
  }

  const withTransaction = createWithTransaction(knex);

  async function queryInvites(filters = {}, options = {}, { includeWorkspace = false } = {}) {
    return extractJsonRestCollectionRows(
      await api.resources.workspaceInvites.query(
        {
          queryParams: {
            filters,
            ...(includeWorkspace ? { include: ["workspace"] } : {})
          },
          transaction: options?.trx || null,
          simplified: true
        },
        createJsonRestContext(options?.context || null)
      )
    );
  }

  async function findPendingByTokenHash(tokenHash, options = {}) {
    const rows = await queryInvites(
      {
        tokenHash: normalizeText(tokenHash),
        status: "pending"
      },
      options
    );

    return normalizeInviteRecord(rows[0] || null);
  }

  async function listPendingByEmail(email, options = {}) {
    const normalizedEmail = normalizeLowerText(email);
    if (!normalizedEmail) {
      return [];
    }

    const rows = await queryInvites(
      {
        email: normalizedEmail,
        status: "pending"
      },
      options,
      { includeWorkspace: true }
    );

    return rows
      .map(normalizeInviteWithWorkspace)
      .filter(Boolean)
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  }

  async function listPendingByWorkspaceIdWithWorkspace(workspaceId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return [];
    }

    const rows = await queryInvites(
      {
        workspace: normalizedWorkspaceId,
        status: "pending"
      },
      options,
      { includeWorkspace: true }
    );

    return rows
      .map(normalizeInviteWithWorkspace)
      .filter(Boolean)
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  }

  async function insert(payload = {}, options = {}) {
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
      const created = await api.resources.workspaceInvites.post(
        {
          inputRecord: createJsonApiInputRecord(
            RESOURCE_TYPE,
            {
              email: createPayload.email,
              roleSid: createPayload.roleSid,
              status: createPayload.status,
              tokenHash: createPayload.tokenHash,
              expiresAt: createPayload.expiresAt ?? null,
              acceptedAt: null,
              revokedAt: null,
              createdAt: new Date(),
              updatedAt: new Date()
            },
            {
              relationships: createInviteRelationships({
                workspaceId: createPayload.workspaceId,
                invitedByUserId: createPayload.invitedByUserId ?? null
              })
            }
          ),
          transaction: options?.trx || null
        },
        createJsonRestContext(options?.context || null)
      );

      return normalizeInviteRecord(created);
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }
    }

    const rows = await queryInvites(
      {
        workspace: createPayload.workspaceId,
        email: createPayload.email,
        status: "pending"
      },
      options
    );

    rows.sort((left, right) => String(right.id || "").localeCompare(String(left.id || "")));
    return normalizeInviteRecord(rows[0] || null);
  }

  async function expirePendingByWorkspaceIdAndEmail(workspaceId, email, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return;
    }

    const patch = normalizeInvitePatchPayload({ status: "expired" });
    const rows = await queryInvites(
      {
        workspace: normalizedWorkspaceId,
        email: normalizeLowerText(email),
        status: "pending"
      },
      options
    );

    for (const row of rows) {
      if (!row?.id) {
        continue;
      }
      await api.resources.workspaceInvites.patch(
        {
          inputRecord: createJsonApiInputRecord(
            RESOURCE_TYPE,
            {
              status: patch.status,
              updatedAt: nowDb()
            },
            {
              id: row.id
            }
          ),
          transaction: options?.trx || null
        },
        createJsonRestContext(options?.context || null)
      );
    }
  }

  async function markAcceptedById(inviteId, options = {}) {
    const normalizedInviteId = normalizeRecordId(inviteId, { fallback: null });
    if (!normalizedInviteId) {
      return;
    }

    await api.resources.workspaceInvites.patch(
      {
        inputRecord: createJsonApiInputRecord(
          RESOURCE_TYPE,
          {
            status: "accepted",
            acceptedAt: new Date(),
            updatedAt: new Date()
          },
          {
            id: normalizedInviteId
          }
        ),
        transaction: options?.trx || null
      },
      createJsonRestContext(options?.context || null)
    );
  }

  async function revokeById(inviteId, options = {}) {
    const normalizedInviteId = normalizeRecordId(inviteId, { fallback: null });
    if (!normalizedInviteId) {
      return;
    }

    await api.resources.workspaceInvites.patch(
      {
        inputRecord: createJsonApiInputRecord(
          RESOURCE_TYPE,
          {
            status: "revoked",
            revokedAt: new Date(),
            updatedAt: new Date()
          },
          {
            id: normalizedInviteId
          }
        ),
        transaction: options?.trx || null
      },
      createJsonRestContext(options?.context || null)
    );
  }

  async function findPendingByIdForWorkspace(inviteId, workspaceId, options = {}) {
    const normalizedInviteId = normalizeRecordId(inviteId, { fallback: null });
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedInviteId || !normalizedWorkspaceId) {
      return null;
    }

    const rows = await queryInvites(
      {
        id: normalizedInviteId,
        workspace: normalizedWorkspaceId,
        status: "pending"
      },
      options
    );

    return normalizeInviteRecord(rows[0] || null);
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
