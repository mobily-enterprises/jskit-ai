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

/** Existing SQL rows remain authoritative. Core supplies the transaction methods;
 * the database owns locking, sequence allocation and commit/rollback together.
 */
function createSqlConversationStorage({ conversationsRepository, messagesRepository }) {
  async function load(id, trx, write = false) {
    const conversation = await conversationsRepository.findById(id, { trx, forUpdate: write });
    if (!conversation) throw new AppError(404, "Conversation not found.");
    const rows = [];
    for (let page = 1; ; page += 1) {
      const batch = await messagesRepository.listByConversationScope(id, { workspaceId: conversation.workspaceId }, { page, pageSize: 500 }, { trx });
      rows.push(...batch);
      if (batch.length < 500) break;
    }
    return { conversation, rows, projection: inspectSqlConversationRows(conversation, rows) };
  }

  async function save(id, loaded, record, trx) {
    const { conversation, projection } = loaded;
    let added = 0;
    let title = conversation.title;
    const persist = async (previous, fields) => {
      if (previous) {
        if (previous.contentText !== fields.contentText || !isDeepStrictEqual(previous.metadata, fields.metadata)) {
          await messagesRepository.updateById(previous.id, { contentText: fields.contentText, metadata: fields.metadata }, { trx });
        }
      } else {
        await messagesRepository.create({ conversationId: id, workspaceId: conversation.workspaceId,
          actorUserId: conversation.createdByUserId, ...fields }, { trx });
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
  }

  async function access(id, operation, write) {
    for (let attempt = 0; ; attempt += 1) {
      let entered = false;
      try {
        return await conversationsRepository.transaction(async trx => {
          const loaded = await load(id, trx, write);
          requireUnambiguous(loaded.projection);
          const storage = createConversationStorage({
            readRecord: () => loaded.projection.record,
            writeRecord: (_scope, record) => save(id, loaded, record, trx)
          });
          entered = true;
          return storage[write ? "write" : "read"](id, operation);
        });
      } catch (error) {
        // SQLite cannot wait asynchronously for another connection's writer.
        // Retry acquiring the snapshot/lock only; never replay a caller or save.
        if (entered || error.code !== "SQLITE_BUSY" || attempt >= 5) throw error;
        await delay(10 * 2 ** attempt);
      }
    }
  }

  return Object.freeze({
    read: (id, operation) => access(id, operation, false),
    write: (id, operation) => access(id, operation, true),
    preflight(id) {
      return conversationsRepository.transaction(async trx => {
        const { rows, projection } = await load(id, trx);
        return { conversationId: id, rowCount: rows.length, issues: projection.issues };
      });
    }
  });
}

export { createSqlConversationStorage, inspectSqlConversationRows };
