import { db } from "../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../lib/dateUtils.js";

function mapWorkspaceRowRequired(row) {
  if (!row) {
    throw new TypeError("mapWorkspaceRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    avatarUrl: row.avatar_url ? String(row.avatar_url) : "",
    ownerUserId: Number(row.owner_user_id),
    isPersonal: Boolean(row.is_personal),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapWorkspaceRowNullable(row) {
  if (!row) {
    return null;
  }
  return mapWorkspaceRowRequired(row);
}

function createWorkspacesRepository(dbClient) {
  async function repoFindById(id) {
    const row = await dbClient("workspaces").where({ id }).first();
    return mapWorkspaceRowNullable(row);
  }

  async function repoFindBySlug(slug) {
    const row = await dbClient("workspaces").where({ slug }).first();
    return mapWorkspaceRowNullable(row);
  }

  async function repoFindPersonalByOwnerUserId(ownerUserId) {
    const row = await dbClient("workspaces")
      .where({
        owner_user_id: ownerUserId,
        is_personal: true
      })
      .orderBy("id", "asc")
      .first();

    return mapWorkspaceRowNullable(row);
  }

  async function repoInsert(workspace) {
    const now = workspace.updatedAt ? new Date(workspace.updatedAt) : new Date();
    const [id] = await dbClient("workspaces").insert({
      slug: workspace.slug,
      name: workspace.name,
      avatar_url: workspace.avatarUrl || null,
      owner_user_id: workspace.ownerUserId,
      is_personal: Boolean(workspace.isPersonal),
      created_at: toMysqlDateTimeUtc(workspace.createdAt ? new Date(workspace.createdAt) : now),
      updated_at: toMysqlDateTimeUtc(now)
    });

    const row = await dbClient("workspaces").where({ id }).first();
    return mapWorkspaceRowRequired(row);
  }

  async function repoUpdateById(id, patch = {}) {
    const dbPatch = {};

    if (Object.prototype.hasOwnProperty.call(patch, "slug")) {
      dbPatch.slug = patch.slug;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "name")) {
      dbPatch.name = patch.name;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "avatarUrl")) {
      dbPatch.avatar_url = patch.avatarUrl ? String(patch.avatarUrl) : null;
    }

    if (Object.keys(dbPatch).length > 0) {
      dbPatch.updated_at = toMysqlDateTimeUtc(new Date());
      await dbClient("workspaces").where({ id }).update(dbPatch);
    }

    const row = await dbClient("workspaces").where({ id }).first();
    return mapWorkspaceRowNullable(row);
  }

  async function repoListByUserId(userId) {
    const rows = await dbClient("workspaces as w")
      .innerJoin("workspace_memberships as wm", "wm.workspace_id", "w.id")
      .select(
        "w.id",
        "w.slug",
        "w.name",
        "w.avatar_url",
        "w.owner_user_id",
        "w.is_personal",
        "w.created_at",
        "w.updated_at",
        "wm.role_id",
        "wm.status"
      )
      .where({
        "wm.user_id": userId,
        "wm.status": "active"
      })
      .orderBy("w.name", "asc")
      .orderBy("w.id", "asc");

    return rows.map((row) => ({
      ...mapWorkspaceRowRequired(row),
      roleId: row.role_id,
      membershipStatus: row.status
    }));
  }

  return {
    findById: repoFindById,
    findBySlug: repoFindBySlug,
    findPersonalByOwnerUserId: repoFindPersonalByOwnerUserId,
    insert: repoInsert,
    updateById: repoUpdateById,
    listByUserId: repoListByUserId
  };
}

const repository = createWorkspacesRepository(db);

const __testables = {
  mapWorkspaceRowRequired,
  mapWorkspaceRowNullable,
  createWorkspacesRepository
};

export const { findById, findBySlug, findPersonalByOwnerUserId, insert, updateById, listByUserId } = repository;
export { __testables };
