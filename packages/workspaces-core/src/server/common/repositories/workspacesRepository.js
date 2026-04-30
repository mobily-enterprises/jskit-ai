import {
  createSimplifiedWriteParams,
  createWithTransaction,
  normalizeRecordId,
  isDuplicateEntryError
} from "./repositoryUtils.js";

function createRepository({ api, knex } = {}) {
  if (!api?.resources?.workspaces || !api?.resources?.workspaceMemberships) {
    throw new TypeError("workspacesRepository requires json-rest-api workspaces and workspaceMemberships resources.");
  }
  if (typeof knex !== "function") {
    throw new TypeError("workspacesRepository requires knex.");
  }

  const withTransaction = createWithTransaction(knex);

  async function queryFirst(filters = {}, options = {}) {
    const result = await api.resources.workspaces.query({
      queryParams: {
        filters
      },
      transaction: options?.trx,
      simplified: true
    });

    return Array.isArray(result?.data) ? result.data[0] || null : null;
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

    const result = await api.resources.workspaces.query({
      queryParams: {
        filters: {
          owner: normalizedUserId,
          isPersonal: true
        }
      },
      transaction: options?.trx,
      simplified: true
    });

    const rows = Array.isArray(result?.data) ? [...result.data] : [];
    rows.sort((left, right) => {
      const leftId = Number(left?.id);
      const rightId = Number(right?.id);
      if (Number.isFinite(leftId) && Number.isFinite(rightId)) {
        return leftId - rightId;
      }
      return String(left?.id || "").localeCompare(String(right?.id || ""));
    });
    return rows[0] || null;
  }

  async function insert(payload = {}, options = {}) {
    const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    const ownerUserId = normalizeRecordId(source.ownerUserId, { fallback: null });
    if (!ownerUserId) {
      throw new TypeError("workspacesRepository.insert requires ownerUserId.");
    }

    const createPayload = {
      owner: ownerUserId,
      ...(Object.hasOwn(source, "slug") ? { slug: source.slug } : {}),
      ...(Object.hasOwn(source, "name") ? { name: source.name } : {}),
      ...(Object.hasOwn(source, "isPersonal") ? { isPersonal: source.isPersonal } : {}),
      ...(Object.hasOwn(source, "avatarUrl") ? { avatarUrl: source.avatarUrl } : {})
    };

    try {
      return await api.resources.workspaces.post(
        createSimplifiedWriteParams(
          {
            ...createPayload,
            createdAt: new Date(),
            updatedAt: new Date()
          },
          { trx: options?.trx }
        )
      );
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }
      if (!Object.hasOwn(createPayload, "slug")) {
        throw error;
      }

      const bySlug = await findBySlug(createPayload.slug, { trx: options?.trx });
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

    return api.resources.workspaces.patch(
      createSimplifiedWriteParams(
        {
          id: normalizedWorkspaceId,
          ...(patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {}),
          updatedAt: new Date()
        },
        { trx: options?.trx }
      )
    );
  }

  async function listForUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return [];
    }

    const result = await api.resources.workspaceMemberships.query({
      queryParams: {
        filters: {
          user: normalizedUserId,
          status: "active"
        },
        include: ["workspace"]
      },
      transaction: options?.trx,
      simplified: true
    });

    const rows = Array.isArray(result?.data) ? result.data : [];
    const workspaces = rows
      .map((row) => {
        if (!row?.workspace || row.workspace.deletedAt != null) {
          return null;
        }

        return {
          ...row.workspace,
          roleSid: row.roleSid,
          membershipStatus: row.status
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
