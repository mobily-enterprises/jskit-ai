import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { createConversationStorage } from "@jskit-ai/assistant-core/server/conversation";
import { deriveConversationTitleFromMessage, isDefaultConversationTitle } from "./services/transcriptService.js";

const roles = new Set(["user", "system", "assistant", "commentary", "thinking"]);
const authored = row => row.kind === "chat" && ["user", "system"].includes(row.role);
const rowLink = row => row.metadata?.conversationRuntime;

function messageFromRow(row) {
  const { turnId: _turnId, turnMetadata: _turnMetadata, ...fields } = rowLink(row) || {};
  return { ...fields, role: row.role, text: row.contentText || "", at: row.createdAt,
    messageId: authored(row) ? row.clientMessageSid : fields.messageId || "",
    ...(row.metadata?.attachments ? { attachments: structuredClone(row.metadata.attachments) } : {}) };
}

/** Read-only projection. Historical ambiguities are reported, never repaired. */
function inspectSqlConversationRows(conversation, rows) {
  const turns = new Map();
  const groups = new Map();
  const issues = [];
  const receipts = new Map();
  let previousLegacy = null;
  const issue = (code, ...entries) => issues.push({ code, rowIds: entries.filter(Boolean).map(row => row.id) });
  for (const row of rows) {
    const link = rowLink(row);
    if (link !== undefined && (!link || typeof link.turnId !== "string" || !link.turnId)) {
      issue("invalid_turn_link", row);
      continue;
    }
    let id = link?.turnId;
    if (authored(row)) {
      if (!link && previousLegacy) issue("overlapping_historical_turns", previousLegacy, row);
      id ||= row.id;
      if (groups.has(id)) { issue("duplicate_turn", groups.get(id).anchor, row); continue; }
      if (row.clientMessageSid && receipts.has(row.clientMessageSid)) issue("duplicate_message_receipt", receipts.get(row.clientMessageSid), row);
      if (row.clientMessageSid) receipts.set(row.clientMessageSid, row);
      groups.set(id, { anchor: row, messages: [], calls: new Map(), results: new Map(), explicit: Boolean(link) });
      turns.set(id, { messages: [], ...(link?.turnMetadata ? { metadata: structuredClone(link.turnMetadata) } : {}) });
      previousLegacy = link ? null : row;
    } else if (!id) {
      id = previousLegacy?.id;
    }
    const group = groups.get(id);
    if (!group) { issue("orphan_output", row); continue; }
    if (roles.has(row.role) && (row.kind === "chat" || link && row.kind === row.role)) {
      if (row.role === "assistant" && group.messages.some(entry => entry.role === "assistant")) {
        issue("multiple_historical_answers", group.anchor, row);
        continue;
      }
      group.messages.push(row);
      turns.get(id).messages.push(messageFromRow(row));
      if (!link && row.role === "assistant") previousLegacy = null;
    } else if (["tool_call", "tool_result"].includes(row.kind)) {
      const callId = row.metadata?.toolCallId;
      const target = row.kind === "tool_call" ? group.calls : group.results;
      if (typeof callId !== "string" || !callId || target.has(callId)) issue("ambiguous_tool_identity", target.get(callId), row);
      else target.set(callId, row);
    } else issue("unsupported_message_shape", row);
  }
  for (const [id, group] of groups) {
    const tools = [];
    for (const [callId, row] of group.calls) {
      const resultRow = group.results.get(callId);
      let result;
      if (resultRow) {
        try { result = JSON.parse(resultRow.contentText); } catch { issue("invalid_tool_result", resultRow); }
        if (!result || typeof result.ok !== "boolean" || resultRow.metadata.tool !== row.metadata.tool) {
          issue("conflicting_tool_result", row, resultRow);
        }
      } else if (!group.explicit) issue("unconfirmed_historical_tool", row);
      tools.push({ id: callId, name: row.metadata.tool, arguments: row.contentText || "", at: row.createdAt,
        status: rowLink(row)?.status || (result ? !result.ok && result.error?.status >= 500 ? "unknown" : "complete" : "running"),
        ...(result ? { result } : {}) });
    }
    for (const [callId, row] of group.results) if (!group.calls.has(callId)) issue("orphan_tool_result", row);
    if (tools.length) turns.get(id).metadata = { ...turns.get(id).metadata, applicationTools: tools };
  }
  return { record: { metadata: structuredClone(conversation.metadata || {}), turns }, groups, issues };
}

