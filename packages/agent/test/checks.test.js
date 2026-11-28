import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { LEAKED_MARKUP, stoppedShort, toolRecord, unsupportedClaims, withoutMarkup } from "../src/server/index.js";

// Raw model markup that leaked into replies in evaluations: it's spotted, and people only ever see
// the reply without it.
const leaked = [
  ["I'll look at the CRM app first, then add them.\n\n<parameter name=\"appGet\">{\"slug\":\"crm\"}</｜DSML｜ parameter>\n</｜DSML｜ invoke>\n\nI'll add all three now.", "I'll look at the CRM app first, then add them.\n\nI'll add all three now."],
  ["I'll start by looking at the project files.\n\n<budget:token_budget>200000</budget:token_budget>\n\nI've made the code changes.", "I'll start by looking at the project files.\n\nI've made the code changes."],
  ["Now I'll make the changes.\n\n<｜｜tool▁calls▁begin｜｜><｜｜invoke▁name｜｜>runCommand｜｜invoke｜｜<｜｜parameter▁name｜｜>why｜｜<｜｜parameter｜｜>Rename it｜｜<｜｜/parameter｜｜>\n\nDone.", "Now I'll make the changes.\n\nDone."],
  ["I'll set that up.\n\n<｜begin▁of▁sentence｜>中国福利彩票双色球数字范围\n\nThe draft is saved.", "I'll set that up.\n\nThe draft is saved."],
  ["Checking.\n\n<ds_safety>[分类]其他</ds_safety>### Adding the leads\n\nAll three are in.", "Checking.\n\n### Adding the leads\n\nAll three are in."],
  ["I'll look at the files first.\n\n<parameter name=\"runCommand\">ls -la /files/mine</parameter>\n\nBoth commands work now.", "I'll look at the files first.\n\nBoth commands work now."],
  ["I'll take a look.\n\n<｜place▁holder▁no▁558｜> I've read it.", "I'll take a look.\n\nI've read it."]
];

test("leaked markup is spotted and taken out of what people see", () => {
  for (const [text, shown] of leaked) {
    assert.ok(LEAKED_MARKUP.test(text), text);
    assert.equal(withoutMarkup(text), shown);
    assert.ok(!LEAKED_MARKUP.test(withoutMarkup(text)));
  }
  for (const text of ["Use a <table> in HTML.", "Totals | 12 | 13", "你好！今天怎么样？", "a < b and c > d", "The <param> tag is old."]) {
    assert.ok(!LEAKED_MARKUP.test(text), text);
    assert.equal(withoutMarkup(text), text, "ordinary text is left alone");
  }
});

// A reply that ends by announcing its next step and stops is sent back once to finish; a finished
// reply, an offer or a question is left alone.
test("replies that stop at 'let me…' are caught; finished ones aren't", () => {
  for (const text of [
    "I'll take a look at the file first.",
    "I'll take a look at your spending file first.... let me read the whole file structure.",
    "I'll start by checking the file and making the GIF.>",
    "I'll check what's there first, then combine them.",
    "I'll start by reading the script and the data files to understand what it does.\n\nThe script compares every pair of rows (O(n²)) — 60000 rows means ~1.8 billion comparisons. I'll replace that with key-based grouping that produces the identical grouping, then verify it against the original on many inputs before switching it in."
  ]) assert.equal(stoppedShort(text), true, text);
  for (const text of [
    "Done — here's the GIF. If you need it lighter, say the word and I'll shrink it.",
    "Total: 106.40, due 28 October 2026. Want me to set a reminder?",
    "I saved it as plan.docx. Let me know if you want changes.",
    `I'll take a look. ${"Here are the totals by month. ".repeat(12)}`,
    // Advice, or a question to the person, that ends in "first." announces nothing.
    "First.",
    "Safety first.",
    "Stretch gently for five minutes before you start, and always warm up first.",
    "Please ask your physiotherapist first.",
    "I need to know your age first."
  ]) assert.equal(stoppedShort(text), false, text);
});

// Known misses: a plan with none of the announcing phrases. "Checking" or "I need to" would catch
// these, but also advice ("I recommend checking your blood pressure daily.") and questions to the
// person ("I need to know your age first."), which are finished replies.
test("plans without an announcing phrase are not caught", () => {
  for (const text of [
    "Got it. Checking the file first.",
    "I'll do it. I need to read the schema first."
  ]) assert.equal(stoppedShort(text), false, text);
});

