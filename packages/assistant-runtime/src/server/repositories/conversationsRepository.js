import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import {
  normalizeInputRecordId,
  parseJsonObject,
  stringifyJsonObject,
  toIso,
  toWrittenDateTime
} from "./repositoryPersistenceUtils.js";
import { DEFAULT_CONVERSATION_TITLE } from "../../shared/assistantRuntimeConfig.js";


function normalizeRequiredSurfaceId(value) {
  const normalizedSurfaceId = normalizeSurfaceId(value);
  if (!normalizedSurfaceId) {
    throw new TypeError("conversationsRepository requires surfaceId.");
  }

  return normalizedSurfaceId;
}

// What a list shows of a conversation: never its runtime metadata (the system prompt, every tool's schema and
// a note per message ever written), which grows with the conversation and only a read of it needs.
const LIST_FIELDS = Object.freeze(["workspaceId", "userId", "title", "status", "provider", "model", "surfaceId", "messageCount",
  "startedAt", "endedAt", "createdAt", "updatedAt"]);

function mapConversationSummary(record = {}) {
  const { metadata: _metadata, ...summary } = mapConversationRecord(record);
  return summary;
}

function mapConversationRecord(record = {}) {
  return {
    id: normalizeRecordId(record.id, { fallback: "" }),
    workspaceId: normalizeInputRecordId(record.workspaceId),
    title: String(record.title || DEFAULT_CONVERSATION_TITLE),
    createdByUserId: record.userId == null ? null : normalizeInputRecordId(record.userId),
    status: String(record.status || "active"),
    provider: String(record.provider || ""),
    model: String(record.model || ""),
    surfaceId: String(record.surfaceId || ""),
    startedAt: toIso(record.startedAt),
    endedAt: record.endedAt ? toIso(record.endedAt) : null,
    messageCount: Number(record.messageCount || 0),
    metadata: parseJsonObject(record.metadataJson),
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt)
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

// json-rest-api refuses a row lock outside a transaction; callers have always seen this TypeError.
function rethrowLockError(error) {
  if (error?.type === "rest_api_lock_outside_transaction") {
    throw new TypeError("Locking a conversation requires its database transaction.");
  }
  throw error;
}

// A record patch as stored fields, with updatedAt stamped when anything changes.
function conversationChanges(patch) {
  const changes = {};

  if (Object.hasOwn(patch, "title")) {
    changes.title = normalizeText(patch.title) || DEFAULT_CONVERSATION_TITLE;
  }
  if (Object.hasOwn(patch, "status")) {
    changes.status = normalizeText(patch.status).toLowerCase() || "active";
  }
  if (Object.hasOwn(patch, "provider")) {
    changes.provider = normalizeText(patch.provider);
  }
  if (Object.hasOwn(patch, "model")) {
    changes.model = normalizeText(patch.model);
  }
  if (Object.hasOwn(patch, "surfaceId")) {
    changes.surfaceId = normalizeRequiredSurfaceId(patch.surfaceId);
  }
  if (Object.hasOwn(patch, "messageCount")) {
    changes.messageCount = Math.max(0, Number(patch.messageCount || 0));
  }
  if (Object.hasOwn(patch, "endedAt")) {
    changes.endedAt = patch.endedAt ? toWrittenDateTime(patch.endedAt) : null;
  }
  if (Object.hasOwn(patch, "metadata")) {
    changes.metadataJson = stringifyJsonObject(patch.metadata);
  }
  if (Object.keys(changes).length > 0) {
    changes.updatedAt = toWrittenDateTime();
  }
  return changes;
}

/**
 * The assistant's conversations, on the assistantConversations table. A
 * conversation's actor reads it in that actor's user context; the transcript
 * storage, which reaches a conversation by id after its caller's actor check,
 * and creates without a valid creator use the system context.
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.conversations
 * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext
 */
function createRepository({ conversations, systemContext }) {
  const conversationContext = systemContext("a conversation reached by id after its caller checked the actor scope, or created without a valid creator");

  function withTransaction(options, work) {
    return conversations.withTransaction(options, work);
  }

  function transaction(work, { retries } = {}) {
    return conversations.withTransaction({ retry: retries !== 0 }, work);
  }

  // The record as `context` sees it, under a row lock when asked.
  async function readRecord(id, { forUpdate = false, ...options }, context) {
    const scoped = { ...passedOn(options), context };
    if (forUpdate !== true) {
      return conversations.get(id, {}, { ...scoped, missing: "skip" });
    }
    const [locked] = await conversations.lockMany([id], { ...scoped, missing: "skip" }).catch(rethrowLockError);
    return locked || null;
  }

  async function findById(conversationId, options = {}) {
    const normalizedConversationId = normalizeInputRecordId(conversationId);
    if (!normalizedConversationId) {
      return null;
    }

    const record = await readRecord(normalizedConversationId, options, conversationContext);
    return record ? mapConversationRecord(record) : null;
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

    const record = await readRecord(normalizedConversationId, options, conversationContext.forUser(normalizedActorUserId));
    if (!record || record.surfaceId !== normalizedSurfaceId ||
        normalizeInputRecordId(record.workspaceId) !== normalizeInputRecordId(workspaceId)) {
      return null;
    }

    return mapConversationRecord(record);
  }

  async function create(payload = {}, options = {}) {
    const now = toWrittenDateTime();
    const surfaceId = normalizeRequiredSurfaceId(payload.surfaceId);
    const createdByUserId = normalizeInputRecordId(payload.createdByUserId);
    const attributes = {
      workspaceId: normalizeInputRecordId(payload.workspaceId),
      title: normalizeText(payload.title) || DEFAULT_CONVERSATION_TITLE,
      status: normalizeText(payload.status).toLowerCase() || "active",
      provider: normalizeText(payload.provider),
      model: normalizeText(payload.model),
      surfaceId,
      messageCount: Math.max(0, Number(payload.messageCount || 0)),
      metadataJson: stringifyJsonObject(payload.metadata),
      startedAt: payload.startedAt ? toWrittenDateTime(payload.startedAt) : now,
      endedAt: payload.endedAt ? toWrittenDateTime(payload.endedAt) : null,
      createdAt: now,
      updatedAt: now
    };
    // A conversation without a valid creator is stored with none, so it is created in the system context.
    const created = createdByUserId
      ? await conversations.create(attributes, { ...passedOn(options), context: conversationContext.forUser(createdByUserId) })
      : await conversations.create({ ...attributes, userId: null }, { ...passedOn(options), context: conversationContext });

    return mapConversationRecord(created);
  }

  async function updateById(conversationId, patch = {}, options = {}) {
    const normalizedConversationId = normalizeInputRecordId(conversationId);
    if (!normalizedConversationId) {
      return null;
    }

    const changes = conversationChanges(patch);
    if (Object.keys(changes).length > 0) {
      await conversations.patch(normalizedConversationId, changes, {
        ...passedOn(options),
        context: conversationContext,
        missing: "skip",
        returning: "none"
      });
    }

    return findById(normalizedConversationId, passedOn(options));
  }

  /**
   * The conversation and its transcript's own state, its revision and summary, from one read (under a row lock with
   * `forUpdate`), or null. The transcript state stays out of the record, which reaches the browser.
   * @param {unknown} conversationId
   * @param {{ forUpdate?: boolean, context?: object | null, trx?: object | null }} [options]
   */
  async function findWithTranscriptState(conversationId, options = {}) {
    const id = normalizeInputRecordId(conversationId);
    if (!id) return null;
    const record = await readRecord(id, options, conversationContext);
    if (!record) return null;
    return {
      conversation: mapConversationRecord(record),
      revision: record.transcriptRevision || "",
      summary: record.summaryText == null ? null
        : { text: String(record.summaryText), throughTurnId: String(record.summaryThroughTurnId || "") }
    };
  }

  /**
   * Writes the transcript's revision and summary and, in the same statement, the record changes of `changes` (as
   * updateById takes them), so a save that appends messages updates its conversation once. An unknown id writes nothing.
   * @param {unknown} conversationId
   * @param {{ revision: string, summary: { text: string, throughTurnId: string } | null, changes?: Record<string, unknown> }} state
   * @param {{ context?: object | null, trx?: object | null }} [options]
   */
  async function writeTranscriptState(conversationId, { revision, summary, changes = {} }, options = {}) {
    const id = normalizeInputRecordId(conversationId);
    if (!id) throw new TypeError("writeTranscriptState requires conversationId.");
    await conversations.patch(id, {
      ...conversationChanges(changes),
      transcriptRevision: revision,
      summaryText: summary ? summary.text : null,
      summaryThroughTurnId: summary ? summary.throughTurnId : null
    }, { ...passedOn(options), context: conversationContext, missing: "skip", returning: "none" });
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

    const { cursor, limit } = normalizeCursorPagination(pagination);
    const normalizedStatus = normalizeText(filters.status).toLowerCase();
    const { records, page } = await conversations.query({
      filters: {
        surfaceId: normalizedSurfaceId,
        workspaceId: normalizeInputRecordId(workspaceId),
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
        ...(cursor ? { beforeId: cursor } : {})
      },
      sort: ["-id"],
      fields: LIST_FIELDS,
      page: { size: limit }
    }, { ...passedOn(options), context: conversationContext.forUser(normalizedActorUserId) });

    const items = records.map(mapConversationSummary);
    const nextCursor = page.hasMore && items.length > 0 ? items[items.length - 1].id : null;

    return {
      items,
      nextCursor
    };
  }

  return Object.freeze({
    withTransaction,
    findById,
    findByIdForActorScope,
    create,
    updateById,
    listForActorScope,
    findWithTranscriptState,
    writeTranscriptState,
    transaction
  });
}

export { createRepository };
