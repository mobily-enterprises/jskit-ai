import { toIsoString, toDatabaseDateTimeUtc } from "@jskit-ai/jskit-knex/dateUtils";
import { mapRowNullable, resolveQueryOptions, resolveRepoClient } from "@jskit-ai/jskit-knex";
import { coerceWorkspaceColor } from "@jskit-ai/workspace-console-core/workspaceColors";

function mapWorkspaceRowRequired(row) {
  if (!row) {
    throw new TypeError("mapWorkspaceRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    color: coerceWorkspaceColor(row.color),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : "",
    ownerUserId: Number(row.owner_user_id),
    isPersonal: Boolean(row.is_personal),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

const mapWorkspaceRowNullable = mapRowNullable(mapWorkspaceRowRequired);

function createWorkspacesRepository(dbClient) {
  async function repoFindById(id, options = {}) {
    const client = resolveRepoClient(dbClient, options);
    const row = await client("workspaces").where({ id }).first();
    return mapWorkspaceRowNullable(row);
  }

  async function repoFindBySlug(slug, options = {}) {
    const client = resolveRepoClient(dbClient, options);
    const row = await client("workspaces").where({ slug }).first();
    return mapWorkspaceRowNullable(row);
  }

  async function repoFindPersonalByOwnerUserId(ownerUserId, options = {}) {
    const { forUpdate } = resolveQueryOptions(options);
    const client = resolveRepoClient(dbClient, options);
    let query = client("workspaces")
      .where({
        owner_user_id: ownerUserId,
        is_personal: true
      })
      .orderBy("id", "asc");

    if (forUpdate && typeof query.forUpdate === "function") {
      query = query.forUpdate();
    }

    const row = await query.first();

    return mapWorkspaceRowNullable(row);
  }

  async function repoInsert(workspace, options = {}) {
    const client = resolveRepoClient(dbClient, options);
    const now = workspace.updatedAt ? new Date(workspace.updatedAt) : new Date();
    const [id] = await client("workspaces").insert({
      slug: workspace.slug,
      name: workspace.name,
      color: coerceWorkspaceColor(workspace.color),
      avatar_url: workspace.avatarUrl || null,
      owner_user_id: workspace.ownerUserId,
      is_personal: Boolean(workspace.isPersonal),
      created_at: toDatabaseDateTimeUtc(workspace.createdAt ? new Date(workspace.createdAt) : now),
      updated_at: toDatabaseDateTimeUtc(now)
    });

    const row = await client("workspaces").where({ id }).first();
    return mapWorkspaceRowRequired(row);
  }

  async function repoUpdateById(id, patch = {}, options = {}) {
    const client = resolveRepoClient(dbClient, options);
    const dbPatch = {};

    if (Object.hasOwn(patch, "slug")) {
      dbPatch.slug = patch.slug;
    }
    if (Object.hasOwn(patch, "name")) {
      dbPatch.name = patch.name;
    }
    if (Object.hasOwn(patch, "color")) {
      dbPatch.color = coerceWorkspaceColor(patch.color);
    }
    if (Object.hasOwn(patch, "avatarUrl")) {
      dbPatch.avatar_url = patch.avatarUrl ? String(patch.avatarUrl) : null;
    }

    if (Object.keys(dbPatch).length > 0) {
      dbPatch.updated_at = toDatabaseDateTimeUtc(new Date());
      await client("workspaces").where({ id }).update(dbPatch);
    }

    const row = await client("workspaces").where({ id }).first();
    return mapWorkspaceRowNullable(row);
  }

  async function repoListByUserId(userId, options = {}) {
    const client = resolveRepoClient(dbClient, options);
    const rows = await client("workspaces as w")
      .innerJoin("workspace_memberships as wm", "wm.workspace_id", "w.id")
      .select(
        "w.id",
        "w.slug",
        "w.name",
        "w.color",
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

  async function repoTransaction(callback) {
    if (typeof dbClient.transaction === "function") {
      return dbClient.transaction(callback);
    }

    return callback(dbClient);
  }

  return {
    findById: repoFindById,
    findBySlug: repoFindBySlug,
    findPersonalByOwnerUserId: repoFindPersonalByOwnerUserId,
    insert: repoInsert,
    updateById: repoUpdateById,
    listByUserId: repoListByUserId,
    transaction: repoTransaction
  };
}

function createRepository(dbClient) {
  if (typeof dbClient !== "function") {
    throw new TypeError("createRepository requires a dbClient function.");
  }

  return createWorkspacesRepository(dbClient);
}

const __testables = {
  mapWorkspaceRowRequired,
  mapWorkspaceRowNullable,
  createWorkspacesRepository
};

export { createRepository, __testables };
