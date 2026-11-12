import assert from "node:assert/strict";
import test from "node:test";
import {
  latestAssistantMessageAwaitingUserReply,
  latestAssistantQuestionsAwaitingUserReply
} from "../src/shared/conversation/questions.js";

const questions = "Before I build it:\n[1] Which page should hold the form?\n[2] Should the email field be required?";
const laterQuestions = "One more thing:\n[1] Which colour should the button use?";
const choices = "Which layout should I use?\nPossible answers:\n- Cards\n- Table";
const followUp = "No files have changed. I'll build it once you've answered those questions.";

const user = (text = "Add a sign-up form.") => ({ role: "user", text });
const reply = (text, extra = {}) => ({ role: "assistant", text, ...extra });
const commentary = text => ({ role: "commentary", text });
const thinking = text => ({ role: "thinking", text });
const turn = (...messages) => ({ turnId: "000001", messages });

test("questions followed by a short closing message in the same turn are still found", () => {
  const log = { turns: [turn(user(), reply(questions), reply(followUp))] };
  assert.equal(latestAssistantQuestionsAwaitingUserReply(log), questions);
  // The plain reader still answers with the closing message alone.
  assert.equal(latestAssistantMessageAwaitingUserReply(log), followUp);
});

test("questions the AI wrote before a tool call (commentary) are found behind its final reply", () => {
  const log = [turn(user(), thinking("Checking the files."), commentary(questions), thinking("Nothing changed."), reply(followUp))];
  assert.equal(latestAssistantQuestionsAwaitingUserReply(log), questions);
});

test("answer choices count as questions", () => {
  assert.equal(latestAssistantQuestionsAwaitingUserReply([turn(user(), reply(choices), reply(followUp))]), choices);
});

test("the search reads at most the lookback's AI messages, and thinking does not count", () => {
  const between = count => Array.from({ length: count }, (_, index) => [thinking(`Step ${index}`), commentary(`Note ${index}`)]).flat();
  // The questions are the tenth AI message from the end: found.
  assert.equal(latestAssistantQuestionsAwaitingUserReply([turn(user(), reply(questions), ...between(8), reply(followUp))]), questions);
  // The eleventh: not found.
  assert.equal(latestAssistantQuestionsAwaitingUserReply([turn(user(), reply(questions), ...between(9), reply(followUp))]), "");
  assert.equal(latestAssistantQuestionsAwaitingUserReply([turn(user(), reply(questions), reply(followUp))], { lookback: 1 }), "");
});

test("the person's message after the questions ends the search", () => {
  assert.equal(latestAssistantQuestionsAwaitingUserReply([
    turn(user(), reply(questions)),
    turn(user("Page two, and yes."), reply("Done."))
  ]), "");
  assert.equal(latestAssistantQuestionsAwaitingUserReply([turn(user(), reply(questions)), turn(user("Page two."))]), "");
});

test("only the latest set of questions is offered", () => {
  assert.equal(latestAssistantQuestionsAwaitingUserReply([
    turn(user(), reply(questions), commentary(laterQuestions), reply(followUp))
  ]), laterQuestions);
});

test("nothing is offered while the AI is still writing or still working", () => {
  assert.equal(latestAssistantQuestionsAwaitingUserReply([
    turn(user(), reply(questions), reply("No files have", { status: "inProgress" }))
  ]), "");
  assert.equal(latestAssistantQuestionsAwaitingUserReply([turn(user(), reply(questions, { status: "inProgress" }))]), "");
  // Questions in commentary before the AI's final reply exists.
  assert.equal(latestAssistantQuestionsAwaitingUserReply([turn(user(), commentary(questions), thinking("Reading files."))]), "");
});

test("the search crosses turns without a person's message and reads turns without a message list", () => {
  assert.equal(latestAssistantQuestionsAwaitingUserReply([
    turn(user(), reply(questions)),
    { turnId: "000002", system: { text: "Review started." }, messages: [{ role: "system", text: "Review started." }] },
    turn(reply(followUp))
  ]), questions);
  assert.equal(latestAssistantQuestionsAwaitingUserReply([
    { user: { text: "Add a sign-up form." } },
    { assistant: { text: questions } },
    { assistant: { text: followUp } }
  ]), questions);
  assert.equal(latestAssistantQuestionsAwaitingUserReply([
    { user: { text: "Add a sign-up form." } },
    { assistant: { text: followUp }, commentary: [{ text: questions }] }
  ]), questions);
  assert.equal(latestAssistantQuestionsAwaitingUserReply([
    { assistant: { text: questions } },
    { user: { text: "Page two." } }
  ]), "");
  assert.equal(latestAssistantQuestionsAwaitingUserReply([
    { assistant: { text: questions } },
    { assistant: { text: "No files", status: "inProgress" } }
  ]), "");
});

test("a reply without questions, or no reply, offers nothing", () => {
  assert.equal(latestAssistantQuestionsAwaitingUserReply([turn(user(), reply("Done."))]), "");
  assert.equal(latestAssistantQuestionsAwaitingUserReply([]), "");
  assert.equal(latestAssistantQuestionsAwaitingUserReply(null), "");
  assert.equal(latestAssistantQuestionsAwaitingUserReply({ turns: [turn(user())] }), "");
});
