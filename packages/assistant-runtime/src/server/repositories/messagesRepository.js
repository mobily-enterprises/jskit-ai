import { runInTransaction } from "@jskit-ai/database-runtime/shared/repositoryOptions";
import { parsePositiveInteger } from "@jskit-ai/kernel/server/runtime";
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

function applyWorkspaceScope(query, columnName, workspaceId) {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  if (normalizedWorkspaceId) {
    return query.where(columnName, normalizedWorkspaceId);
  }

  return query.whereNull(columnName);
}

function mapMessageRow(row = {}) {
  return {
    id: Number(row.id),
    conversationId: Number(row.conversation_id),
    workspaceId: normalizeWorkspaceId(row.workspace_id),
    seq: Number(row.seq),
    role: String(row.role || ""),
    kind: String(row.kind || "chat"),
    clientMessageSid: String(row.client_message_sid || ""),
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    contentText: row.content_text == null ? null : String(row.content_text),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: toIso(row.created_at)
  };
}

function normalizePagination(pagination = {}, { defaultPage = 1, defaultPageSize = 200, maxPageSize = 500 } = {}) {
  const page = Math.max(1, parsePositiveInteger(pagination.page) || defaultPage);
  const pageSize = Math.max(1, Math.min(maxPageSize, parsePositiveInteger(pagination.pageSize) || defaultPageSize));

  return {
    page,
    pageSize
  };
}

async function resolveNextSequence(client, conversationId) {
  const row = await client(assistantRuntimeConfig.messagesTable)
    .where({ conversation_id: conversationId })
    .max({ maxSeq: "seq" })
    .first();
  const maxSeq = Number(row?.maxSeq || 0);
  if (!Number.isInteger(maxSeq) || maxSeq < 0) {
    return 1;
  }

  return maxSeq + 1;
}

function createRepository(knex) {
  if (!knex || typeof knex !== "function") {
    throw new Error("createMessagesRepository requires knex client.");
  }

  async function findById(messageId, options = {}) {
    const numericMessageId = parsePositiveInteger(messageId);
    if (!numericMessageId) {
      return null;
    }

    const client = options?.trx || knex;
    const row = await client(assistantRuntimeConfig.messagesTable)
      .where({ id: numericMessageId })
      .first();

    return row ? mapMessageRow(row) : null;
  }

  async function create(payload = {}, options = {}) {
    const client = options?.trx || knex;
    const conversationId = parsePositiveInteger(payload.conversationId);
    if (!conversationId) {
      throw new TypeError("messagesRepository.create requires conversationId.");
    }

    const seq = parsePositiveInteger(payload.seq) || (await resolveNextSequence(client, conversationId));
    const insertResult = await client(assistantRuntimeConfig.messagesTable).insert({
      conversation_id: conversationId,
      workspace_id: normalizeWorkspaceId(payload.workspaceId),
      seq,
      role: normalizeText(payload.role).toLowerCase(),
      kind: normalizeText(payload.kind).toLowerCase() || "chat",
      client_message_sid: normalizeText(payload.clientMessageSid),
      actor_user_id: parsePositiveInteger(payload.actorUserId) || null,
      content_text: payload.contentText == null ? null : String(payload.contentText),
      metadata_json: stringifyJsonObject(payload.metadata),
      created_at: payload.createdAt ? new Date(payload.createdAt) : new Date()
    });
    const id = resolveInsertedId(insertResult);
    if (!id) {
      throw new Error("messagesRepository.create could not resolve inserted id.");
    }

    return findById(id, {
      trx: client
    });
  }

  async function countByConversationScope(conversationId, { workspaceId = null } = {}, options = {}) {
    const numericConversationId = parsePositiveInteger(conversationId);
    if (!numericConversationId) {
      return 0;
    }

    const client = options?.trx || knex;
    const query = client(assistantRuntimeConfig.messagesTable).where({
      conversation_id: numericConversationId
    });
    applyWorkspaceScope(query, "workspace_id", workspaceId);
    const row = await query.count({ total: "*" }).first();

    const total = Number(row?.total || 0);
    return Number.isFinite(total) && total > 0 ? total : 0;
  }

  async function listByConversationScope(conversationId, { workspaceId = null } = {}, pagination = {}, options = {}) {
    const numericConversationId = parsePositiveInteger(conversationId);
    if (!numericConversationId) {
      return [];
    }

    const client = options?.trx || knex;
    const { page, pageSize } = normalizePagination(pagination);
    const offset = (page - 1) * pageSize;

    const query = client(assistantRuntimeConfig.messagesTable).where({
      conversation_id: numericConversationId
    });
    applyWorkspaceScope(query, "workspace_id", workspaceId);
    const rows = await query
      .orderBy("seq", "asc")
      .orderBy("id", "asc")
      .limit(pageSize)
      .offset(offset);

    return rows.map(mapMessageRow);
  }

  async function transaction(callback) {
    return runInTransaction(knex, callback);
  }

  return Object.freeze({
    findById,
    create,
    countByConversationScope,
    listByConversationScope,
    transaction
  });
}

export { createRepository };
