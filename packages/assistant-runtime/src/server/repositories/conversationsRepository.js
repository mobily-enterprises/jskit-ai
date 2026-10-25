import { applyForUpdate, createWithTransaction, normalizeDbRecordId, runInTransaction } from "@jskit-ai/database-runtime/shared/repositoryOptions";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  applyWorkspaceScope,
  normalizeDbWorkspaceId,
  normalizeInputRecordId,
  normalizeWorkspaceId,
  parseJsonObject,
  resolveInsertedId,
  stringifyJsonObject,
  toIso
} from "./repositoryPersistenceUtils.js";
import { DEFAULT_CONVERSATION_TITLE, assistantRuntimeConfig } from "../../shared/assistantRuntimeConfig.js";

function normalizeRequiredSurfaceId(value) {
  const normalizedSurfaceId = normalizeSurfaceId(value);
  if (!normalizedSurfaceId) {
    throw new TypeError("conversationsRepository requires surfaceId.");
  }

  return normalizedSurfaceId;
}

function mapConversationRow(row = {}) {
  return {
    id: normalizeDbRecordId(row.id, { fallback: "" }),
    workspaceId: normalizeDbWorkspaceId(row.workspace_id),
    title: String(row.title || DEFAULT_CONVERSATION_TITLE),
    createdByUserId: row.created_by_user_id == null ? null : normalizeDbRecordId(row.created_by_user_id, { fallback: null }),
    status: String(row.status || "active"),
    provider: String(row.provider || ""),
    model: String(row.model || ""),
    surfaceId: String(row.surface_id || ""),
    startedAt: toIso(row.started_at),
    endedAt: row.ended_at ? toIso(row.ended_at) : null,
    messageCount: Number(row.message_count || 0),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function normalizeCursorPagination(pagination = {}, { defaultLimit = 20, maxLimit = 200 } = {}) {
  const cursor = normalizeInputRecordId(pagination.cursor) || "";
  const parsedLimit = Number(pagination.limit);
  const limit = Number.isInteger(parsedLimit) && parsedLimit > 0
    ? Math.max(1, Math.min(maxLimit, parsedLimit))
    : defaultLimit;

  return {
    cursor,
    limit
  };
}

function createConversationBaseQuery(client) {
  return client(`${assistantRuntimeConfig.conversationsTable} as c`).select("c.*");
}

function createRepository(knex) {
  if (!knex || typeof knex !== "function") {
    throw new Error("createConversationsRepository requires knex client.");
  }
  const withTransaction = createWithTransaction(knex);

  async function findById(conversationId, options = {}) {
    const normalizedConversationId = normalizeInputRecordId(conversationId);
    if (!normalizedConversationId) {
      return null;
    }

    const client = options?.trx || knex;
    if (options.forUpdate === true) {
      if (!options.trx) throw new TypeError("Locking a conversation requires its database transaction.");
      // Acquire the write reservation before reading, including SQLite where
      // SELECT FOR UPDATE is not supported. This does not change row contents.
      await client(assistantRuntimeConfig.conversationsTable).where({ id: normalizedConversationId })
        .update({ id: normalizedConversationId });
    }
    const query = createConversationBaseQuery(client).where("c.id", normalizedConversationId);
    const row = await applyForUpdate(query, options).first();

    return row ? mapConversationRow(row) : null;
  }

  async function findByIdForActorScope(
    conversationId,
    { workspaceId = null, actorUserId = null, surfaceId = "" } = {},
    options = {}
  ) {
    const normalizedConversationId = normalizeInputRecordId(conversationId);
    const normalizedActorUserId = normalizeInputRecordId(actorUserId);
    const normalizedSurfaceId = normalizeSurfaceId(surfaceId);
    if (!normalizedConversationId || !normalizedActorUserId || !normalizedSurfaceId) {
      return null;
    }

    const client = options?.trx || knex;
    if (options.forUpdate === true) await findById(normalizedConversationId, options);
    const query = createConversationBaseQuery(client)
      .where("c.id", normalizedConversationId)
      .where("c.created_by_user_id", normalizedActorUserId)
      .where("c.surface_id", normalizedSurfaceId);
    applyWorkspaceScope(query, "c.workspace_id", workspaceId);
    const row = await applyForUpdate(query, options).first();

    return row ? mapConversationRow(row) : null;
  }

  async function create(payload = {}, options = {}) {
    const client = options?.trx || knex;
    const now = new Date();
    const surfaceId = normalizeRequiredSurfaceId(payload.surfaceId);
    const insertResult = await client(assistantRuntimeConfig.conversationsTable).insert({
      workspace_id: normalizeWorkspaceId(payload.workspaceId),
      created_by_user_id: normalizeInputRecordId(payload.createdByUserId),
      title: normalizeText(payload.title) || DEFAULT_CONVERSATION_TITLE,
      status: normalizeText(payload.status).toLowerCase() || "active",
      provider: normalizeText(payload.provider),
      model: normalizeText(payload.model),
      surface_id: surfaceId,
      message_count: Math.max(0, Number(payload.messageCount || 0)),
      metadata_json: stringifyJsonObject(payload.metadata),
      started_at: payload.startedAt ? new Date(payload.startedAt) : now,
      ended_at: payload.endedAt ? new Date(payload.endedAt) : null,
      created_at: now,
      updated_at: now
    });
    const id = resolveInsertedId(insertResult);
    if (!id) {
      throw new Error("conversationsRepository.create could not resolve inserted id.");
    }

    return findById(id, {
      trx: client
    });
  }

  async function updateById(conversationId, patch = {}, options = {}) {
    const normalizedConversationId = normalizeInputRecordId(conversationId);
    if (!normalizedConversationId) {
      return null;
    }

    const client = options?.trx || knex;
    const updatePatch = {};

    if (Object.hasOwn(patch, "title")) {
      updatePatch.title = normalizeText(patch.title) || DEFAULT_CONVERSATION_TITLE;
    }
    if (Object.hasOwn(patch, "status")) {
      updatePatch.status = normalizeText(patch.status).toLowerCase() || "active";
    }
    if (Object.hasOwn(patch, "provider")) {
      updatePatch.provider = normalizeText(patch.provider);
    }
    if (Object.hasOwn(patch, "model")) {
      updatePatch.model = normalizeText(patch.model);
    }
    if (Object.hasOwn(patch, "surfaceId")) {
      updatePatch.surface_id = normalizeRequiredSurfaceId(patch.surfaceId);
    }
    if (Object.hasOwn(patch, "messageCount")) {
      updatePatch.message_count = Math.max(0, Number(patch.messageCount || 0));
    }
    if (Object.hasOwn(patch, "endedAt")) {
      updatePatch.ended_at = patch.endedAt ? new Date(patch.endedAt) : null;
    }
    if (Object.hasOwn(patch, "metadata")) {
      updatePatch.metadata_json = stringifyJsonObject(patch.metadata);
    }

    if (Object.keys(updatePatch).length > 0) {
      updatePatch.updated_at = new Date();
      await client(assistantRuntimeConfig.conversationsTable)
        .where({ id: normalizedConversationId })
        .update(updatePatch);
    }

    return findById(normalizedConversationId, {
      trx: client
    });
  }

  async function listForActorScope(
    { workspaceId = null, actorUserId = null, surfaceId = "", pagination = {}, filters = {} } = {},
    options = {}
  ) {
    const normalizedActorUserId = normalizeInputRecordId(actorUserId);
    const normalizedSurfaceId = normalizeSurfaceId(surfaceId);
    if (!normalizedActorUserId || !normalizedSurfaceId) {
      return {
        items: [],
        nextCursor: null
      };
    }

    const client = options?.trx || knex;
    const { cursor, limit } = normalizeCursorPagination(pagination);
    let query = createConversationBaseQuery(client)
      .where("c.created_by_user_id", normalizedActorUserId)
      .where("c.surface_id", normalizedSurfaceId);
    query = applyWorkspaceScope(query, "c.workspace_id", workspaceId);

    const normalizedStatus = normalizeText(filters.status).toLowerCase();
    if (normalizedStatus) {
      query = query.where("c.status", normalizedStatus);
    }
    if (cursor) {
      query = query.where("c.id", "<", cursor);
    }

    const rows = await query
      .orderBy("c.id", "desc")
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map(mapConversationRow);
    const nextCursor = hasMore && pageRows.length > 0
      ? normalizeDbRecordId(pageRows[pageRows.length - 1].id, { fallback: null })
      : null;

    return {
      items,
      nextCursor
    };
  }

  async function transaction(callback) {
    return runInTransaction(knex, callback);
  }

  return Object.freeze({
    withTransaction,
    findById,
    findByIdForActorScope,
    create,
    updateById,
    listForActorScope,
    transaction
  });
}

export { createRepository };
