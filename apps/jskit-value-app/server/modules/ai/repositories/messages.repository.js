import { db } from "../../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../../../lib/primitives/dateUtils.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { deleteRowsOlderThan, normalizeBatchSize, normalizeCutoffDateOrThrow } from "../../../lib/primitives/retention.js";

function parseJsonObject(value) {
  const source = String(value || "").trim();
  if (!source) {
    return {};
  }

  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringifyJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "{}";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function normalizeCountRow(row) {
  const values = Object.values(row || {});
  if (values.length < 1) {
    return 0;
  }

  const parsed = Number(values[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function mapMessageRowRequired(row) {
  if (!row) {
    throw new TypeError("mapMessageRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    conversationId: Number(row.conversation_id),
    workspaceId: Number(row.workspace_id),
    workspaceSlug: String(row.workspace_slug || ""),
    workspaceName: String(row.workspace_name || ""),
    seq: Number(row.seq || 0),
    role: String(row.role || ""),
    kind: String(row.kind || "chat"),
    clientMessageId: String(row.client_message_id || ""),
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    contentText: row.content_text == null ? null : String(row.content_text),
    contentRedacted: Boolean(row.content_redacted),
    redactionHits: parseJsonObject(row.redaction_hits_json),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: toIsoString(row.created_at)
  };
}

function mapMessageRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapMessageRowRequired(row);
}

async function resolveNextSequence(client, conversationId) {
  const row = await client("ai_messages")
    .where({ conversation_id: conversationId })
    .max({ maxSeq: "seq" })
    .first();
  const currentMax = Number(row?.maxSeq || 0);
  if (!Number.isInteger(currentMax) || currentMax < 0) {
    return 1;
  }

  return currentMax + 1;
}

function applyExportFilters(query, filters = {}) {
  const workspaceId = parsePositiveInteger(filters.workspaceId);
  if (workspaceId) {
    query.where("m.workspace_id", workspaceId);
  }

  const conversationId = parsePositiveInteger(filters.conversationId);
  if (conversationId) {
    query.where("m.conversation_id", conversationId);
  }

  const role = String(filters.role || "").trim().toLowerCase();
  if (role) {
    query.where("m.role", role);
  }

  if (filters.from) {
    query.where("m.created_at", ">=", toMysqlDateTimeUtc(normalizeCutoffDateOrThrow(filters.from)));
  }
  if (filters.to) {
    query.where("m.created_at", "<=", toMysqlDateTimeUtc(normalizeCutoffDateOrThrow(filters.to)));
  }

  return query;
}

function createMessagesRepository(dbClient) {
  function resolveClient(options = {}) {
    const trx = options && typeof options === "object" ? options.trx || null : null;
    return trx || dbClient;
  }

  async function repoInsert(payload, options = {}) {
    const client = resolveClient(options);
    const conversationId = parsePositiveInteger(payload?.conversationId);
    const workspaceId = parsePositiveInteger(payload?.workspaceId);
    if (!conversationId || !workspaceId) {
      throw new TypeError("conversationId and workspaceId are required.");
    }

    const seq = Number.isInteger(Number(payload?.seq)) ? Number(payload.seq) : await resolveNextSequence(client, conversationId);
    const createdAt = payload?.createdAt ? normalizeCutoffDateOrThrow(payload.createdAt) : new Date();

    const [id] = await client("ai_messages").insert({
      conversation_id: conversationId,
      workspace_id: workspaceId,
      seq,
      role: String(payload?.role || "").trim().toLowerCase(),
      kind: String(payload?.kind || "chat").trim().toLowerCase() || "chat",
      client_message_id: String(payload?.clientMessageId || "").trim(),
      actor_user_id: parsePositiveInteger(payload?.actorUserId),
      content_text: payload?.contentText == null ? null : String(payload.contentText),
      content_redacted: Boolean(payload?.contentRedacted),
      redaction_hits_json: stringifyJsonObject(payload?.redactionHits),
      metadata_json: stringifyJsonObject(payload?.metadata),
      created_at: toMysqlDateTimeUtc(createdAt)
    });

    return repoFindById(id, options);
  }

  async function repoFindById(messageId, options = {}) {
    const client = resolveClient(options);
    const numericMessageId = parsePositiveInteger(messageId);
    if (!numericMessageId) {
      return null;
    }

    const row = await client("ai_messages as m")
      .leftJoin("workspaces as w", "w.id", "m.workspace_id")
      .select(
        "m.*",
        client.raw("COALESCE(w.slug, '') AS workspace_slug"),
        client.raw("COALESCE(w.name, '') AS workspace_name")
      )
      .where("m.id", numericMessageId)
      .first();

    return mapMessageRowNullable(row);
  }

  async function repoListByConversationId(conversationId, pagination = {}, options = {}) {
    const client = resolveClient(options);
    const numericConversationId = parsePositiveInteger(conversationId);
    if (!numericConversationId) {
      return [];
    }

    const page = Math.max(1, parsePositiveInteger(pagination.page) || 1);
    const pageSize = Math.max(1, Math.min(500, parsePositiveInteger(pagination.pageSize) || 100));
    const offset = (page - 1) * pageSize;

    const rows = await client("ai_messages as m")
      .leftJoin("workspaces as w", "w.id", "m.workspace_id")
      .select(
        "m.*",
        client.raw("COALESCE(w.slug, '') AS workspace_slug"),
        client.raw("COALESCE(w.name, '') AS workspace_name")
      )
      .where("m.conversation_id", numericConversationId)
      .orderBy("m.seq", "asc")
      .orderBy("m.id", "asc")
      .limit(pageSize)
      .offset(offset);

    return rows.map(mapMessageRowRequired);
  }

  async function repoListByConversationIdForWorkspace(conversationId, workspaceId, pagination = {}, options = {}) {
    const client = resolveClient(options);
    const numericConversationId = parsePositiveInteger(conversationId);
    const numericWorkspaceId = parsePositiveInteger(workspaceId);
    if (!numericConversationId || !numericWorkspaceId) {
      return [];
    }

    const page = Math.max(1, parsePositiveInteger(pagination.page) || 1);
    const pageSize = Math.max(1, Math.min(500, parsePositiveInteger(pagination.pageSize) || 100));
    const offset = (page - 1) * pageSize;

    const rows = await client("ai_messages as m")
      .leftJoin("workspaces as w", "w.id", "m.workspace_id")
      .select(
        "m.*",
        client.raw("COALESCE(w.slug, '') AS workspace_slug"),
        client.raw("COALESCE(w.name, '') AS workspace_name")
      )
      .where("m.conversation_id", numericConversationId)
      .where("m.workspace_id", numericWorkspaceId)
      .orderBy("m.seq", "asc")
      .orderBy("m.id", "asc")
      .limit(pageSize)
      .offset(offset);

    return rows.map(mapMessageRowRequired);
  }

  async function repoCountByConversationId(conversationId, options = {}) {
    const client = resolveClient(options);
    const numericConversationId = parsePositiveInteger(conversationId);
    if (!numericConversationId) {
      return 0;
    }

    const row = await client("ai_messages").where({ conversation_id: numericConversationId }).count({ total: "*" }).first();
    return normalizeCountRow(row);
  }

  async function repoCountByConversationIdForWorkspace(conversationId, workspaceId, options = {}) {
    const client = resolveClient(options);
    const numericConversationId = parsePositiveInteger(conversationId);
    const numericWorkspaceId = parsePositiveInteger(workspaceId);
    if (!numericConversationId || !numericWorkspaceId) {
      return 0;
    }

    const row = await client("ai_messages")
      .where({ conversation_id: numericConversationId, workspace_id: numericWorkspaceId })
      .count({ total: "*" })
      .first();
    return normalizeCountRow(row);
  }

  async function repoExportByFilters(filters = {}, options = {}) {
    const client = resolveClient(options);
    const limit = Math.max(1, Math.min(10_000, parsePositiveInteger(filters.limit) || 2000));

    let query = client("ai_messages as m")
      .leftJoin("workspaces as w", "w.id", "m.workspace_id")
      .leftJoin("ai_conversations as c", "c.id", "m.conversation_id")
      .select(
        "m.*",
        client.raw("COALESCE(w.slug, '') AS workspace_slug"),
        client.raw("COALESCE(w.name, '') AS workspace_name"),
        client.raw("COALESCE(c.status, '') AS conversation_status"),
        client.raw("COALESCE(c.transcript_mode, 'standard') AS conversation_transcript_mode"),
        client.raw("COALESCE(c.provider, '') AS conversation_provider"),
        client.raw("COALESCE(c.model, '') AS conversation_model"),
        "c.started_at as conversation_started_at",
        "c.ended_at as conversation_ended_at"
      );

    query = applyExportFilters(query, filters)
      .orderBy("m.created_at", "asc")
      .orderBy("m.id", "asc")
      .limit(limit);

    const rows = await query;
    return rows.map((row) => ({
      ...mapMessageRowRequired(row),
      conversation: {
        status: String(row.conversation_status || ""),
        transcriptMode: String(row.conversation_transcript_mode || "standard"),
        provider: String(row.conversation_provider || ""),
        model: String(row.conversation_model || ""),
        startedAt: row.conversation_started_at ? toIsoString(row.conversation_started_at) : null,
        endedAt: row.conversation_ended_at ? toIsoString(row.conversation_ended_at) : null
      }
    }));
  }

  async function repoDeleteOlderThan(cutoffDate, batchSize = 1000, options = {}) {
    return deleteRowsOlderThan({
      client: resolveClient(options),
      tableName: "ai_messages",
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
    findById: repoFindById,
    listByConversationId: repoListByConversationId,
    listByConversationIdForWorkspace: repoListByConversationIdForWorkspace,
    countByConversationId: repoCountByConversationId,
    countByConversationIdForWorkspace: repoCountByConversationIdForWorkspace,
    exportByFilters: repoExportByFilters,
    deleteOlderThan: repoDeleteOlderThan,
    transaction: repoTransaction
  };
}

const repository = createMessagesRepository(db);

const __testables = {
  parseJsonObject,
  stringifyJsonObject,
  normalizeCountRow,
  mapMessageRowRequired,
  mapMessageRowNullable,
  resolveNextSequence,
  applyExportFilters,
  normalizeBatchSize,
  normalizeCutoffDateOrThrow,
  createMessagesRepository
};

export const {
  insert,
  findById,
  listByConversationId,
  listByConversationIdForWorkspace,
  countByConversationId,
  countByConversationIdForWorkspace,
  exportByFilters,
  deleteOlderThan,
  transaction
} = repository;

export { __testables };