// The claims checker: each call answers with the next of `answers` (an object goes as JSON) and is
// recorded with its system prompt and request.
function checker(...answers) {
  const calls = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const [system, ...messages] = options.prompt;
      calls.push({ system: system.content, text: messages.map((message) => message.content.map((part) => part.text).join("")).join("\n") });
      const answer = answers[calls.length - 1] ?? { unsupported: [] };
      return { content: [{ type: "text", text: typeof answer === "string" ? answer : JSON.stringify(answer) }], finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }, warnings: [] };
    }
  });
  return { model, calls };
}
// A reply that read emails, as its transcript holds them.
const readEmails = (...emails) => emails.flatMap((email, index) => [
  { role: "assistant", content: [{ type: "tool-call", toolCallId: `call_${index}`, toolName: "inbox_read", input: { messageId: `m${index}` } }] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: `call_${index}`, toolName: "inbox_read", output: { type: "json", value: email } }] }
]);
const opening = "Hi all,\n\nThank you for the berth update this morning. Pilots are booked for 06:00 and the tugs are confirmed with the harbour master's office. The surveyor will attend after berthing, once the gangway is rigged and the vessel is cleared by the port health officer.\n\n";
const CLAIMS_CHECKER = [
  "You check an assistant's reply against a record of what its tools did while writing that reply.",
  "List each statement in the reply that says something was done in this reply (made, saved, sent, attached, added, changed, deleted, booked, set up, fixed, run, tested) that the record doesn't support.",
  "A claim is supported if a tool call and its answer in the record show it happened. Ignore plans, offers, questions, advice, facts about the person, things said to have happened earlier in the conversation, and descriptions of what a file or app contains.",
  "Reply with JSON only: {\"unsupported\": [\"short quote of each unsupported claim\"]}, with [] when every claim is supported."
].join("\n");

// CompAS (28 Nov): its Colleague read the agency's email, which said the documents were forwarded to
// the vessel, and passed that on in its own words; the checker, which sees each tool result only
// briefly, named it as the reply's own claim and the reply was sent back. A flagged claim goes to a
// second call with the passages of the reply's tool results that match it, read in full.
test("a fact a record the reply read reports, even in other words, is judged on the record's own passages and not sent back", async () => {
  const email = { subject: "Re: berth change", from: "ops@agency.example",
    body: `${opening}Both documents were forwarded to OCEAN EMERALD at 08:35 by our Singapore desk, and the master confirmed receipt.\n\nRegards,\nOps` };
  const transcript = readEmails(email);
  const record = toolRecord(transcript);
  assert.ok(!record.includes("forwarded"), "The first check sees too little of the email to know");
  const claim = "the two were also forwarded to MV Ocean Emerald at 08:35";
  const { model, calls } = checker({ unsupported: [claim] }, { reported: [1] });
  const reply = `According to the agency's email, ${claim}, and the master confirmed receipt.`;
  assert.deepEqual(await unsupportedClaims({ model, reply, record, transcript }), []);
  assert.equal(calls.length, 2, "One more call, for the flagged claim");
  assert.equal(calls[0].system, CLAIMS_CHECKER, "The first call is the one the check always made");
  assert.match(calls[1].text, /Both documents were forwarded to OCEAN EMERALD at 08:35 by our Singapore desk/u, "The second sees the passage in full");
  assert.ok(calls[1].text.includes(`1. "${claim}"`));
  assert.ok(calls[1].text.includes(reply));
});

// "We've forwarded it" with nothing in the results about forwarding, or "I've sent the email": no
// record is behind them, so they stand without asking again.
test("a claim no tool result speaks to, or one in the first person singular, stands without a second call", async () => {
  const transcript = readEmails({ subject: "Berth", body: `${opening}The berth is now 7B.` });
  for (const claims of [["We've forwarded it"], ["I've sent the email"], ["I forwarded the berth change to the master", "We've forwarded it"]]) {
    const { model, calls } = checker({ unsupported: claims }, { reported: [1, 2] });
    assert.deepEqual(await unsupportedClaims({ model, reply: "(the reply)", record: toolRecord(transcript), transcript }), claims, claims.join(" / "));
    assert.equal(calls.length, 1, claims.join(" / "));
  }
  // An email that says "we forwarded" can't make the assistant's own "I forwarded" a report.
  const forwarded = readEmails({ subject: "Fwd", body: "We forwarded this to OCEAN EMERALD at 19:03." });
  const mine = ["I forwarded this to OCEAN EMERALD at 19:03", "we forwarded this to Ocean Emerald at 19:03"];
  const { model, calls } = checker({ unsupported: mine }, { reported: [1] });
  assert.deepEqual(await unsupportedClaims({ model, reply: "(the reply)", record: toolRecord(forwarded), transcript: forwarded }), [mine[0]]);
  assert.ok(!calls[1].text.includes(mine[0]), "The first person singular is never asked about");
  assert.ok(calls[1].text.includes(`1. "${mine[1]}"`));
});

