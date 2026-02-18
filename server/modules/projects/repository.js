import { db } from "../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../../lib/dateUtils.js";

const PROJECT_STATUS_SET = new Set(["draft", "active", "archived"]);

function normalizeStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return PROJECT_STATUS_SET.has(normalized) ? normalized : "draft";
}

function mapProjectRowRequired(row) {
  if (!row) {
    throw new TypeError("mapProjectRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    name: String(row.name || ""),
    status: normalizeStatus(row.status),
    owner: String(row.owner || ""),
    notes: String(row.notes || ""),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapProjectRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapProjectRowRequired(row);
}

function normalizeCount(row) {
  const values = Object.values(row || {});
  if (!values.length) {
    return 0;
  }

  const parsed = Number(values[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function resolveQueryOptions(options = {}) {
  if (!options || typeof options !== "object") {
    return {
      trx: null
    };
  }

  return {
    trx: options.trx || null
  };
}

function createProjectsRepository(dbClient) {
  function resolveClient(options = {}) {
    const { trx } = resolveQueryOptions(options);
    return trx || dbClient;
  }

  async function repoInsert(workspaceId, payload, options = {}) {
    const client = resolveClient(options);
    const now = new Date();
    const [id] = await client("workspace_projects").insert({
      workspace_id: workspaceId,
      name: payload.name,
      status: normalizeStatus(payload.status),
      owner: payload.owner || "",
      notes: payload.notes || "",
      created_at: toMysqlDateTimeUtc(payload.createdAt ? new Date(payload.createdAt) : now),
      updated_at: toMysqlDateTimeUtc(payload.updatedAt ? new Date(payload.updatedAt) : now)
    });

    const row = await client("workspace_projects").where({ id, workspace_id: workspaceId }).first();
    return mapProjectRowRequired(row);
  }

  async function repoFindByIdForWorkspace(workspaceId, projectId, options = {}) {
    const client = resolveClient(options);
    const row = await client("workspace_projects")
      .where({ id: projectId, workspace_id: workspaceId })
      .first();

    return mapProjectRowNullable(row);
  }

  async function repoCountForWorkspace(workspaceId, options = {}) {
    const client = resolveClient(options);
    const row = await client("workspace_projects")
      .where({ workspace_id: workspaceId })
      .count({ total: "*" })
      .first();

    return normalizeCount(row);
  }

  async function repoListForWorkspace(workspaceId, page, pageSize, options = {}) {
    const client = resolveClient(options);
    const offset = (page - 1) * pageSize;

    const rows = await client("workspace_projects")
      .where({ workspace_id: workspaceId })
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(pageSize)
      .offset(offset);

    return rows.map(mapProjectRowRequired);
  }

  async function repoUpdateByIdForWorkspace(workspaceId, projectId, patch = {}, options = {}) {
    const client = resolveClient(options);
    const dbPatch = {};

    if (Object.prototype.hasOwnProperty.call(patch, "name")) {
      dbPatch.name = String(patch.name || "");
    }

    if (Object.prototype.hasOwnProperty.call(patch, "status")) {
      dbPatch.status = normalizeStatus(patch.status);
    }

    if (Object.prototype.hasOwnProperty.call(patch, "owner")) {
      dbPatch.owner = String(patch.owner || "");
    }

    if (Object.prototype.hasOwnProperty.call(patch, "notes")) {
      dbPatch.notes = String(patch.notes || "");
    }

    if (Object.keys(dbPatch).length > 0) {
      dbPatch.updated_at = toMysqlDateTimeUtc(new Date());
      await client("workspace_projects")
        .where({ id: projectId, workspace_id: workspaceId })
        .update(dbPatch);
    }

    const row = await client("workspace_projects")
      .where({ id: projectId, workspace_id: workspaceId })
      .first();

    return mapProjectRowNullable(row);
  }

  async function repoTransaction(callback) {
    if (typeof dbClient.transaction === "function") {
      return dbClient.transaction(callback);
    }

    return callback(dbClient);
  }

  return {
    insert: repoInsert,
    findByIdForWorkspace: repoFindByIdForWorkspace,
    countForWorkspace: repoCountForWorkspace,
    listForWorkspace: repoListForWorkspace,
    updateByIdForWorkspace: repoUpdateByIdForWorkspace,
    transaction: repoTransaction
  };
}

const repository = createProjectsRepository(db);

const __testables = {
  normalizeStatus,
  mapProjectRowRequired,
  mapProjectRowNullable,
  normalizeCount,
  createProjectsRepository
};

export const { insert, findByIdForWorkspace, countForWorkspace, listForWorkspace, updateByIdForWorkspace, transaction } =
  repository;
export { __testables };
