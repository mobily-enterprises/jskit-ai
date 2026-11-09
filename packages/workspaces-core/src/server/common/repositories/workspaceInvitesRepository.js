import { isLostDuplicateInsertRace, normalizeDbRecordId, toIsoString } from "@jskit-ai/database-runtime/shared";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeLowerText, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

// The filters a locking read takes: the invite, its workspace, email, status and token.
const LOCKING_FILTERS = Object.freeze(["id", "workspace", "email", "status", "tokenHash"]);

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

function normalizeInviteWithWorkspace(payload = {}) {
  const invite = normalizeInviteRecord(payload);
  if (!invite) {
    return null;
  }

  return {
    ...invite,
    workspaceSlug: payload.workspace?.slug ? normalizeText(payload.workspace.slug) : undefined,
    workspaceName: payload.workspace?.name ? normalizeText(payload.workspace.name) : undefined,
    workspaceAvatarUrl: payload.workspace?.avatarUrl ? normalizeText(payload.workspace.avatarUrl) : undefined
  };
}

/**
 * The workspace invites' records, `repositories.workspaceInvites` of
 * `workspaces.core`. Every method takes the caller's options last and joins
 * their transaction; `lock: true` reads lock the invites, and their workspace
 * first, in it.
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.workspaceInvites
 *   The workspace_invites table's handle.
 * @param {import("../../types.js").Workspaces} dependencies.workspaces The workspaces, whose lock an invite's work takes first.
 */
function createRepository({ workspaceInvites, workspaces }) {
  async function queryInvites(filters, options, { includeWorkspace = false } = {}) {
    if (options.lock === true) {
      // The handle's lock refuses a call outside a transaction.
      if (includeWorkspace) {
        throw new TypeError("Locking invites takes no relationship includes.");
      }
      if (Object.keys(filters).some((key) => !LOCKING_FILTERS.includes(key))) {
        throw new TypeError("Unsupported locking invitation filter.");
      }
      // The locking read answers the rows as committed when the lock is granted. A row whose status changed while the
      // lock waited (another request accepted or revoked it) is left out, whether or not the database re-checked it.
      const rows = await workspaceInvites.lockWhere(filters, options);
      return filters.status === undefined ? rows : rows.filter((row) => row.status === filters.status);
    }
    return workspaceInvites.queryAll({ filters, ...(includeWorkspace ? { include: ["workspace"] } : {}) }, options);
  }

  async function patchInvite(id, changes, options) {
    await workspaceInvites.patch(id, changes, { ...options, returning: "none" });
  }

  async function lockWorkspaceForInvitations(workspaceId, options = {}) {
    if (!await workspaces.lock(workspaceId, { ...options, missing: "skip" })) {
      throw new AppError(404, "Invitation workspace no longer exists.", { code: "workspaces.invite.workspaceMissing" });
    }
  }

  // An invite in any status, or null.
  async function findById(inviteId, options = {}) {
    const id = normalizeRecordId(inviteId, { fallback: null });
    if (!id) {
      return null;
    }

    const rows = await queryInvites({ id }, options);
    return normalizeInviteRecord(rows[0] || null);
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

  /**
   * One page of the workspace's pending invites, newest first (then oldest id), each with its workspace as
   * listPendingByWorkspaceIdWithWorkspace reads it: `{ invites, next }`, where `next` is the cursor of the page after,
   * or null on the last page. It reads one page however many invites are pending.
   * @param {unknown} workspaceId
   * @param {{ size: number, after?: string }} page At most the invites handle's pageLimits().request invites.
   * @param {object} [options]
   */
  async function listPendingPageByWorkspaceId(workspaceId, { size, after }, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return { invites: [], next: null };
    }

    const { records, page } = await workspaceInvites.query(
      {
        filters: { workspace: normalizedWorkspaceId, status: "pending" },
        sort: ["-createdAt", "id"],
        include: ["workspace"],
        page: {
          size: Math.min(Number(size), workspaceInvites.pageLimits().request),
          ...(after === undefined ? {} : { after })
        }
      },
      options
    );
    return { invites: records.map(normalizeInviteWithWorkspace).filter(Boolean), next: page.next };
  }

  async function insert(payload, options = {}) {
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
      const created = await workspaceInvites.create(
        {
          email: createPayload.email,
          roleSid: createPayload.roleSid,
          status: createPayload.status,
          tokenHash: createPayload.tokenHash,
          expiresAt: createPayload.expiresAt == null ? null : toIsoString(createPayload.expiresAt),
          acceptedAt: null,
          revokedAt: null,
          createdAt,
          updatedAt: createdAt,
          workspaceId: createPayload.workspaceId,
          invitedByUserId: createPayload.invitedByUserId ?? null
        },
        options
      );

      return normalizeInviteRecord(created);
    } catch (error) {
      if (!isLostDuplicateInsertRace(error, options)) {
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

    // queryInvites returns the rows in id order, compared by the database, so the newest is the last.
    return normalizeInviteRecord(rows.at(-1) || null);
  }

  async function expirePendingByWorkspaceIdAndEmail(workspaceId, email, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return;
    }

    await workspaceInvites.withTransaction(options, async (txOptions) => {
      await lockWorkspaceForInvitations(normalizedWorkspaceId, txOptions);
      // One write for every pending invite of the email, however many there are; the handle stamps updatedAt.
      await workspaceInvites.patchWhere(
        { workspace: normalizedWorkspaceId, email: normalizeLowerText(email), status: "pending" },
        { status: "expired" },
        { ...txOptions, returning: "none" }
      );
    });
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
        throw new AppError(404, "Invitation not found or already handled.", {
          code: "workspaces.invite.invitationNotFoundOrHandled"
        });
      }
      workspaceId = normalizeInviteRecord(candidate[0]).workspaceId;
    }
    await workspaceInvites.withTransaction(options, async (txOptions) => {
      const invite = await findPendingByIdForWorkspace(id, workspaceId, { ...txOptions, workspaceId, lock: true });
      if (!invite) {
        throw new AppError(404, "Invitation not found or already handled.", {
          code: "workspaces.invite.invitationNotFoundOrHandled"
        });
      }
      const updatedAt = new Date().toISOString();
      await patchInvite(
        id,
        {
          status,
          [status === "accepted" ? "acceptedAt" : "revokedAt"]: updatedAt,
          updatedAt
        },
        txOptions
      );
    });
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
    withTransaction: workspaceInvites.withTransaction,
    lockWorkspaceForInvitations,
    findById,
    findPendingByTokenHash,
    findByTokenHashWithWorkspace,
    listPendingByEmail,
    listPendingByWorkspaceIdWithWorkspace,
    listPendingPageByWorkspaceId,
    insert,
    expirePendingByWorkspaceIdAndEmail,
    markAcceptedById,
    revokeById,
    findPendingByIdForWorkspace
  });
}

export { createRepository, normalizeInviteRecord, normalizeInviteWithWorkspace };