// A record that mentions a forward doesn't make a new one the reply claims a report, and neither does
// one that only plans it ("once we've forwarded it", which holds the claim's words).
test("a record that mentions a forward doesn't cover a new forward the reply claims", async () => {
  const transcript = readEmails(
    { subject: "Crew", body: `${opening}We forwarded the crew list to the agent yesterday.` },
    { subject: "Master", body: "We'll confirm once we've forwarded it to the master." });
  for (const [claim, passage] of [
    ["the invoice has now been forwarded to the agent", /We forwarded the crew list to the agent yesterday\./u],
    ["We've forwarded it to the master", /We'll confirm once we've forwarded it to the master\./u]
  ]) {
    const { model, calls } = checker({ unsupported: [claim] }, { reported: [] });
    assert.deepEqual(await unsupportedClaims({ model, reply: `Done: ${claim}.`, record: toolRecord(transcript), transcript }), [claim], claim);
    assert.equal(calls.length, 2, `${claim}: judged on the record`);
    assert.match(calls[1].text, passage);
  }
});

test("the passages stay within a fixed budget, whatever the size of the results", async () => {
  const sentence = (index) => `Cargo lot ${index} was forwarded to OCEAN EMERALD at the anchorage after the survey. `;
  const huge = Array.from({ length: 3 }, (_, result) => ({ subject: `Log ${result}`, body: Array.from({ length: 800 }, (_, index) => sentence(result * 1000 + index)).join("") }));
  const transcript = readEmails(...huge);
  const claims = ["cargo was forwarded to OCEAN EMERALD", "the survey was forwarded", "lot 5 was forwarded at the anchorage", "everything was forwarded to the anchorage", "the cargo went to OCEAN EMERALD"];
  const { model, calls } = checker({ unsupported: claims }, { reported: [] });
  assert.deepEqual(await unsupportedClaims({ model, reply: "(the reply)", record: toolRecord(transcript), transcript }), claims);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].text.length < 8000, `${calls[1].text.length} characters for 200 KB of results`);
  for (const [index, claim] of claims.entries()) assert.ok(calls[1].text.includes(`${index + 1}. "${claim}"`));
});

// Mercbot calls the check without a transcript: one call, the same prompt and request as always.
test("without the reply's transcript the check is the one call it always was", async () => {
  const transcript = readEmails({ subject: "Fwd", body: "We forwarded this to OCEAN EMERALD at 19:03." });
  const record = toolRecord(transcript, ["the bot saved notes.txt"], "Mercbot");
  const claims = ["We forwarded this to OCEAN EMERALD at 19:03", "a", "b", "c", "d", "e"];
  const { model, calls } = checker({ unsupported: claims }, { reported: [1] });
  assert.deepEqual(await unsupportedClaims({ model, reply: "We forwarded this to OCEAN EMERALD at 19:03.", record }), claims.slice(0, 5));
  assert.deepEqual(calls, [{ system: CLAIMS_CHECKER, text: `Tool record:\n${record}\n\nReply:\nWe forwarded this to OCEAN EMERALD at 19:03.` }]);
});

test("when the second call can't run, the flagged claims stand", async () => {
  const transcript = readEmails({ subject: "Fwd", body: "We forwarded this to OCEAN EMERALD at 19:03." });
  for (const answer of ["not json", { reported: "1" }]) {
    const { model, calls } = checker({ unsupported: ["we forwarded this to Ocean Emerald"] }, answer);
    assert.deepEqual(await unsupportedClaims({ model, reply: "(the reply)", record: toolRecord(transcript), transcript }), ["we forwarded this to Ocean Emerald"]);
    assert.equal(calls.length, 2);
  }
});
