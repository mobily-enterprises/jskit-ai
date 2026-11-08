import { normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { passedOn } from "@jskit-ai/resource-runtime/server/callOptions";
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

// A conversation id list per query, so its "in" list stays well inside every database's limits.
const CONVERSATION_IDS_PER_QUERY = 1000;

// Whether message a was written after b: the later createdAt, then the higher id.
function isNewer(a, b) {
  const byTime = Date.parse(toIso(a.createdAt)) - Date.parse(toIso(b.createdAt));
  return byTime !== 0 ? byTime > 0 : BigInt(a.id) > BigInt(b.id);
}

/**
 * A conversation's messages, on the assistantMessages table. Callers reach
 * them by conversation id after checking that conversation's actor scope; a
 * workspace's messages are read in that workspace, the rest in the system context.
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.messages
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.conversations The
 *   assistantConversations table's handle, for the conversations of one user.
 * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext
 */
function createRepository({ messages, conversations, systemContext }) {
  const messageContext = systemContext("messages reached by conversation id after the caller checked the conversation's actor scope");
  const userContext = systemContext("the newest assistant message among one user's conversations, which the caller is entitled to read");

  // A workspace's messages in that workspace; messages without one in the system context, filtered to none.
  function scoped(workspaceId, options) {
    return workspaceId
      ? { filters: {}, options: { ...passedOn(options), context: messageContext.forWorkspace(workspaceId) } }
      : { filters: { workspaceId: null }, options: { ...passedOn(options), context: messageContext } };
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

    const record = await messages.get(normalizedMessageId, {}, { ...passedOn(options), context: messageContext, missing: "skip" });
    return record ? mapMessageRecord(record) : null;
  }

  // The conversation's highest seq, across its workspaces, or 0.
  async function highestSequence(conversationId, options) {
    const [row] = await messages.aggregate({
      measures: { maxSeq: { max: "seq" } },
      filters: { conversationId }
    }, { ...passedOn(options), context: messageContext });
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
      await messages.patch(id, changes, { ...passedOn(options), context: messageContext, missing: "skip", returning: "none" });
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

  /**
   * The newest assistant message (the latest createdAt, then the highest id)
   * in any of one user's conversations, in every workspace and surface, or
   * null; with `kind`, the newest of that kind, such as "chat" for a reply.
   * Two reads for a user with up to 1,000 conversations: their ids, then the
   * newest message among them.
   * @param {unknown} userId
   * @param {{ kind?: string }} [criteria]
   * @param {{ context?: object | null, trx?: object | null }} [options]
   */
  async function findNewestAssistantByUserId(userId, { kind = "" } = {}, options = {}) {
    const normalizedUserId = normalizeInputRecordId(userId);
    if (!normalizedUserId) {
      return null;
    }

    const owned = await conversations.queryAll(
      { filters: { userId: normalizedUserId }, fields: ["userId"] },
      { ...passedOn(options), context: userContext.forUser(normalizedUserId) }
    );
    const conversationIds = owned.map((conversation) => normalizeRecordId(conversation.id, { fallback: "" })).filter(Boolean);
    const normalizedKind = normalizeText(kind).toLowerCase();
    let newest = null;
    for (let start = 0; start < conversationIds.length; start += CONVERSATION_IDS_PER_QUERY) {
      const { records: [candidate] } = await messages.query({
        filters: {
          conversationIds: conversationIds.slice(start, start + CONVERSATION_IDS_PER_QUERY),
          role: "assistant",
          ...(normalizedKind ? { kind: normalizedKind } : {})
        },
        sort: ["-createdAt", "-id"],
        page: { size: 1 }
      }, { ...passedOn(options), context: messageContext });
      if (candidate && (!newest || isNewer(candidate, newest))) {
        newest = candidate;
      }
    }
    return newest ? mapMessageRecord(newest) : null;
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
    findNewestAssistantByUserId,
    lastSequence,
    transaction
  });
}

export { createRepository };
