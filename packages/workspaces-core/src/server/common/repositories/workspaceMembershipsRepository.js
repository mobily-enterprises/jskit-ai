import {
  isLostDuplicateInsertRace,
  normalizeDbRecordId,
  resolveTransaction,
  retryDeadlocks,
  toIsoString
} from "@jskit-ai/database-runtime/shared";
import { normalizeLowerText, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  createJsonRestContext,
  queryAllJsonRestCollectionRows
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { OWNER_ROLE_ID } from "../../../shared/roles.js";

// A bulk read's users per query, so its "in" list stays well inside every database's limits.
const USER_IDS_PER_QUERY = 1000;

function normalizeMembershipRecord(payload) {
  if (!payload) {
    return null;
  }

  return {
    id: normalizeDbRecordId(payload.id, { fallback: null }),
    workspaceId: normalizeDbRecordId(payload?.workspace?.id || payload?.workspaceId, { fallback: null }),
    userId: normalizeDbRecordId(payload?.user?.id || payload?.userId, { fallback: null }),
    roleSid: normalizeLowerText(payload.roleSid || "member") || "member",
    status: normalizeLowerText(payload.status || "active") || "active",
    createdAt: payload.createdAt ? toIsoString(payload.createdAt) : null,
    updatedAt: payload.updatedAt ? toIsoString(payload.updatedAt) : null
  };
}

function normalizeMemberSummaryRow(row) {
  if (!row) {
    return null;
  }

  return {
    userId: normalizeDbRecordId(row.user_id, { fallback: "" }),
    roleSid: normalizeLowerText(row.role_sid || "member") || "member",
    status: normalizeLowerText(row.status || "active") || "active",
    displayName: normalizeText(row.display_name),
    email: normalizeLowerText(row.email)
  };
}

// A membership read with its user included, as a member summary.
function memberSummaryFromMembership(row) {
  if (!row) {
    return null;
  }

  return normalizeMemberSummaryRow({
    user_id: row.user?.id,
    role_sid: row.roleSid,
    status: row.status,
    display_name: row.user?.displayName,
    email: row.user?.email
  });
}

/** @param {{ api: import("@jskit-ai/json-rest-api-core/server/types").RuntimeJsonRestApi }} dependencies */
function createRepository({ api }) {
  const withTransaction = (work) => retryDeadlocks(() => api.transaction(work));

  async function queryMemberships(filters = {}, options = {}, { include = [] } = {}) {
    const normalizedInclude = Array.from(
      new Set(
        (Array.isArray(include) ? include : [])
          .map((entry) => normalizeText(entry))
          .filter(Boolean)
      )
    );
    return queryAllJsonRestCollectionRows(
      api.resources.workspaceMemberships,
      {
        queryParams: {
          filters,
          ...(normalizedInclude.length > 0 ? { include: normalizedInclude } : {})
        },
        transaction: resolveTransaction(options),
        format: "plain"
      },
      options.context
    );
  }

  async function findByWorkspaceIdAndUserId(workspaceId, userId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedWorkspaceId || !normalizedUserId) {
      return null;
    }

    const rows = await queryMemberships(
      {
        workspace: normalizedWorkspaceId,
        user: normalizedUserId
      },
      options,
      { include: ["workspace", "user"] }
    );

    return normalizeMembershipRecord(rows[0] || null);
  }

  async function ensureOwnerMembership(workspaceId, userId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedWorkspaceId || !normalizedUserId) {
      throw new TypeError("workspaceMembershipsRepository.ensureOwnerMembership requires workspaceId and userId.");
    }

    const existing = await findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, options);
    if (existing) {
      if (existing.roleSid !== OWNER_ROLE_ID || existing.status !== "active") {
        const updatedAt = new Date().toISOString();
        await api.resources.workspaceMemberships.patch(
          {
            id: existing.id,
            data: {
              roleSid: OWNER_ROLE_ID,
              status: "active",
              updatedAt
            },
            format: "plain",
            returning: "full",
            transaction: resolveTransaction(options)
          },
          createJsonRestContext(options.context)
        );
      }
      return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, options);
    }

    try {
      const createdAt = new Date().toISOString();
      await api.resources.workspaceMemberships.post(
        {
          data: {
            roleSid: OWNER_ROLE_ID,
            status: "active",
            createdAt,
            updatedAt: createdAt,
            workspace: normalizedWorkspaceId,
            user: normalizedUserId
          },
          format: "plain",
          returning: "full",
          transaction: resolveTransaction(options)
        },
        createJsonRestContext(options.context)
      );
    } catch (error) {
      if (!isLostDuplicateInsertRace(error, options)) {
        throw error;
      }
    }

    return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, options);
  }

  async function upsertMembership(workspaceId, userId, patch, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedWorkspaceId || !normalizedUserId) {
      throw new TypeError("workspaceMembershipsRepository.upsertMembership requires workspaceId and userId.");
    }

    const existing = await findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, options);
    const roleSid = normalizeLowerText(patch?.roleSid ?? existing?.roleSid) || "member";
    const status = normalizeLowerText(patch?.status ?? existing?.status) || "active";

    if (!existing) {
      try {
        const createdAt = new Date().toISOString();
        await api.resources.workspaceMemberships.post(
          {
            data: {
              roleSid,
              status,
              createdAt,
              updatedAt: createdAt,
              workspace: normalizedWorkspaceId,
              user: normalizedUserId
            },
            format: "plain",
            returning: "full",
            transaction: resolveTransaction(options)
          },
          createJsonRestContext(options.context)
        );
      } catch (error) {
        if (!isLostDuplicateInsertRace(error, options)) {
          throw error;
        }
      }
      return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, options);
    }

    const updatedAt = new Date().toISOString();
    await api.resources.workspaceMemberships.patch(
      {
        id: existing.id,
        data: {
          roleSid,
          status,
          updatedAt
        },
        format: "plain",
        returning: "full",
        transaction: resolveTransaction(options)
      },
      createJsonRestContext(options.context)
    );

    return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, options);
  }

  async function listActiveByWorkspaceId(workspaceId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return [];
    }

    const rows = await queryMemberships(
      {
        workspace: normalizedWorkspaceId,
        status: "active"
      },
      options,
      { include: ["user"] }
    );

    const members = rows.map(memberSummaryFromMembership).filter(Boolean);

    members.sort((left, right) => String(left.displayName || "").localeCompare(String(right.displayName || "")));
    return members;
  }

  // One active member's summary, as listActiveByWorkspaceId lists it, or null. Its cost does not grow
  // with the workspace's members.
  async function findActiveByWorkspaceIdAndUserId(workspaceId, userId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedWorkspaceId || !normalizedUserId) {
      return null;
    }

    const rows = await queryMemberships(
      {
        workspace: normalizedWorkspaceId,
        user: normalizedUserId,
        status: "active"
      },
      options,
      { include: ["user"] }
    );

    return memberSummaryFromMembership(rows[0] || null);
  }

  async function listActiveWorkspaceIdsByUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return [];
    }

    const rows = await queryMemberships(
      {
        user: normalizedUserId,
        status: "active"
      },
      options,
      { include: ["workspace"] }
    );

    return rows
      .map((row) => normalizeDbRecordId(row?.workspace?.id || row?.workspaceId, { fallback: null }))
      .filter(Boolean);
  }

  /**
   * Each user's active workspace ids, as listActiveWorkspaceIdsByUserId lists them, in one
   * query per 1,000 users: its cost does not grow with the users asked about. It reads the
   * memberships' workspace_id column instead of including each workspace.
   * @param {Iterable<string | number>} userIds
   * @param {object} [options]
   * @returns {Promise<Map<string, string[]>>} Every asked user, with no workspaces when they have none.
   */
  async function listActiveWorkspaceIdsByUserIds(userIds, options = {}) {
    const workspaceIdsByUserId = new Map();
    for (const userId of userIds) {
      const normalizedUserId = normalizeRecordId(userId, { fallback: null });
      if (normalizedUserId) workspaceIdsByUserId.set(normalizedUserId, []);
    }

    const normalizedUserIds = [...workspaceIdsByUserId.keys()];
    for (let start = 0; start < normalizedUserIds.length; start += USER_IDS_PER_QUERY) {
      const rows = await queryMemberships(
        {
          users: normalizedUserIds.slice(start, start + USER_IDS_PER_QUERY),
          status: "active"
        },
        options
      );
      for (const row of rows) {
        const userId = normalizeDbRecordId(row?.user?.id || row?.userId, { fallback: null });
        const workspaceId = normalizeDbRecordId(row?.workspace?.id || row?.workspaceId, { fallback: null });
        if (workspaceId) workspaceIdsByUserId.get(userId)?.push(workspaceId);
      }
    }
    return workspaceIdsByUserId;
  }

  return Object.freeze({
    withTransaction,
    findByWorkspaceIdAndUserId,
    ensureOwnerMembership,
    upsertMembership,
    listActiveByWorkspaceId,
    findActiveByWorkspaceIdAndUserId,
    listActiveWorkspaceIdsByUserId,
    listActiveWorkspaceIdsByUserIds
  });
}

export { createRepository, normalizeMembershipRecord, normalizeMemberSummaryRow };
