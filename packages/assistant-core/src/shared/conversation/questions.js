import { parseAnswerChoicePrompt } from "./answerChoiceSugar.js";
import { parseNumberedQuestionPrompt } from "./numberedQuestionSugar.js";

const ASSISTANT_QUESTION_LOOKBACK = 10;

function messageText(value = "") {
  return String(value || "").trim();
}

function conversationTurns(conversationLog = {}) {
  // readable-check: allow no-optional-after-default - data: the conversation is null until a caller knows it
  if (Array.isArray(conversationLog?.turns)) {
    return conversationLog.turns;
  }
  return Array.isArray(conversationLog) ? conversationLog : [];
}

/**
 * The conversation's messages, newest first. A turn without a message list
 * offers its person's message first, then its reply, then its commentary.
 */
function* messagesNewestFirst(conversationLog) {
  const turns = conversationTurns(conversationLog);
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    const messages = Array.isArray(turn?.messages) ? turn.messages : [];
    if (messages.length) {
      for (let index = messages.length - 1; index >= 0; index -= 1) yield messages[index];
      continue;
    }
    if (turn?.user) yield { ...turn.user, role: "user" };
    if (turn?.assistant) yield { ...turn.assistant, role: "assistant" };
    const commentary = Array.isArray(turn?.commentary) ? turn.commentary : [];
    for (let index = commentary.length - 1; index >= 0; index -= 1) yield { ...commentary[index], role: "commentary" };
  }
}

/** The same messages for which the standard composer offers answer fields. */
function asksPerson(text) {
  return parseNumberedQuestionPrompt(text).questions.length > 0 || parseAnswerChoicePrompt(text).choices.length > 0;
}

function latestAssistantMessageAwaitingUserReply(conversationLog = {}) {
  for (const message of messagesNewestFirst(conversationLog)) {
    const text = messageText(message?.text);
    if (!text) {
      continue;
    }
    if (message?.role === "user") {
      return "";
    }
    if (message?.role === "assistant") {
      return message.status === "inProgress" ? "" : text;
    }
  }
  return "";
}

/**
 * The text of the newest AI message that asks the person numbered questions or
 * offers answer choices and still awaits their reply, or "". The search starts at
 * the AI's newest completed reply, the message latestAssistantMessageAwaitingUserReply
 * returns, so nothing is offered while the AI is still writing or working before it.
 * From there it reads that reply and the AI's earlier replies and commentary, at most
 * `lookback` of them, and stops at the person's latest message. A short message the
 * AI adds after its questions therefore no longer hides them.
 * @param {object | object[]} conversationLog
 * @param {{ lookback?: number }} [options]
 */
function latestAssistantQuestionsAwaitingUserReply(conversationLog = {}, { lookback = ASSISTANT_QUESTION_LOOKBACK } = {}) {
  let replied = false;
  let read = 0;
  for (const message of messagesNewestFirst(conversationLog)) {
    const text = messageText(message?.text);
    if (!text) {
      continue;
    }
    if (message?.role === "user") {
      return "";
    }
    if (message?.role === "assistant" && !replied) {
      if (message.status === "inProgress") return "";
      replied = true;
    }
    if (!replied || !["assistant", "commentary"].includes(message?.role)) {
      continue;
    }
    if (asksPerson(text)) {
      return text;
    }
    read += 1;
    if (read >= lookback) {
      return "";
    }
  }
  return "";
}

export {
  latestAssistantMessageAwaitingUserReply,
  latestAssistantQuestionsAwaitingUserReply
};
