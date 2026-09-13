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
import { OWNER_ROLE_ID } from "../../../shared/roles.js";

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

function createRepository({ api } = {}) {
  if (!api?.resources?.workspaceMemberships) {
    throw new TypeError("workspaceMembershipsRepository requires json-rest-api workspaceMemberships resource.");
  }

  const withTransaction = (work) => api.transaction(work);

  async function queryMemberships(filters = {}, options = {}, { include = [] } = {}) {
    const normalizedInclude = Array.from(
      new Set(
        (Array.isArray(include) ? include : [])
          .map((entry) => normalizeText(entry))
          .filter(Boolean)
      )
    );
    return extractJsonRestCollectionRows(
      await api.resources.workspaceMemberships.query(
        {
          queryParams: {
            filters,
            ...(normalizedInclude.length > 0 ? { include: normalizedInclude } : {})
          },
          transaction: options?.trx || null,
          format: "plain"
        },
        createJsonRestContext(options?.context || null)
      )
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
            transaction: options?.trx || null
          },
          createJsonRestContext(options?.context || null)
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
          transaction: options?.trx || null
        },
        createJsonRestContext(options?.context || null)
      );
    } catch (error) {
      if (options?.trx || error?.transactionOutcome !== "rolledBack" || !isDuplicateEntryError(error)) {
        throw error;
      }
    }

    return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, options);
  }

  async function upsertMembership(workspaceId, userId, patch = {}, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedWorkspaceId || !normalizedUserId) {
      throw new TypeError("workspaceMembershipsRepository.upsertMembership requires workspaceId and userId.");
    }

    const existing = await findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, options);
    const normalizedPatch = normalizeMembershipPatchPayload({
      roleSid: patch?.roleSid ?? existing?.roleSid ?? "member",
      status: patch?.status ?? existing?.status ?? "active"
    });
    const roleSid = normalizeLowerText(normalizedPatch.roleSid || "member") || "member";
    const status = normalizeLowerText(normalizedPatch.status || "active") || "active";

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
            transaction: options?.trx || null
          },
          createJsonRestContext(options?.context || null)
        );
      } catch (error) {
        if (options?.trx || error?.transactionOutcome !== "rolledBack" || !isDuplicateEntryError(error)) {
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
        transaction: options?.trx || null
      },
      createJsonRestContext(options?.context || null)
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
      options,
      { include: ["workspace"] }
    );

    return rows
      .map((row) => normalizeDbRecordId(row?.workspace?.id || row?.workspaceId, { fallback: null }))
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