function requireUnambiguous(projection) {
  if (!projection.issues.length) return;
  throw new AppError(409, "This conversation has ambiguous historical SQL rows. Inspect the reported rows offline before using the common runtime; no history was changed.", {
    code: "assistant_history_inspection_required", details: { issues: projection.issues }
  });
}

// Rows kept in memory across every cached conversation. A conversation with more rows
// than this is read from the database on each access.
const CACHED_ROWS = 50_000;

/** Existing SQL rows remain authoritative. Core supplies the transaction methods;
 * the database owns locking, sequence allocation and commit/rollback together.
 * Each conversation's rows stay cached while its transcript revision and last message
 * sequence are unchanged. Every save that changes rows or the summary writes a new
 * random revision under the conversation lock, so a save by another server makes the
 * next access read the rows again, as does a row inserted without this storage; the
 * cache takes a save only after its transaction commits.
 * @param {object} dependencies
 * @param {import("./types.js").ConversationsRepository} dependencies.conversationsRepository
 * @param {import("./types.js").MessagesRepository} dependencies.messagesRepository
 */
function createSqlConversationStorage({ conversationsRepository, messagesRepository }) {
  const cache = new Map();
  let cachedRows = 0;

  function forget(id) {
    const entry = cache.get(id);
    if (!entry) return;
    cache.delete(id);
    cachedRows -= entry.rows.length;
  }

  function remember(id, entry) {
    forget(id);
    if (!entry.revision || entry.rows.length > CACHED_ROWS) return;
    cache.set(id, entry);
    cachedRows += entry.rows.length;
    for (const [oldest, value] of cache) {
      if (cachedRows <= CACHED_ROWS) break;
      cache.delete(oldest);
      cachedRows -= value.rows.length;
    }
  }

  async function readRows(id, conversation, trx) {
    const rows = [];
    for (let page = 1; ; page += 1) {
      const batch = await messagesRepository.listByConversationScope(id, { workspaceId: conversation.workspaceId }, { page, pageSize: 500 }, { trx });
      rows.push(...batch);
      if (batch.length < 500) break;
    }
    return rows;
  }

  async function load(id, trx, write = false) {
    const conversation = await conversationsRepository.findById(id, { trx, forUpdate: write });
    if (!conversation) throw new AppError(404, "Conversation not found.", { code: "assistant.runtime.conversation.notFound" });
    const { revision, summary } = await conversationsRepository.readTranscriptState(id, { trx });
    const lastSeq = await messagesRepository.lastSequence(id, { trx });
    let saved = cache.get(id);
    if (saved && revision && saved.revision === revision && saved.lastSeq === lastSeq) remember(id, saved);
    else {
      const rows = await readRows(id, conversation, trx);
      saved = { revision, lastSeq, rows, projection: inspectSqlConversationRows(conversation, rows) };
      remember(id, saved);
    }
    const { projection } = saved;
    const record = { ...projection.record, metadata: structuredClone(conversation.metadata || {}), ...(summary ? { summary } : {}) };
    return { conversation, summary, lastSeq, rows: saved.rows, projection: { ...projection, record }, next: null };
  }

  async function save(id, loaded, record, trx) {
    const { conversation, projection } = loaded;
    let added = 0;
    let title = conversation.title;
    const updated = new Map();
    const inserted = [];
    const persist = async (previous, fields) => {
      if (previous) {
        if (previous.contentText !== fields.contentText || !isDeepStrictEqual(previous.metadata, fields.metadata)) {
          updated.set(previous.id, await messagesRepository.updateById(previous.id, { contentText: fields.contentText, metadata: fields.metadata }, { trx }));
        }
      } else {
        inserted.push(await messagesRepository.create({ conversationId: id, workspaceId: conversation.workspaceId,
          actorUserId: conversation.createdByUserId, ...fields }, { trx }));
        added += 1;
      }
    };
    for (const [turnId, turn] of record.turns) {
      const original = projection.record.turns.get(turnId);
      if (isDeepStrictEqual(turn, original)) continue;
      const group = projection.groups.get(turnId);
      const { applicationTools = [], ...turnMetadata } = turn.metadata || {};
      for (const message of turn.messages) {
        const previous = group?.messages.find(row => row.role === message.role &&
          (message.role === "assistant" || messageFromRow(row).messageId === message.messageId && row.createdAt === message.at));
        const { role, text, at, attachments, messageId, ...fields } = message;
        const isAuthored = ["user", "system"].includes(role);
        const metadata = { ...previous?.metadata, ...(isAuthored ? { surfaceId: conversation.surfaceId } : {}), ...(attachments ? { attachments } : {}),
          conversationRuntime: { turnId, ...fields, ...(!isAuthored && messageId ? { messageId } : {}),
            ...(isAuthored ? { turnMetadata } : {}) } };
        await persist(previous, { role, kind: ["commentary", "thinking"].includes(role) ? role : "chat",
          clientMessageSid: isAuthored ? messageId : "", contentText: text, createdAt: at, metadata });
        if (!previous && role === "user" && isDefaultConversationTitle(title)) title = deriveConversationTitleFromMessage(text) || title;
      }
      for (const call of applicationTools) {
        const previous = group?.calls.get(call.id);
        await persist(previous, { role: "assistant", kind: "tool_call", contentText: call.arguments, createdAt: call.at,
          metadata: { ...previous?.metadata, toolCallId: call.id, tool: call.name,
            conversationRuntime: { turnId, status: call.status } } });
        if (call.result) {
          const previousResult = group?.results.get(call.id);
          await persist(previousResult, { role: "assistant", kind: "tool_result", contentText: JSON.stringify(call.result),
            metadata: { ...previousResult?.metadata, toolCallId: call.id, tool: call.name, ok: call.result.ok === true,
              conversationRuntime: { turnId } } });
        }
      }
    }
    const patch = { ...(added ? { messageCount: conversation.messageCount + added } : {}),
      ...(title !== conversation.title ? { title } : {}),
      ...(!isDeepStrictEqual(record.metadata, conversation.metadata) ? { metadata: record.metadata } : {}) };
    if (Object.keys(patch).length) await conversationsRepository.updateById(id, patch, { trx });
    const summary = record.summary ? { text: record.summary.text, throughTurnId: record.summary.throughTurnId } : null;
    if (!updated.size && !inserted.length && isDeepStrictEqual(summary, loaded.summary)) return;
    const revision = randomUUID();
    await conversationsRepository.writeTranscriptState(id, { revision, summary }, { trx });
    const rows = loaded.rows.map(row => updated.get(row.id) || row).concat(inserted);
    loaded.next = { revision, lastSeq: Math.max(loaded.lastSeq, ...inserted.map(row => row.seq)), rows,
      projection: inspectSqlConversationRows(conversation, rows) };
  }

  async function access(id, operation, write) {
    for (let attempt = 0; ; attempt += 1) {
      let entered = false;
      let loaded = null;
      try {
        const result = await conversationsRepository.transaction(async trx => {
          loaded = await load(id, trx, write);
          requireUnambiguous(loaded.projection);
          const storage = createConversationStorage({
            readRecord: () => loaded.projection.record,
            writeRecord: (_scope, record) => save(id, loaded, record, trx)
          });
          entered = true;
          return storage[write ? "write" : "read"](id, operation);
        }, { retries: 0 });
        if (loaded.next) remember(id, loaded.next);
        return result;
      } catch (error) {
        // SQLite cannot wait asynchronously for another connection's writer.
        // Retry acquiring the snapshot/lock only; never replay a caller or save,
        // so a deadlock victim is not run again either.
        if (entered || error.code !== "SQLITE_BUSY" || attempt >= 5) throw error;
        await delay(10 * 2 ** attempt);
      }
    }
  }

  function read(id, operation) {
    return access(id, operation, false);
  }

  function write(id, operation) {
    return access(id, operation, true);
  }

  function preflight(id) {
    return conversationsRepository.transaction(async trx => {
      const { rows, projection } = await load(id, trx);
      return { conversationId: id, rowCount: rows.length, issues: projection.issues };
    });
  }

  return Object.freeze({
    read,
    write,
    preflight
  });
}

export { createSqlConversationStorage, inspectSqlConversationRows };
