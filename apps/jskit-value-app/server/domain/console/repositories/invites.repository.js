import { db } from "../../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../../../lib/primitives/dateUtils.js";
import {
  deleteRowsOlderThan,
  normalizeBatchSize,
  normalizeCutoffDateOrThrow
} from "../../../lib/primitives/retention.js";
import { normalizeEmail } from "../../../../shared/auth/utils.js";

function mapInviteRowRequired(row) {
  if (!row) {
    throw new TypeError("mapInviteRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    email: String(row.email || ""),
    roleId: String(row.role_id || ""),
    tokenHash: String(row.token_hash || ""),
    invitedByUserId: row.invited_by_user_id == null ? null : Number(row.invited_by_user_id),
    expiresAt: toIsoString(row.expires_at),
    status: String(row.status || ""),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    invitedBy:
      row.invited_by_user_id == null && row.invited_by_display_name == null && row.invited_by_email == null
        ? null
        : {
            displayName: String(row.invited_by_display_name || ""),
            email: String(row.invited_by_email || "")
          }
  };
}

function mapInviteRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapInviteRowRequired(row);
}

function createInviteBaseQuery(client) {
  return client("console_invites as gi")
    .leftJoin("user_profiles as inviter", "inviter.id", "gi.invited_by_user_id")
    .select(
      "gi.id",
      "gi.email",
      "gi.role_id",
      "gi.token_hash",
      "gi.invited_by_user_id",
      "gi.expires_at",
      "gi.status",
      "gi.created_at",
      "gi.updated_at",
      "inviter.display_name as invited_by_display_name",
      "inviter.email as invited_by_email"
    );
}

function createInvitesRepository(dbClient) {
  function resolveClient(options = {}) {
    const trx = options && typeof options === "object" ? options.trx || null : null;
    return trx || dbClient;
  }

  async function repoInsert(invite, options = {}) {
    const client = resolveClient(options);
    const now = new Date();
    const [id] = await client("console_invites").insert({
      email: normalizeEmail(invite.email),
      role_id: String(invite.roleId || "").trim(),
      token_hash: String(invite.tokenHash || "").trim(),
      invited_by_user_id: invite.invitedByUserId || null,
      expires_at: toMysqlDateTimeUtc(new Date(invite.expiresAt)),
      status: String(invite.status || "pending").trim() || "pending",
      created_at: toMysqlDateTimeUtc(now),
      updated_at: toMysqlDateTimeUtc(now)
    });

    const row = await client("console_invites").where({ id }).first();
    return mapInviteRowRequired(row);
  }

  async function repoListPending(options = {}) {
    const client = resolveClient(options);
    const rows = await createInviteBaseQuery(client)
      .where({ "gi.status": "pending" })
      .andWhere("gi.expires_at", ">", toMysqlDateTimeUtc(new Date()))
      .orderBy("gi.created_at", "desc")
      .orderBy("gi.id", "desc");

    return rows.map(mapInviteRowRequired);
  }

  async function repoListPendingByEmail(email, options = {}) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return [];
    }

    const client = resolveClient(options);
    const rows = await createInviteBaseQuery(client)
      .where({
        "gi.status": "pending",
        "gi.email": normalizedEmail
      })
      .andWhere("gi.expires_at", ">", toMysqlDateTimeUtc(new Date()))
      .orderBy("gi.created_at", "desc")
      .orderBy("gi.id", "desc");

    return rows.map(mapInviteRowRequired);
  }

  async function repoFindPendingById(inviteId, options = {}) {
    const client = resolveClient(options);
    const row = await createInviteBaseQuery(client)
      .where({
        "gi.id": inviteId,
        "gi.status": "pending"
      })
      .andWhere("gi.expires_at", ">", toMysqlDateTimeUtc(new Date()))
      .first();

    return mapInviteRowNullable(row);
  }

  async function repoFindPendingByTokenHash(tokenHash, options = {}) {
    const normalized = String(tokenHash || "")
      .trim()
      .toLowerCase();
    if (!normalized) {
      return null;
    }

    const client = resolveClient(options);
    const row = await createInviteBaseQuery(client)
      .where({
        "gi.token_hash": normalized,
        "gi.status": "pending"
      })
      .andWhere("gi.expires_at", ">", toMysqlDateTimeUtc(new Date()))
      .first();

    return mapInviteRowNullable(row);
  }

  async function repoUpdateStatusById(id, status, options = {}) {
    const client = resolveClient(options);
    await client("console_invites")
      .where({ id })
      .update({
        status: String(status || "")
          .trim()
          .toLowerCase(),
        updated_at: toMysqlDateTimeUtc(new Date())
      });

    return client("console_invites").where({ id }).first().then(mapInviteRowNullable);
  }

  async function repoRevokeById(id, options = {}) {
    return repoUpdateStatusById(id, "revoked", options);
  }

  async function repoMarkAcceptedById(id, options = {}) {
    return repoUpdateStatusById(id, "accepted", options);
  }

  async function repoExpirePendingByEmail(email, options = {}) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return 0;
    }

    const client = resolveClient(options);
    const now = toMysqlDateTimeUtc(new Date());
    const affectedRows = await client("console_invites")
      .where({
        email: normalizedEmail,
        status: "pending"
      })
      .andWhere("expires_at", "<=", now)
      .update({
        status: "expired",
        updated_at: now
      });

    return Number(affectedRows || 0);
  }

  async function repoDeleteArtifactsOlderThan(cutoffDate, batchSize = 1000, options = {}) {
    return deleteRowsOlderThan({
      client: resolveClient(options),
      tableName: "console_invites",
      dateColumn: "updated_at",
      cutoffDate,
      batchSize,
      applyFilters: (query) => query.whereIn("status", ["accepted", "revoked", "expired"])
    });
  }

  async function repoTransaction(callback) {
    if (typeof dbClient.transaction === "function") {
      return dbClient.transaction(callback);
    }

    return callback(dbClient);
  }

  return {
    insert: repoInsert,
    listPending: repoListPending,
    listPendingByEmail: repoListPendingByEmail,
    findPendingById: repoFindPendingById,
    findPendingByTokenHash: repoFindPendingByTokenHash,
    updateStatusById: repoUpdateStatusById,
    revokeById: repoRevokeById,
    markAcceptedById: repoMarkAcceptedById,
    expirePendingByEmail: repoExpirePendingByEmail,
    deleteArtifactsOlderThan: repoDeleteArtifactsOlderThan,
    transaction: repoTransaction
  };
}

const repository = createInvitesRepository(db);

const __testables = {
  normalizeEmail,
  mapInviteRowRequired,
  mapInviteRowNullable,
  normalizeBatchSize,
  normalizeCutoffDateOrThrow,
  createInvitesRepository
};

export const {
  insert,
  listPending,
  listPendingByEmail,
  findPendingById,
  findPendingByTokenHash,
  updateStatusById,
  revokeById,
  markAcceptedById,
  expirePendingByEmail,
  deleteArtifactsOlderThan
} = repository;
export { __testables };
