import { normalizeThinkingMessageText } from "./thinkingText.js";
import { normalizeConversationLogPagination } from "./pagination.js";

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeConversationMessage(message = {}, { normalizeAttachments = value => Array.isArray(value) ? value : [] } = {}) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }
  const role = String(message.role || "").trim();
  const text = role === "thinking"
    ? normalizeThinkingMessageText(message.text)
    : String(message.text || "").trim();
  if (!role || !text) {
    return null;
  }
  const attachments = normalizeAttachments(message.attachments);
  return {
    at: String(message.at || "").trim(),
    ...(attachments.length ? { attachments } : {}),
    ...(String(message.messageId || "").trim()
      ? { messageId: String(message.messageId).trim() }
      : {}),
    role,
    text,
    ...(message.receipt === false ? { receipt: false } : {})
  };
}

function chronologicalConversationActivity(messages = []) {
  return [...messages].sort((left, right) => (
    String(left?.at || "").localeCompare(String(right?.at || ""))
  ));
}

function normalizeConversationTurn(turn = {}, index = 0, options = {}) {
  if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
    return null;
  }
  const user = normalizeConversationMessage(turn.user, options);
  const assistant = normalizeConversationMessage(turn.assistant, options);
  const normalizedCommentary = Array.isArray(turn.commentary)
    ? turn.commentary.map(message => normalizeConversationMessage(message, options)).filter(Boolean)
    : [];
  const system = normalizeConversationMessage(turn.system, options);
  const normalizedThinking = Array.isArray(turn.thinking)
    ? turn.thinking.map(message => normalizeConversationMessage(message, options)).filter(Boolean)
    : [];
  const activityFromMessages = Array.isArray(turn.messages)
    ? turn.messages
      .map(message => normalizeConversationMessage(message, options))
      .filter((message) => ["commentary", "thinking"].includes(message?.role))
    : [];
  const activity = activityFromMessages.length
    ? activityFromMessages
    : chronologicalConversationActivity([...normalizedThinking, ...normalizedCommentary]);
  const commentary = activity.filter((message) => message.role === "commentary");
  const thinking = activity.filter((message) => message.role === "thinking");
  if (!system && !user && !assistant && !activity.length) {
    return null;
  }
  return {
    assistant,
    commentary,
    messages: [system, user, ...activity, assistant].filter(Boolean),
    ...(isRecord(turn.metadata) ? { metadata: turn.metadata } : {}),
    ...(system ? { system } : {}),
    thinking,
    turnId: String(turn.turnId || index + 1).trim(),
    user
  };
}

function applyConversationLogPatch(payload = {}, patch = null, options = {}) {
  if (patch?.type !== "upsert-turn" || !isRecord(patch.turn)) {
    return null;
  }
  const source = isRecord(payload) ? payload : {};
  const turns = Array.isArray(source.conversationLog) ? source.conversationLog : [];
  const turnId = String(patch.turn.turnId || "").trim();
  if (!turnId) {
    return null;
  }
  const existingIndex = turns.findIndex((turn) => String(turn?.turnId || "").trim() === turnId);
  const existing = turns[existingIndex];
  const updated = { ...existing, ...patch.turn };
  if (existing) {
    // An upsert adds delivered messages. An older partial turn must not remove
    // a saved answer or progress; authoritative history arrives through a fresh read.
    for (const role of ["system", "user", "assistant"]) {
      if (existing[role] && !updated[role]) {
        updated[role] = existing[role];
      }
    }
    const existingTurn = normalizeConversationTurn(existing, 0, options);
    const patchedTurn = normalizeConversationTurn(patch.turn, 0, options);
    for (const role of ["thinking", "commentary"]) {
      const messages = new Map();
      for (const message of [...(existingTurn?.[role] || []), ...(patchedTurn?.[role] || [])]) {
        // Timestamped progress without a message ID updates one saved file as
        // its text grows. Match that identity instead of retaining each version.
        const key = message.messageId || JSON.stringify(message.at
          ? [message.role, message.at]
          : [message.role, "", message.text]);
        messages.set(key, message);
      }
      updated[role] = chronologicalConversationActivity([...messages.values()]);
    }
    updated.messages = [
      updated.system,
      updated.user,
      ...chronologicalConversationActivity([...updated.thinking, ...updated.commentary]),
      updated.assistant
    ].filter(Boolean);
  }
  const nextTurns = (existingIndex >= 0
    ? turns.map((turn, index) => index === existingIndex ? updated : turn)
    : [...turns, patch.turn]
  ).sort((left, right) => String(left?.turnId || "").localeCompare(
    String(right?.turnId || ""),
    undefined,
    {
      numeric: true
    }
  ));
  const limit = Number.parseInt(String(options.limit || ""), 10);
  const limitedTurns = Number.isFinite(limit) && limit > 0
    ? nextTurns.slice(-limit)
    : nextTurns;
  const wasTrimmed = limitedTurns.length < nextTurns.length;
  const pagination = normalizeConversationLogPagination(source.pagination);
  const hasMoreBefore = pagination.hasMoreBefore || wasTrimmed;
  const oldestTurnId = String(limitedTurns[0]?.turnId || "").trim();
  return {
    ...source,
    conversationLog: limitedTurns,
    pagination: {
      ...pagination,
      count: limitedTurns.length,
      hasMoreBefore,
      newestTurnId: String(limitedTurns.at(-1)?.turnId || "").trim(),
      nextBeforeTurnId: hasMoreBefore ? oldestTurnId : "",
      oldestTurnId
    }
  };
}

export { normalizeConversationMessage, normalizeConversationTurn, applyConversationLogPatch };
