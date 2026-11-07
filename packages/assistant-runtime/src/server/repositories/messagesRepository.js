import { normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  normalizeInputRecordId,
  parseJsonObject,
  stringifyJsonObject,
  toIso,
  toWrittenDateTime
} from "./repositoryPersistenceUtils.js";

function mapMessageRecord(record = {}) {
  return {
    id: normalizeRecordId(record.id, { fallback: "" }),
    conversationId: normalizeRecordId(record.conversationId, { fallback: "" }),
    workspaceId: normalizeInputRecordId(record.workspaceId),
    seq: Number(record.seq),
    role: String(record.role || ""),
    kind: String(record.kind || "chat"),
    clientMessageSid: String(record.clientMessageSid || ""),
    actorUserId: record.actorUserId == null ? null : normalizeInputRecordId(record.actorUserId),
    contentText: record.contentText == null ? null : String(record.contentText),
    metadata: parseJsonObject(record.metadataJson),
    createdAt: toIso(record.createdAt)
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

/**
 * A conversation's messages, on the assistantMessages table. Callers reach
 * them by conversation id after checking that conversation's actor scope; a
 * workspace's messages are read in that workspace, the rest in the system context.
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.messages
 * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext
 */
function createRepository({ messages, systemContext }) {
  const messageContext = systemContext("messages reached by conversation id after the caller checked the conversation's actor scope");

  // A workspace's messages in that workspace; messages without one in the system context, filtered to none.
  function scoped(workspaceId, options) {
    return workspaceId
      ? { filters: {}, options: { ...options, context: messageContext.forWorkspace(workspaceId) } }
      : { filters: { workspaceId: null }, options: { ...options, context: messageContext } };
  }

  function withTransaction(options, work) {
    return messages.withTransaction(options, work);
  }

  function transaction(work) {
    return messages.withTransaction({}, work);
  }

  async function findById(messageId, options = {}) {
    const normalizedMessageId = normalizeInputRecordId(messageId);
    if (!normalizedMessageId) {
      return null;
    }

    const record = await messages.get(normalizedMessageId, {}, { ...options, context: messageContext, missing: "skip" });
    return record ? mapMessageRecord(record) : null;
  }

  // The conversation's highest seq, across its workspaces, or 0.
  async function highestSequence(conversationId, options) {
    const [row] = await messages.aggregate({
      measures: { maxSeq: { max: "seq" } },
      filters: { conversationId }
    }, { ...options, context: messageContext });
    const maxSeq = Number(row?.maxSeq || 0);
    return Number.isInteger(maxSeq) && maxSeq > 0 ? maxSeq : 0;
  }

  async function create(payload = {}, options = {}) {
    const conversationId = normalizeInputRecordId(payload.conversationId);
    if (!conversationId) {
      throw new TypeError("messagesRepository.create requires conversationId.");
    }

    const providedSeq = Number(payload.seq);
    const seq = Number.isInteger(providedSeq) && providedSeq > 0 ? providedSeq : (await highestSequence(conversationId, options)) + 1;
    const workspaceId = normalizeInputRecordId(payload.workspaceId);
    const created = await messages.create({
      conversationId,
      workspaceId,
      seq,
      role: normalizeText(payload.role).toLowerCase(),
      kind: normalizeText(payload.kind).toLowerCase() || "chat",
      clientMessageSid: normalizeText(payload.clientMessageSid),
      actorUserId: normalizeInputRecordId(payload.actorUserId),
      contentText: payload.contentText == null ? null : String(payload.contentText),
      metadataJson: stringifyJsonObject(payload.metadata),
      createdAt: toWrittenDateTime(payload.createdAt)
    }, scoped(workspaceId, options).options);

    return mapMessageRecord(created);
  }

  async function countByConversationScope(conversationId, { workspaceId = null } = {}, options = {}) {
    const normalizedConversationId = normalizeInputRecordId(conversationId);
    if (!normalizedConversationId) {
      return 0;
    }

    const scope = scoped(normalizeInputRecordId(workspaceId), options);
    const [row] = await messages.aggregate({
      measures: { total: { count: "*" } },
      filters: { ...scope.filters, conversationId: normalizedConversationId }
    }, scope.options);

    const total = Number(row?.total || 0);
    return Number.isFinite(total) && total > 0 ? total : 0;
  }

  async function updateById(messageId, patch = {}, options = {}) {
    const id = normalizeInputRecordId(messageId);
    if (!id) return null;
    const changes = {};
    if (Object.hasOwn(patch, "contentText")) changes.contentText = patch.contentText == null ? null : String(patch.contentText);
    if (Object.hasOwn(patch, "metadata")) changes.metadataJson = stringifyJsonObject(patch.metadata);
    if (Object.keys(changes).length) {
      await messages.patch(id, changes, { ...options, context: messageContext, missing: "skip", returning: "none" });
    }
    return findById(id, options);
  }

  // One numbered page of the conversation's messages in seq order, in one statement.
  async function listByConversationScope(conversationId, { workspaceId = null } = {}, pagination = {}, options = {}) {
    const normalizedConversationId = normalizeInputRecordId(conversationId);
    if (!normalizedConversationId) {
      return [];
    }

    const { page, pageSize } = normalizePagination(pagination);
    const scope = scoped(normalizeInputRecordId(workspaceId), options);
    const { records } = await messages.query({
      filters: { ...scope.filters, conversationId: normalizedConversationId },
      sort: ["seq", "id"],
      page: { size: pageSize, number: page }
    }, scope.options);
    return records.map(mapMessageRecord);
  }

  async function lastSequence(conversationId, options = {}) {
    const normalizedConversationId = normalizeInputRecordId(conversationId);
    if (!normalizedConversationId) return 0;
    return highestSequence(normalizedConversationId, options);
  }

  return Object.freeze({
    withTransaction,
    findById,
    create,
    updateById,
    countByConversationScope,
    listByConversationScope,
    lastSequence,
    transaction
  });
}

export { createRepository };
