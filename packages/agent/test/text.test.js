import assert from "node:assert/strict";
import test from "node:test";
import { READ_LIMIT, sameGist, stripNotes, textPart } from "../src/server/index.js";

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
