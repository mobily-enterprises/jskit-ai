import assert from "node:assert/strict";
import test from "node:test";
import { askTools } from "../src/server/index.js";

test("a question is a card to answer when the chat can show one, otherwise part of the reply", async () => {
  const posted = [];
  const card = askTools({ post: async (messages) => posted.push(...messages) }).askUser;
  assert.deepEqual(await card.execute({ question: "Which colour?", options: ["Red", "Blue"] }), { status: "asked", note: "The person sees the question. End your reply now in one short line, and carry on when they answer." });
  assert.deepEqual(posted, [{ kind: "question", role: "bot", body: { question: "Which colour?", options: ["Red", "Blue"] } }]);
  await card.execute({ question: "Anything else?" });
  assert.deepEqual(posted[1].body.options, [], "no answers to pick from");
  assert.deepEqual(await askTools().askUser.execute({ question: "Which colour?" }), { status: "ask in your reply", note: "Put the question in your reply, end it there, and carry on when they answer." });
});
