import { createCrudResourceRuntime } from "@jskit-ai/crud-core/server/resourceRuntime";
import {
  normalizeLowerText,
  normalizeRecordId,
  normalizeDbRecordId,
  normalizeText,
  isDuplicateEntryError
} from "./repositoryUtils.js";
import { OWNER_ROLE_ID } from "../../../shared/roles.js";
import { workspaceMembershipsResource } from "../resources/workspaceMembershipsResource.js";

const REPOSITORY_CONFIG = Object.freeze({
  context: "internal.repository.workspace-memberships"
});

function normalizeMembershipRecord(payload) {
  if (!payload) {
    return null;
  }
  return workspaceMembershipsResource.operations.view.outputValidator.normalize(payload);
}

function normalizeMembershipPatchPayload(payload = {}) {
  return workspaceMembershipsResource.operations.patch.bodyValidator.normalize(payload);
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

function createRepository(knex) {
  if (typeof knex !== "function") {
    throw new TypeError("workspaceMembershipsRepository requires knex.");
  }
  const resourceRuntime = createCrudResourceRuntime(workspaceMembershipsResource, knex, REPOSITORY_CONFIG);
  const withTransaction = resourceRuntime.withTransaction;

  async function findByWorkspaceIdAndUserId(workspaceId, userId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedWorkspaceId || !normalizedUserId) {
      return null;
    }

    const client = options?.trx || knex;
    const row = await client("workspace_memberships")
      .where({ workspace_id: normalizedWorkspaceId, user_id: normalizedUserId })
      .first();
    return normalizeMembershipRecord(row);
  }

  async function ensureOwnerMembership(workspaceId, userId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedWorkspaceId || !normalizedUserId) {
      throw new TypeError("workspaceMembershipsRepository.ensureOwnerMembership requires workspaceId and userId.");
    }

    const client = options?.trx || knex;
    const existing = await findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, { trx: client });
    if (existing) {
      if (existing.roleSid !== OWNER_ROLE_ID || existing.status !== "active") {
        await resourceRuntime.updateById(
          existing.id,
          {
            roleSid: OWNER_ROLE_ID,
            status: "active"
          },
          {
            ...options,
            trx: client,
            include: "none",
            existingRecord: existing
          }
        );
      }
      return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, { trx: client });
    }

    try {
      await resourceRuntime.create(
        {
          workspaceId: normalizedWorkspaceId,
          userId: normalizedUserId,
          roleSid: OWNER_ROLE_ID,
          status: "active"
        },
        {
          ...options,
          trx: client,
          include: "none"
        }
      );
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }
    }

    return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, { trx: client });
  }

  async function upsertMembership(workspaceId, userId, patch = {}, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedWorkspaceId || !normalizedUserId) {
      throw new TypeError("workspaceMembershipsRepository.upsertMembership requires workspaceId and userId.");
    }

    const client = options?.trx || knex;
    const existing = await findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, { trx: client });
    const normalizedPatch = normalizeMembershipPatchPayload({
      roleSid: patch?.roleSid ?? existing?.roleSid ?? "member",
      status: patch?.status ?? existing?.status ?? "active"
    });
    const roleSid = normalizeLowerText(normalizedPatch.roleSid || "member") || "member";
    const status = normalizeLowerText(normalizedPatch.status || "active") || "active";

    if (!existing) {
      try {
        await resourceRuntime.create(
          {
            workspaceId: normalizedWorkspaceId,
            userId: normalizedUserId,
            roleSid,
            status
          },
          {
            ...options,
            trx: client,
            include: "none"
          }
        );
      } catch (error) {
        if (!isDuplicateEntryError(error)) {
          throw error;
        }
      }
      return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, { trx: client });
    }

    await resourceRuntime.updateById(
      existing.id,
      {
        roleSid,
        status
      },
      {
        ...options,
        trx: client,
        include: "none",
        existingRecord: existing
      }
    );

    return findByWorkspaceIdAndUserId(normalizedWorkspaceId, normalizedUserId, { trx: client });
  }

  async function listActiveByWorkspaceId(workspaceId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return [];
    }

    const client = options?.trx || knex;
    const rows = await client("workspace_memberships as wm")
      .join("users as up", "up.id", "wm.user_id")
      .where({ "wm.workspace_id": normalizedWorkspaceId, "wm.status": "active" })
      .orderBy("up.display_name", "asc")
      .select([
        "wm.user_id",
        "wm.role_sid",
        "wm.status",
        "up.display_name",
        "up.email"
      ]);

    return rows.map(normalizeMemberSummaryRow).filter(Boolean);
  }

  async function listActiveWorkspaceIdsByUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return [];
    }

    const client = options?.trx || knex;
    const rows = await client("workspace_memberships")
      .where({
        user_id: normalizedUserId,
        status: "active"
      })
      .select("workspace_id")
      .orderBy("workspace_id", "asc");

    return rows
      .map((row) => normalizeDbRecordId(row.workspace_id, { fallback: null }))
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
