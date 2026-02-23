import { db } from "../../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../../../lib/primitives/dateUtils.js";
import { isMysqlDuplicateEntryError } from "../../../lib/primitives/mysqlErrors.js";

function mapMembershipWithUserRowRequired(row) {
  if (!row) {
    throw new TypeError("mapMembershipWithUserRowRequired expected a row object.");
  }

  return {
    ...mapMembershipRowRequired(row),
    user: {
      id: Number(row.user_id),
      email: String(row.user_email || ""),
      displayName: String(row.user_display_name || "")
    }
  };
}

function mapMembershipRowRequired(row) {
  if (!row) {
    throw new TypeError("mapMembershipRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    userId: Number(row.user_id),
    roleId: row.role_id,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapMembershipRowNullable(row) {
  if (!row) {
    return null;
  }
  return mapMembershipRowRequired(row);
}

function createWorkspaceMembershipsRepository(dbClient) {
  function resolveClient(options = {}) {
    const trx = options && typeof options === "object" ? options.trx || null : null;
    return trx || dbClient;
  }

  async function repoFindByWorkspaceIdAndUserId(workspaceId, userId, options = {}) {
    const client = resolveClient(options);
    const row = await client("workspace_memberships")
      .where({
        workspace_id: workspaceId,
        user_id: userId
      })
      .first();

    return mapMembershipRowNullable(row);
  }

  async function repoListByUserIdAndWorkspaceIds(userId, workspaceIds, options = {}) {
    const numericUserId = Number(userId);
    const normalizedWorkspaceIds = Array.isArray(workspaceIds)
      ? Array.from(
          new Set(
            workspaceIds
              .map((workspaceId) => Number(workspaceId))
              .filter((workspaceId) => Number.isInteger(workspaceId) && workspaceId > 0)
          )
        )
      : [];

    if (!Number.isInteger(numericUserId) || numericUserId < 1 || normalizedWorkspaceIds.length < 1) {
      return [];
    }

    const client = resolveClient(options);
    const rows = await client("workspace_memberships")
      .where({
        user_id: numericUserId
      })
      .whereIn("workspace_id", normalizedWorkspaceIds)
      .orderBy("workspace_id", "asc")
      .orderBy("id", "asc");

    return rows.map(mapMembershipRowRequired);
  }

  async function repoInsert(membership, options = {}) {
    const client = resolveClient(options);
    const now = new Date();
    const [id] = await client("workspace_memberships").insert({
      workspace_id: membership.workspaceId,
      user_id: membership.userId,
      role_id: membership.roleId,
      status: membership.status || "active",
      created_at: toMysqlDateTimeUtc(now),
      updated_at: toMysqlDateTimeUtc(now)
    });

    const row = await client("workspace_memberships").where({ id }).first();
    return mapMembershipRowRequired(row);
  }

  async function repoEnsureOwnerMembership(workspaceId, userId, options = {}) {
    const client = resolveClient(options);
    const existing = await repoFindByWorkspaceIdAndUserId(workspaceId, userId, options);
    if (existing) {
      return existing;
    }

    try {
      const now = toMysqlDateTimeUtc(new Date());
      await client("workspace_memberships").insert({
        workspace_id: workspaceId,
        user_id: userId,
        role_id: "owner",
        status: "active",
        created_at: now,
        updated_at: now
      });
    } catch (error) {
      if (!isMysqlDuplicateEntryError(error)) {
        throw error;
      }
    }

    const row = await client("workspace_memberships")
      .where({
        workspace_id: workspaceId,
        user_id: userId
      })
      .first();

    return mapMembershipRowRequired(row);
  }

  async function repoListByUserId(userId, options = {}) {
    const client = resolveClient(options);
    const rows = await client("workspace_memberships")
      .where({ user_id: userId, status: "active" })
      .orderBy("workspace_id", "asc")
      .orderBy("id", "asc");

    return rows.map(mapMembershipRowRequired);
  }

  async function repoListActiveByWorkspaceId(workspaceId, options = {}) {
    const client = resolveClient(options);
    const rows = await client("workspace_memberships as wm")
      .innerJoin("user_profiles as up", "up.id", "wm.user_id")
      .select(
        "wm.id",
        "wm.workspace_id",
        "wm.user_id",
        "wm.role_id",
        "wm.status",
        "wm.created_at",
        "wm.updated_at",
        "up.email as user_email",
        "up.display_name as user_display_name"
      )
      .where({
        "wm.workspace_id": workspaceId,
        "wm.status": "active"
      })
      .orderBy("up.display_name", "asc")
      .orderBy("up.email", "asc")
      .orderBy("wm.id", "asc");

    return rows.map(mapMembershipWithUserRowRequired);
  }

  async function repoUpdateRoleByWorkspaceIdAndUserId(workspaceId, userId, roleId, options = {}) {
    const client = resolveClient(options);
    await client("workspace_memberships")
      .where({
        workspace_id: workspaceId,
        user_id: userId
      })
      .update({
        role_id: roleId,
        updated_at: toMysqlDateTimeUtc(new Date())
      });

    return repoFindByWorkspaceIdAndUserId(workspaceId, userId, options);
  }

  async function repoEnsureActiveByWorkspaceIdAndUserId(workspaceId, userId, roleId, options = {}) {
    const client = resolveClient(options);
    const existing = await repoFindByWorkspaceIdAndUserId(workspaceId, userId, options);
    if (!existing) {
      return repoInsert(
        {
          workspaceId,
          userId,
          roleId,
          status: "active"
        },
        options
      );
    }

    await client("workspace_memberships")
      .where({
        workspace_id: workspaceId,
        user_id: userId
      })
      .update({
        role_id: roleId,
        status: "active",
        updated_at: toMysqlDateTimeUtc(new Date())
      });

    return repoFindByWorkspaceIdAndUserId(workspaceId, userId, options);
  }

  return {
    findByWorkspaceIdAndUserId: repoFindByWorkspaceIdAndUserId,
    listByUserIdAndWorkspaceIds: repoListByUserIdAndWorkspaceIds,
    insert: repoInsert,
    ensureOwnerMembership: repoEnsureOwnerMembership,
    listByUserId: repoListByUserId,
    listActiveByWorkspaceId: repoListActiveByWorkspaceId,
    updateRoleByWorkspaceIdAndUserId: repoUpdateRoleByWorkspaceIdAndUserId,
    ensureActiveByWorkspaceIdAndUserId: repoEnsureActiveByWorkspaceIdAndUserId
  };
}

const repository = createWorkspaceMembershipsRepository(db);

const __testables = {
  isMysqlDuplicateEntryError,
  mapMembershipRowRequired,
  mapMembershipRowNullable,
  createWorkspaceMembershipsRepository
};

export const {
  findByWorkspaceIdAndUserId,
  listByUserIdAndWorkspaceIds,
  insert,
  ensureOwnerMembership,
  listByUserId,
  listActiveByWorkspaceId,
  updateRoleByWorkspaceIdAndUserId,
  ensureActiveByWorkspaceIdAndUserId
} = repository;
export { __testables };
