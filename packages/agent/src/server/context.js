import { SUMMARY_LIMITS } from "./summaries.js";
import { estimateTokens } from "./text.js";

// Context for the model's 1-million-token window. Between turns, a conversation is summarised
// (summaries.js); what's after the summary is read word for word.

// Should summarising fall behind, the oldest messages give way past this size, and the model is
// told; never silently. It leaves a long turn's own steps room in the window.
export const HISTORY_MAX_TOKENS = 600000;

export function withinBudget(history, maxTokens = HISTORY_MAX_TOKENS) {
  let tokens = estimateTokens(history);
  let start = 0;
  while (start < history.length - 1 && tokens > maxTokens) tokens -= estimateTokens([history[start++]]);
  if (!start) return history;
  // A cut never starts on a tool result whose call was cut.
  while (start < history.length - 1 && history[start].role === "tool") start += 1;
  console.error(`A reply's history was cut by ${start} messages: summarising didn't keep up.`);
  return [{ role: "system", content: "(The earliest part of this conversation isn't shown: it was too long to read and couldn't be summarised just now. If you need something from it, say so rather than guess.)" }, ...history.slice(start)];
}

export function summaryNote(summary) {
  return `Summary of the earlier part of this conversation (those messages are no longer shown; it was written for you, not by the person). If you need a detail that isn't here, say so or look it up; never invent it.\n\n${summary}`;
}

// Room inside one long turn (as Claude Code's context editing and DeepSeek Harness's result pruning
// do): before each model call, past `trimAt` estimated tokens, the oldest tool results (never the
// newest `keepRecent`) give way to a one-line note until the request is under `trimTo`. Calls and
// the model's words stay. Results once left out stay out for the rest of the turn, so the prompt's
// start changes rarely and the cache keeps hitting. Stored history is untouched.
export const TURN_LIMITS = { trimAt: 700000, trimTo: 500000, keepRecent: 20 };

const partTokens = (part) => Math.ceil(JSON.stringify(part).length / 4);

export function trimOldResults(messages, left = new Set(), limits = TURN_LIMITS) {
  const results = messages.flatMap((message) => (message.role === "tool" && Array.isArray(message.content) ? message.content.filter((part) => part.type === "tool-result") : []));
  const total = messages.reduce((sum, message) => sum + (Array.isArray(message.content) ? message.content.reduce((inner, part) => inner + partTokens(part), 0) : Math.ceil(String(message.content || "").length / 4)), 0);
  if (total > limits.trimAt) {
    let size = total;
    for (const part of results.slice(0, Math.max(0, results.length - limits.keepRecent))) {
      if (size <= limits.trimTo) break;
      if (left.has(part.toolCallId)) continue;
      left.add(part.toolCallId);
      size -= partTokens(part);
    }
  }
  if (!left.size) return messages;
  return messages.map((message) => (message.role === "tool" && Array.isArray(message.content)
    ? { ...message, content: message.content.map((part) => (part.type === "tool-result" && left.has(part.toolCallId)
      ? { ...part, output: { type: "text", value: `(This older result of ${part.toolName} was left out to save room. Run the tool again if you need it.)` } }
      : part)) }
    : message));
}

// An earlier turn's tool result, as later turns read it: past `OLD_RESULT_CHARS` it's cut, saying
// so (a whole page or file isn't needed twice; the model can look again). The same cut every
// time, so the prompt cache isn't disturbed.
export const OLD_RESULT_CHARS = 6000;
export function clipOldResult(message) {
  if (message.role !== "tool" || !Array.isArray(message.content)) return message;
  return {
    ...message,
    content: message.content.map((part) => {
      if (part.type !== "tool-result") return part;
      const text = typeof part.output?.value === "string" ? part.output.value : JSON.stringify(part.output?.value ?? part.output ?? null);
      return text.length > OLD_RESULT_CHARS ? { ...part, output: { type: "text", value: `${text.slice(0, OLD_RESULT_CHARS)}… [the rest of this result is no longer shown]` } } : part;
    })
  };
}

// The sizes above are for a window of about a million tokens. For a model with a smaller one
// (`contextTokens`), each shrinks in proportion: when to summarise, how much is kept word for
// word, where a long turn's old results give way and the last-resort cut.
export const WINDOW_TOKENS = 1048576;
export function windowLimits(contextTokens = WINDOW_TOKENS) {
  const share = Math.min(1, Math.max(0.01, Number(contextTokens) / WINDOW_TOKENS || 1));
  const scaled = (limits, keys) => ({ ...limits, ...Object.fromEntries(keys.map((key) => [key, Math.floor(limits[key] * share)])) });
  return {
    history: Math.floor(HISTORY_MAX_TOKENS * share),
    turn: scaled(TURN_LIMITS, ["trimAt", "trimTo"]),
    summaries: scaled(SUMMARY_LIMITS, ["compactAt", "summariseNowAt", "keepTokens", "minTokens", "readTokens"])
  };
}
