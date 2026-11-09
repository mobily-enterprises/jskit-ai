import assert from "node:assert/strict";
import test from "node:test";
import { READ_LIMIT, estimateTokens, sameGist, stripNotes, textPart, windowLimits, withinBudget } from "../src/server/index.js";

test("a paragraph that says again what a later one says is spotted, but an answer after a status line isn't", () => {
  assert.equal(sameGist(
    "GitHub isn't signed in, it's waiting for sign-in, so I can't see your activity. If you connect it, I'll pull together the week's activity and flag reviews.",
    "I can't see anything yet because GitHub isn't signed in, it's waiting for sign-in. Connect it and I'll pull this week's activity and flag anything."
  ), true);
  assert.equal(sameGist("I'll check your calendar for Tuesday now.", "Tuesday 3 Nov is clear on both calendars; I changed nothing."), false);
});

test("bracketed bookkeeping lines never reach the person", () => {
  assert.equal(stripNotes("The page is open.\n(I handed you my screen to: sign in.)"), "The page is open.");
  assert.equal(stripNotes("Pick one (or both) of these."), "Pick one (or both) of these.");
  assert.equal(stripNotes("(The app's record of a tool that ran: Starred: an email.)(The app's record of a tool that ran: Marked as read: an email.)\n\nBoth undone."), "Both undone.", "several notes on a line go too");
});

// A long text is read in parts, whole lines at a time, and each cut-off part says where to carry on
// (as Claude Code's reader does); one over-long line still moves reading on.
test("a long text is read in parts", () => {
  const text = Array.from({ length: 30000 }, (_, index) => `line ${index + 1} ${"x".repeat(20)}`).join("\n");
  const first = textPart(text);
  assert.equal(first.lines, 30000);
  const next = Number(first.shown.match(/from_line: (\d+)/u)[1]);
  assert.ok(first.shown.includes("line 1 ") && first.shown.includes(`line ${next - 1} `) && !first.shown.includes(`line ${next} `));
  assert.ok(first.shown.length <= READ_LIMIT + 200);
  assert.ok(textPart(text, next).shown.startsWith(`line ${next} `), "the next part starts where the first stopped");
  const last = textPart(text, 29999).shown;
  assert.ok(last.includes("line 30000 ") && !last.includes("from_line"), "the end says nothing more");
  const minified = textPart(`${"{\"a\":1}".repeat(30000)}\n{"b":2}`);
  assert.match(minified.shown, /from_line: 2/u, "an over-long line is split and reading moves on");
  assert.ok(minified.shown.length < 130000);
});

// A file's bytes count about four to a token, as text does, and a picture a thousand: never the
// JSON that writes the bytes out, several characters a byte, which made an attachment of about
// 80 KB outweigh a 128k-token model's whole history, so every earlier message was dropped.
test("an attached file counts by its bytes, so the history before it stays", () => {
  const file = { type: "file", data: Buffer.alloc(80_000, 200), mediaType: "text/plain" };
  assert.equal(estimateTokens([{ role: "user", content: [file] }]), 20_000);
  assert.equal(estimateTokens([{ role: "user", content: [{ ...file, data: new Uint8Array(80_000) }] }]), 20_000);
  assert.equal(estimateTokens([{ role: "user", content: [{ ...file, data: Buffer.alloc(80_000).toString("base64") }] }]), 20_000);
  assert.equal(estimateTokens([{ role: "user", content: [{ type: "image", image: Buffer.alloc(2_000_000), mediaType: "image/png" }] }]), 1000);
  assert.equal(estimateTokens([{ role: "user", content: [{ ...file, data: Buffer.alloc(900_000), mediaType: "image/png" }] }]), 1000);
  const screenshot = { type: "tool-result", toolCallId: "c1", toolName: "screenshot",
    output: { type: "content", value: [{ type: "text", text: "The page." }, { type: "media", data: Buffer.alloc(600_000).toString("base64"), mediaType: "image/png" }] } };
  assert.ok(estimateTokens([{ role: "tool", content: [screenshot] }]) < 1100, "a tool's picture counts as a picture");

  const history = [{ role: "user", content: "What did the report say?" }, { role: "assistant", content: "It said sales rose." }];
  const request = { role: "user", content: [{ type: "text", text: "Compare it with this one." }, file] };
  const kept = withinBudget([...history, request], windowLimits(128_000).history);
  assert.deepEqual(kept, [...history, request], "the earlier messages are still read");
});
