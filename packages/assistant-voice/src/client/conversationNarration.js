import {
  VOICE_MAX_SPEECH_TEXT_CHARACTERS,
  speechPauseDurationMs,
  speechPhrases,
  speechTextFromAssistant,
  splitSpeechText
} from "../shared/protocol.js";

const ACTIVITY_SPEECH_CHARACTERS = 300;

function latestConversationFinalNarrationEntry(turns = []) {
  const conversationTurns = Array.isArray(turns) ? turns : [];
  for (let turnIndex = conversationTurns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = conversationTurns[turnIndex];
    const turnId = String(turn?.turnId || turnIndex + 1).trim();
    const finalText = String(turn?.assistant?.text || "").trim();
    if (finalText && turn.assistant.status !== "inProgress") {
      return {
        key: `final:${turnId}`,
        kind: "final",
        text: finalText
      };
    }
  }
  return null;
}

function createConversationNarrationTracker() {
  let primed = false;
  let activityTurnId = "";
  const finalKeys = new Set();
  const activityText = new Map();

  function reset() {
    primed = false;
    activityTurnId = "";
    finalKeys.clear();
    activityText.clear();
  }

  function observe(turns = [], {
    includeFinals = false,
    settled = false,
    enabled = true,
    vocalizeThinking = false,
    vocalizeInterimTurns = false
  } = {}) {
    const conversationTurns = Array.isArray(turns) ? turns : [];
    const turn = conversationTurns.at(-1);
    const turnId = String(turn?.turnId || conversationTurns.length).trim();
    if (turnId !== activityTurnId) {
      activityTurnId = turnId;
      activityText.clear();
    }
    const activity = (Array.isArray(turn?.messages) ? turn.messages : [])
      .filter((message) => ["thinking", "commentary"].includes(message?.role));
    if (!activity.length) {
      activity.push(...[
        ...(Array.isArray(turn?.thinking) ? turn.thinking : []),
        ...(Array.isArray(turn?.commentary) ? turn.commentary : [])
      ].sort((left, right) => String(left?.at || "").localeCompare(String(right?.at || ""))));
    }
    const entries = [];
    for (const [index, message] of activity.entries()) {
      const kind = message?.role;
      if (!["thinking", "commentary"].includes(kind) || message.status === "inProgress") continue;
      const key = `${turnId}:${kind}:${message.messageId || index}`;
      const rawText = String(message.text || "");
      // Track the whole message; only individual outgoing utterances are bounded.
      const phrases = speechPhrases(speechTextFromAssistant(rawText,
        Math.max(rawText.length, VOICE_MAX_SPEECH_TEXT_CHARACTERS)));
      const fullText = phrases.join(" ");
      const complete = settled || index < activity.length - 1 || Boolean(turn?.assistant);
      if (!complete && !speechPauseDurationMs(phrases.at(-1))) phrases.pop();
      const text = phrases.join(" ");
      const previous = activityText.get(key) || "";
      // A later stream observation must not retire a tail already flushed after settling.
      if (text.length < previous.length && fullText.startsWith(previous)) continue;
      activityText.set(key, text);
      const selected = kind === "thinking" ? vocalizeThinking : vocalizeInterimTurns;
      // Observe disabled/old content too, so enabling speech never replays it.
      // A rewritten prefix is also retired instead of speaking it twice.
      if (!primed || !enabled || !selected || !text.startsWith(previous)) continue;
      for (const chunk of splitSpeechText(text.slice(previous.length), ACTIVITY_SPEECH_CHARACTERS)) {
        entries.push({ kind, text: chunk });
      }
    }

    const final = latestConversationFinalNarrationEntry(conversationTurns);
    if (!primed) {
      if (final) finalKeys.add(final.key);
      primed = true;
      return [];
    }
    if (includeFinals && final && !finalKeys.has(final.key)) {
      finalKeys.add(final.key);
      return enabled ? [final] : [];
    }
    return entries;
  }

  return { observe, reset };
}

export {
  createConversationNarrationTracker,
  latestConversationFinalNarrationEntry
};
