// Stopped native storage inspection, and retirement of a native family after the host's durable preservation.
import { Buffer } from "node:buffer";
import path from "node:path";
import { createNativeHistoryExport, readStoppedNativeDatabase, retireNativeConversation } from "./nativeHistoryExport.js";
import { normalizedMessageRows, openCodeAssistantMessageText } from "./openCodeClient.js";

/** Inspect stopped native storage without starting OpenCode or changing its files. */
async function readOpenCodeConversationDatabase({ databasePath, conversationId, onMessage, signal } = {}) {
  if (!path.isAbsolute(databasePath || "") || !/^ses_[a-zA-Z0-9_]{1,256}$/u.test(conversationId || "") ||
      typeof onMessage !== "function") throw new TypeError("OpenCode inspection requires its exact database, conversation and message reader.");
  const unavailable = () => new Error("OpenCode native storage could not be inspected completely. Keep its writers stopped and inspect its original database before retrying.");
  try {
    return await readStoppedNativeDatabase(databasePath, async database => {
      const session = database.prepare("SELECT * FROM session WHERE id = ?").get(conversationId);
      if (!session || session.id !== conversationId || !path.isAbsolute(session.directory || "")) throw unavailable();
      if (database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'session_input'").get() &&
          database.prepare("SELECT 1 FROM session_input WHERE session_id = ? AND promoted_seq IS NULL LIMIT 1").get(conversationId)) {
        throw new Error("OpenCode has an unpromoted native request. Inspect it before restoring continuity; no request was repeated.");
      }
      const output = createNativeHistoryExport(async ({ message }) => onMessage(normalizedMessageRows([message])[0]), { signal });
      const parts = database.prepare("SELECT id, message_id, session_id, data FROM part WHERE message_id = ? ORDER BY id");
      for (const row of database.prepare("SELECT id, session_id, data FROM message WHERE session_id = ? ORDER BY time_created, id").iterate(conversationId)) {
        signal?.throwIfAborted();
        if (!/^msg_[a-zA-Z0-9_]{1,256}$/u.test(row.id)) throw unavailable();
        let bytes = Buffer.byteLength(row.data);
        if (bytes > 64 * 1024 * 1024) throw unavailable();
        const data = JSON.parse(row.data);
        if (!data || typeof data !== "object" || Array.isArray(data) || !["user", "assistant"].includes(data.role)) throw unavailable();
        const content = [];
        for (const part of parts.iterate(row.id)) {
          signal?.throwIfAborted();
          bytes += Buffer.byteLength(part.data);
          if (bytes > 64 * 1024 * 1024 || part.session_id !== conversationId || part.message_id !== row.id ||
              !/^prt_[a-zA-Z0-9_]{1,256}$/u.test(part.id)) throw unavailable();
          const value = JSON.parse(part.data);
          if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
          content.push({ ...value, id: part.id, sessionID: part.session_id, messageID: part.message_id });
        }
        // Same original MessageV2 storage projection: native columns own IDs.
        await output.emit({ type: "message", message: { info: { ...data, id: row.id, sessionID: row.session_id }, parts: content }, text: [] });
      }
      return { session, ...output.complete() };
    }, { signal });
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (String(error?.message || "").startsWith("OpenCode ") ||
        String(error?.message || "").startsWith("Native storage ")) throw error;
    throw unavailable();
  }
}

// Native preservation uses the storage API independently of the saved worktree.
// Status still comes from the exact directory-scoped control client.
async function inspectOpenCodeConversationFamily(storageClient, controlClient, binding, { signal } = {}) {
  const queue = [binding.conversationId];
  const seen = new Set();
  const records = [];
  for (let index = 0; index < queue.length; index += 1) {
    signal?.throwIfAborted();
    const conversationId = queue[index];
    if (seen.has(conversationId) || queue.length > 1000) throw new Error("OpenCode native family is cyclic or exceeds its inventory limit.");
    seen.add(conversationId);
    let native;
    try { native = await storageClient.readConversationStorage(conversationId, { signal }); }
    catch (error) { if (error.statusCode === 404 && index === 0) return []; throw error; }
    if (native?.id !== conversationId || native?.directory !== binding.workdir ||
        (await controlClient.sessionStatus(conversationId, { signal })).type !== "idle") {
      throw new Error("OpenCode retirement requires an idle native family in the exact saved directory.");
    }
    records.push({ conversationId, workdir: native.directory,
      ...(Number.isFinite(native.time?.created) ? { createdAt: new Date(native.time.created).toISOString() } : {}),
      ...(Number.isFinite(native.time?.updated) ? { updatedAt: new Date(native.time.updated).toISOString() } : {}) });
    const children = await storageClient.listConversationChildren(conversationId, { signal });
    for (const child of children) {
      if (child.directory !== binding.workdir) throw new Error("OpenCode child directory differs from its saved owner.");
      queue.push(child.id);
    }
  }
  return records.sort((left, right) => left.conversationId.localeCompare(right.conversationId));
}

