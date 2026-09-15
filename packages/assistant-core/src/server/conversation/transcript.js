import { normalizeText } from "./normalize.js";

/** Conversation policy, independent of database, filesystem, identity and HTTP. */
export function createConversationTranscript({ storage, clock = () => new Date() } = {}) {
  if (typeof storage?.read !== "function" || typeof storage?.write !== "function") {
    throw new TypeError("Conversation storage requires read(scope, callback) and write(scope, callback).");
  }

  async function readConversationLog(scope) {
    return storage.read(scope, async (transaction) => {
      const ids = await transaction.listTurnIds();
      return (await Promise.all(ids.map((id) => transaction.readTurn(id)))).filter(hasMessages);
    });
  }

  async function readConversationLogPage(scope, { beforeTurnId = "", limit = 0 } = {}) {
    return storage.read(scope, async (transaction) => {
      const ids = await transaction.listTurnIds();
      const before = normalizeText(beforeTurnId);
      const requestedLimit = Number.parseInt(String(limit || ""), 10);
      const pageLimit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 0;
      const end = before && ids.includes(before) ? ids.indexOf(before) : ids.length;
      const start = pageLimit ? Math.max(0, end - pageLimit) : 0;
      const selected = ids.slice(start, end);
      const turns = (await Promise.all(selected.map((id) => transaction.readTurn(id)))).filter(hasMessages);
      return {
        conversationLog: turns,
        pagination: {
          beforeTurnId: before,
          count: turns.length,
          hasMoreBefore: start > 0,
          limit: pageLimit,
          newestTurnId: turns.at(-1)?.turnId || "",
          nextBeforeTurnId: start > 0 ? turns[0]?.turnId || selected[0] || "" : "",
          oldestTurnId: turns[0]?.turnId || "",
          totalTurnCount: ids.length
        }
      };
    });
  }

  async function tailTurn(transaction) {
    const ids = await transaction.listTurnIds();
    return ids.length ? transaction.readTurn(ids.at(-1)) : null;
  }

  async function append(scope, role, { text = "", messageId = "", at = "", attachments = [], turnMetadata = null, requireOpenTurn = false } = {}) {
    const messageText = normalizeText(text);
    const id = normalizeText(messageId);
    if (!messageText) return null;
    return storage.write(scope, async (transaction) => {
      if (id && await transaction.hasMessage(id)) return null;
      const createdAt = new Date(at || clock());
      const tail = ["assistant", "commentary", "thinking"].includes(role) ? await tailTurn(transaction) : null;
      const open = tail?.user && !tail.assistant ? tail : null;
      if (requireOpenTurn && !open) return null;
      const thinkingOnly = role === "thinking" && !open && at && tail &&
        !tail.system && !tail.user && !tail.assistant && !tail.commentary?.length &&
        tail.thinking?.some((message) => message.at === createdAt.toISOString());
      const turnId = open?.turnId || (thinkingOnly ? tail.turnId : await transaction.nextTurnId());
      await transaction.appendMessage(turnId, {
        role, text: messageText, messageId: id, at: createdAt.toISOString(),
        ...(role === "user" ? { attachments, turnMetadata } : {})
      });
      return transaction.readTurn(turnId);
    });
  }

  return Object.freeze({
    readConversationLog,
    readConversationLogPage,
    conversationMessageIdExists: (scope, messageId) => storage.read(scope, (transaction) => transaction.hasMessage(normalizeText(messageId))),
    writeConversationUserMessage: (scope, input) => append(scope, "user", input),
    writeConversationAssistantMessage: (scope, input) => append(scope, "assistant", input),
    writeConversationCommentaryMessage: (scope, input) => append(scope, "commentary", input),
    writeConversationThinkingMessage: (scope, input) => append(scope, "thinking", input),
    writeConversationSystemMessage: (scope, input) => append(scope, "system", input),
    async upsertConversationAssistantMessage(scope, { turnId = "", text = "" } = {}) {
      const messageText = normalizeText(text);
      if (!messageText) return null;
      return storage.write(scope, async (transaction) => {
        const id = normalizeText(turnId);
        await transaction.replaceAssistant(id, { role: "assistant", text: messageText, at: new Date(clock()).toISOString() });
        return transaction.readTurn(id);
      });
    }
  });
}

function hasMessages(turn) {
  return Boolean(turn && (turn.system || turn.user || turn.assistant || turn.commentary?.length || turn.thinking?.length));
}
