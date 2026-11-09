import { isLostDuplicateInsertRace, normalizeDbRecordId, toIsoString } from "@jskit-ai/database-runtime/shared";
import { normalizeLowerText, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
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

/**
 * The `workspaces.memberships` capability: the workspace memberships table's
 * records. Every method takes the caller's options last and joins their transaction.
 * @param {{ workspaceMemberships: import("@jskit-ai/resource-runtime/server/types").ResourceHandle }} dependencies
 *   The workspace_memberships table's handle.
 */
function createRepository({ workspaceMemberships }) {
  async function queryMemberships(filters, options, { include = [] } = {}) {
    return workspaceMemberships.queryAll({ filters, ...(include.length > 0 ? { include } : {}) }, options);
  }

  // A new membership, or nothing when a standalone insert lost to another one (the caller reads the winner).
  async function createMembership(attributes, options) {
    const createdAt = new Date().toISOString();
    try {
      await workspaceMemberships.create({ ...attributes, createdAt, updatedAt: createdAt }, { ...options, returning: "none" });
    } catch (error) {
      if (!isLostDuplicateInsertRace(error, options)) {
        throw error;
      }
    }
  }

  async function patchMembership(id, changes, options) {
    await workspaceMemberships.patch(id, { ...changes, updatedAt: new Date().toISOString() }, { ...options, returning: "none" });
  }

  async function findByWorkspaceIdAndUserId(workspaceId, userId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedWorkspaceId || !normalizedUserId) {
      return null;
    }

    const rows = await queryMemberships({ workspace: normalizedWorkspaceId, user: normalizedUserId }, options);
    return normalizeMembershipRecord(rows[0] || null);
  }

  /**
   * The membership as findByWorkspaceIdAndUserId reads it, locked until the caller's transaction ends, or null. Another
   * change of the same membership that locks it first waits, and then reads what this one left.
   * @param {unknown} workspaceId
   * @param {unknown} userId
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options The caller's transaction.
   */
  async function lockByWorkspaceIdAndUserId(workspaceId, userId, options) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedWorkspaceId || !normalizedUserId) {
      return null;
    }

    const [row] = await workspaceMemberships.lockWhere({ workspace: normalizedWorkspaceId, user: normalizedUserId }, options);
    return normalizeMembershipRecord(row || null);
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
        await patchMembership(existing.id, { roleSid: OWNER_ROLE_ID, status: "active" }, options);
      }
      return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, options);
    }

    await createMembership(
      { roleSid: OWNER_ROLE_ID, status: "active", workspaceId: normalizedWorkspaceId, userId: normalizedUserId },
      options
    );
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
      await createMembership({ roleSid, status, workspaceId: normalizedWorkspaceId, userId: normalizedUserId }, options);
      return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, options);
    }

    await patchMembership(existing.id, { roleSid, status }, options);
    return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, options);
  }

  /**
   * Makes the user an active member of the workspace with the role (`member`
   * when none is given), adding the membership or reactivating it.
   * @param {{ workspaceId: unknown, userId: unknown, roleSid?: string }} member
   * @param {object} [options]
   */
  async function addMember({ workspaceId, userId, roleSid = "member" }, options = {}) {
    return upsertMembership(workspaceId, userId, { roleSid, status: "active" }, options);
  }

  /**
   * The ids of the workspace's active members, in one read without their profiles.
   * @param {unknown} workspaceId
   * @param {object} [options]
   * @returns {Promise<string[]>}
   */
  async function activeMemberIds(workspaceId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return [];
    }

    const rows = await queryMemberships({ workspace: normalizedWorkspaceId, status: "active" }, options);
    return rows
      .map((row) => normalizeDbRecordId(row.userId, { fallback: null }))
      .filter(Boolean);
  }

  // The member summaries of a workspace's memberships the filters select, by display name, with their users in the same read.
  async function listWorkspaceMembers(workspaceId, filters, options) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return [];
    }

    const rows = await queryMemberships({ workspace: normalizedWorkspaceId, ...filters }, options, { include: ["user"] });
    const members = rows.map(memberSummaryFromMembership).filter(Boolean);

    members.sort((left, right) => String(left.displayName || "").localeCompare(String(right.displayName || "")));
    return members;
  }

  async function listActiveByWorkspaceId(workspaceId, options = {}) {
    return listWorkspaceMembers(workspaceId, { status: "active" }, options);
  }

  /**
   * Every member of a workspace whatever their membership's status, such as
   * one just removed ("revoked"), as listActiveByWorkspaceId lists the active
   * ones; each summary carries its status.
   * @param {unknown} workspaceId
   * @param {object} [options]
   */
  async function listByWorkspaceId(workspaceId, options = {}) {
    return listWorkspaceMembers(workspaceId, {}, options);
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

    const rows = await queryMemberships({ user: normalizedUserId, status: "active" }, options);
    return rows
      .map((row) => normalizeDbRecordId(row.workspaceId, { fallback: null }))
      .filter(Boolean);
  }

  /**
   * Each user's active workspace ids, as listActiveWorkspaceIdsByUserId lists them, in one
   * query per 1,000 users: its cost does not grow with the users asked about.
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
        const userId = normalizeDbRecordId(row.userId, { fallback: null });
        const workspaceId = normalizeDbRecordId(row.workspaceId, { fallback: null });
        if (workspaceId) workspaceIdsByUserId.get(userId)?.push(workspaceId);
      }
    }
    return workspaceIdsByUserId;
  }

  return Object.freeze({
    withTransaction: workspaceMemberships.withTransaction,
    // The memberships as a join source for another owner's report, which reads them in its own statement: the
    // handle's joinSource, the scoped memberships under `alias` matching `filters` (such as `{ workspace, status:
    // "active" }`).
    joinSource: workspaceMemberships.joinSource,
    findByWorkspaceIdAndUserId,
    lockByWorkspaceIdAndUserId,
    ensureOwnerMembership,
    upsertMembership,
    addMember,
    activeMemberIds,
    listActiveByWorkspaceId,
    listByWorkspaceId,
    findActiveByWorkspaceIdAndUserId,
    listActiveWorkspaceIdsByUserId,
    listActiveWorkspaceIdsByUserIds
  });
}

export { createRepository, normalizeMembershipRecord, normalizeMemberSummaryRow };
