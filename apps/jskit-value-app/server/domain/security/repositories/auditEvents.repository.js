import { db } from "../../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../../../lib/primitives/dateUtils.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import {
  deleteRowsOlderThan,
  normalizeBatchSize,
  normalizeCutoffDateOrThrow
} from "../../../lib/primitives/retention.js";

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

function parseMetadata(value) {
  const source = String(value || "").trim();
  if (!source) {
    return {};
  }

  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function stringifyMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return "{}";
  }

  try {
    return JSON.stringify(metadata);
  } catch {
    return "{}";
  }
}

function mapAuditEventRowRequired(row) {
  if (!row) {
    throw new TypeError("mapAuditEventRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    createdAt: toIsoString(row.created_at),
    action: String(row.action || ""),
    outcome: String(row.outcome || ""),
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    actorEmail: String(row.actor_email || ""),
    targetUserId: row.target_user_id == null ? null : Number(row.target_user_id),
    workspaceId: row.workspace_id == null ? null : Number(row.workspace_id),
    surface: String(row.surface || ""),
    requestId: String(row.request_id || ""),
    method: String(row.method || ""),
    path: String(row.path || ""),
    ipAddress: String(row.ip_address || ""),
    userAgent: String(row.user_agent || ""),
    metadata: parseMetadata(row.metadata_json)
  };
}

function mapAuditEventRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapAuditEventRowRequired(row);
}

function createAuditEventsRepository(dbClient) {
  function resolveClient(options = {}) {
    const trx = options && typeof options === "object" ? options.trx || null : null;
    return trx || dbClient;
  }

  async function repoInsert(event, options = {}) {
    const client = resolveClient(options);
    const createdAt = event?.createdAt ? normalizeCutoffDateOrThrow(event.createdAt) : new Date();
    const [id] = await client("security_audit_events").insert({
      created_at: toMysqlDateTimeUtc(createdAt),
      action: String(event?.action || "").trim(),
      outcome: String(event?.outcome || "success").trim().toLowerCase() || "success",
      actor_user_id: parsePositiveInteger(event?.actorUserId),
      actor_email: String(event?.actorEmail || "").trim(),
      target_user_id: parsePositiveInteger(event?.targetUserId),
      workspace_id: parsePositiveInteger(event?.workspaceId),
      surface: String(event?.surface || "").trim(),
      request_id: String(event?.requestId || "").trim(),
      method: String(event?.method || "").trim(),
      path: String(event?.path || "").trim(),
      ip_address: String(event?.ipAddress || "").trim(),
      user_agent: String(event?.userAgent || ""),
      metadata_json: stringifyMetadata(event?.metadata)
    });

    const row = await client("security_audit_events").where({ id }).first();
    return mapAuditEventRowRequired(row);
  }

  async function repoDeleteOlderThan(cutoffDate, batchSize = 1000, options = {}) {
    return deleteRowsOlderThan({
      client: resolveClient(options),
      tableName: "security_audit_events",
      dateColumn: "created_at",
      cutoffDate,
      batchSize
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
    deleteOlderThan: repoDeleteOlderThan,
    transaction: repoTransaction
  };
}

const repository = createAuditEventsRepository(db);

const __testables = {
  normalizeCount,
  parseMetadata,
  stringifyMetadata,
  mapAuditEventRowRequired,
  mapAuditEventRowNullable,
  normalizeBatchSize,
  normalizeDateOrThrow: normalizeCutoffDateOrThrow,
  createAuditEventsRepository
};

export const { insert, deleteOlderThan, transaction } = repository;
export { __testables };
