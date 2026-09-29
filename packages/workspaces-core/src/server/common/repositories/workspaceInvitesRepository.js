import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import {
  normalizeLowerText,
  normalizeRecordId,
  normalizeDbRecordId,
  normalizeText,
  isDuplicateEntryError,
  toIsoString
} from "./repositoryUtils.js";
import {
  createJsonRestContext,
  extractJsonRestCollectionRows
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";

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
    normalized.expiresAt = source.expiresAt == null ? null : toIsoString(source.expiresAt);
  }
  if (Object.hasOwn(source, "acceptedAt")) {
    normalized.acceptedAt = source.acceptedAt == null ? null : toIsoString(source.acceptedAt);
  }
  if (Object.hasOwn(source, "revokedAt")) {
    normalized.revokedAt = source.revokedAt == null ? null : toIsoString(source.revokedAt);
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

function createRepository({ api } = {}) {
  if (!api?.resources?.workspaceInvites) {
    throw new TypeError("workspaceInvitesRepository requires json-rest-api workspaceInvites resource.");
  }

  const withTransaction = (work) => api.transaction(work);

  async function queryInvites(filters = {}, options = {}, { includeWorkspace = false } = {}) {
    if (options.lock === true) {
      if (typeof options.trx !== "function" || includeWorkspace) {
        throw new TypeError("Locking invites requires a transaction and no relationship includes.");
      }
      // Locking reads must see changes committed while waiting for the lock.
      const fields = {
        id: "id",
        workspace: "workspace_id",
        email: "email",
        status: "status",
        tokenHash: "token_hash"
      };
      const where = Object.fromEntries(Object.entries(filters).map(([key, value]) => {
        if (!fields[key]) {
          throw new TypeError("Unsupported locking invitation filter.");
        }
        return [fields[key], value];
      }));
      // Read PostgreSQL's UTC timestamps as text to avoid the driver's local-time conversion.
      const dateColumn = (name) => options.trx.client?.config?.client === "pg"
        ? options.trx.raw("CAST(?? AS TEXT)", [name])
        : name;
      return options.trx("workspace_invites").where(where).select({
        id: "id",
        workspaceId: "workspace_id",
        email: "email",
        roleSid: "role_sid",
        status: "status",
        tokenHash: "token_hash",
        invitedByUserId: "invited_by_user_id",
        expiresAt: dateColumn("expires_at"),
        acceptedAt: dateColumn("accepted_at"),
        revokedAt: dateColumn("revoked_at"),
        createdAt: dateColumn("created_at"),
        updatedAt: dateColumn("updated_at")
      }).forUpdate();
    }
    return extractJsonRestCollectionRows(
      await api.resources.workspaceInvites.query(
        {
          queryParams: {
            filters,
            ...(includeWorkspace ? { include: ["workspace"] } : {})
          },
          transaction: options?.trx || null,
          format: "plain"
        },
        createJsonRestContext(options?.context || null)
      )
    );
  }

  async function lockWorkspaceForInvitations(workspaceId, options = {}) {
    if (typeof options.trx !== "function" || options.trx.isCompleted?.()) {
      throw new TypeError("Invitation locking requires an active transaction.");
    }
    const id = normalizeRecordId(workspaceId, { fallback: null });
    if (!id) {
      throw new TypeError("Invitation locking requires workspaceId.");
    }
    const row = await options.trx("workspaces").where({ id }).forUpdate().first("id");
    if (!row) {
      throw new AppError(404, "Invitation workspace no longer exists.");
    }
  }

  async function findPendingByTokenHash(tokenHash, options = {}) {
    if (options.lock === true) {
      await lockWorkspaceForInvitations(options.workspaceId, options);
    }
    const filters = options.lock === true
      ? {
          id: normalizeRecordId(options.inviteId, { fallback: null }),
          workspace: normalizeRecordId(options.workspaceId, { fallback: null }),
          status: "pending"
        }
      : { tokenHash: normalizeText(tokenHash), status: "pending" };
    // Lock by ID so database errors cannot expose token hashes; compare the token here.
    const rows = await queryInvites(filters, options);
    const invite = normalizeInviteRecord(rows[0] || null);
    return invite?.tokenHash === normalizeText(tokenHash) ? invite : null;
  }

  async function findByTokenHashWithWorkspace(tokenHash, options = {}) {
    const normalizedTokenHash = normalizeText(tokenHash);
    if (!normalizedTokenHash) {
      return null;
    }

    const rows = await queryInvites(
      {
        tokenHash: normalizedTokenHash
      },
      options,
      { includeWorkspace: true }
    );

    return normalizeInviteWithWorkspace(rows[0] || null);
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
      const createdAt = new Date().toISOString();
      const created = await api.resources.workspaceInvites.post(
        {
          data: {
            email: createPayload.email,
            roleSid: createPayload.roleSid,
            status: createPayload.status,
            tokenHash: createPayload.tokenHash,
            expiresAt: createPayload.expiresAt == null ? null : toIsoString(createPayload.expiresAt),
            acceptedAt: null,
            revokedAt: null,
            createdAt,
            updatedAt: createdAt,
            workspace: createPayload.workspaceId,
            invitedByUser: createPayload.invitedByUserId ?? null
          },
          format: "plain",
          returning: "full",
          transaction: options?.trx || null
        },
        createJsonRestContext(options?.context || null)
      );

      return normalizeInviteRecord(created);
    } catch (error) {
      if (options?.trx || error?.transactionOutcome !== "rolledBack" || !isDuplicateEntryError(error)) {
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

    if (!options.trx) {
      return withTransaction((trx) => expirePendingByWorkspaceIdAndEmail(workspaceId, email, { ...options, trx }));
    }
    await lockWorkspaceForInvitations(normalizedWorkspaceId, options);
    const patch = normalizeInvitePatchPayload({ status: "expired" });
    const rows = await queryInvites(
      {
        workspace: normalizedWorkspaceId,
        email: normalizeLowerText(email),
        status: "pending"
      },
      { ...options, lock: true }
    );

    for (const row of rows) {
      if (!row?.id) {
        continue;
      }
      await api.resources.workspaceInvites.patch(
        {
          id: row.id,
          data: {
            status: patch.status,
            updatedAt: new Date().toISOString()
          },
          format: "plain",
          returning: "full",
          transaction: options?.trx || null
        },
        createJsonRestContext(options?.context || null)
      );
    }
  }

  async function transitionPendingById(inviteId, status, options = {}) {
    const id = normalizeRecordId(inviteId, { fallback: null });
    if (!id) {
      throw new TypeError("Invitation transition requires inviteId.");
    }
    let workspaceId = options.workspaceId;
    if (!workspaceId) {
      const candidate = await queryInvites({ id }, { ...options, lock: false });
      if (!candidate[0]) {
        throw new AppError(404, "Invitation not found or already handled.");
      }
      workspaceId = normalizeInviteRecord(candidate[0]).workspaceId;
    }
    if (!options.trx) {
      return withTransaction((trx) => transitionPendingById(id, status, { ...options, trx, workspaceId }));
    }
    const invite = await findPendingByIdForWorkspace(id, workspaceId, { ...options, lock: true });
    if (!invite) {
      throw new AppError(404, "Invitation not found or already handled.");
    }
    const updatedAt = new Date().toISOString();
    await api.resources.workspaceInvites.patch(
      {
        id,
        data: {
          status,
          [status === "accepted" ? "acceptedAt" : "revokedAt"]: updatedAt,
          updatedAt
        },
        format: "plain",
        returning: "full",
        transaction: options.trx
      },
      createJsonRestContext(options.context || null)
    );
  }

  async function markAcceptedById(inviteId, options = {}) {
    return transitionPendingById(inviteId, "accepted", options);
  }

  async function revokeById(inviteId, options = {}) {
    return transitionPendingById(inviteId, "revoked", options);
  }

  async function findPendingByIdForWorkspace(inviteId, workspaceId, options = {}) {
    const normalizedInviteId = normalizeRecordId(inviteId, { fallback: null });
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedInviteId || !normalizedWorkspaceId) {
      return null;
    }

    if (options.lock === true) {
      await lockWorkspaceForInvitations(normalizedWorkspaceId, options);
    }
    const rows = await queryInvites(
      {
        id: normalizedInviteId,
        workspace: normalizedWorkspaceId,
        status: "pending"
      },
      options,
      { includeWorkspace: options.includeWorkspace === true }
    );

    return options.includeWorkspace === true
      ? (rows[0] ? normalizeInviteWithWorkspace(rows[0]) : null)
      : normalizeInviteRecord(rows[0] || null);
  }

  return Object.freeze({
    withTransaction,
    lockWorkspaceForInvitations,
    findPendingByTokenHash,
    findByTokenHashWithWorkspace,
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
