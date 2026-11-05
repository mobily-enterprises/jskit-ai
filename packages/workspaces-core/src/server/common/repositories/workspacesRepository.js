import { isLostDuplicateInsertRace, resolveTransaction, retryDeadlocks, toIsoString } from "@jskit-ai/database-runtime/shared";
import { normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  createJsonRestContext,
  extractJsonRestCollectionRows,
  queryAllJsonRestCollectionRows
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";

function normalizeWorkspaceRecord(payload = null) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return {
    id: normalizeRecordId(payload.id, { fallback: null }),
    slug: normalizeText(payload.slug),
    name: normalizeText(payload.name),
    ownerUserId: normalizeRecordId(payload.ownerUserId || payload?.owner?.id, { fallback: null }),
    isPersonal: payload.isPersonal === true,
    avatarUrl: normalizeText(payload.avatarUrl),
    createdAt: payload.createdAt ? toIsoString(payload.createdAt) : null,
    updatedAt: payload.updatedAt ? toIsoString(payload.updatedAt) : null,
    deletedAt: payload.deletedAt ? toIsoString(payload.deletedAt) : null
  };
}

/** @param {{ api: import("@jskit-ai/json-rest-api-core/server/types").RuntimeJsonRestApi }} dependencies */
function createRepository({ api }) {
  const withTransaction = (work) => retryDeadlocks(() => api.transaction(work));

  async function queryFirst(filters = {}, options = {}) {
    const rows = extractJsonRestCollectionRows(
      await api.resources.workspaces.query(
        {
          queryParams: {
            filters
          },
          transaction: resolveTransaction(options),
          format: "plain"
        },
        createJsonRestContext(options.context)
      )
    );

    return normalizeWorkspaceRecord(rows[0] || null);
  }

  async function findById(workspaceId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return null;
    }

    return queryFirst({ id: normalizedWorkspaceId }, options);
  }

  async function findBySlug(slug, options = {}) {
    const normalizedSlug = typeof slug === "string" ? slug.trim().toLowerCase() : "";
    if (!normalizedSlug) {
      return null;
    }

    return queryFirst({ slug: normalizedSlug }, options);
  }

  async function findPersonalByOwnerUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return null;
    }

    const rows = extractJsonRestCollectionRows(
      await api.resources.workspaces.query(
        {
          queryParams: {
            filters: {
              owner: normalizedUserId,
              isPersonal: true
            }
          },
          transaction: resolveTransaction(options),
          format: "plain"
        },
        createJsonRestContext(options.context)
      )
    );

    const normalizedRows = rows.map((row) => normalizeWorkspaceRecord(row)).filter(Boolean);
    normalizedRows.sort((left, right) => {
      const leftId = Number(left?.id);
      const rightId = Number(right?.id);
      if (Number.isFinite(leftId) && Number.isFinite(rightId)) {
        return leftId - rightId;
      }
      return String(left?.id || "").localeCompare(String(right?.id || ""));
    });
    return normalizedRows[0] || null;
  }

  async function insert(payload, options = {}) {
    const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    const ownerUserId = normalizeRecordId(source.ownerUserId, { fallback: null });
    if (!ownerUserId) {
      throw new TypeError("workspacesRepository.insert requires ownerUserId.");
    }

    const createPayload = {
      ...(Object.hasOwn(source, "slug") ? { slug: source.slug } : {}),
      ...(Object.hasOwn(source, "name") ? { name: source.name } : {}),
      ...(Object.hasOwn(source, "isPersonal") ? { isPersonal: source.isPersonal } : {}),
      ...(Object.hasOwn(source, "avatarUrl") ? { avatarUrl: source.avatarUrl } : {})
    };

    try {
      const createdAt = new Date().toISOString();
      const created = await api.resources.workspaces.post(
        {
          data: {
            ...createPayload,
            createdAt,
            updatedAt: createdAt,
            owner: ownerUserId
          },
          format: "plain",
          returning: "full",
          transaction: resolveTransaction(options)
        },
        createJsonRestContext(options.context)
      );

      return normalizeWorkspaceRecord(created);
    } catch (error) {
      if (!isLostDuplicateInsertRace(error, options)) {
        throw error;
      }
      if (!Object.hasOwn(createPayload, "slug")) {
        throw error;
      }

      const bySlug = await findBySlug(createPayload.slug, options);
      if (bySlug) {
        return bySlug;
      }
      throw error;
    }
  }

  async function updateById(workspaceId, patch, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return null;
    }

    const sourcePatch = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    const workspacePatch = {
      ...sourcePatch,
      updatedAt: new Date().toISOString()
    };
    delete workspacePatch.ownerUserId;
    if (Object.hasOwn(sourcePatch, "ownerUserId")) {
      workspacePatch.owner = normalizeRecordId(sourcePatch.ownerUserId, { fallback: null });
    }

    const updated = await api.resources.workspaces.patch(
      {
        id: normalizedWorkspaceId,
        data: workspacePatch,
        format: "plain",
        returning: "full",
        transaction: resolveTransaction(options)
      },
      createJsonRestContext(options.context)
    );

    return normalizeWorkspaceRecord(updated);
  }

  async function listForUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return [];
    }

    const rows = await queryAllJsonRestCollectionRows(
      api.resources.workspaceMemberships,
      {
        queryParams: {
          filters: {
            user: normalizedUserId,
            status: "active"
          },
          include: ["workspace"]
        },
        transaction: resolveTransaction(options),
        format: "plain"
      },
      options.context
    );

    const workspaces = rows
      .map((row) => {
        const workspace = normalizeWorkspaceRecord(row?.workspace);
        if (!workspace || workspace.deletedAt != null) {
          return null;
        }

        return {
          ...workspace,
          roleSid: row?.roleSid,
          membershipStatus: row?.status
        };
      })
      .filter(Boolean);

    workspaces.sort((left, right) => {
      if (left.isPersonal !== right.isPersonal) {
        return left.isPersonal ? -1 : 1;
      }
      const leftId = Number(left?.id);
      const rightId = Number(right?.id);
      if (Number.isFinite(leftId) && Number.isFinite(rightId)) {
        return leftId - rightId;
      }
      return String(left?.id || "").localeCompare(String(right?.id || ""));
    });

    return workspaces;
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

export { createRepository };
