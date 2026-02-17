import { db } from "../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../lib/dateUtils.js";

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
  async function repoFindByWorkspaceIdAndUserId(workspaceId, userId) {
    const row = await dbClient("workspace_memberships")
      .where({
        workspace_id: workspaceId,
        user_id: userId
      })
      .first();

    return mapMembershipRowNullable(row);
  }

  async function repoInsert(membership) {
    const now = new Date();
    const [id] = await dbClient("workspace_memberships").insert({
      workspace_id: membership.workspaceId,
      user_id: membership.userId,
      role_id: membership.roleId,
      status: membership.status || "active",
      created_at: toMysqlDateTimeUtc(now),
      updated_at: toMysqlDateTimeUtc(now)
    });

    const row = await dbClient("workspace_memberships").where({ id }).first();
    return mapMembershipRowRequired(row);
  }

  async function repoEnsureOwnerMembership(workspaceId, userId) {
    const existing = await repoFindByWorkspaceIdAndUserId(workspaceId, userId);
    if (existing) {
      return existing;
    }

    return repoInsert({
      workspaceId,
      userId,
      roleId: "owner",
      status: "active"
    });
  }

  async function repoListByUserId(userId) {
    const rows = await dbClient("workspace_memberships")
      .where({ user_id: userId, status: "active" })
      .orderBy("workspace_id", "asc")
      .orderBy("id", "asc");

    return rows.map(mapMembershipRowRequired);
  }

  async function repoListActiveByWorkspaceId(workspaceId) {
    const rows = await dbClient("workspace_memberships as wm")
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

  async function repoUpdateRoleByWorkspaceIdAndUserId(workspaceId, userId, roleId) {
    await dbClient("workspace_memberships")
      .where({
        workspace_id: workspaceId,
        user_id: userId
      })
      .update({
        role_id: roleId,
        updated_at: toMysqlDateTimeUtc(new Date())
      });

    return repoFindByWorkspaceIdAndUserId(workspaceId, userId);
  }

  async function repoEnsureActiveByWorkspaceIdAndUserId(workspaceId, userId, roleId) {
    const existing = await repoFindByWorkspaceIdAndUserId(workspaceId, userId);
    if (!existing) {
      return repoInsert({
        workspaceId,
        userId,
        roleId,
        status: "active"
      });
    }

    await dbClient("workspace_memberships")
      .where({
        workspace_id: workspaceId,
        user_id: userId
      })
      .update({
        role_id: roleId,
        status: "active",
        updated_at: toMysqlDateTimeUtc(new Date())
      });

    return repoFindByWorkspaceIdAndUserId(workspaceId, userId);
  }

  return {
    findByWorkspaceIdAndUserId: repoFindByWorkspaceIdAndUserId,
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
  mapMembershipRowRequired,
  mapMembershipRowNullable,
  createWorkspaceMembershipsRepository
};

export const {
  findByWorkspaceIdAndUserId,
  insert,
  ensureOwnerMembership,
  listByUserId,
  listActiveByWorkspaceId,
  updateRoleByWorkspaceIdAndUserId,
  ensureActiveByWorkspaceIdAndUserId
} = repository;
export { __testables };