async function exportOpenCodeNativeHistory(storageClient, controlClient, id, onRecord, { signal: inputSignal } = {}) {
  const deadline = AbortSignal.timeout(300_000);
  const signal = inputSignal ? AbortSignal.any([inputSignal, deadline]) : deadline;
  const output = createNativeHistoryExport(onRecord, { signal });
  const info = await storageClient.readConversationStorage(id, { signal });
  if (info?.id !== id || (await controlClient.sessionStatus(id, { signal })).type !== "idle") {
    throw new Error("OpenCode native export requires the exact idle conversation.");
  }
  await output.emit({ type: "thread", thread: info, text: [] });
  const messageIds = new Set();
  const cursors = new Set();
  let before = "";
  let pages = 0;
  while (true) {
    signal.throwIfAborted();
    if (++pages > 20_000) throw new Error("OpenCode native export exceeded its page limit; history was not retired.");
    const response = await storageClient.readConversationStoragePage(id, { before, signal });
    if (!Array.isArray(response?.data) || response.data.length > 1 ||
        (response.nextCursor !== null && (typeof response.nextCursor !== "string" || !response.nextCursor || response.nextCursor.length > 8192)) ||
        (response.data.length === 0 && response.nextCursor !== null)) {
      throw new Error("OpenCode returned an incomplete or invalid native message page.");
    }
    for (const message of response.data) {
      const info = message?.info;
      if (!/^msg_[a-zA-Z0-9_]{1,256}$/u.test(info?.id) || info.sessionID !== id ||
          !["user", "assistant"].includes(info.role) || !Array.isArray(message.parts) || messageIds.has(info.id)) {
        throw new Error("OpenCode returned an invalid or duplicate native message.");
      }
      messageIds.add(info.id);
      const content = openCodeAssistantMessageText({ content: message.parts });
      await output.emit({ type: "message", message, text: content ? [{ role: info.role, text: content,
        branchId: id, messageId: info.id,
        ...(info.parentID ? { parentMessageId: info.parentID } : {}),
        ...(Number.isFinite(info.time?.created) ? { createdAt: new Date(info.time.created).toISOString() } : {}),
        ...(Number.isFinite(info.time?.completed) ? { completedAt: new Date(info.time.completed).toISOString() } : {}),
        ...(info.modelID || info.model?.modelID ? { modelId: info.modelID || info.model.modelID } : {}),
        ...(info.providerID || info.model?.providerID ? { modelProviderId: info.providerID || info.model.providerID } : {}),
        ...(info.agent ? { agent: info.agent } : {}) }] : [] });
    }
    if (response.nextCursor === null) break;
    if (cursors.has(response.nextCursor)) throw new Error("OpenCode repeated a native history cursor.");
    cursors.add(response.nextCursor);
    before = response.nextCursor;
  }
  return output.complete();
}

/** Retire the exact native family after the host's durable preservation. */
async function retireOpenCodeConversationHistory(storageClient, controlClient, binding, options = {}) {
  const inspect = () => inspectOpenCodeConversationFamily(storageClient, controlClient, binding, { signal: options.signal });
  return retireNativeConversation({ binding, inspect, beforeDelete: options.beforeDelete,
    readConversation: async (id) => ({ info: await storageClient.readConversationStorage(id), messages: (await controlClient.messages(id)).data }),
    exportConversation: (id, onRecord) => exportOpenCodeNativeHistory(storageClient, controlClient, id, onRecord, { signal: options.signal }),
    remove: () => controlClient.deleteSession(binding.conversationId) });
}

export {
  readOpenCodeConversationDatabase,
  retireOpenCodeConversationHistory
};
