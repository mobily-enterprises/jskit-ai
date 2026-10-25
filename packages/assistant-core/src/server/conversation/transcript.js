import { normalizeNullableText } from "./normalize.js";
import { conversationLogPage } from "../../shared/conversation/pagination.js";

/** Conversation policy, independent of database, filesystem, identity and HTTP. */
export function createConversationTranscript({ storage, clock = () => new Date(), applicationTurns = false } = {}) {
  if (typeof storage?.read !== "function" || typeof storage?.write !== "function") {
    throw new TypeError("Conversation storage requires read(scope, callback) and write(scope, callback).");
  }

  async function readConversationLog(scope, { presentation = false } = {}) {
    if (typeof presentation !== "boolean") throw new TypeError("Transcript presentation requires an explicit boolean.");
    return storage.read(scope, async (transaction) => {
      const ids = await transaction.listTurnIds();
      const turns = (await Promise.all(ids.map((id) => transaction.readTurn(id)))).filter(hasMessages);
      return presentation ? turns.filter(turn => !isCompletedEnvelopeTurn(turn)) : turns;
    });
  }

  async function readConversationLogPage(scope, { beforeTurnId = "", limit = 0, presentation = false, pageUnit = "turns" } = {}) {
    if (typeof presentation !== "boolean") throw new TypeError("Transcript presentation requires an explicit boolean.");
    if (!["turns", "messages"].includes(pageUnit)) throw new TypeError("Transcript pageUnit must be turns or messages.");
    return storage.read(scope, async (transaction) => {
      const allIds = await transaction.listTurnIds();
      const visible = presentation || pageUnit === "messages"
        ? (await Promise.all(allIds.map(id => transaction.readTurn(id))))
          .filter(turn => hasMessages(turn) && (!presentation || !isCompletedEnvelopeTurn(turn))) : null;
      const ids = visible ? visible.map(turn => turn.turnId) : allIds;
      const before = normalizeNullableText(beforeTurnId);
      const requestedLimit = Number.parseInt(String(limit || ""), 10);
      const pageLimit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 0;
      let page;
      if (pageUnit === "messages") {
        page = conversationLogPage(visible, { beforeTurnId: before, limit: pageLimit });
      } else {
        const end = before && ids.includes(before) ? ids.indexOf(before) : ids.length;
        const start = pageLimit ? Math.max(0, end - pageLimit) : 0;
        const selected = ids.slice(start, end);
        page = {
          conversationLog: visible ? visible.slice(start, end)
            : (await Promise.all(selected.map(id => transaction.readTurn(id)))).filter(hasMessages),
          hasMoreBefore: start > 0,
          nextBeforeTurnId: start > 0 ? ids[start] : ""
        };
      }
      const turns = page.conversationLog;
      return {
        conversationLog: turns,
        pagination: {
          ...(pageUnit === "messages" ? { pageUnit } : {}),
          beforeTurnId: before,
          count: turns.length,
          hasMoreBefore: page.hasMoreBefore,
          limit: pageLimit,
          newestTurnId: turns.at(-1)?.turnId || "",
          nextBeforeTurnId: page.nextBeforeTurnId,
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

  async function append(scope, role, { text = "", messageId = "", at = "", attachments = [], data, turnMetadata = null, requireOpenTurn = false, outputId = "", turnId: requestedTurnId = "" } = {}) {
    const messageText = normalizeNullableText(text);
    const id = normalizeNullableText(messageId);
    if (!messageText && !(role === "user" && Array.isArray(attachments) && attachments.length)) return null;
    return storage.write(scope, async (transaction) => {
      if (id && await transaction.hasMessage(id)) return null;
      const createdAt = new Date(at || clock());
      const targetId = ["assistant", "commentary", "thinking"].includes(role) ? normalizeNullableText(requestedTurnId) : "";
      const target = targetId ? await transaction.readTurn(targetId) : null;
      if (targetId && !target) throw new Error("The native output's original turn no longer exists.");
      const tail = target || (["assistant", "commentary", "thinking"].includes(role) ? await tailTurn(transaction) : null);
      const open = (tail?.user || applicationTurns && tail?.system?.origin === "application") && !tail.assistant ? tail : null;
      if (requireOpenTurn && !open) return null;
      const thinkingOnly = role === "thinking" && !open && at && tail &&
        !tail.system && !tail.user && !tail.assistant && !tail.commentary?.length &&
        tail.thinking?.some((message) => message.at === createdAt.toISOString());
      const turnId = target?.turnId || open?.turnId || (thinkingOnly ? tail.turnId : await transaction.nextTurnId());
      await transaction.appendMessage(turnId, {
        role, text: messageText, messageId: id, at: createdAt.toISOString(),
        ...(["assistant", "commentary", "thinking"].includes(role) && normalizeNullableText(outputId) ? { outputId: normalizeNullableText(outputId) } : {}),
        ...(role === "user" ? { attachments, turnMetadata } : {}),
        ...(data !== undefined ? { data: structuredClone(data) } : {})
      });
      return transaction.readTurn(turnId);
    });
  }

  // The first turn whose submitted (user or application) message has this ID.
  async function findSubmittedTurn(scope, messageId) {
    const id = normalizeNullableText(messageId);
    if (!id) return null;
    return storage.read(scope, async (transaction) => {
      const submitted = turn => hasMessages(turn) && (turn.user || turn.system)?.messageId === id ? turn : null;
      if (typeof transaction.findMessageTurnId === "function") {
        const turnId = await transaction.findMessageTurnId(id);
        if (!turnId) return null;
        const turn = submitted(await transaction.readTurn(turnId));
        if (turn) return turn;
      }
      for (const turnId of await transaction.listTurnIds()) {
        const turn = submitted(await transaction.readTurn(turnId));
        if (turn) return turn;
      }
      return null;
    });
  }

  return Object.freeze({
    readConversationLog,
    findSubmittedTurn,
    readConversationLogPage,
    conversationMessageIdExists: (scope, messageId) => storage.read(scope, (transaction) => transaction.hasMessage(normalizeNullableText(messageId))),
    writeConversationUserMessage: (scope, input) => append(scope, "user", input),
    writeConversationAssistantMessage: (scope, input) => append(scope, "assistant", input),
    writeConversationCommentaryMessage: (scope, input) => append(scope, "commentary", input),
    writeConversationThinkingMessage: (scope, input) => append(scope, "thinking", input),
    writeConversationSystemMessage: (scope, input) => append(scope, "system", input),
    async upsertConversationAssistantMessage(scope, { turnId = "", text = "" } = {}) {
      const messageText = normalizeNullableText(text);
      if (!messageText) return null;
      return storage.write(scope, async (transaction) => {
        const id = normalizeNullableText(turnId);
        await transaction.replaceAssistant(id, { role: "assistant", text: messageText, at: new Date(clock()).toISOString() });
        return transaction.readTurn(id);
      });
    }
  });
}

function hasMessages(turn) {
  return Boolean(turn && (turn.system || turn.user || turn.assistant || turn.commentary?.length || turn.thinking?.length));
}

// Only the future server-owned application response marker identifies a private carrier.
export function isCompletedEnvelopeTurn(turn) {
  return turn?.metadata?.runtime?.origin === "application" && turn.metadata.runtime.completedEnvelope === true;
}
