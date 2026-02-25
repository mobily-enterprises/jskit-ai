import { db } from "../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "@jskit-ai/knex-mysql-core/dateUtils";

function normalizeCount(row) {
  const values = Object.values(row || {});
  if (values.length < 1) {
    return 0;
  }

  const parsed = Number(values[0]);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function normalizePositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

function parsePayloadJson(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  return value;
}

function mapAlertRowRequired(row) {
  if (!row) {
    throw new TypeError("mapAlertRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    type: String(row.type || ""),
    title: String(row.title || ""),
    message: row.message == null ? null : String(row.message || ""),
    targetUrl: String(row.target_url || ""),
    payloadJson: parsePayloadJson(row.payload_json),
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    workspaceId: row.workspace_id == null ? null : Number(row.workspace_id),
    createdAt: toIsoString(row.created_at)
  };
}

function mapReadStateRowRequired(row) {
  if (!row) {
    throw new TypeError("mapReadStateRowRequired expected a row object.");
  }

  return {
    userId: Number(row.user_id),
    readThroughAlertId: row.read_through_alert_id == null ? null : Number(row.read_through_alert_id),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapReadStateRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapReadStateRowRequired(row);
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

function createAlertsRepository(dbClient) {
  function resolveClient(options = {}) {
    const { trx } = resolveQueryOptions(options);
    return trx || dbClient;
  }

  async function repoInsertAlert(alertInput, options = {}) {
    const client = resolveClient(options);
    const now = new Date();
    const [id] = await client("user_alerts").insert({
      user_id: Number(alertInput.userId),
      type: String(alertInput.type || ""),
      title: String(alertInput.title || ""),
      message: alertInput.message == null ? null : String(alertInput.message || ""),
      target_url: String(alertInput.targetUrl || ""),
      payload_json: alertInput.payloadJson == null ? null : alertInput.payloadJson,
      actor_user_id: normalizePositiveInteger(alertInput.actorUserId),
      workspace_id: normalizePositiveInteger(alertInput.workspaceId),
      created_at: toMysqlDateTimeUtc(alertInput.createdAt ? new Date(alertInput.createdAt) : now)
    });

    const row = await client("user_alerts").where({ id }).first();
    return mapAlertRowRequired(row);
  }

  async function repoListAlertsForUser(userId, page, pageSize, options = {}) {
    const client = resolveClient(options);
    const offset = (Math.max(1, Number(page) || 1) - 1) * Math.max(1, Number(pageSize) || 20);

    const rows = await client("user_alerts")
      .where({ user_id: Number(userId) })
      .orderBy("id", "desc")
      .limit(Math.max(1, Number(pageSize) || 20))
      .offset(offset);

    return rows.map(mapAlertRowRequired);
  }

  async function repoCountAlertsForUser(userId, options = {}) {
    const client = resolveClient(options);
    const row = await client("user_alerts").where({ user_id: Number(userId) }).count({ total: "*" }).first();
    return normalizeCount(row);
  }

  async function repoCountUnreadAlertsForUser(userId, readThroughAlertId, options = {}) {
    const client = resolveClient(options);
    const threshold = normalizePositiveInteger(readThroughAlertId) || 0;
    const row = await client("user_alerts")
      .where({ user_id: Number(userId) })
      .andWhere("id", ">", threshold)
      .count({ total: "*" })
      .first();

    return normalizeCount(row);
  }

  async function repoGetLatestAlertIdForUser(userId, options = {}) {
    const client = resolveClient(options);
    const row = await client("user_alerts").where({ user_id: Number(userId) }).max({ latestId: "id" }).first();
    const latestId = Number(row?.latestId || 0);
    return Number.isInteger(latestId) && latestId > 0 ? latestId : null;
  }

  async function repoGetReadStateForUser(userId, options = {}) {
    const client = resolveClient(options);
    const row = await client("user_alert_states").where({ user_id: Number(userId) }).first();
    return mapReadStateRowNullable(row);
  }

  async function repoUpsertReadStateForUser(userId, readThroughAlertId, options = {}) {
    const client = resolveClient(options);
    const now = toMysqlDateTimeUtc(new Date());
    const normalizedReadThroughAlertId = normalizePositiveInteger(readThroughAlertId);

    await client("user_alert_states")
      .insert({
        user_id: Number(userId),
        read_through_alert_id: normalizedReadThroughAlertId,
        updated_at: now
      })
      .onConflict("user_id")
      .merge({
        read_through_alert_id: normalizedReadThroughAlertId,
        updated_at: now
      });

    const row = await client("user_alert_states").where({ user_id: Number(userId) }).first();
    return mapReadStateRowRequired(row);
  }

  async function repoTransaction(callback) {
    if (typeof dbClient.transaction === "function") {
      return dbClient.transaction(callback);
    }

    return callback(dbClient);
  }

  return {
    insertAlert: repoInsertAlert,
    listAlertsForUser: repoListAlertsForUser,
    countAlertsForUser: repoCountAlertsForUser,
    countUnreadAlertsForUser: repoCountUnreadAlertsForUser,
    getLatestAlertIdForUser: repoGetLatestAlertIdForUser,
    getReadStateForUser: repoGetReadStateForUser,
    upsertReadStateForUser: repoUpsertReadStateForUser,
    transaction: repoTransaction
  };
}

const repository = createAlertsRepository(db);

const __testables = {
  normalizeCount,
  normalizePositiveInteger,
  parsePayloadJson,
  mapAlertRowRequired,
  mapReadStateRowRequired,
  mapReadStateRowNullable,
  createAlertsRepository
};

export const {
  insertAlert,
  listAlertsForUser,
  countAlertsForUser,
  countUnreadAlertsForUser,
  getLatestAlertIdForUser,
  getReadStateForUser,
  upsertReadStateForUser,
  transaction
} = repository;
export { __testables };
