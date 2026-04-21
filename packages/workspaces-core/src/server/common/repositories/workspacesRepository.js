import { createCrudResourceRuntime } from "@jskit-ai/crud-core/server/resourceRuntime";
import {
  normalizeRecordId,
  normalizeText,
  normalizeLowerText,
  isDuplicateEntryError
} from "./repositoryUtils.js";
import { workspacesResource } from "../resources/workspacesResource.js";

const REPOSITORY_CONFIG = Object.freeze({
  context: "internal.repository.workspaces"
});

function normalizeWorkspaceRecord(payload) {
  if (!payload) {
    return null;
  }
  return workspacesResource.operations.view.outputValidator.normalize(payload);
}

function normalizeCreatePayload(payload = {}) {
  return workspacesResource.operations.create.bodyValidator.normalize(payload);
}

function normalizeMembershipWorkspaceRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...normalizeWorkspaceRecord(row),
    roleSid: normalizeLowerText(row.role_sid || "member"),
    membershipStatus: normalizeLowerText(row.membership_status || "active") || "active"
  };
}

function createRepository(knex) {
  if (typeof knex !== "function") {
    throw new TypeError("workspacesRepository requires knex.");
  }
  const resourceRuntime = createCrudResourceRuntime(workspacesResource, knex, REPOSITORY_CONFIG);
  const withTransaction = resourceRuntime.withTransaction;

  function workspaceSelectColumns({ includeMembership = false } = {}) {
    const columns = [
      "w.id",
      "w.slug",
      "w.name",
      "w.owner_user_id",
      "w.is_personal",
      "w.avatar_url",
      "w.created_at",
      "w.updated_at",
      "w.deleted_at"
    ];
    if (includeMembership) {
      columns.push("wm.role_sid", "wm.status as membership_status");
    }
    return columns;
  }

  async function findById(workspaceId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return null;
    }

    return resourceRuntime.findById(normalizedWorkspaceId, {
      ...options,
      include: "none"
    });
  }

  async function findBySlug(slug, options = {}) {
    const client = options?.trx || knex;
    const normalizedSlug = normalizeLowerText(slug);
    if (!normalizedSlug) {
      return null;
    }

    const row = await client("workspaces as w")
      .where({ "w.slug": normalizedSlug })
      .select(workspaceSelectColumns())
      .first();
    return normalizeWorkspaceRecord(row);
  }

  async function findPersonalByOwnerUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return null;
    }

    const client = options?.trx || knex;
    const row = await client("workspaces as w")
      .where({ "w.owner_user_id": normalizedUserId, "w.is_personal": 1 })
      .orderBy("w.id", "asc")
      .select(workspaceSelectColumns())
      .first();
    return normalizeWorkspaceRecord(row);
  }

  async function insert(payload = {}, options = {}) {
    const client = options?.trx || knex;
    const normalizedPayload = normalizeCreatePayload(payload);
    const ownerUserId = normalizeRecordId(normalizedPayload.ownerUserId, { fallback: null });
    if (!ownerUserId) {
      throw new TypeError("workspacesRepository.insert requires ownerUserId.");
    }

    const createPayload = {
      ...normalizedPayload,
      ownerUserId,
      isPersonal: normalizedPayload.isPersonal === true,
      avatarUrl: normalizeText(normalizedPayload.avatarUrl)
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
      const bySlug = await findBySlug(createPayload.slug, { trx: client });
      if (bySlug) {
        return bySlug;
      }
      throw error;
    }
  }

  async function updateById(workspaceId, patch = {}, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return null;
    }

    return resourceRuntime.updateById(normalizedWorkspaceId, patch, {
      ...options,
      include: "none"
    });
  }

  async function listForUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return [];
    }

    const client = options?.trx || knex;
    const rows = await client("workspace_memberships as wm")
      .join("workspaces as w", "w.id", "wm.workspace_id")
      .where({ "wm.user_id": normalizedUserId })
      .whereNull("w.deleted_at")
      .orderBy("w.is_personal", "desc")
      .orderBy("w.id", "asc")
      .select(workspaceSelectColumns({ includeMembership: true }));

    return rows.map(normalizeMembershipWorkspaceRow).filter(Boolean);
  }

  return Object.freeze({
    withTransaction,
    findById,
    findBySlug,
    findPersonalByOwnerUserId,
    insert,
    updateById,
    listForUserId
  });
}

export { createRepository, normalizeWorkspaceRecord, normalizeMembershipWorkspaceRow };
