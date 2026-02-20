import { db } from "../../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../../../lib/primitives/dateUtils.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { normalizeBatchSize, normalizeCutoffDateOrThrow } from "../../../lib/primitives/retention.js";

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

function mapConversationRowRequired(row) {
  if (!row) {
    throw new TypeError("mapConversationRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    workspaceSlug: String(row.workspace_slug || ""),
    workspaceName: String(row.workspace_name || ""),
    createdByUserId: row.created_by_user_id == null ? null : Number(row.created_by_user_id),
    createdByUserDisplayName: String(row.created_by_user_display_name || ""),
    createdByUserEmail: String(row.created_by_user_email || ""),
    status: String(row.status || ""),
    transcriptMode: String(row.transcript_mode || "standard"),
    provider: String(row.provider || ""),
    model: String(row.model || ""),
    startedAt: toIsoString(row.started_at),
    endedAt: row.ended_at ? toIsoString(row.ended_at) : null,
    messageCount: Number(row.message_count || 0),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapConversationRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapConversationRowRequired(row);
}

function applyListFilters(query, filters = {}) {
  const workspaceId = parsePositiveInteger(filters.workspaceId);
  if (workspaceId) {
    query.where("c.workspace_id", workspaceId);
  }

  const actorUserId = parsePositiveInteger(filters.createdByUserId);
  if (actorUserId) {
    query.where("c.created_by_user_id", actorUserId);
  }

  const status = String(filters.status || "").trim().toLowerCase();
  if (status) {
    query.where("c.status", status);
  }

  if (filters.from) {
    query.where("c.started_at", ">=", toMysqlDateTimeUtc(normalizeCutoffDateOrThrow(filters.from)));
  }
  if (filters.to) {
    query.where("c.started_at", "<=", toMysqlDateTimeUtc(normalizeCutoffDateOrThrow(filters.to)));
  }

  return query;
}

function createConversationsRepository(dbClient) {
  function resolveClient(options = {}) {
    const trx = options && typeof options === "object" ? options.trx || null : null;
    return trx || dbClient;
  }

  async function repoInsert(payload, options = {}) {
    const client = resolveClient(options);
    const now = new Date();
    const startedAt = payload?.startedAt ? normalizeCutoffDateOrThrow(payload.startedAt) : now;
    const [id] = await client("ai_conversations").insert({
      workspace_id: parsePositiveInteger(payload?.workspaceId),
      created_by_user_id: parsePositiveInteger(payload?.createdByUserId),
      status: String(payload?.status || "active").trim().toLowerCase() || "active",
      transcript_mode: String(payload?.transcriptMode || "standard").trim().toLowerCase() || "standard",
      provider: String(payload?.provider || "").trim(),
      model: String(payload?.model || "").trim(),
      started_at: toMysqlDateTimeUtc(startedAt),
      ended_at: payload?.endedAt ? toMysqlDateTimeUtc(normalizeCutoffDateOrThrow(payload.endedAt)) : null,
      message_count: Number.isInteger(Number(payload?.messageCount)) ? Number(payload.messageCount) : 0,
      metadata_json: stringifyJsonObject(payload?.metadata),
      created_at: toMysqlDateTimeUtc(now),
      updated_at: toMysqlDateTimeUtc(now)
    });

    return repoFindById(id, options);
  }

  async function repoFindById(conversationId, options = {}) {
    const client = resolveClient(options);
    const numericConversationId = parsePositiveInteger(conversationId);
    if (!numericConversationId) {
      return null;
    }

    const row = await client("ai_conversations as c")
      .leftJoin("workspaces as w", "w.id", "c.workspace_id")
      .leftJoin("user_profiles as creator", "creator.id", "c.created_by_user_id")
      .select(
        "c.*",
        client.raw("COALESCE(w.slug, '') AS workspace_slug"),
        client.raw("COALESCE(w.name, '') AS workspace_name"),
        client.raw("COALESCE(creator.display_name, '') AS created_by_user_display_name"),
        client.raw("COALESCE(creator.email, '') AS created_by_user_email")
      )
      .where("c.id", numericConversationId)
      .first();

    return mapConversationRowNullable(row);
  }

  async function repoFindByIdForWorkspace(conversationId, workspaceId, options = {}) {
    const client = resolveClient(options);
    const numericConversationId = parsePositiveInteger(conversationId);
    const numericWorkspaceId = parsePositiveInteger(workspaceId);
    if (!numericConversationId || !numericWorkspaceId) {
      return null;
    }

    const row = await client("ai_conversations as c")
      .leftJoin("workspaces as w", "w.id", "c.workspace_id")
      .leftJoin("user_profiles as creator", "creator.id", "c.created_by_user_id")
      .select(
        "c.*",
        client.raw("COALESCE(w.slug, '') AS workspace_slug"),
        client.raw("COALESCE(w.name, '') AS workspace_name"),
        client.raw("COALESCE(creator.display_name, '') AS created_by_user_display_name"),
        client.raw("COALESCE(creator.email, '') AS created_by_user_email")
      )
      .where("c.id", numericConversationId)
      .where("c.workspace_id", numericWorkspaceId)
      .first();

    return mapConversationRowNullable(row);
  }

  async function repoFindByIdForWorkspaceAndUser(conversationId, workspaceId, userId, options = {}) {
    const client = resolveClient(options);
    const numericConversationId = parsePositiveInteger(conversationId);
    const numericWorkspaceId = parsePositiveInteger(workspaceId);
    const numericUserId = parsePositiveInteger(userId);
    if (!numericConversationId || !numericWorkspaceId || !numericUserId) {
      return null;
    }

    const row = await client("ai_conversations as c")
      .leftJoin("workspaces as w", "w.id", "c.workspace_id")
      .leftJoin("user_profiles as creator", "creator.id", "c.created_by_user_id")
      .select(
        "c.*",
        client.raw("COALESCE(w.slug, '') AS workspace_slug"),
        client.raw("COALESCE(w.name, '') AS workspace_name"),
        client.raw("COALESCE(creator.display_name, '') AS created_by_user_display_name"),
        client.raw("COALESCE(creator.email, '') AS created_by_user_email")
      )
      .where("c.id", numericConversationId)
      .where("c.workspace_id", numericWorkspaceId)
      .where("c.created_by_user_id", numericUserId)
      .first();

    return mapConversationRowNullable(row);
  }

  async function repoUpdateById(conversationId, patch = {}, options = {}) {
    const client = resolveClient(options);
    const numericConversationId = parsePositiveInteger(conversationId);
    if (!numericConversationId) {
      return null;
    }

    const dbPatch = {};
    if (Object.prototype.hasOwnProperty.call(patch, "status")) {
      dbPatch.status = String(patch.status || "").trim().toLowerCase() || "active";
    }
    if (Object.prototype.hasOwnProperty.call(patch, "transcriptMode")) {
      dbPatch.transcript_mode = String(patch.transcriptMode || "").trim().toLowerCase() || "standard";
    }
    if (Object.prototype.hasOwnProperty.call(patch, "provider")) {
      dbPatch.provider = String(patch.provider || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(patch, "model")) {
      dbPatch.model = String(patch.model || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(patch, "messageCount")) {
      const messageCount = Number(patch.messageCount);
      if (Number.isInteger(messageCount) && messageCount >= 0) {
        dbPatch.message_count = messageCount;
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, "endedAt")) {
      dbPatch.ended_at = patch.endedAt ? toMysqlDateTimeUtc(normalizeCutoffDateOrThrow(patch.endedAt)) : null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "metadata")) {
      dbPatch.metadata_json = stringifyJsonObject(patch.metadata);
    }

    if (Object.keys(dbPatch).length > 0) {
      dbPatch.updated_at = toMysqlDateTimeUtc(new Date());
      await client("ai_conversations").where({ id: numericConversationId }).update(dbPatch);
    }

    return repoFindById(numericConversationId, options);
  }

  async function repoIncrementMessageCount(conversationId, delta = 1, options = {}) {
    const client = resolveClient(options);
    const numericConversationId = parsePositiveInteger(conversationId);
    if (!numericConversationId) {
      return null;
    }

    const incrementBy = Number.isInteger(Number(delta)) ? Number(delta) : 1;
    await client("ai_conversations")
      .where({ id: numericConversationId })
      .update({
        message_count: client.raw("GREATEST(0, message_count + ?)", [incrementBy]),
        updated_at: toMysqlDateTimeUtc(new Date())
      });

    return repoFindById(numericConversationId, options);
  }

  async function repoList(filters = {}, pagination = {}, options = {}) {
    const client = resolveClient(options);
    const page = Math.max(1, parsePositiveInteger(pagination.page) || 1);
    const pageSize = Math.max(1, Math.min(200, parsePositiveInteger(pagination.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    let query = client("ai_conversations as c")
      .leftJoin("workspaces as w", "w.id", "c.workspace_id")
      .leftJoin("user_profiles as creator", "creator.id", "c.created_by_user_id")
      .select(
        "c.*",
        client.raw("COALESCE(w.slug, '') AS workspace_slug"),
        client.raw("COALESCE(w.name, '') AS workspace_name"),
        client.raw("COALESCE(creator.display_name, '') AS created_by_user_display_name"),
        client.raw("COALESCE(creator.email, '') AS created_by_user_email")
      );

    query = applyListFilters(query, filters)
      .orderBy("c.started_at", "desc")
      .orderBy("c.id", "desc")
      .limit(pageSize)
      .offset(offset);

    const rows = await query;
    return rows.map(mapConversationRowRequired);
  }

  async function repoCount(filters = {}, options = {}) {
    const client = resolveClient(options);
    let query = client("ai_conversations as c").count({ total: "*" });
    query = applyListFilters(query, filters);
    const row = await query.first();
    return normalizeCountRow(row);
  }

  async function repoDeleteWithoutMessagesOlderThan(cutoffDate, batchSize = 1000, options = {}) {
    const client = resolveClient(options);
    const normalizedCutoff = toMysqlDateTimeUtc(normalizeCutoffDateOrThrow(cutoffDate));
    const normalizedBatchSize = normalizeBatchSize(batchSize, {
      fallback: 1000,
      max: 10_000
    });

    const ids = await client("ai_conversations as c")
      .leftJoin("ai_messages as m", "m.conversation_id", "c.id")
      .whereNull("m.id")
      .where("c.started_at", "<", normalizedCutoff)
      .orderBy("c.id", "asc")
      .limit(normalizedBatchSize)
      .select("c.id");

    const numericIds = (Array.isArray(ids) ? ids : [])
      .map((entry) => Number(entry.id))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (numericIds.length < 1) {
      return 0;
    }

    const deletedRows = await client("ai_conversations").whereIn("id", numericIds).del();
    return Number.isFinite(Number(deletedRows)) && Number(deletedRows) > 0 ? Number(deletedRows) : 0;
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
    findByIdForWorkspace: repoFindByIdForWorkspace,
    findByIdForWorkspaceAndUser: repoFindByIdForWorkspaceAndUser,
    updateById: repoUpdateById,
    incrementMessageCount: repoIncrementMessageCount,
    list: repoList,
    count: repoCount,
    deleteWithoutMessagesOlderThan: repoDeleteWithoutMessagesOlderThan,
    transaction: repoTransaction
  };
}

const repository = createConversationsRepository(db);

const __testables = {
  parseJsonObject,
  stringifyJsonObject,
  normalizeCountRow,
  mapConversationRowRequired,
  mapConversationRowNullable,
  applyListFilters,
  createConversationsRepository
};

export const {
  insert,
  findById,
  findByIdForWorkspace,
  findByIdForWorkspaceAndUser,
  updateById,
  incrementMessageCount,
  list,
  count,
  deleteWithoutMessagesOlderThan,
  transaction
} = repository;

export { __testables };
