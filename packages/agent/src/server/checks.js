import { REASONING, generateOnce } from "./model.js";

// Checks on a finished reply. Each can send the reply back once, carrying on from its own steps;
// `checkTexts(app)` words the note the model gets, signed by the app.

export function checkTexts(app) {
  return {
    stoppedShort: `(Check from ${app}: your reply ended by saying what you'd do next, and then stopped, so the person is left waiting. Carry on now with your tools and finish the job, then reply with the result. If you can't, say plainly why.)`,
    markup: `(Check from ${app}: your last message contained raw markup, such as a tool call written out as text or special tokens, so nothing in it ran and the person can't read it. Carry on now: call the tools properly to do what's left, then reply in plain words.)`,
    unsupported: (claims) => `(Check from ${app}: your reply says ${claims.map((claim) => `"${claim}"`).join(", ")}, but no tool in this reply did that, so it hasn't happened. Do it now with the right tool, or answer again without saying it's done.)`,
    resumed: "(This reply was interrupted part-way, when the server running it stopped. Your steps so far are above and what they did stays done. Carry on from where you got to, without redoing them, and finish the job.)"
  };
}

// --- Stopping short: a short reply that ends by announcing its next step, with no result.
const ANNOUNCES_NEXT = /(?:\b(?:let me|let's|I'll|I will|I'm going to|now I'll|next,? I'll|one moment|give me a (?:moment|second|sec)|just a (?:moment|second|sec))\b[^.!?\n]{0,160}[.…:>]*|\bfirst\.)\s*$/iu;
const REPORTS_RESULT = /\b(?:done|here(?:'s| is| are)|saved|I've|I have|made|ready|finished|let me know|if you(?:'d)? (?:like|want)|say the word)\b/iu;
// A plan of a paragraph or two counts too ("…then verify it before switching it in.").
export const stoppedShort = (text) => text.length < 600 && ANNOUNCES_NEXT.test(text) && !REPORTS_RESULT.test(text);

// A reply's steps without its closing words, to carry on from.
export function withoutClosingWords(transcript) {
  const last = transcript.at(-1);
  const saidOnly = last?.role === "assistant" && (typeof last.content === "string" || last.content.every((part) => part.type === "text"));
  return saidOnly ? transcript.slice(0, -1) : transcript;
}

// --- Raw model markup: DeepSeek's own tokens (<｜begin▁of▁sentence｜>), tool calls written out as
// text (<invoke>, <parameter>, ｜DSML｜) and the blocks that come with them (budget, safety). Its
// presence means the step was malformed.
export const LEAKED_MARKUP = /<[｜|]{1,2}[^<>\n]{0,80}?[｜|]{1,2}>|｜DSML｜|<\/?(?:invoke|parameter|tool_call|function_calls|tools|ds_safety)\b|<budget:/u;
const CJK = /[㐀-鿿豈-﫿]/gu;

// The reply as people may see it: the markup and what it wraps taken out. After one of DeepSeek's
// tokens, the rest of that line goes too when it's in a script the reply otherwise isn't in.
export function withoutMarkup(text) {
  const source = String(text || "");
  if (!LEAKED_MARKUP.test(source)) return source;
  // Judged on the lines without one of its tokens, so the junk itself doesn't count.
  const others = source.split("\n").filter((line) => !/<[｜|]{1,2}[^<>\n]{0,80}?[｜|]{1,2}>/u.test(line)).join("\n");
  const foreign = (others.match(CJK) || []).length <= others.length * 0.05;
  return source
    .replace(/<budget:[^>]*>[\s\S]*?<\/budget:[^>]*>/gu, "")
    .replace(/<ds_safety>[\s\S]*?<\/ds_safety>/gu, "")
    .replace(/<(?:[｜|]*DSML[｜|]*\s*)?invoke\b[\s\S]*?(?:<\/(?:[｜|]*DSML[｜|]*\s*)?invoke>|$)/gu, "")
    .replace(/<(?:[｜|]*DSML[｜|]*\s*)?parameter\b[\s\S]*?(?:<\/(?:[｜|]*DSML[｜|]*\s*)?parameter>|$)/gu, "")
    .replace(/<[｜|]{1,2}[^<>\n]{0,80}?[｜|]{1,2}>([^\n]*)/gu, (match, rest) => (foreign && CJK.test(rest) ? "" : match))
    .replace(/<[｜|]{1,2}[^<>\n]{0,80}?[｜|]{1,2}>[ \t]*/gu, "")
    .replace(/<\/?(?:[｜|]*DSML[｜|]*\s*)?(?:tool_call|function_calls|tools|invoke|parameter)\b[^>\n]*>?/gu, "")
    .replace(/[｜|]*DSML[｜|]*[^\n]*/gu, "")
    .split("\n")
    // What's left of a call in DeepSeek's token form ("runCommand｜｜invoke｜｜…") and lone brackets.
    .filter((line) => !line.includes("｜") && !/^\s*[<>/]+\s*$/u.test(line))
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

// --- Unsupported claims: a reply that says it did something is compared with what its tools did,
// in one short call. Only claims about this reply's own actions count; plans, offers, questions
// and things done earlier don't.
const CLAIMS_ACTION = /\b(?:I(?:'ve| have)?|it's|it is|they're|they are|all|both|now|done|is|are|was|were)\b[^.!?\n]{0,60}\b(?:created|made|saved|sent|added|updated|changed|removed|deleted|moved|renamed|booked|scheduled|set up|attached|uploaded|published|installed|fixed|written|wrote|built|drafted|replied|invited|cancelled|archived|forwarded)\b/iu;
export const reportsActions = (text) => CLAIMS_ACTION.test(String(text || ""));

// What a reply's tools did, briefly, from its transcript and the app's own records of it.
export function toolRecord(transcript = [], events = [], app = "The app") {
  const brief = (value, size = 240) => {
    const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
    return text.length > size ? `${text.slice(0, size)}…` : text;
  };
  const lines = [];
  for (const message of transcript) {
    for (const part of Array.isArray(message.content) ? message.content : []) {
      if (part.type === "tool-call") lines.push(`called ${part.toolName}(${brief(part.input ?? part.args ?? {})})`);
      if (part.type === "tool-result") lines.push(`  ${part.toolName} answered: ${brief(part.output?.value ?? part.output ?? part.result)}`);
    }
  }
  for (const event of events) lines.push(`${app} recorded: ${event}`);
  return lines.join("\n") || "(no tool ran in this reply)";
}

const CLAIMS_CHECKER = [
  "You check an assistant's reply against a record of what its tools did while writing that reply.",
  "List each statement in the reply that says something was done in this reply (made, saved, sent, attached, added, changed, deleted, booked, set up, fixed, run, tested) that the record doesn't support.",
  "A claim is supported if a tool call and its answer in the record show it happened. Ignore plans, offers, questions, advice, facts about the person, things said to have happened earlier in the conversation, and descriptions of what a file or app contains.",
  "Reply with JSON only: {\"unsupported\": [\"short quote of each unsupported claim\"]}, with [] when every claim is supported."
].join("\n");

export async function unsupportedClaims({ model, reply, record }) {
  try {
    const text = await generateOnce({ model, system: CLAIMS_CHECKER, messages: [{ role: "user", content: `Tool record:\n${record}\n\nReply:\n${String(reply).slice(0, 6000)}` }], reasoning: REASONING.off, maxOutputTokens: 400 });
    const parsed = JSON.parse(String(text || "").replace(/^\s*```(?:json)?|```\s*$/gu, "").trim());
    return Array.isArray(parsed.unsupported) ? parsed.unsupported.map(String).filter(Boolean).slice(0, 5) : [];
  } catch {
    // The check is a safety net: when it can't run, the reply goes as it is.
    return [];
  }
}
