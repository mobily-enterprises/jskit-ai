import { isLostDuplicateInsertRace, toIsoString } from "@jskit-ai/database-runtime/shared";
import { normalizeLowerText, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

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

// Lower ids first; ids that are not numbers in text order.
function byId(left, right) {
  const leftId = Number(left?.id);
  const rightId = Number(right?.id);
  if (Number.isFinite(leftId) && Number.isFinite(rightId)) {
    return leftId - rightId;
  }
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

/**
 * The `workspaces` capability: the workspaces table's records. Every method
 * takes the caller's options last and joins their transaction.
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.workspaces The workspaces table's handle.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.workspaceMemberships
 *   The workspace_memberships table's handle, for a user's workspaces.
 */
function createRepository({ workspaces, workspaceMemberships }) {
  async function queryFirst(filters, options) {
    const { records } = await workspaces.query({ filters, page: { size: 1 } }, options);
    return normalizeWorkspaceRecord(records[0] || null);
  }

  async function findById(workspaceId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return null;
    }

    return queryFirst({ id: normalizedWorkspaceId }, options);
  }

  // A deleted workspace keeps its slug, so the slug stays taken, but it is not found by it.
  async function findBySlug(slug, options = {}) {
    const normalizedSlug = typeof slug === "string" ? slug.trim().toLowerCase() : "";
    if (!normalizedSlug) {
      return null;
    }

    return queryFirst({ slug: normalizedSlug, deletedAt: null }, options);
  }

  /**
   * Which of these slugs workspaces already hold, in one read however many do.
   * @param {string[]} slugs
   * @param {object} [options]
   * @returns {Promise<Set<string>>}
   */
  async function listSlugsIn(slugs, options = {}) {
    const normalizedSlugs = [...new Set(
      (Array.isArray(slugs) ? slugs : []).map((slug) => normalizeLowerText(slug)).filter(Boolean)
    )];
    if (normalizedSlugs.length < 1) {
      return new Set();
    }

    const rows = await workspaces.queryAll({ filters: { slugs: normalizedSlugs } }, options);
    return new Set(rows.map((row) => normalizeLowerText(row.slug)));
  }

  /**
   * The workspaces with these ids, in one read however many, sorted by id. An id naming no workspace is left out; a
   * deleted workspace is kept, as findById keeps it.
   * @param {unknown[]} workspaceIds
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} [options]
   */
  async function listByIds(workspaceIds, options = {}) {
    if (!Array.isArray(workspaceIds)) {
      throw new TypeError("workspaces.listByIds() takes a list of workspace ids.");
    }
    const ids = [...new Set(workspaceIds.map((id) => normalizeRecordId(id, { fallback: null })).filter(Boolean))];
    if (ids.length < 1) {
      return [];
    }
    const rows = await workspaces.queryAll({ filters: { id: ids } }, options);
    return rows.map((row) => normalizeWorkspaceRecord(row)).filter(Boolean).sort(byId);
  }

  async function findPersonalByOwnerUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return null;
    }

    const rows = await workspaces.queryAll({ filters: { owner: normalizedUserId, isPersonal: true } }, options);
    const normalizedRows = rows.map((row) => normalizeWorkspaceRecord(row)).filter(Boolean);
    normalizedRows.sort(byId);
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
      const created = await workspaces.create(
        {
          ...createPayload,
          createdAt,
          updatedAt: createdAt,
          ownerUserId
        },
        options
      );

      return normalizeWorkspaceRecord(created);
    } catch (error) {
      if (!isLostDuplicateInsertRace(error, options)) {
        throw error;
      }
      if (!Object.hasOwn(createPayload, "slug")) {
        throw error;
      }

      // A create lost to the same owner's identical create, such as a personal workspace made twice at a first
      // sign-in, answers that workspace. Another owner's workspace is never answered: the caller picks another slug.
      const bySlug = await findBySlug(createPayload.slug, options);
      if (bySlug && bySlug.ownerUserId === ownerUserId && bySlug.isPersonal === (createPayload.isPersonal === true)) {
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
    if (Object.hasOwn(sourcePatch, "ownerUserId")) {
      workspacePatch.ownerUserId = normalizeRecordId(sourcePatch.ownerUserId, { fallback: null });
    }

    return normalizeWorkspaceRecord(await workspaces.patch(normalizedWorkspaceId, workspacePatch, options));
  }

  async function listForUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return [];
    }

    const rows = await workspaceMemberships.queryAll(
      { filters: { user: normalizedUserId, status: "active" }, include: ["workspace"] },
      options
    );

    const userWorkspaces = rows
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

    userWorkspaces.sort((left, right) => {
      if (left.isPersonal !== right.isPersonal) {
        return left.isPersonal ? -1 : 1;
      }
      return byId(left, right);
    });

    return userWorkspaces;
  }

  /**
   * Locks a workspace's row until the caller's transaction ends, so work that
   * must not interleave for one workspace takes turns. It needs an active
   * transaction: pass the txOptions of withTransaction. A missing workspace
   * throws json-rest-api's not-found error, or answers null with
   * `missing: "skip"`.
   * @param {unknown} workspaceId
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions & { missing?: "throw" | "skip" }} options
   * @returns {Promise<{ id: string } | null>} The locked workspace.
   */
  async function lock(workspaceId, options = {}) {
    const id = normalizeRecordId(workspaceId, { fallback: null });
    if (!id) {
      throw new TypeError("Locking a workspace requires workspaceId.");
    }
    const row = await workspaces.lock(id, options);
    return row ? { id: normalizeRecordId(row.id, { fallback: null }) } : null;
  }

  /**
   * The workspaces as a join source for another owner's report, so it reads them in its own statement: the scoped
   * workspaces under `alias`, matching `filters` (this resource's search fields; a deleted workspace is in it unless
   * the report filters on `column("deletedAt")`), and each field's column under that alias. It answers the builder
   * wrapped, since a builder is thenable.
   * @param {{ alias: string, filters?: object }} params
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} [options]
   * @returns {Promise<{ query: object, column: (field: string) => string }>}
   */
  // Knex: subquery - another owner's report joins the workspaces it reads, in one statement
  async function joinSource({ alias, filters }, options = {}) {
    if (typeof alias !== "string" || !alias) {
      throw new TypeError("workspaces.joinSource() needs the alias the report joins the workspaces under.");
    }
    const { query } = await workspaces.scopedQuery({ alias, ...(filters === undefined ? {} : { filters }) }, options);
    return { query, column: (field) => workspaces.column(field, alias) };
  }

  return Object.freeze({
    withTransaction: workspaces.withTransaction,
    joinSource,
    findById,
    listByIds,
    findBySlug,
    listSlugsIn,
    findPersonalByOwnerUserId,
    insert,
    updateById,
    listForUserId,
    lock
  });
}

export { createRepository };
