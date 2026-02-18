import { db } from "../../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../../../lib/primitives/dateUtils.js";
import { isMysqlDuplicateEntryError } from "../../../lib/primitives/mysqlErrors.js";

function mapMembershipRowRequired(row) {
  if (!row) {
    throw new TypeError("mapMembershipRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    roleId: String(row.role_id || ""),
    status: String(row.status || "active"),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    user:
      row.user_id == null
        ? null
        : {
            id: Number(row.user_id),
            email: String(row.user_email || ""),
            displayName: String(row.user_display_name || "")
          }
  };
}

function mapMembershipRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapMembershipRowRequired(row);
}

function createMembershipsRepository(dbClient) {
  function resolveClient(options = {}) {
    const trx = options && typeof options === "object" ? options.trx || null : null;
    return trx || dbClient;
  }

  async function repoFindByUserId(userId, options = {}) {
    const client = resolveClient(options);
    const row = await client("god_memberships").where({ user_id: userId }).first();
    return mapMembershipRowNullable(row);
  }

  async function repoListActive(options = {}) {
    const client = resolveClient(options);
    const rows = await client("god_memberships as gm")
      .innerJoin("user_profiles as up", "up.id", "gm.user_id")
      .select(
        "gm.id",
        "gm.user_id",
        "gm.role_id",
        "gm.status",
        "gm.created_at",
        "gm.updated_at",
        "up.email as user_email",
        "up.display_name as user_display_name"
      )
      .where({
        "gm.status": "active"
      })
      .orderBy("up.display_name", "asc")
      .orderBy("up.email", "asc")
      .orderBy("gm.id", "asc");

    return rows.map(mapMembershipRowRequired);
  }

  async function repoCountActiveMembers(options = {}) {
    const client = resolveClient(options);
    const row = await client("god_memberships").where({ status: "active" }).count({ total: "id" }).first();
    return Number(row?.total || 0);
  }

  async function repoInsert(membership, options = {}) {
    const client = resolveClient(options);
    const now = new Date();
    const [id] = await client("god_memberships").insert({
      user_id: Number(membership.userId),
      role_id: String(membership.roleId || "").trim(),
      status: String(membership.status || "active").trim() || "active",
      created_at: toMysqlDateTimeUtc(now),
      updated_at: toMysqlDateTimeUtc(now)
    });

    const row = await client("god_memberships").where({ id }).first();
    return mapMembershipRowRequired(row);
  }

  async function repoEnsureActiveByUserId(userId, roleId, options = {}) {
    const client = resolveClient(options);
    const existing = await repoFindByUserId(userId, options);
    if (!existing) {
      try {
        return await repoInsert(
          {
            userId,
            roleId,
            status: "active"
          },
          options
        );
      } catch (error) {
        if (!isMysqlDuplicateEntryError(error)) {
          throw error;
        }
      }
    }

    await client("god_memberships")
      .where({ user_id: userId })
      .update({
        role_id: String(roleId || "").trim(),
        status: "active",
        updated_at: toMysqlDateTimeUtc(new Date())
      });

    return repoFindByUserId(userId, options);
  }

  async function repoUpdateRoleByUserId(userId, roleId, options = {}) {
    const client = resolveClient(options);
    await client("god_memberships")
      .where({ user_id: userId })
      .update({
        role_id: String(roleId || "").trim(),
        updated_at: toMysqlDateTimeUtc(new Date())
      });

    return repoFindByUserId(userId, options);
  }

  async function repoTransaction(callback) {
    if (typeof dbClient.transaction === "function") {
      return dbClient.transaction(callback);
    }

    return callback(dbClient);
  }

  return {
    findByUserId: repoFindByUserId,
    listActive: repoListActive,
    countActiveMembers: repoCountActiveMembers,
    insert: repoInsert,
    ensureActiveByUserId: repoEnsureActiveByUserId,
    updateRoleByUserId: repoUpdateRoleByUserId,
    transaction: repoTransaction
  };
}

const repository = createMembershipsRepository(db);

const __testables = {
  isMysqlDuplicateEntryError,
  mapMembershipRowRequired,
  mapMembershipRowNullable,
  createMembershipsRepository
};

export const { findByUserId, listActive, countActiveMembers, insert, ensureActiveByUserId, updateRoleByUserId } =
  repository;
export { __testables };
