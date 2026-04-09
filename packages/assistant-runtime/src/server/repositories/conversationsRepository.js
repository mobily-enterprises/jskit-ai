import { runInTransaction } from "@jskit-ai/database-runtime/shared/repositoryOptions";
import { parsePositiveInteger } from "@jskit-ai/kernel/server/runtime";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  parseJsonObject,
  resolveInsertedId,
  stringifyJsonObject,
  toIso
} from "@jskit-ai/assistant-core/server";
import { assistantRuntimeConfig } from "../../shared/assistantRuntimeConfig.js";

function normalizeWorkspaceId(value) {
  return parsePositiveInteger(value) || null;
}

function normalizeRequiredSurfaceId(value) {
  const normalizedSurfaceId = normalizeSurfaceId(value);
  if (!normalizedSurfaceId) {
    throw new TypeError("conversationsRepository requires surfaceId.");
  }

  return normalizedSurfaceId;
}

function applyWorkspaceScope(query, columnName, workspaceId) {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  if (normalizedWorkspaceId) {
    return query.where(columnName, normalizedWorkspaceId);
  }

  return query.whereNull(columnName);
}

function mapConversationRow(row = {}) {
  return {
    id: Number(row.id),
    workspaceId: normalizeWorkspaceId(row.workspace_id),
    title: String(row.title || "New conversation"),
    createdByUserId: row.created_by_user_id == null ? null : Number(row.created_by_user_id),
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
  const cursor = parsePositiveInteger(pagination.cursor) || 0;
  const limit = Math.max(1, Math.min(maxLimit, parsePositiveInteger(pagination.limit) || defaultLimit));

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

  async function findById(conversationId, options = {}) {
    const numericConversationId = parsePositiveInteger(conversationId);
    if (!numericConversationId) {
      return null;
    }

    const client = options?.trx || knex;
    const row = await createConversationBaseQuery(client)
      .where("c.id", numericConversationId)
      .first();

    return row ? mapConversationRow(row) : null;
  }

  async function findByIdForActorScope(
    conversationId,
    { workspaceId = null, actorUserId = null, surfaceId = "" } = {},
    options = {}
  ) {
    const numericConversationId = parsePositiveInteger(conversationId);
    const numericActorUserId = parsePositiveInteger(actorUserId);
    const normalizedSurfaceId = normalizeSurfaceId(surfaceId);
    if (!numericConversationId || !numericActorUserId || !normalizedSurfaceId) {
      return null;
    }

    const client = options?.trx || knex;
    const query = createConversationBaseQuery(client)
      .where("c.id", numericConversationId)
      .where("c.created_by_user_id", numericActorUserId)
      .where("c.surface_id", normalizedSurfaceId);
    applyWorkspaceScope(query, "c.workspace_id", workspaceId);
    const row = await query.first();

    return row ? mapConversationRow(row) : null;
  }

  async function create(payload = {}, options = {}) {
    const client = options?.trx || knex;
    const now = new Date();
    const surfaceId = normalizeRequiredSurfaceId(payload.surfaceId);
    const insertResult = await client(assistantRuntimeConfig.conversationsTable).insert({
      workspace_id: normalizeWorkspaceId(payload.workspaceId),
      created_by_user_id: parsePositiveInteger(payload.createdByUserId) || null,
      title: normalizeText(payload.title) || "New conversation",
      status: normalizeText(payload.status).toLowerCase() || "active",
      provider: normalizeText(payload.provider),
      model: normalizeText(payload.model),
      surface_id: surfaceId,
      message_count: parsePositiveInteger(payload.messageCount) || 0,
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
    const numericConversationId = parsePositiveInteger(conversationId);
    if (!numericConversationId) {
      return null;
    }

    const client = options?.trx || knex;
    const updatePatch = {};

    if (Object.hasOwn(patch, "title")) {
      updatePatch.title = normalizeText(patch.title) || "New conversation";
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
        .where({ id: numericConversationId })
        .update(updatePatch);
    }

    return findById(numericConversationId, {
      trx: client
    });
  }

  async function incrementMessageCount(conversationId, delta = 1, options = {}) {
    const numericConversationId = parsePositiveInteger(conversationId);
    if (!numericConversationId) {
      return null;
    }

    const client = options?.trx || knex;
    const incrementBy = Number.isInteger(Number(delta)) ? Number(delta) : 1;
    await client(assistantRuntimeConfig.conversationsTable)
      .where({ id: numericConversationId })
      .update({
        message_count: client.raw("GREATEST(0, message_count + ?)", [incrementBy]),
        updated_at: new Date()
      });

    return findById(numericConversationId, {
      trx: client
    });
  }

  async function listForActorScope(
    { workspaceId = null, actorUserId = null, surfaceId = "", pagination = {}, filters = {} } = {},
    options = {}
  ) {
    const numericActorUserId = parsePositiveInteger(actorUserId);
    const normalizedSurfaceId = normalizeSurfaceId(surfaceId);
    if (!numericActorUserId || !normalizedSurfaceId) {
      return {
        items: [],
        nextCursor: null
      };
    }

    const client = options?.trx || knex;
    const { cursor, limit } = normalizeCursorPagination(pagination);
    let query = createConversationBaseQuery(client)
      .where("c.created_by_user_id", numericActorUserId)
      .where("c.surface_id", normalizedSurfaceId);
    query = applyWorkspaceScope(query, "c.workspace_id", workspaceId);

    const normalizedStatus = normalizeText(filters.status).toLowerCase();
    if (normalizedStatus) {
      query = query.where("c.status", normalizedStatus);
    }
    if (cursor > 0) {
      query = query.where("c.id", "<", cursor);
    }

    const rows = await query
      .orderBy("c.id", "desc")
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map(mapConversationRow);
    const nextCursor = hasMore && pageRows.length > 0 ? String(pageRows[pageRows.length - 1].id) : null;

    return {
      items,
      nextCursor
    };
  }

  async function transaction(callback) {
    return runInTransaction(knex, callback);
  }

  return Object.freeze({
    findById,
    findByIdForActorScope,
    create,
    updateById,
    incrementMessageCount,
    listForActorScope,
    transaction
  });
}

export { createRepository };
