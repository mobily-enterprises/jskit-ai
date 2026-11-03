import { computed } from "vue";
import { parseNumberedQuestionPrompt } from "../../shared/conversation/numberedQuestionSugar.js";
import { parseLongTextReviewBlocks } from "../../shared/conversation/longTextBlocks.js";
import { normalizeThinkingMessageText } from "../../shared/conversation/thinkingText.js";
import { useJskitText } from "../i18n.js";

const USER_MESSAGE_COLLAPSE_MIN_CHARACTERS = 360;
const USER_MESSAGE_PREVIEW_MAX_CHARACTERS = 280;
const USER_MESSAGE_PREVIEW_MAX_LINES = 4;
const DISPLAY_MESSAGE_CACHE_LIMIT = 500;
const TIME_FORMAT = Object.freeze({
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

/** The collapsed preview of a long user message, or "" when it is short enough to show whole. */
function userMessagePreviewText(value = "") {
  const text = String(value || "");
  const characters = [...text];
  const lines = text.split(/\r\n?|\n/u);
  if (
    characters.length <= USER_MESSAGE_COLLAPSE_MIN_CHARACTERS &&
    lines.length <= USER_MESSAGE_PREVIEW_MAX_LINES
  ) {
    return "";
  }
  const firstLines = lines.slice(0, USER_MESSAGE_PREVIEW_MAX_LINES).join("\n");
  const preview = [...firstLines]
    .slice(0, USER_MESSAGE_PREVIEW_MAX_CHARACTERS)
    .join("")
    .trimEnd();
  return preview ? `${preview}…` : "";
}

function conversationAgentMessages(turn = {}) {
  if (Array.isArray(turn.messages)) {
    return turn.messages.filter((message) => (
      ["assistant", "commentary", "thinking"].includes(String(message?.role || "").trim())
    ));
  }
  return [
    ...(Array.isArray(turn.thinking) ? turn.thinking : []),
    ...(Array.isArray(turn.commentary) ? turn.commentary : []),
    turn.assistant
  ].filter(Boolean);
}

function conversationMessageKey(message = {}, index = 0) {
  return [
    String(message.messageId || "").trim(),
    String(message.role || "").trim(),
    String(message.at || "").trim(),
    index
  ].join(":");
}

/**
 * The transcript's entries, one per displayed message in chronological order, with consecutive reasoning grouped into
 * one progress entry. Each displayed message is parsed once and cached by its key until `clearDisplayCache()`.
 * @param {{ turns: any[] }} props The transcript's props.
 */
function useTranscriptEntries(props) {
  const jskitText = useJskitText();
  const { formatDateTime, serverMessage } = jskitText;
  const displayMessageCache = new Map();

  function displayTime(value = "") {
    const date = new Date(String(value || ""));
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return formatDateTime(date, TIME_FORMAT);
  }

  function displayMessage(message = null, {
    allowNumberedQuestions = false,
    preserveParagraphLineBreaks = false,
    previewUserMessage = false
  } = {}, cacheKey = "") {
    if (!message) {
      return null;
    }
    const normalizedCacheKey = String(cacheKey || "").trim();
    const cached = normalizedCacheKey ? displayMessageCache.get(normalizedCacheKey) : null;
    // Times and status texts follow the active locale, so a locale change re-renders them.
    const activeLocale = jskitText.locale;
    if (
      cached &&
      cached.locale === activeLocale &&
      cached.allowNumberedQuestions === allowNumberedQuestions &&
      cached.attachments === message.attachments &&
      cached.at === message.at &&
      cached.messageId === message.messageId &&
      cached.preserveParagraphLineBreaks === preserveParagraphLineBreaks &&
      cached.previewUserMessage === previewUserMessage &&
      cached.role === message.role &&
      cached.text === message.text
    ) {
      return { ...message, ...cached.value };
    }
    const messageText = message.textCode ? serverMessage({ message: message.text, messageCode: message.textCode }) : message.text;
    const questionInput = allowNumberedQuestions
      ? parseNumberedQuestionPrompt(messageText)
      : {
          intro: "",
          outro: "",
          questions: []
        };
    const hasQuestions = questionInput.questions.length > 0;
    const previewText = previewUserMessage ? userMessagePreviewText(message.text) : "";
    const value = {
      blocks: parseLongTextReviewBlocks(hasQuestions ? questionInput.intro : messageText, {
        preserveParagraphLineBreaks
      }),
      outroBlocks: parseLongTextReviewBlocks(hasQuestions ? questionInput.outro : "", {
        preserveParagraphLineBreaks
      }),
      previewBlocks: previewText
        ? parseLongTextReviewBlocks(previewText, { preserveParagraphLineBreaks: true })
        : null,
      questions: hasQuestions ? questionInput.questions : [],
      displayAt: displayTime(message.at)
    };
    if (normalizedCacheKey) {
      if (
        displayMessageCache.size >= DISPLAY_MESSAGE_CACHE_LIMIT &&
        !displayMessageCache.has(normalizedCacheKey)
      ) {
        displayMessageCache.delete(displayMessageCache.keys().next().value);
      }
      displayMessageCache.set(normalizedCacheKey, {
        allowNumberedQuestions,
        attachments: message.attachments,
        at: message.at,
        locale: activeLocale,
        messageId: message.messageId,
        preserveParagraphLineBreaks,
        previewUserMessage,
        role: message.role,
        text: message.text,
        value
      });
    }
    return { ...message, ...value };
  }

  function displayThinkingMessage(message = null) {
    if (!message) {
      return null;
    }
    const text = normalizeThinkingMessageText(message.text);
    if (!text) {
      return null;
    }
    return {
      ...message,
      text,
      displayAt: displayTime(message.at)
    };
  }

  // Storage rows are not visual boundaries. Only an intervening message ends a
  // reasoning group, including when history is prepended or execution continues.
  const displayEntries = computed(() => {
    const candidates = [];
    for (const [index, turn] of props.turns.entries()) {
      const turnId = String(turn.turnId || index + 1);
      // A delivery notice belongs to its exact user message, not the previous reply.
      const userDelivery = turn.user && turn.system?.delivery && turn.system.delivery.messageId === turn.user.messageId
        ? turn.system : null;
      const messages = [
        turn.system && !userDelivery && { ...turn.system, role: "system" },
        turn.user && { ...turn.user, role: "user" },
        ...conversationAgentMessages(turn)
      ].filter(Boolean);
      for (const [messageIndex, message] of messages.entries()) {
        const role = String(message.role || "").trim();
        const key = `${turnId}:${conversationMessageKey(message, messageIndex)}`;
        const displayed = role === "thinking" ? displayThinkingMessage(message) : displayMessage(message, {
          allowNumberedQuestions: role !== "user" && role !== "system",
          preserveParagraphLineBreaks: role === "user",
          previewUserMessage: role === "user"
        }, key);
        if (!displayed) continue;
        candidates.push({ key, role, turn: { ...turn, turnId }, message: displayed,
          sortAt: turn.optimistic && turn.optimistic.status !== "accepted" && turn.optimistic.id === message.messageId
            ? NaN : Date.parse(message.at),
          delivery: role === "user" ? userDelivery : null });
      }
    }
    // Native streaming turns and saved authored turns can arrive independently.
    // Local queued timestamps can precede an earlier message's native admission.
    // Keep unconfirmed messages in their supplied positions, along with undated
    // notices. Accepted local copies join chronology even before history arrives.
    const dated = candidates.filter(entry => Number.isFinite(entry.sortAt))
      .sort((a, b) => a.sortAt - b.sortAt)[Symbol.iterator]();
    const entries = [];
    for (const candidate of candidates) {
      const entry = Number.isFinite(candidate.sortAt) ? dated.next().value : candidate;
      const previous = entries.at(-1);
      if (entry.role === "thinking" && previous?.role === "thinking") previous.messages.push({ ...entry.message, key: entry.key });
      else entries.push({ ...entry, ...(entry.role === "thinking" ? { messages: [{ ...entry.message, key: entry.key }] } : {}) });
    }
    // Anchor a progress group to the following message, or to the transcript end.
    // Appending progress or prepending history then preserves its expansion state.
    for (const [index, entry] of entries.entries()) {
      if (entry.role === "thinking") entry.key = `progress:${entries[index + 1]?.key || "tail"}`;
    }
    return entries;
  });

  function clearDisplayCache() {
    displayMessageCache.clear();
  }

  return {
    clearDisplayCache,
    displayEntries
  };
}

export { useTranscriptEntries, userMessagePreviewText };
