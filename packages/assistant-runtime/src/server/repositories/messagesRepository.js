import { createWithTransaction, normalizeDbRecordId, runInTransaction } from "@jskit-ai/database-runtime/shared/repositoryOptions";
import { normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  parseJsonObject,
  resolveInsertedId,
  stringifyJsonObject,
  toIso
} from "@jskit-ai/assistant-core/server";
import { assistantRuntimeConfig } from "../../shared/assistantRuntimeConfig.js";

function normalizeWorkspaceId(value) {
  return normalizeRecordId(value, { fallback: null });
}

function normalizeDbWorkspaceId(value) {
  return normalizeDbRecordId(value, { fallback: null });
}

function normalizeInputRecordId(value) {
  return normalizeRecordId(value, { fallback: null });
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
    id: normalizeDbRecordId(row.id, { fallback: "" }),
    conversationId: normalizeDbRecordId(row.conversation_id, { fallback: "" }),
    workspaceId: normalizeDbWorkspaceId(row.workspace_id),
    seq: Number(row.seq),
    role: String(row.role || ""),
    kind: String(row.kind || "chat"),
    clientMessageSid: String(row.client_message_sid || ""),
    actorUserId: row.actor_user_id == null ? null : normalizeDbRecordId(row.actor_user_id, { fallback: null }),
    contentText: row.content_text == null ? null : String(row.content_text),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: toIso(row.created_at)
  };
}

function normalizePagination(pagination = {}, { defaultPage = 1, defaultPageSize = 200, maxPageSize = 500 } = {}) {
  const rawPage = Number(pagination.page);
  const rawPageSize = Number(pagination.pageSize);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : defaultPage;
  const pageSize = Number.isInteger(rawPageSize) && rawPageSize > 0
    ? Math.max(1, Math.min(maxPageSize, rawPageSize))
    : defaultPageSize;

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
  const withTransaction = createWithTransaction(knex);

  async function findById(messageId, options = {}) {
    const normalizedMessageId = normalizeInputRecordId(messageId);
    if (!normalizedMessageId) {
      return null;
    }

    const client = options?.trx || knex;
    const row = await client(assistantRuntimeConfig.messagesTable)
      .where({ id: normalizedMessageId })
      .first();

    return row ? mapMessageRow(row) : null;
  }

  async function create(payload = {}, options = {}) {
    const client = options?.trx || knex;
    const conversationId = normalizeInputRecordId(payload.conversationId);
    if (!conversationId) {
      throw new TypeError("messagesRepository.create requires conversationId.");
    }

    const providedSeq = Number(payload.seq);
    const seq = Number.isInteger(providedSeq) && providedSeq > 0 ? providedSeq : (await resolveNextSequence(client, conversationId));
    const insertResult = await client(assistantRuntimeConfig.messagesTable).insert({
      conversation_id: conversationId,
      workspace_id: normalizeWorkspaceId(payload.workspaceId),
      seq,
      role: normalizeText(payload.role).toLowerCase(),
      kind: normalizeText(payload.kind).toLowerCase() || "chat",
      client_message_sid: normalizeText(payload.clientMessageSid),
      actor_user_id: normalizeInputRecordId(payload.actorUserId),
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
    const normalizedConversationId = normalizeInputRecordId(conversationId);
    if (!normalizedConversationId) {
      return 0;
    }

    const client = options?.trx || knex;
    const query = client(assistantRuntimeConfig.messagesTable).where({
      conversation_id: normalizedConversationId
    });
    applyWorkspaceScope(query, "workspace_id", workspaceId);
    const row = await query.count({ total: "*" }).first();

    const total = Number(row?.total || 0);
    return Number.isFinite(total) && total > 0 ? total : 0;
  }

  async function listByConversationScope(conversationId, { workspaceId = null } = {}, pagination = {}, options = {}) {
    const normalizedConversationId = normalizeInputRecordId(conversationId);
    if (!normalizedConversationId) {
      return [];
    }

    const client = options?.trx || knex;
    const { page, pageSize } = normalizePagination(pagination);
    const offset = (page - 1) * pageSize;

    const query = client(assistantRuntimeConfig.messagesTable).where({
      conversation_id: normalizedConversationId
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
    withTransaction,
    findById,
    create,
    countByConversationScope,
    listByConversationScope,
    transaction
  });
}

export { createRepository };
