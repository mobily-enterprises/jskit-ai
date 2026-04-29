import {
  createWithTransaction,
  normalizeLowerText,
  normalizeRecordId,
  normalizeDbRecordId,
  normalizeText,
  isDuplicateEntryError,
  toIsoString
} from "./repositoryUtils.js";
import { OWNER_ROLE_ID } from "../../../shared/roles.js";

function normalizeMembershipRecord(payload) {
  if (!payload) {
    return null;
  }

  return {
    id: normalizeDbRecordId(payload.id, { fallback: null }),
    workspaceId: normalizeDbRecordId(payload?.workspace?.id, { fallback: null }),
    userId: normalizeDbRecordId(payload?.user?.id, { fallback: null }),
    roleSid: normalizeLowerText(payload.roleSid || "member") || "member",
    status: normalizeLowerText(payload.status || "active") || "active",
    createdAt: payload.createdAt ? toIsoString(payload.createdAt) : null,
    updatedAt: payload.updatedAt ? toIsoString(payload.updatedAt) : null
  };
}

function normalizeMembershipPatchPayload(payload = {}) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const normalized = {};

  if (Object.hasOwn(source, "roleSid")) {
    normalized.roleSid = normalizeLowerText(source.roleSid);
  }
  if (Object.hasOwn(source, "status")) {
    normalized.status = normalizeLowerText(source.status);
  }

  return normalized;
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

function createRepository({ api, knex } = {}) {
  if (!api?.resources?.workspaceMemberships) {
    throw new TypeError("workspaceMembershipsRepository requires json-rest-api workspaceMemberships resource.");
  }
  if (typeof knex !== "function") {
    throw new TypeError("workspaceMembershipsRepository requires knex.");
  }

  const withTransaction = createWithTransaction(knex);

  async function queryMemberships(filters = {}, options = {}, { includeUser = false } = {}) {
    const result = await api.resources.workspaceMemberships.query({
      queryParams: {
        filters,
        ...(includeUser ? { include: ["user"] } : {})
      },
      transaction: options?.trx,
      simplified: true
    });

    return Array.isArray(result?.data) ? result.data : [];
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
      options
    );

    return normalizeMembershipRecord(rows[0] || null);
  }

  async function ensureOwnerMembership(workspaceId, userId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedWorkspaceId || !normalizedUserId) {
      throw new TypeError("workspaceMembershipsRepository.ensureOwnerMembership requires workspaceId and userId.");
    }

    const existing = await findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, { trx: options?.trx });
    if (existing) {
      if (existing.roleSid !== OWNER_ROLE_ID || existing.status !== "active") {
        await api.resources.workspaceMemberships.patch({
          id: existing.id,
          roleSid: OWNER_ROLE_ID,
          status: "active",
          updatedAt: new Date(),
          transaction: options?.trx
        });
      }
      return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, { trx: options?.trx });
    }

    try {
      await api.resources.workspaceMemberships.post({
        workspace: normalizedWorkspaceId,
        user: normalizedUserId,
        roleSid: OWNER_ROLE_ID,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
        transaction: options?.trx
      });
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }
    }

    return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, { trx: options?.trx });
  }

  async function upsertMembership(workspaceId, userId, patch = {}, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedWorkspaceId || !normalizedUserId) {
      throw new TypeError("workspaceMembershipsRepository.upsertMembership requires workspaceId and userId.");
    }

    const existing = await findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, { trx: options?.trx });
    const normalizedPatch = normalizeMembershipPatchPayload({
      roleSid: patch?.roleSid ?? existing?.roleSid ?? "member",
      status: patch?.status ?? existing?.status ?? "active"
    });
    const roleSid = normalizeLowerText(normalizedPatch.roleSid || "member") || "member";
    const status = normalizeLowerText(normalizedPatch.status || "active") || "active";

    if (!existing) {
      try {
        await api.resources.workspaceMemberships.post({
          workspace: normalizedWorkspaceId,
          user: normalizedUserId,
          roleSid,
          status,
          createdAt: new Date(),
          updatedAt: new Date(),
          transaction: options?.trx
        });
      } catch (error) {
        if (!isDuplicateEntryError(error)) {
          throw error;
        }
      }
      return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, { trx: options?.trx });
    }

    await api.resources.workspaceMemberships.patch({
      id: existing.id,
      roleSid,
      status,
      updatedAt: new Date(),
      transaction: options?.trx
    });

    return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, { trx: options?.trx });
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
      { includeUser: true }
    );

    const members = rows
      .map((row) => normalizeMemberSummaryRow({
        user_id: row?.user?.id,
        role_sid: row?.roleSid,
        status: row?.status,
        display_name: row?.user?.displayName,
        email: row?.user?.email
      }))
      .filter(Boolean);

    members.sort((left, right) => String(left.displayName || "").localeCompare(String(right.displayName || "")));
    return members;
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
      options
    );

    return rows
      .map((row) => normalizeDbRecordId(row?.workspace?.id, { fallback: null }))
      .filter(Boolean);
  }

  return Object.freeze({
    withTransaction,
    findByWorkspaceIdAndUserId,
    ensureOwnerMembership,
    upsertMembership,
    listActiveByWorkspaceId,
    listActiveWorkspaceIdsByUserId
  });
}

export { createRepository, normalizeMembershipRecord, normalizeMemberSummaryRow };
