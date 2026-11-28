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

// The claims checker, answering with the claims it names.
const naming = (claims) => new MockLanguageModelV4({
  doGenerate: async () => ({ content: [{ type: "text", text: JSON.stringify({ unsupported: claims }) }], finishReason: { unified: "stop", raw: "stop" },
    usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }, warnings: [] })
});
// A reply that read one email, as its transcript holds it.
const readEmail = (email) => [
  { role: "assistant", content: [{ type: "tool-call", toolCallId: "call_1", toolName: "inbox_read", input: { messageId: "m1" } }] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: "call_1", toolName: "inbox_read", output: { type: "json", value: email } }] }
];

// CompAS's Colleague read an email that said "We forwarded this to OCEAN EMERALD at 19:03" and repeated
// it; the checker, which sees each tool result only briefly, named it as the reply's own claim and the
// reply was sent back. A claim the reply's own tool results hold word for word was reported from a
// record, not done; the assistant's own claims are still sent back.
test("a claim its own tool results hold word for word was reported from a record; the assistant's own claims stand", async () => {
  const email = { subject: "Fwd: berth change", from: "ops@agency.example",
    body: "Hi all,\n\nWe forwarded this to OCEAN EMERALD at 19:03 and are waiting for the master.\nI've forwarded the invoice to the vessel's master as well.\nWe've forwarded it to the pilots too." };
  const transcript = readEmail(email);
  const claims = (named, options = {}) => unsupportedClaims({ model: naming(named), reply: "(the reply)", record: toolRecord(transcript), ...options });
  for (const reported of ["We forwarded this to OCEAN EMERALD at 19:03", "we forwarded this to Ocean Emerald at 19:03."]) {
    assert.deepEqual(await claims([reported], { transcript }), [], `${reported}: reported from the email, whatever its case and punctuation`);
  }
  for (const own of [
    // The first person singular is the assistant speaking, even in a record's words.
    "I've forwarded the invoice to the vessel's master",
    // Too short to tell a report from a claim by its words.
    "We've forwarded it",
    // Not what the email says.
    "We forwarded the invoice to OCEAN EMERALD at 19:03",
    "I've sent the email"
  ]) assert.deepEqual(await claims([own], { transcript }), [own], own);
  assert.deepEqual(await claims(["We forwarded this to OCEAN EMERALD at 19:03", "I've sent the email"], { transcript }), ["I've sent the email"],
    "Only the reported claim is set aside");
  assert.deepEqual(await claims(["We forwarded this to OCEAN EMERALD at 19:03"]), ["We forwarded this to OCEAN EMERALD at 19:03"],
    "Without the reply's transcript, as Mercbot calls it, every claim the checker names stands");
});
