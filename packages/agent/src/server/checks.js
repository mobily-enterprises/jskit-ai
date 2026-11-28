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
// Only an announcing phrase counts: a reply that merely ends "first." is as often advice to the
// person ("Please ask your physiotherapist first.") as a plan.
const ANNOUNCES_NEXT = /\b(?:let me|let's|I'll|I will|I'm going to|now I'll|next,? I'll|one moment|give me a (?:moment|second|sec)|just a (?:moment|second|sec))\b[^.!?\n]{0,160}[.…:>]*\s*$/iu;
const REPORTS_RESULT = /\b(?:done|here(?:'s| is| are)|saved|I've|I have|made|ready|finished|let me know|if you(?:'d)? (?:like|want)|say the word)\b/iu;
/** A plan of a paragraph or two counts too ("…then verify it before switching it in."). */
export const stoppedShort = (text) => text.length < 600 && ANNOUNCES_NEXT.test(text) && !REPORTS_RESULT.test(text);

/** A reply's steps without its closing words, to carry on from. */
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

/**
 * The reply as people may see it: the markup and what it wraps taken out. After one of DeepSeek's
 * tokens, the rest of that line goes too when it's in a script the reply otherwise isn't in.
 */
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

/** What a reply's tools did, briefly, from its transcript and the app's own records of it. */
export function toolRecord(transcript = [], events = [], app = "The app") {
  const brief = (value, size = 240) => {
    const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
    return text.length > size ? `${text.slice(0, size)}…` : text;
  };
  const lines = [];
  for (const message of transcript) {
    for (const part of Array.isArray(message.content) ? message.content : []) {
      if (part.type === "tool-call") lines.push(`called ${part.toolName}(${brief(part.input ?? part.args ?? {})})`);
      // readable-check: allow no-dual-shape - data: a tool result's output is { type, value } in model messages and the bare value in transcripts stored before that
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

// --- Reported facts. The check above sees only the first 240 characters of each tool result, so a
// fact the reply passes on from a record it read ("the agency's email says both documents were
// forwarded to the vessel at 08:35") reads as the reply's own claim. When the caller gives the reply's
// transcript, each flagged claim is judged again, in one more call, on the passages of the reply's
// tool results that best match it, read in full. A claim in the first person singular ("I forwarded
// it") is the assistant's own, and one that no passage speaks to has no record behind it: both stand
// without asking.
const EVIDENCE_CHECKER = [
  "You judge claims from an assistant's reply. Under each claim are passages from records the assistant's tools read while writing that reply, such as emails, messages and documents.",
  "A claim is reported when a passage says that thing was done and the reply is passing on what the record says. It is not reported when the reply says the assistant did it in this conversation, or when the passages only mention, plan or ask for it, or say that something else was done.",
  "Reply with JSON only: {\"reported\": [the number of each reported claim]}, with [] when none is."
].join("\n");
const EVIDENCE_BUDGET = 6000;
const PASSAGES_PER_CLAIM = 3;
const COMMON = new Set("that this these those with were have been from also they them then than will what when where here there into about would should could which their your just only some each both".split(" "));
// The words a claim and a passage are matched on, by their first five letters (forward, forwarded).
const stems = (text) => new Set((String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
  .filter((word) => /\p{N}/u.test(word) || (word.length > 3 && !COMMON.has(word))).map((word) => word.slice(0, 5)));

/** Each text in a tool result, named by where it sits in the result. */
function leaves(value, key = "") {
  if (typeof value === "string") return [{ key, text: value }];
  if (value && typeof value === "object") return Object.entries(value).flatMap(([name, item]) => leaves(item, key ? `${key}.${name}` : name));
  return value === undefined || value === null ? [] : [{ key, text: String(value) }];
}

/** Every sentence of the reply's tool results, with the sentences either side of it. */
function passages(transcript) {
  return transcript.flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .filter((part) => part.type === "tool-result")
    // readable-check: allow no-dual-shape - data: a tool result's output is { type, value } in model messages and the bare value in transcripts stored before that
    .flatMap((part) => leaves(part.output?.value ?? part.output ?? part.result).flatMap(({ key, text }) => {
      const sentences = text.split(/(?<=[.!?])\s+|\n+/u).map((sentence) => sentence.trim()).filter(Boolean);
      return sentences.map((sentence, index) => ({ source: [part.toolName, key].filter(Boolean).join(" "), sentence, stems: stems(sentence),
        text: sentences.slice(Math.max(0, index - 1), index + 2).join(" ").slice(0, 600) }));
    }));
}

/** The passages that share the most words with `claim`, best first, within `budget` characters. */
function evidence(claim, all, budget) {
  const wanted = [...stems(claim)];
  const ranked = all.map((passage) => ({ passage, score: wanted.filter((stem) => passage.stems.has(stem)).length }))
    .filter(({ score }) => score > 0).sort((a, b) => b.score - a.score);
  const chosen = [];
  for (const { passage } of ranked) {
    if (chosen.length === PASSAGES_PER_CLAIM) break;
    if (chosen.some((other) => other.text.includes(passage.sentence))) continue;
    if (chosen.reduce((used, other) => used + other.text.length, passage.text.length) > budget) continue;
    chosen.push(passage);
  }
  return chosen;
}

async function reportedClaims({ model, reply, claims, transcript }) {
  const all = passages(transcript);
  const budget = Math.floor(EVIDENCE_BUDGET / claims.length);
  const asked = claims.filter((claim) => !/\bI\b/iu.test(claim)).map((claim) => ({ claim, found: evidence(claim, all, budget) })).filter(({ found }) => found.length);
  if (!asked.length) return new Set();
  const listed = asked.map(({ claim, found }, index) => [`${index + 1}. "${claim}"`, ...found.map((passage) => `   ${passage.source}: "${passage.text}"`)].join("\n"));
  try {
    const text = await generateOnce({ model, system: EVIDENCE_CHECKER, messages: [{ role: "user", content: `Reply:\n${String(reply).slice(0, 6000)}\n\nClaims, each with the passages that best match it:\n${listed.join("\n\n")}` }], reasoning: REASONING.off, maxOutputTokens: 200 });
    const { reported } = JSON.parse(String(text || "").replace(/^\s*```(?:json)?|```\s*$/gu, "").trim());
    return new Set(Array.isArray(reported) ? reported.map((number) => asked[Number(number) - 1]?.claim).filter(Boolean) : []);
  } catch {
    // When this call can't run, the claims the check named stand.
    return new Set();
  }
}

/**
 * The claims of `reply` that its tools' `record` doesn't support, from one short model call; [] when the
 * check can't run. With the reply's `transcript`, a flagged claim is judged again on the passages of its
 * tool results that match it, and one the reply passes on from a record it read is set aside.
 */
export async function unsupportedClaims({ model, reply, record, transcript }) {
  let claims;
  try {
    const text = await generateOnce({ model, system: CLAIMS_CHECKER, messages: [{ role: "user", content: `Tool record:\n${record}\n\nReply:\n${String(reply).slice(0, 6000)}` }], reasoning: REASONING.off, maxOutputTokens: 400 });
    const parsed = JSON.parse(String(text || "").replace(/^\s*```(?:json)?|```\s*$/gu, "").trim());
    claims = Array.isArray(parsed.unsupported) ? parsed.unsupported.map(String).filter(Boolean) : [];
  } catch {
    // The check is a safety net: when it can't run, the reply goes as it is.
    return [];
  }
  if (!transcript || !claims.length) return claims.slice(0, 5);
  const reported = await reportedClaims({ model, reply, claims, transcript });
  return claims.filter((claim) => !reported.has(claim)).slice(0, 5);
}
