import {
  createWithTransaction,
  normalizeRecordId,
  isDuplicateEntryError,
  normalizeText,
  toIsoString
} from "./repositoryUtils.js";
import {
  createJsonApiInputRecord,
  createJsonApiRelationship,
  createJsonRestContext,
  extractJsonRestCollectionRows
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";

const RESOURCE_TYPE = "workspaces";

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

function createWorkspaceRelationships(source = {}) {
  const relationships = {};
  const ownerUserId = normalizeRecordId(source.ownerUserId, { fallback: null });

  if (ownerUserId) {
    relationships.owner = createJsonApiRelationship("userProfiles", ownerUserId);
  }

  return relationships;
}

function createRepository({ api, knex } = {}) {
  if (!api?.resources?.workspaces || !api?.resources?.workspaceMemberships) {
    throw new TypeError("workspacesRepository requires json-rest-api workspaces and workspaceMemberships resources.");
  }
  if (typeof knex !== "function") {
    throw new TypeError("workspacesRepository requires knex.");
  }

  const withTransaction = createWithTransaction(knex);

  async function queryFirst(filters = {}, options = {}) {
    const rows = extractJsonRestCollectionRows(
      await api.resources.workspaces.query(
        {
          queryParams: {
            filters
          },
          transaction: options?.trx || null,
          simplified: true
        },
        createJsonRestContext(options?.context || null)
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
          transaction: options?.trx || null,
          simplified: true
        },
        createJsonRestContext(options?.context || null)
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

  async function insert(payload = {}, options = {}) {
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
      const created = await api.resources.workspaces.post(
        {
          inputRecord: createJsonApiInputRecord(
            RESOURCE_TYPE,
            {
              ...createPayload,
              createdAt: new Date(),
              updatedAt: new Date()
            },
            {
              relationships: createWorkspaceRelationships({ ownerUserId })
            }
          ),
          transaction: options?.trx || null
        },
        createJsonRestContext(options?.context || null)
      );

      return normalizeWorkspaceRecord(created);
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
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

  async function updateById(workspaceId, patch = {}, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return null;
    }

    const sourcePatch = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    const workspacePatch = {
      ...sourcePatch,
      updatedAt: new Date()
    };
    const relationships = createWorkspaceRelationships(sourcePatch);

    const updated = await api.resources.workspaces.patch(
      {
        inputRecord: createJsonApiInputRecord(
          RESOURCE_TYPE,
          workspacePatch,
          {
            id: normalizedWorkspaceId,
            relationships
          }
        ),
        transaction: options?.trx || null
      },
      createJsonRestContext(options?.context || null)
    );

    return normalizeWorkspaceRecord(updated);
  }

  async function listForUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return [];
    }

    const rows = extractJsonRestCollectionRows(
      await api.resources.workspaceMemberships.query(
        {
          queryParams: {
            filters: {
              user: normalizedUserId,
              status: "active"
            },
            include: ["workspace"]
          },
          transaction: options?.trx || null,
          simplified: true
        },
        createJsonRestContext(options?.context || null)
      )
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
