import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

const options = { skip: process.env.JSKIT_ASSISTANT_RUNTIME_BROWSER_INTEGRATION !== "1", timeout: 120_000 };

async function fixture(t, width = 1280, { acceptedDraft = false, draftWhileLoading = false, unresolved = false, applicationDefaults = false } = {}) {
  const vite = await startViteFixture({ fixtureRoot: fileURLToPath(new URL("../fixtures/canonical-conversation/", import.meta.url)) });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  const diagnostics = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") diagnostics.push(message.text()); });
  page.on("requestfailed", request => diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`));
  t.after(async () => { await browser.close(); await stopProcess(vite); assert.deepEqual(errors, []); });
  const fixtureOptions = new URLSearchParams();
  if (acceptedDraft) fixtureOptions.set("acceptedDraft", "");
  if (draftWhileLoading) fixtureOptions.set("draftWhileLoading", "");
  if (unresolved) fixtureOptions.set("unresolved", "");
  if (applicationDefaults) fixtureOptions.set("applicationDefaults", "");
  await page.goto(`${vite.baseURL}/?${fixtureOptions}`);
  const primary = page.locator("[data-primary]");
  const input = primary.getByRole("textbox", { name: "Message AI assistant" });
  try { await expect(input).toBeEnabled(); }
  catch (failure) {
    t.diagnostic(JSON.stringify({ errors, diagnostics, vite: vite.readOutput(), html: await page.locator("body").innerHTML() }));
    throw failure;
  }
  const command = (name, body = {}) => page.request.post(`${vite.baseURL}/fixture/${name}`, { data: body });
  const state = async () => (await page.request.get(`${vite.baseURL}/fixture/state`)).json();
  const sent = async () => (await state()).requests.filter(request => request.suffix === "/messages");
  const notify = id => page.evaluate(id => window.conversationFixture.socket.notify(id), id);
  return { page, primary, input, command, state, sent, notify };
}

test("inspecting a restored no-admission request releases Send while preserving newer draft and uploads", options, async t => {
  const f = await fixture(t, 390);
  const attach = async () => {
    await f.page.evaluate(() => {
      window.savedBinding = window.conversationFixture.acquireConversation({
        conversationId: "chat:2", draftStorage: { storage: sessionStorage, key: "not-sent-recovery" }
      });
      window.conversationFixture.target("chat:2");
    });
    await expect.poll(() => f.page.evaluate(() => window.savedBinding.runtime.value?.available.value)).toBe(true);
  };
  await attach();
  await f.command("mode", { mode: "uncertain" });
  await f.input.fill("Original unadmitted words");
  await f.input.press("Enter");
  const check = f.primary.getByRole("button", { name: "Check delivery", exact: true });
  await expect(check).toBeVisible();
  const [original] = await f.sent();
  await f.input.fill("A separate newer draft");
  await f.command("question", { id: "chat:2", text: "An unrelated completed answer.", pending: false });
  await f.notify("chat:2");
  await f.page.reload();
  await expect(f.input).toBeEnabled();
  await attach();
  await expect(f.input).toHaveValue("A separate newer draft");
  const send = f.primary.getByRole("button", { name: "Send message", exact: true });
  await expect(send).toBeDisabled();
  await f.page.evaluate(() => window.conversationFixture.attachments(true));
  await f.primary.locator("input[type=file]").setInputFiles({ name: "newer.txt", mimeType: "text/plain", buffer: Buffer.from("Keep this upload") });
  const uploads = () => f.page.evaluate(() => window.conversationFixture.attachmentState());
  await expect.poll(async () => (await uploads()).ready.length).toBe(1);
  await f.command("mode", { mode: "not-sent" });
  await check.click();
  await expect(check).toHaveCount(0);
  await expect(send).toBeEnabled();
  await expect(f.input).toHaveValue("A separate newer draft");
  assert.equal((await f.sent()).length, 1, "Inspection never resends the old request or submits the new draft");
  assert.deepEqual((await uploads()).acknowledged, []);
  assert.deepEqual((await uploads()).deleted, []);
  assert.equal((await uploads()).ready[0].fileName, "newer.txt");
  await f.command("mode", { mode: "product-accepted" });
  await send.click();
  await expect.poll(async () => (await f.sent()).length).toBe(2);
  const next = (await f.sent())[1];
  assert.notEqual(next.input.messageId, original.input.messageId);
  assert.equal(next.input.text, "A separate newer draft");
});

test("the canonical standard element keeps draft/focus/layout while applying the shared stream snapshot", options, async t => {
  const f = await fixture(t, 390);
  await expect(f.primary.getByRole("button", { name: "Set goal", exact: true })).toHaveCount(0);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().changeGoal("set", { objective: "Unsupported" })), false);
  assert.equal((await f.state()).requests.filter(request => request.suffix === "/goal").length, 0);
  await f.input.fill("First request");
  await f.input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  assert.equal((await f.sent()).length, 0);
  await f.input.press("Enter");
  await expect(f.primary.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect(f.input).toHaveValue("");
  await f.input.fill("Draft typed while streaming. Keep my selection.");
  await f.input.evaluate(element => { element.focus(); element.setSelectionRange(6, 11); window.fixtureInput = element; });
  const [request] = await f.sent();
  assert.equal(request.surface, "home");
  assert.deepEqual(Object.keys(request.input).sort(), ["messageId", "text"]);
  const messageId = `${request.input.messageId}:answer`;
  await f.page.evaluate(messageId => window.conversationFixture.socket.notify("chat:1", {
    type: "message", messageId, role: "assistant", status: "inProgress", text: "Partial answer",
    streaming: { revision: 1, messages: [{ messageId, role: "assistant", status: "inProgress", text: "Partial answer" }] }
  }), messageId);
  await expect(f.primary.getByText("Partial answer", { exact: true })).toBeVisible();
  await expect(f.input).toBeFocused();
  assert.deepEqual(await f.input.evaluate(element => [element === window.fixtureInput, element.selectionStart, element.selectionEnd]), [true, 6, 11]);
  await f.command("finish", { id: "chat:1", text: "Partial answer completed." });
  await f.notify("chat:1");
  await expect(f.primary.getByText("Partial answer completed.", { exact: true })).toHaveCount(1);
  await expect(f.primary.getByText("Partial answer", { exact: true })).toHaveCount(0);
  await expect(f.input).toHaveValue("Draft typed while streaming. Keep my selection.");
  await expect(f.primary.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  for (const width of [390, 800, 1365]) {
    await f.page.setViewportSize({ width, height: 900 });
    await expect(f.input).toBeVisible();
    assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.equal((await f.sent()).length, 1);
  await f.command("error", { id: "chat:1", error: "Restore access to conversation storage before continuing." });
  await f.notify("chat:1");
  await expect(f.primary.getByText("Restore access to conversation storage before continuing.", { exact: true })).toBeVisible();
});

test("optional goal controls follow declared command semantics and budgets without client engine branches", options, async t => {
  const f = await fixture(t);
  await f.input.fill("Keep this draft while changing goals");
  const requests = async () => (await f.state()).requests.filter(request => request.suffix === "/goal" && request.method === "POST");
  for (const budgets of [true, false]) {
    const commands = {
      set: { delivery: "message", interruptsTurn: false }, resume: { delivery: "message", interruptsTurn: false },
      pause: { delivery: "control", interruptsTurn: !budgets },
      cancel: { delivery: budgets ? "control" : "message", interruptsTurn: !budgets }
    };
    await f.command("goals", { id: "chat:1", budgets, commands });
    await f.notify("chat:1");
    await f.primary.getByRole("button", { name: "Set goal", exact: true }).click();
    const objective = budgets ? "Finish with a bounded budget" : "Finish without a budget";
    await f.page.getByRole("textbox", { name: "Goal objective" }).fill(objective);
    const budget = f.page.getByRole("spinbutton", { name: "Token budget (optional)" });
    if (budgets) await budget.fill("1000");
    else await expect(budget).toHaveCount(0);
    const start = f.page.getByRole("button", { name: "Start goal", exact: true });
    await expect(start).toBeEnabled();
    await start.click();
    await expect(f.primary.getByRole("button", { name: "Goal running", exact: true })).toBeVisible();
    const pause = f.page.getByRole("button", { name: "Pause goal", exact: true });
    await expect(pause).toBeEnabled();
    await expect(f.page.getByText(budgets
      ? "Pausing prevents further automatic turns. Use Stop to interrupt the current turn."
      : "Pause stops the current turn and keeps the goal for later.", { exact: true })).toBeVisible();
    await pause.click();
    await expect(f.primary.getByRole("button", { name: "Goal paused", exact: true })).toBeVisible();
    const resume = f.page.getByRole("button", { name: "Resume goal", exact: true });
    await expect(resume).toBeEnabled();
    await resume.click();
    await expect(f.primary.getByRole("button", { name: "Goal running", exact: true })).toBeVisible();
    const cancel = f.page.getByRole("button", { name: "Cancel goal", exact: true });
    await expect(cancel).toBeEnabled();
    await cancel.click();
    await expect(f.primary.getByRole("button", { name: "Set goal", exact: true })).toBeVisible();
    const commandsSent = (await requests()).slice(-4).map(request => request.input);
    assert.deepEqual(commandsSent.map(command => command.action), ["set", "pause", "resume", "cancel"]);
    assert.ok(commandsSent[0].messageId);
    assert.ok(commandsSent[2].messageId);
    assert.equal(Object.hasOwn(commandsSent[1], "messageId"), false);
    assert.equal(Object.hasOwn(commandsSent[3], "messageId"), !budgets);
    assert.equal(commandsSent[0].tokenBudget, budgets ? 1000 : undefined);
    assert.ok(commandsSent.every(command => command.expectedSegmentId === commandsSent[0].expectedSegmentId));
    assert.ok(commandsSent.slice(1).every(command => command.expectedGoalId === `goal-${commandsSent[0].messageId}`));
    assert.ok(commandsSent.every(command => !Object.hasOwn(command, "engine") && !Object.hasOwn(command, "threadId")));
    await f.input.click();
    await expect(f.input).toHaveValue("Keep this draft while changing goals");
  }
  assert.equal((await f.sent()).length, 0, "Goal commands use the existing goal operation, not ordinary send");
});

test("the first native goal preserves absent identity and later controls capture its actual thread", options, async t => {
  const f = await fixture(t);
  await f.input.fill("Keep this ordinary draft");
  await f.command("goals", { id: "chat:1", segmentId: null, budgets: false, commands: {
    set: { delivery: "control", interruptsTurn: false }, pause: { delivery: "control", interruptsTurn: false }
  } });
  await f.notify("chat:1");
  await f.primary.getByRole("button", { name: "Set goal", exact: true }).click();
  await f.page.getByRole("textbox", { name: "Goal objective" }).fill("Start the first native goal");
  const start = f.page.getByRole("button", { name: "Start goal", exact: true });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(f.primary.getByRole("button", { name: "Goal running", exact: true })).toBeVisible();
  const pause = f.page.getByRole("button", { name: "Pause goal", exact: true });
  await expect(pause).toBeEnabled();
  await pause.click();
  await expect(f.primary.getByRole("button", { name: "Goal paused", exact: true })).toBeVisible();
  const state = await f.state();
  const commands = state.requests.filter(request => request.suffix === "/goal" && request.method === "POST").map(request => request.input);
  assert.deepEqual(commands.map(command => command.action), ["set", "pause"]);
  assert.equal(commands[0].expectedSegmentId, null, "The binding must not invent a segment for an unstarted native conversation");
  assert.equal(commands[0].expectedGoalId, null);
  assert.equal(commands[1].expectedSegmentId, "first-native-thread-chat:1");
  assert.equal(commands[1].expectedGoalId, state.states["chat:1"].goal.id);
  assert.ok(commands.every(command => !Object.hasOwn(command, "messageId") && !Object.hasOwn(command, "threadId")));
  assert.deepEqual(state.states["chat:1"].conversationLog, [], "Native controls do not fabricate authored transcript receipts");
  assert.deepEqual(await f.sent(), []);
  await f.input.click();
  await expect(f.input).toHaveValue("Keep this ordinary draft");
});

test("a lost goal receipt uses the same inspection-only ledger and never starts a second goal on reconnect", options, async t => {
  const f = await fixture(t);
  await f.command("goals", { id: "chat:1", budgets: false, commands: {
    set: { delivery: "message", interruptsTurn: false }, pause: { delivery: "control", interruptsTurn: true }
  } });
  await f.notify("chat:1");
  await f.primary.getByRole("button", { name: "Set goal", exact: true }).click();
  await f.page.getByRole("textbox", { name: "Goal objective" }).fill("Finish the uncertain goal");
  await f.command("mode", { mode: "uncertain" });
  const start = f.page.getByRole("button", { name: "Start goal", exact: true });
  await expect(start).toBeEnabled();
  await start.click();
  await f.input.click();
  const check = f.primary.getByRole("button", { name: "Check delivery", exact: true });
  await expect(check).toBeVisible();
  await expect(f.primary.getByText("Finish the uncertain goal", { exact: true })).toHaveCount(1);
  const requests = async () => (await f.state()).requests.filter(request => request.suffix === "/goal" && request.method === "POST");
  const [original] = await requests();
  assert.ok(original.input.messageId);
  await f.page.evaluate(() => window.conversationFixture.socket.reconnect());
  await expect(check).toBeVisible();
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().changeGoal("set", { objective: "Do not repeat" })), false);
  assert.equal((await requests()).length, 1);
  await f.command("confirm", { id: "chat:1" });
  await check.click();
  await expect(check).toHaveCount(0);
  await expect(f.primary.getByRole("button", { name: "Goal running", exact: true })).toBeVisible();
  await expect(f.primary.getByText("Finish the uncertain goal", { exact: true })).toHaveCount(1);
  assert.equal((await requests()).length, 1);
  await f.primary.getByRole("button", { name: "Goal running", exact: true }).click();
  await expect(f.page.getByRole("button", { name: "Cancel goal", exact: true })).toHaveCount(0);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().changeGoal("cancel")), false);
  assert.equal((await requests()).length, 1, "An undeclared goal command is not exposed or dispatched");
});

test("a supplied goal view keeps its pinned target and refreshes through the retained binding without polling", options, async t => {
  const f = await fixture(t);
  const goal = { id: "retained-goal", objective: "The plain product objective", status: "paused",
    timeUsedSeconds: 12, updatedAt: "2026-10-04T00:00:00.000Z" };
  const view = { status: "available", goal, routing: { mode: "senior", selection: { engineId: "other-native" } },
    target: { segmentId: "retained-goal-segment", capabilities: { goals: true, goalBudgets: false,
      goalCommands: { resume: { delivery: "control", interruptsTurn: false }, pause: { delivery: "control", interruptsTurn: true } } } } };
  let reads = 0;
  let failedRead = false;
  const commands = [];
  await f.page.route("**/conversations/*/goal", async route => {
    if (route.request().method() === "GET") {
      reads++;
      return route.fulfill({ status: failedRead ? 503 : 200, json: failedRead ? { error: "Goal status is unavailable." } : view });
    }
    commands.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: false, error: "The displayed goal changed." } });
  });
  await f.page.evaluate(async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const interval = window.setInterval.bind(window);
    window.fixtureGoalTimeouts = [];
    window.fixtureGoalIntervals = [];
    AbortSignal.timeout = ms => { window.fixtureGoalTimeouts.push(ms); return timeout(ms); };
    window.setInterval = (callback, ms, ...args) => { window.fixtureGoalIntervals.push(ms); return interval(callback, ms, ...args); };
    await window.conversationFixture.eventReaders([{ id: "goal-reader", goal: true }]);
  });
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().goalView.value)).toEqual(view);
  assert.equal((await f.state()).states["chat:1"].capabilities.goals, false,
    "An explicit supplied read can follow a retained goal while the visible engine has no goals");
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().goalState.value.pending)).toBe(false);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().changeGoal("resume")), false);
  assert.deepEqual(commands, [{ action: "resume", expectedSegmentId: view.target.segmentId, expectedGoalId: goal.id }]);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().goalState.value.error), "The displayed goal changed.");
  const beforeEvent = reads;
  view.goal = { ...goal, status: "active", objective: "Still the plain product objective" };
  await f.page.evaluate(() => window.conversationFixture.socket.notify("chat:1", { type: "goal" }));
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().goalView.value.goal.objective)).toBe(view.goal.objective);
  assert.ok(reads > beforeEvent);
  const beforeReconnect = reads;
  await f.page.evaluate(() => window.conversationFixture.socket.reconnect());
  await expect.poll(() => reads).toBeGreaterThan(beforeReconnect);
  const beforeFocus = reads;
  await f.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads).toBeGreaterThan(beforeFocus);
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().goalState.value.pending)).toBe(false);
  failedRead = true;
  await f.page.evaluate(() => window.conversationFixture.current().refreshGoal());
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().goalLoadError.value)).toBe("Goal status is unavailable.");
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().error.value), "",
    "Passive goal failure does not enter conversation or app-wide request recovery");
  await expect(f.input).toBeEnabled();
  const deadlines = await f.page.evaluate(() => window.fixtureGoalTimeouts);
  assert.ok(deadlines.length > 0);
  assert.ok(deadlines.every(ms => ms === 30_000));
  assert.equal((await f.page.evaluate(() => window.fixtureGoalIntervals)).includes(60_000), false);
  assert.equal(commands.length, 1, "Native events, reconnect, focus and passive recovery never retry a command");
  await f.page.evaluate(() => {
    window.retiredGoalRuntime = window.conversationFixture.current();
    window.conversationFixture.actor("");
  });
  await expect.poll(() => f.page.evaluate(() => window.retiredGoalRuntime.goalView.value)).toBe(null);
  assert.equal(await f.page.evaluate(() => window.retiredGoalRuntime.current.value), false);
  assert.equal(await f.page.evaluate(() => window.retiredGoalRuntime.changeGoal("resume")), false);
  assert.equal(commands.length, 1, "Retired viewer controls cannot target the next viewer's goal");
});

test("a rejected message goal retry keeps its original UUID and exact read target", options, async t => {
  const f = await fixture(t);
  const commands = [];
  const view = { status: "available", goal: null, target: { segmentId: null,
    capabilities: { goals: true, goalBudgets: false, goalCommands: { set: { delivery: "message", interruptsTurn: false } } } } };
  await f.page.route("**/conversations/*/goal", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: view });
    const input = route.request().postDataJSON();
    commands.push(input);
    if (commands.length === 1) return route.fulfill({ status: 409,
      json: { code: "conversation_goal_changed", error: "Goal changed before admission." } });
    return route.fulfill({ json: { status: "accepted", messageId: input.messageId, turnId: "original-goal-receipt" } });
  });
  await f.page.evaluate(() => window.conversationFixture.eventReaders([{ id: "goal-reader", goal: true }]));
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().goalView.value)).toEqual(view);
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().goalState.value?.pending)).toBe(false);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().changeGoal("set", { objective: "Original objective" })), false);
  assert.equal(commands.length, 1);
  assert.ok(commands[0].messageId);
  assert.equal(commands[0].expectedSegmentId, null);
  assert.equal(commands[0].expectedGoalId, null);
  view.target.segmentId = "newly-observed-target";
  view.target.capabilities.goalCommands.set.delivery = "control";
  view.goal = { id: "newly-observed-goal", status: "complete", objective: "Another objective" };
  await f.page.evaluate(() => window.conversationFixture.current().refreshGoal());
  const accepted = await f.page.evaluate(messageId => window.conversationFixture.current().send(
    { message: "Changed retry must be ignored" }, { messageId }), commands[0].messageId);
  assert.equal(accepted.status, "accepted");
  assert.deepEqual(commands[1], commands[0], "Retry does not substitute the newer target, goal, objective or UUID");
  assert.deepEqual(await f.sent(), [], "Goal delivery stays on the existing goal command and receipt ledger");
});

test("canonical attachment receipts clear only captured uploads before a held HTTP response", options, async t => {
  const f = await fixture(t, 390);
  await f.page.evaluate(() => window.conversationFixture.attachments(true));
  const files = f.primary.locator("input[type=file]");
  const attachments = () => f.page.evaluate(() => window.conversationFixture.attachmentState());
  await files.setInputFiles({ name: "original.txt", mimeType: "text/plain", buffer: Buffer.from("Original file") });
  await expect.poll(async () => (await attachments()).ready.length).toBe(1);
  const original = (await attachments()).ready[0];
  await f.command("mode", { mode: "hold" });
  await f.primary.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(async () => (await f.state()).held).toBe(1);
  const [request] = await f.sent();
  assert.deepEqual(Object.keys(request.input).sort(), ["attachmentIds", "messageId", "text"]);
  assert.deepEqual(request.input.attachmentIds, [original.attachmentId]);
  assert.equal(request.input.text, "", "Attachment-only delivery preserves the authored empty text");
  await files.setInputFiles([
    { name: "newer.txt", mimeType: "text/plain", buffer: Buffer.from("Newer file") },
    { name: "held-later.txt", mimeType: "text/plain", buffer: Buffer.from("Still uploading") }
  ]);
  await expect.poll(async () => (await attachments()).queue.map(row => row.phase)).toEqual(["ready", "ready", "uploading"]);
  await f.input.fill("Keep the newer draft and uploads.");
  await f.command("accept", { holdResponse: true });
  await f.notify("chat:1");
  await expect.poll(async () => (await attachments()).acknowledged).toEqual([[original.attachmentId]]);
  assert.deepEqual((await attachments()).queue.map(row => row.fileName), ["newer.txt", "held-later.txt"]);
  assert.deepEqual((await attachments()).deleted, []);
  assert.equal((await f.state()).held, 1);
  await f.command("release-response");
  await f.page.evaluate(() => window.conversationFixture.finishUploads());
  await expect.poll(async () => (await attachments()).ready.map(file => file.fileName)).toEqual(["newer.txt", "held-later.txt"]);
  assert.deepEqual((await attachments()).acknowledged, [[original.attachmentId]]);
  await expect(f.input).toHaveValue("Keep the newer draft and uploads.");
  assert.equal((await f.sent()).length, 1);
});

test("explicit delivery inspection acknowledges uncertain attachments without clearing newer uploads or resending", options, async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => window.conversationFixture.attachments(true));
  const files = f.primary.locator("input[type=file]");
  const attachments = () => f.page.evaluate(() => window.conversationFixture.attachmentState());
  await files.setInputFiles({ name: "uncertain.txt", mimeType: "text/plain", buffer: Buffer.from("Keep this receipt") });
  await expect.poll(async () => (await attachments()).ready.length).toBe(1);
  const original = (await attachments()).ready[0];
  await f.command("mode", { mode: "uncertain" });
  await f.input.fill("Inspect this file.");
  await f.input.press("Enter");
  const check = f.primary.getByRole("button", { name: "Check delivery", exact: true });
  await expect(check).toBeVisible();
  assert.deepEqual((await attachments()).acknowledged, []);
  await files.setInputFiles({ name: "newer.txt", mimeType: "text/plain", buffer: Buffer.from("Keep this newer file") });
  await expect.poll(async () => (await attachments()).ready.length).toBe(2);
  await check.click();
  await expect(check).toBeVisible();
  assert.deepEqual((await attachments()).acknowledged, [], "An unknown receipt does not accept the upload");
  await f.command("confirm", { id: "chat:1" });
  await check.click();
  await expect(check).toHaveCount(0);
  await expect.poll(async () => (await attachments()).acknowledged).toEqual([[original.attachmentId]]);
  assert.deepEqual((await attachments()).ready.map(file => file.fileName), ["newer.txt"]);
  assert.deepEqual((await attachments()).deleted, []);
  await f.notify("chat:1");
  assert.equal((await f.sent()).length, 1);
  assert.deepEqual((await attachments()).acknowledged, [[original.attachmentId]]);
});

test("attachment capability and upload gates preserve drafts and retired actors cannot clear a new queue", options, async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => window.conversationFixture.attachments(true));
  const files = f.primary.locator("input[type=file]");
  const attachments = () => f.page.evaluate(() => window.conversationFixture.attachmentState());
  await files.setInputFiles({ name: "held-upload.txt", mimeType: "text/plain", buffer: Buffer.from("Wait for upload") });
  await f.input.fill("Wait for this file.");
  await expect(f.primary.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  await f.input.press("Enter");
  assert.equal((await f.sent()).length, 0);
  // Disabled submission preserves ordinary textarea editing, including Enter.
  await expect(f.input).toHaveValue("Wait for this file.\n");
  await f.command("attachments", { id: "chat:1", enabled: false });
  await f.notify("chat:1");
  await expect(f.primary.getByRole("button", { name: "Attach files", exact: true })).toHaveCount(0);
  await f.page.evaluate(() => window.conversationFixture.finishUploads());
  await expect.poll(async () => (await attachments()).ready.length).toBe(1);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().send({
    message: "", displayAttachments: window.conversationFixture.attachmentState().ready
  })), false);
  assert.equal((await f.sent()).length, 0);
  await f.command("attachments", { id: "chat:1", enabled: true });
  await f.notify("chat:1");
  await f.command("mode", { mode: "hold" });
  await f.input.press("Enter");
  await expect.poll(async () => (await f.state()).held).toBe(1);
  await f.page.evaluate(() => window.conversationFixture.actor("43"));
  await expect(f.input).toBeEnabled();
  await files.setInputFiles({ name: "next-actor.txt", mimeType: "text/plain", buffer: Buffer.from("Next actor file") });
  await expect.poll(async () => (await attachments()).ready.map(file => file.fileName)).toEqual(["next-actor.txt"]);
  await f.command("accept");
  await f.notify("chat:1");
  await expect.poll(async () => (await f.state()).held).toBe(0);
  assert.deepEqual((await attachments()).acknowledged, []);
  assert.deepEqual((await attachments()).ready.map(file => file.fileName), ["next-actor.txt"]);
  assert.equal((await f.sent()).length, 1);
});

test("canonical optional suggestions use an independent host generator and edit the draft without sending", options, async t => {
  const f = await fixture(t, 390);
  const suggestion = prompt => f.primary.getByRole("button", { name: `Use suggestion: ${prompt}`, exact: true });
  const suggestions = () => f.page.evaluate(() => window.conversationFixture.suggestionState());
  await expect(f.primary.getByRole("button", { name: /^Use suggestion:/u })).toHaveCount(0);
  await f.page.evaluate(() => window.conversationFixture.suggestions(true));
  await expect(suggestion("Suggested by suggestions-small")).toBeVisible();
  const [original] = (await suggestions()).requests;
  assert.deepEqual(original.configuration, { integrationId: "suggestions", model: "suggestions-small" });
  assert.equal(original.target.conversationId, "chat:1");
  assert.equal(original.target.actorKey, "42");
  await suggestion("Suggested by suggestions-small").hover();
  await expect(f.input).toHaveAttribute("placeholder", "Suggested by suggestions-small");
  await expect(f.input).toHaveValue("");
  await f.input.fill("Keep this draft until I choose a suggestion.");
  await expect(suggestion("Suggested by suggestions-small")).toBeVisible();
  await suggestion("Suggested by suggestions-small").hover();
  await expect(f.input).toHaveValue("Keep this draft until I choose a suggestion.");
  assert.equal((await f.sent()).length, 0);
  await f.page.evaluate(() => window.conversationFixture.suggestionModel("suggestions-large"));
  await suggestion("Suggested by suggestions-large").click();
  await expect(f.input).toHaveValue("Suggested by suggestions-large");
  await expect(f.input).toBeFocused();
  assert.equal((await f.sent()).length, 0, "Choosing a suggestion edits the draft; Send stays explicit");
  assert.equal((await suggestions()).requests[0].configuration.model, "suggestions-small");
  await f.input.press("Enter");
  await expect(f.primary.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect(f.primary.getByRole("button", { name: /^Use suggestion:/u })).toHaveCount(0);
  assert.equal((await f.sent())[0].input.text, "Suggested by suggestions-large");
  await f.input.fill("Keep typing while chat works.");
  await expect(f.input).toHaveValue("Keep typing while chat works.");
  assert.equal((await f.sent()).length, 1);
  assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
});

test("canonical suggestion scope cancels stale targets and actors while a voice reader retains the draft", options, async t => {
  const f = await fixture(t);
  const suggestions = () => f.page.evaluate(() => window.conversationFixture.suggestionState());
  const resolve = (index, prompt) => f.page.evaluate(({ index, prompt }) => window.conversationFixture.resolveSuggestion(index, prompt), { index, prompt });
  await f.page.evaluate(() => window.conversationFixture.suggestions(true, "hold"));
  await expect.poll(async () => (await suggestions()).requests.length).toBe(1);
  await f.page.evaluate(() => window.conversationFixture.target("chat:2"));
  await expect.poll(async () => (await suggestions()).requests.at(-1)?.target.conversationId).toBe("chat:2");
  assert.equal((await suggestions()).requests[0].aborted, true);
  await resolve(0, "Obsolete conversation suggestion");
  assert.deepEqual((await suggestions()).items, []);
  const previousActor = (await suggestions()).requests.length - 1;
  await f.page.evaluate(() => window.conversationFixture.actor("43"));
  await expect.poll(async () => (await suggestions()).requests.at(-1)?.target.actorKey).toBe("43");
  assert.equal((await suggestions()).requests[previousActor].aborted, true);
  await resolve(previousActor, "Obsolete actor suggestion");
  assert.deepEqual((await suggestions()).items, []);
  await resolve((await suggestions()).requests.length - 1, "Current actor suggestion");
  await f.primary.getByRole("button", { name: "Use suggestion: Current actor suggestion", exact: true }).click();
  await expect(f.input).toHaveValue("Current actor suggestion");
  await expect.poll(async () => (await suggestions()).requests.at(-1)?.draft).toBe("Current actor suggestion");
  const hiddenRequest = (await suggestions()).requests.length - 1;
  await f.page.evaluate(() => { window.conversationFixture.retainVoice(); window.conversationFixture.show(false); });
  await expect.poll(async () => (await suggestions()).requests[hiddenRequest].aborted).toBe(true);
  await resolve(hiddenRequest, "Late hidden suggestion");
  assert.equal((await f.page.evaluate(() => window.conversationFixture.voiceState())).draft, "Current actor suggestion");
  assert.deepEqual((await suggestions()).items, []);
  await f.page.evaluate(() => window.conversationFixture.show(true));
  await expect(f.input).toHaveValue("Current actor suggestion");
  await expect.poll(async () => (await suggestions()).requests.length).toBeGreaterThan(hiddenRequest + 1);
  await resolve((await suggestions()).requests.length - 1, "Returned conversation suggestion");
  await expect(f.primary.getByRole("button", { name: "Use suggestion: Returned conversation suggestion", exact: true })).toBeVisible();
  assert.equal(await f.page.evaluate(() => window.conversationFixture.socket.inspect().active), 1);
  await f.command("deny", { denied: true });
  await f.notify("chat:2");
  await expect(f.input).toBeDisabled();
  await expect(f.primary.getByRole("button", { name: /^Use suggestion:/u })).toHaveCount(0);
  assert.deepEqual((await suggestions()).items, []);
  assert.equal((await f.sent()).length, 0);
});

test("text, mirror and voice retain one target while five chats share the supplied socket and release only observers", options, async t => {
  const f = await fixture(t);
  await f.input.fill("Retained draft");
  await f.page.evaluate(() => { window.conversationFixture.retainVoice(); window.conversationFixture.mirror(true); });
  await expect(f.page.locator("[data-mirror]").getByRole("textbox", { name: "Message AI assistant" })).toHaveValue("Retained draft");
  assert.equal(await f.page.evaluate(() => window.conversationFixture.socket.inspect().active), 1);
  await f.page.evaluate(() => window.conversationFixture.multiple(true));
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.socket.inspect().active)).toBe(5);
  await f.page.evaluate(() => { window.conversationFixture.multiple(false); window.conversationFixture.mirror(false); window.conversationFixture.show(false); });
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.socket.inspect().active)).toBe(1);
  assert.equal((await f.page.evaluate(() => window.conversationFixture.voiceState())).draft, "Retained draft");
  assert.equal((await f.page.evaluate(() => window.conversationFixture.sendVoice("Voice stays with its retained target."))).status, "accepted");
  await expect.poll(async () => (await f.page.evaluate(() => window.conversationFixture.voiceState())).turns.length).toBe(1);
  assert.equal((await f.sent())[0].id, "chat:1");
  await f.page.evaluate(() => { window.conversationFixture.target("chat:2"); window.conversationFixture.show(true); });
  await expect(f.input).toBeEnabled();
  await expect(f.input).toHaveValue("");
  assert.equal((await f.page.evaluate(() => window.conversationFixture.voiceState())).id, "chat:1");
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.socket.inspect().active)).toBe(2);
  await f.page.evaluate(() => { window.conversationFixture.show(false); window.conversationFixture.actor("43"); });
  await expect.poll(async () => (await f.page.evaluate(() => window.conversationFixture.voiceState())).current).toBe(false);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.sendVoice("A retired identity must not send.")), false);
  const retired = await f.page.evaluate(() => window.conversationFixture.voiceState());
  assert.deepEqual(retired.turns, []);
  assert.equal(retired.draft, "");
  await f.page.evaluate(() => window.conversationFixture.releaseVoice());
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.socket.inspect().active)).toBe(0);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.socket.inspect().listeners), 0);
  assert.equal((await f.sent()).length, 1);
  assert.equal((await f.state()).requests.filter(request => request.suffix === "/cancel").length, 0);
});

test("retained event hooks notify active mirrored readers in state order and leave no callbacks after release", options, async t => {
  const f = await fixture(t);
  const readers = value => f.page.evaluate(value => window.conversationFixture.eventReaders(value), value);
  const events = () => f.page.evaluate(() => window.conversationFixture.readerEvents());
  const socket = () => f.page.evaluate(() => window.conversationFixture.socket.inspect());
  const notify = event => f.page.evaluate(event => window.conversationFixture.socket.notify("chat:1", event), event);
  const initialCalls = (await socket()).calls.length;
  const initialRequests = (await f.state()).requests.length;
  await readers([{ id: "first" }, { id: "second" }]);
  assert.equal((await socket()).active, 1);
  assert.equal((await socket()).calls.length, initialCalls, "Mirrored hooks reuse the existing subscription");
  await notify({ type: "application", marker: "both", failure: "throw" });
  assert.deepEqual((await events()).map(({ reader, marker }) => [reader, marker]), [["first", "both"], ["second", "both"]]);

  await notify({ type: "message", marker: "stream", failure: "reject", messageId: "streamed-answer", role: "assistant",
    status: "inProgress", text: "Applied before notification", streaming: { revision: 1,
      messages: [{ messageId: "streamed-answer", role: "assistant", status: "inProgress", text: "Applied before notification" }] } });
  assert.deepEqual((await events()).slice(-2), ["first", "second"].map(reader => ({
    reader, type: "message", marker: "stream", revision: 1, text: "Applied before notification"
  })), "A failed hook cannot interrupt the next reader or precede canonical stream application");
  await expect(f.primary.getByText("Applied before notification", { exact: true })).toBeVisible();
  assert.equal((await f.state()).requests.length, initialRequests, "Presentation notifications do not add canonical reads");

  await readers([{ id: "first", active: false }, { id: "second" }]);
  await notify({ type: "application", marker: "active-only" });
  assert.deepEqual((await events()).slice(4).map(({ reader, marker }) => [reader, marker]), [["second", "active-only"]]);
  await f.page.evaluate(() => { window.conversationFixture.retainVoice(); window.conversationFixture.show(false); });
  await expect(f.primary).toHaveCount(0);
  await readers([{ id: "first", active: false }]);
  await notify({ type: "application", marker: "released-second" });
  assert.equal((await events()).length, 5, "Inactive and released readers receive no events while voice retains the target");
  assert.equal((await socket()).active, 1);

  await readers([{ id: "first" }]);
  await notify({ type: "application", marker: "reactivated" });
  assert.deepEqual((await events()).slice(5).map(({ reader, marker }) => [reader, marker]), [["first", "reactivated"]]);
  assert.equal((await socket()).calls.length, initialCalls, "Changing presentation readers does not restart the retained subscription");
  await readers([]);
  await notify({ type: "application", marker: "voice-only" });
  assert.equal((await events()).length, 6, "Runtime retention does not retain a released view's callback");
  assert.equal((await socket()).active, 1);
  assert.equal((await f.page.evaluate(() => window.conversationFixture.voiceState())).turns[0].assistant.text, "Applied before notification");
  await f.page.evaluate(() => window.conversationFixture.releaseVoice());
  await expect.poll(async () => (await socket()).active).toBe(0);
  assert.equal((await socket()).listeners, 0);
  assert.equal((await f.state()).requests.filter(request => request.suffix === "/cancel").length, 0);
});

test("canonical receipts settle a held response and uncertain delivery stays inspection-only through reconnect", options, async t => {
  const f = await fixture(t, 390);
  await f.command("mode", { mode: "hold" });
  await f.input.fill("Receipt before response");
  await f.input.press("Enter");
  await expect.poll(async () => (await f.state()).held).toBe(1);
  await f.command("accept", { holdResponse: true });
  await f.notify("chat:1");
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().delivery.state.sending)).toBe(false);
  await expect(f.primary.getByText("Receipt before response", { exact: true })).toHaveCount(1);
  assert.equal((await f.state()).held, 1, "The canonical receipt wins before the HTTP response is released");
  await f.command("release-response");
  await f.command("finish", { id: "chat:1" });
  await f.notify("chat:1");
  await expect(f.primary.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await f.command("mode", { mode: "uncertain" });
  await f.input.fill("Keep this exact uncertain request");
  await f.input.press("Enter");
  const check = f.primary.getByRole("button", { name: "Check delivery", exact: true });
  await expect(check).toBeVisible();
  await expect(f.primary.getByText("Keep this exact uncertain request", { exact: true })).toHaveCount(1);
  await expect(f.primary.getByRole("button", { name: /^(Retry|Edit|Cancel)$/u })).toHaveCount(0);
  const checkBox = await check.boundingBox();
  assert.ok(checkBox.width >= 48 && checkBox.height >= 48);
  await f.input.fill("Preserve the newer draft");
  await expect(f.primary.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  await check.click();
  await expect(check).toBeEnabled();
  assert.equal((await f.sent()).length, 2);
  await f.page.evaluate(() => window.conversationFixture.socket.reconnect());
  await expect(check).toBeVisible();
  await expect(f.input).toHaveValue("Preserve the newer draft");
  await expect(f.primary.getByText("Keep this exact uncertain request", { exact: true })).toHaveCount(1);
  assert.equal((await f.sent()).length, 2, "Reconnect only subscribes and reads");
  await f.command("confirm", { id: "chat:1" });
  await check.click();
  await expect(check).toHaveCount(0);
  await expect(f.primary.getByText("Keep this exact uncertain request", { exact: true })).toHaveCount(1);
  assert.equal((await f.sent()).length, 2, "Explicit inspection does not submit the request");
  await f.command("deny", { denied: true });
  await f.notify("chat:1");
  await expect(f.primary.getByText("Access denied.", { exact: true })).toBeVisible();
  await expect(f.input).toBeDisabled();
  await expect(f.input).toHaveValue("");
  await expect(f.primary.getByText("Keep this exact uncertain request", { exact: true })).toHaveCount(0);
});

for (const status of ["uncertain", "pending", "accepted", "failed", "unrecognised"]) {
  test(`saved delivery preserves its actual admission fact through page reload: ${status}`, options, async t => {
    const f = await fixture(t);
    const messageId = `reload-${status}`;
    const attach = async () => {
      await f.page.evaluate(() => {
        window.savedBinding = window.conversationFixture.acquireConversation({
          conversationId: "chat:2", draftStorage: { storage: sessionStorage, key: "original-delivery-reload" }
        });
        window.conversationFixture.target("chat:2");
      });
      await expect.poll(() => f.page.evaluate(() => window.savedBinding.runtime.value?.available.value)).toBe(true);
    };
    await attach();
    await f.command("mode", { mode: status === "accepted" ? "product-native-duplicate"
      : status === "failed" ? "rejected" : status === "pending" ? "hold" : "uncertain" });
    await f.page.evaluate(messageId => {
      const runtime = window.savedBinding.runtime.value;
      runtime.draft.value = "Keep my separate newer draft";
      window.savedSubmission = runtime.send({ message: "Exact original saved words",
        data: { clientId: "original-client", focus: { project: "original-project" } } }, { messageId });
    }, messageId);
    await expect.poll(async () => (await f.sent()).length).toBe(1);
    if (status !== "pending") await f.page.evaluate(() => window.savedSubmission);
    const unconfirmed = ["uncertain", "pending", "unrecognised"].includes(status);
    await f.command("question", { id: "chat:2", text: "An unrelated completed answer.", pending: false });
    if (unconfirmed) {
      await f.command("history", { id: "chat:2", limit: 20, turns: [{ turnId: messageId,
        user: { messageId, role: "user", text: "Exact original saved words", receipt: false }
      }] });
    }
    await f.notify("chat:2");
    await expect.poll(() => f.page.evaluate(() => window.savedBinding.runtime.value.snapshot.value.status)).toBe("ready");
    if (status === "unrecognised") {
      await f.page.evaluate(() => {
        const saved = JSON.parse(sessionStorage.getItem("original-delivery-reload"));
        saved.messages[0].status = "unrecognised";
        sessionStorage.setItem("original-delivery-reload", JSON.stringify(saved));
      });
    }
    let releaseInspection;
    if (status === "uncertain") {
      const gate = Promise.withResolvers();
      t.after(() => gate.resolve());
      releaseInspection = gate.resolve;
      await f.page.route("**/deliveries/**/inspect", async route => {
        await gate.promise;
        await route.fulfill({ json: { status: "unknown", messageId } }).catch(() => {});
      });
      await f.page.evaluate(messageId => { void window.savedBinding.runtime.value.inspectDelivery(messageId); }, messageId);
      await expect.poll(() => f.page.evaluate(() => JSON.parse(sessionStorage.getItem("original-delivery-reload")).messages[0].checking)).toBe(true);
    }
    const saved = await f.page.evaluate(() => JSON.parse(sessionStorage.getItem("original-delivery-reload")));
    assert.equal(saved.messages[0].status, status);
    await f.page.reload();
    releaseInspection?.();
    if (releaseInspection) await f.page.unroute("**/deliveries/**/inspect");
    await expect(f.input).toBeEnabled();
    await attach();
    await expect(f.input).toHaveValue(saved.draft);
    const restored = await f.page.evaluate(messageId => window.savedBinding.runtime.value.delivery.find(messageId), messageId);
    assert.equal(restored.status, unconfirmed ? "uncertain" : status);
    assert.equal(restored.checking, false, "an inspector from the old page cannot disable recovery on the new page");
    assert.equal(restored.id, saved.messages[0].id);
    assert.deepEqual(restored.payload, saved.messages[0].payload);
    assert.equal((await f.sent()).length, 1, "restoration never dispatches a saved request");
    assert.equal(await f.page.evaluate(() => window.savedBinding.runtime.value.canSubmit.value), !unconfirmed);
    if (unconfirmed) {
      const check = f.primary.getByRole("button", { name: "Check delivery", exact: true });
      try { await expect(check).toBeEnabled(); }
      catch (failure) {
        t.diagnostic(JSON.stringify(await f.page.evaluate(() => {
          const saved = window.savedBinding.runtime.value;
          const primary = window.conversationFixture.current();
          return { shared: saved === primary, savedIdentity: saved.identity, primaryIdentity: primary.identity,
            canonical: saved.turns.value, messages: saved.delivery.state.messages,
            projected: saved.delivery.turns(saved.turns.value) };
        })));
        await f.page.screenshot({ path: `/tmp/jskit-saved-delivery-reload-${status}-20261006.png` });
        throw failure;
      }
      for (const action of ["Retry", "Cancel", "Edit"]) {
        await expect(f.primary.getByRole("button", { name: action, exact: true })).toHaveCount(0);
      }
      // The fixture's original inspector matches any same-ID row. Keep the
      // nonreceipt projection proof above, then inspect genuine absence.
      await f.command("history", { id: "chat:2", turns: [], limit: 20 });
      await f.notify("chat:2");
      await expect(check).toBeEnabled();
      assert.equal(await f.page.evaluate(messageId => window.savedBinding.runtime.value.delivery.find(messageId).status, messageId), "uncertain",
        "removing a nonreceipt row is not evidence of rejection or admission");
      await check.click();
      await expect(check).toBeEnabled();
      assert.equal(await f.page.evaluate(messageId => window.savedBinding.runtime.value.delivery.find(messageId).status, messageId), "uncertain");
      assert.equal((await f.sent()).length, 1, "unknown inspection cannot resend or acknowledge");
      if (status === "pending") await f.command("accept");
      else await f.command("confirm", { id: "chat:2" });
      await f.notify("chat:2");
      await expect(check).toHaveCount(0);
      assert.equal((await f.sent()).length, 1, "only the actual canonical receipt settles the original identity");
    } else {
      await expect(f.primary.getByRole("button", { name: "Check delivery", exact: true })).toHaveCount(0);
      await expect(f.primary.getByRole("button", { name: "Retry", exact: true })).toHaveCount(status === "failed" ? 1 : 0);
    }
  });
}

for (const code of ["ACTION_VALIDATION_FAILED", "conversation_not_steerable"]) {
test(`an explicit pre-admission rejection retains original retry identity and the newer draft: ${code}`, options, async t => {
  const f = await fixture(t);
  await f.command("mode", { mode: "rejected" });
  if (code === "conversation_not_steerable") {
    await f.command("steering", { id: "chat:1", enabled: true });
    await f.command("question", { id: "chat:1", text: "An earlier answer is still finishing.", pending: true });
    await f.notify("chat:1");
    await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().steerable.value)).toBe(true);
    await f.page.route("**/messages", async route => {
      const response = await route.fetch();
      await route.fulfill(response.status() === 400
        ? { response, status: 409, json: { error: "The message was rejected before admission.", code } }
        : { response });
    });
  }
  await f.input.fill("Retry only this original message");
  await f.input.press("Enter");
  await expect(f.primary.getByText("Failed: The message was rejected before admission.", { exact: true })).toBeVisible();
  const [rejected] = await f.sent();
  assert.equal((await f.sent()).length, 1, "a definite rejection never silently resubmits steering as new work");
  assert.equal(await f.page.evaluate(id => window.conversationFixture.current().delivery.find(id).status, rejected.input.messageId), "failed");
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().canSubmit.value), true);
  await expect(f.primary.getByRole("button", { name: "Check delivery", exact: true })).toHaveCount(0);
  if (code === "conversation_not_steerable") {
    assert.equal(rejected.input.steer, true);
  }
  await f.input.fill("My newer draft");
  await f.command("mode", { mode: "accepted" });
  await f.primary.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(f.primary.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect(f.input).toHaveValue("My newer draft");
  const requests = await f.sent();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].input, requests[1].input);
  await expect(f.primary.getByText("Retry only this original message", { exact: true })).toHaveCount(1);
  await f.primary.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(f.primary.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  assert.equal((await f.state()).requests.filter(request => request.suffix === "/cancel").length, 1);
  if (code === "conversation_not_steerable") {
    await f.command("mode", { mode: "rejected" });
    for (const action of ["Cancel", "Edit"]) {
      await f.command("question", { id: "chat:1", text: "An earlier answer is still finishing.", pending: true });
      await f.notify("chat:1");
      await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().steerable.value)).toBe(true);
      const text = `Known rejected steer for ${action}`;
      await f.input.fill(text);
      await f.input.press("Enter");
      await expect(f.primary.getByText("Failed: The message was rejected before admission.", { exact: true })).toBeVisible();
      const request = (await f.sent()).at(-1);
      assert.equal(request.input.steer, true);
      await f.input.fill("Keep my newer draft");
      await f.primary.getByRole("button", { name: action, exact: true }).click();
      await expect(f.primary.getByText("Failed: The message was rejected before admission.", { exact: true })).toHaveCount(0);
      assert.equal(await f.page.evaluate(id => window.conversationFixture.current().delivery.find(id), request.input.messageId), null);
      await expect(f.input).toHaveValue(action === "Edit" ? `${text}\n\nKeep my newer draft` : "Keep my newer draft");
    }
    assert.equal((await f.sent()).length, 4, "Cancel and Edit do not dispatch another prompt");
    assert.equal((await f.state()).requests.filter(request => request.suffix === "/cancel").length, 1, "failed-message recovery does not stop agent work");
  }
});
}

test("opted-in nonsteerable follow-ups use the original serial queue and dispatch only after ready", options, async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => {
    window.deferredBinding = window.conversationFixture.acquireConversation({
      conversationId: "chat:2", deferWhileWorking: true, queueWhileSending: true
    });
    window.conversationFixture.target("chat:2");
  });
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current()?.identity.conversationId)).toBe("chat:2");
  await expect(f.input).toBeEnabled();
  await f.input.fill("Original nonsteerable request");
  await f.input.press("Enter");
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().snapshot.value.status)).toBe("working");
  await f.page.evaluate(() => window.conversationFixture.data({ clientId: "typed", focus: { project: "captured" } }));
  await f.input.fill("Typed follow-up while answering");
  await f.input.press("Enter");
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().delivery.state.messages.length)).toBe(1);
  const [typed] = await f.page.evaluate(() => window.conversationFixture.current().delivery.state.messages);
  await f.page.evaluate(() => {
    window.conversationFixture.retainVoice();
    window.queuedSpeech = window.conversationFixture.sendVoice("Spoken follow-up while answering", {
      clientId: "voice", focus: { project: "voice-captured" }
    });
    window.conversationFixture.changeFocus({ project: "later" });
  });
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().delivery.state.messages.length)).toBe(2);
  const [, spoken] = await f.page.evaluate(() => window.conversationFixture.current().delivery.state.messages);
  await expect(f.primary.getByText(typed.text, { exact: true })).toHaveCount(1);
  await expect(f.primary.getByText(spoken.text, { exact: true })).toHaveCount(1);
  await expect(f.input).toBeEnabled();
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().canSubmit.value), true);
  assert.equal((await f.sent()).length, 1, "both authored follow-ups wait locally without HTTP");
  await f.command("finish", { id: "chat:2" });
  await f.notify("chat:2");
  await expect.poll(async () => (await f.sent()).length).toBe(2);
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().snapshot.value.status)).toBe("working");
  assert.deepEqual((await f.sent())[1].input, {
    messageId: typed.id, text: typed.text, data: { clientId: "typed", focus: { project: "captured" } }
  });
  assert.equal((await f.sent()).length, 2, "the next follower waits for the first follow-up's real turn");
  await f.command("finish", { id: "chat:2" });
  await f.notify("chat:2");
  await expect.poll(async () => (await f.sent()).length).toBe(3);
  assert.deepEqual((await f.sent())[2].input, {
    messageId: spoken.id, text: spoken.text, data: { clientId: "voice", focus: { project: "voice-captured" } }
  });
  assert.equal((await f.page.evaluate(() => window.queuedSpeech)).status, "accepted");
  assert.equal((await f.state()).requests.some(request => request.suffix === "/cancel"), false,
    "ordinary follow-ups never stop the original turn or output owner");
  await f.command("steering", { id: "chat:2", enabled: true });
  await f.notify("chat:2");
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().steerable.value)).toBe(true);
  assert.equal((await f.page.evaluate(() => window.conversationFixture.sendVoice("Native steering remains immediate"))).status, "accepted");
  assert.equal((await f.sent()).at(-1).input.steer, true);
});

for (const action of ["stop", "actor", "denied"]) {
  test(`opted-in local followers cannot dispatch after ${action}`, options, async t => {
    const f = await fixture(t);
    await f.page.evaluate(() => {
      window.deferredBinding = window.conversationFixture.acquireConversation({
        conversationId: "chat:2", deferWhileWorking: true, queueWhileSending: true
      });
      window.conversationFixture.target("chat:2");
    });
    await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current()?.identity.conversationId)).toBe("chat:2");
    await f.command("mode", { mode: "hold" });
    await f.page.evaluate(() => {
      window.firstDeferred = window.deferredBinding.runtime.value.send({ message: "First in-flight request" }, { messageId: "first-held" });
    });
    await expect.poll(async () => (await f.state()).held).toBe(1);
    await f.page.evaluate(() => {
      window.followerDeferred = window.deferredBinding.runtime.value.send({ message: "Local follower only" }, { messageId: "local-follower" });
    });
    assert.equal((await f.sent()).length, 1);
    if (action === "stop") await f.page.evaluate(() => window.deferredBinding.runtime.value.cancel());
    else if (action === "actor") await f.page.evaluate(() => window.conversationFixture.actor("different-actor"));
    else {
      await f.command("deny", { denied: true });
      await f.notify("chat:2");
      await expect.poll(() => f.page.evaluate(() => window.deferredBinding.runtime.value.available.value)).toBe(false);
    }
    await f.command("accept");
    assert.equal(await f.page.evaluate(() => window.followerDeferred), false);
    assert.equal((await f.sent()).length, 1, "a canceled local follower never reaches HTTP behind the original serial predecessor");
    assert.equal((await f.state()).requests.filter(request => request.suffix === "/cancel").length, action === "stop" ? 1 : 0);
  });
}

test("authored application data stays captured across retry, a lost receipt and changed focus", options, async t => {
  const f = await fixture(t);
  const originalData = { clientId: "typed-client", focus: { project: "first", session: "original" } };
  await f.page.evaluate(data => window.conversationFixture.data(data), originalData);
  await f.command("mode", { mode: "rejected" });
  await f.input.fill("Keep this authored context");
  await f.input.press("Enter");
  await expect(f.primary.getByText("Failed: The message was rejected before admission.", { exact: true })).toBeVisible();
  const [original] = await f.sent();
  assert.deepEqual(original.input.data, originalData);
  assert.deepEqual(Object.keys(original.input).sort(), ["data", "messageId", "text"]);

  await f.page.evaluate(() => window.conversationFixture.changeFocus({ project: "second", session: "new-selection" }));
  await f.input.fill("Keep the newer typed draft");
  await f.command("mode", { mode: "uncertain" });
  await f.primary.getByRole("button", { name: "Retry", exact: true }).click();
  const check = f.primary.getByRole("button", { name: "Check delivery", exact: true });
  await expect(check).toBeVisible();
  assert.deepEqual((await f.sent())[1].input, original.input);
  assert.deepEqual(await f.page.evaluate(() => window.conversationFixture.current().delivery.state.messages[0].payload.request.data), originalData);
  assert.deepEqual((await f.state()).states["chat:1"].pendingRequest.data, originalData);

  await f.page.evaluate(() => {
    window.conversationFixture.changeFocus({ project: "third", session: "after-receipt-loss" });
    window.conversationFixture.socket.reconnect();
  });
  await expect(check).toBeVisible();
  await check.click();
  await expect(check).toBeEnabled();
  assert.equal((await f.sent()).length, 2, "Receipt inspection and reconnect do not reconstruct or resend input data");
  await f.command("confirm", { id: "chat:1" });
  await check.click();
  await expect(check).toHaveCount(0);
  await expect(f.input).toHaveValue("Keep the newer typed draft");
  assert.equal((await f.sent()).length, 2);
});

test("voice supplies its own authored data on the retained target and cannot send after actor retirement", options, async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => {
    window.conversationFixture.data({ clientId: "typed-client", focus: { project: "typed-original" } });
    window.conversationFixture.retainVoice();
  });
  await f.input.fill("A typed draft remains independent");
  const voiceData = { clientId: "voice-client", focus: { project: "voice-capture", session: "voice-original" } };
  const result = await f.page.evaluate(async data => {
    const pending = window.conversationFixture.sendVoice("Use the utterance capture", data);
    data.focus.project = "changed-after-submission";
    return pending;
  }, voiceData);
  assert.equal(result.status, "accepted");
  await expect(f.input).toHaveValue("A typed draft remains independent");
  const [request] = await f.sent();
  assert.equal(request.id, "chat:1");
  assert.deepEqual(request.input.data, voiceData);
  await f.command("finish", { id: "chat:1" });
  await f.notify("chat:1");
  await expect(f.primary.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);

  await f.page.evaluate(() => {
    window.conversationFixture.target("chat:2");
    window.conversationFixture.changeFocus({ project: "new-text-target" });
  });
  await expect(f.input).toBeEnabled();
  await f.input.fill("Another target's draft");
  const retainedData = { clientId: "voice-client", focus: { project: "second-utterance" } };
  assert.equal((await f.page.evaluate(data => window.conversationFixture.sendVoice("Still the retained conversation", data), retainedData)).status, "accepted");
  assert.equal((await f.sent())[1].id, "chat:1");
  assert.deepEqual((await f.sent())[1].input.data, retainedData);
  await expect(f.input).toHaveValue("Another target's draft");

  await f.page.evaluate(() => window.conversationFixture.actor("43"));
  await expect.poll(async () => (await f.page.evaluate(() => window.conversationFixture.voiceState())).current).toBe(false);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.sendVoice("Retired actor", { focus: { project: "forbidden" } })), false);
  const retired = await f.page.evaluate(() => window.conversationFixture.voiceState());
  assert.equal(retired.draft, "");
  assert.deepEqual(retired.turns, []);
  assert.equal((await f.sent()).length, 2);
});

test("canonical questions require complete answers and keep the captured reply while voice retains a pending send", options, async t => {
  const f = await fixture(t, 390);
  const prompt = "Please answer both.\n[1] Which file?\n[2] Which helper?";
  await f.command("question", { id: "chat:1", text: prompt, pending: true });
  await f.notify("chat:1");
  await f.page.evaluate(() => window.conversationFixture.questions(true));
  await expect(f.primary.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  const first = f.primary.getByRole("textbox", { name: "[1] Which file?", exact: true });
  const second = f.primary.getByRole("textbox", { name: "[2] Which helper?", exact: true });
  await expect(first, "An unfinished assistant reply does not open a question form").toHaveCount(0);
  await f.command("question", { id: "chat:1", text: prompt });
  await f.notify("chat:1");
  await expect(first).toBeVisible();
  const send = f.primary.getByRole("button", { name: "Send message", exact: true });
  await expect(send).toBeDisabled();
  await first.fill("src/main.js");
  await expect(send).toBeDisabled();
  await f.page.evaluate(() => window.conversationFixture.mirror(true));
  const mirroredFirst = f.page.locator("[data-mirror]").getByRole("textbox", { name: "[1] Which file?", exact: true });
  await expect(mirroredFirst).toHaveValue("src/main.js");
  await mirroredFirst.fill("src/shared.js");
  await expect(first).toHaveValue("src/shared.js");
  await first.fill("src/main.js");
  await f.page.evaluate(() => {
    window.conversationFixture.retainVoice();
    window.conversationFixture.mirror(false);
    window.conversationFixture.show(false);
  });
  await expect(f.primary).toHaveCount(0);
  await f.page.evaluate(() => window.conversationFixture.show(true));
  await expect(first, "The shared form retains an unfinished answer while only voice holds the conversation").toHaveValue("src/main.js");
  await expect(send).toBeDisabled();
  await second.fill("parseInput");
  await f.input.fill("Keep the existing behavior.");
  await expect(send).toBeEnabled();
  for (const width of [390, 800, 1365]) {
    await f.page.setViewportSize({ width, height: 900 });
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await f.command("mode", { mode: "hold" });
  await send.click();
  await expect.poll(async () => (await f.state()).held).toBe(1);
  await expect(first).toHaveCount(0);
  await f.input.fill("My next thought stays editable.");
  await f.page.evaluate(() => { window.conversationFixture.retainVoice(); window.conversationFixture.show(false); });
  await expect(f.primary).toHaveCount(0);
  await f.page.evaluate(() => window.conversationFixture.show(true));
  await expect(f.input).toHaveValue("My next thought stays editable.");
  await expect(first, "The retained send does not reopen its submitted form").toHaveCount(0);
  const [request] = await f.sent();
  assert.deepEqual(Object.keys(request.input).sort(), ["messageId", "text"]);
  assert.equal(request.input.text, "[1] src/main.js\n[2] parseInput\n\nKeep the existing behavior.");
  await f.command("accept", { holdResponse: true });
  await f.notify("chat:1");
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().delivery.state.sending)).toBe(false);
  assert.equal((await f.state()).held, 1);
  await f.command("release-response");
  await expect(f.input).toHaveValue("My next thought stays editable.");
  assert.equal((await f.sent()).length, 1);
});

test("canonical questions retry their exact formatted reply and uncertain delivery stays inspection-only", options, async t => {
  const f = await fixture(t);
  await f.command("question", { id: "chat:1", text: "[1] Which file should change?" });
  await f.notify("chat:1");
  await f.page.evaluate(() => window.conversationFixture.questions(true));
  const answer = f.primary.getByRole("textbox", { name: "[1] Which file should change?", exact: true });
  await answer.fill("src/first.js");
  await f.input.fill("Use the existing helper.");
  await f.command("mode", { mode: "rejected" });
  await f.primary.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(f.primary.getByText("Failed: The message was rejected before admission.", { exact: true })).toBeVisible();
  await expect(answer).toHaveCount(0);
  await f.input.fill("A separate newer thought.");
  await f.command("mode", { mode: "uncertain" });
  await f.primary.getByRole("button", { name: "Retry", exact: true }).click();
  const check = f.primary.getByRole("button", { name: "Check delivery", exact: true });
  await expect(check).toBeVisible();
  const requests = await f.sent();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].input, requests[0].input);
  assert.equal(requests[0].input.text, "[1] src/first.js\n\nUse the existing helper.");
  await f.page.evaluate(() => window.conversationFixture.socket.reconnect());
  await expect(check).toBeVisible();
  await check.click();
  await expect(check).toBeEnabled();
  assert.equal((await f.sent()).length, 2);
  await f.command("confirm", { id: "chat:1" });
  await check.click();
  await expect(check).toHaveCount(0);
  await expect(f.input).toHaveValue("A separate newer thought.");
  await expect(answer).toHaveCount(0);
  assert.equal((await f.sent()).length, 2);
});

test("canonical questions preserve choice values and free-form escape while isolating target and actor changes", options, async t => {
  const f = await fixture(t);
  await f.command("question", { id: "chat:1", text: ["[1] Include callbacks?", "Possible answers:",
    "- Complete lifecycle (Recommended)", "- Sending first", "[2] Which file?"].join("\n") });
  await f.notify("chat:1");
  await f.page.evaluate(() => window.conversationFixture.questions(true));
  const select = f.primary.getByRole("combobox", { name: "[1] Include callbacks?", exact: true });
  await f.primary.locator(".assistant-questions__question-select .v-field__input").click();
  await expect(f.page.getByRole("option", { name: "I am not sure", exact: true })).toHaveCount(0);
  await select.press("Escape");
  await f.page.evaluate(() => window.conversationFixture.questions({
    extraChoice: { label: "I am not sure", selectLabel: "I am not sure", value: "I am not sure", recommended: false }
  }));
  await f.primary.locator(".assistant-questions__question-select .v-field__input").click();
  await f.page.getByRole("option", { name: "I am not sure", exact: true }).click();
  await f.primary.getByRole("textbox", { name: "[2] Which file?", exact: true }).fill("src/main.js");
  await f.input.fill("Let me explain in my own words.");
  await f.primary.getByRole("button", { name: "Answer normally instead", exact: true }).click();
  await expect(select).toHaveCount(0);
  await expect(f.input).toHaveValue("Let me explain in my own words.");
  await f.primary.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(f.primary.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  assert.equal((await f.sent())[0].input.text, "Let me explain in my own words.");
  await f.command("finish", { id: "chat:1" });
  await f.notify("chat:1");
  await expect(f.primary.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await f.command("question", { id: "chat:1", text: "Choose.\nPossible answers:\n- Option A: Use A.\n- Option B: Use B." });
  await f.notify("chat:1");
  await f.primary.locator(".assistant-questions__answer-choices").getByText("Option A", { exact: true }).click();
  assert.equal((await f.sent()).length, 1, "Choosing an answer does not submit it");
  await f.primary.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(f.primary.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  assert.equal((await f.sent())[1].input.text, "Use A.");
  await f.command("finish", { id: "chat:1" });
  await f.notify("chat:1");
  const samePrompt = "[1] Which subsystem?";
  await f.command("question", { id: "chat:1", text: samePrompt });
  await f.command("question", { id: "chat:2", text: samePrompt });
  await f.notify("chat:1");
  const field = f.primary.getByRole("textbox", { name: samePrompt, exact: true });
  await field.fill("Old target answer");
  await f.page.evaluate(() => window.conversationFixture.target("chat:2"));
  await expect(field).toHaveValue("");
  await field.fill("Old actor answer");
  await f.page.evaluate(() => window.conversationFixture.actor("43"));
  await expect(field).toHaveValue("");
  await f.command("deny", { denied: true });
  await f.notify("chat:2");
  await expect(f.primary.getByText("Access denied.", { exact: true })).toBeVisible();
  await expect(field).toHaveCount(0);
  assert.equal((await f.sent()).length, 2);
});

test("canonical model controls use the supplied reactive owner and disappear with unavailable or retired access", options, async t => {
  const f = await fixture(t, 390);
  const choose = f.primary.getByRole("button", { name: "Choose AI", exact: true });
  await expect(choose).toHaveCount(0);
  await f.input.fill("Keep this independent draft.");
  await f.page.evaluate(() => window.conversationFixture.models(true));
  await choose.click();
  const apply = f.page.getByRole("button", { name: "Apply", exact: true });
  await expect(apply).toBeDisabled();
  await f.page.getByRole("button", { name: "Large model", exact: true }).click();
  await expect(apply).toBeEnabled();
  for (const width of [390, 800, 1365]) {
    await f.page.setViewportSize({ width, height: 900 });
    await expect(apply).toBeVisible();
    assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await apply.click();
  const applying = f.page.getByRole("button", { name: "Applying…", exact: true });
  await expect(applying).toBeDisabled();
  assert.deepEqual(await f.page.evaluate(() => window.conversationFixture.modelState()), {
    selected: "large", applied: "small", saving: true, selections: ["large"]
  });
  await f.notify("chat:1");
  await expect(applying).toBeDisabled();
  await expect(f.input).toHaveValue("Keep this independent draft.");
  await f.page.evaluate(() => window.conversationFixture.finishModelApply());
  await expect(applying).toHaveCount(0);
  assert.deepEqual(await f.page.evaluate(() => window.conversationFixture.modelState()), {
    selected: "large", applied: "large", saving: false, selections: ["large"]
  });
  await choose.click();
  await f.page.evaluate(() => window.conversationFixture.modelError("Reconnect the application catalogue."));
  await expect(f.page.getByText("Reconnect the application catalogue.", { exact: true })).toBeVisible();
  await f.page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(f.page.getByText("Reconnect the application catalogue.", { exact: true })).toHaveCount(0);
  await f.page.keyboard.press("Escape");
  await f.input.press("Enter");
  await expect(f.primary.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await choose.click();
  await expect(f.page.getByRole("button", { name: "Small model", exact: true })).toBeDisabled();
  await expect(f.page.getByText("AI choices are view-only while the assistant is working.", { exact: true })).toBeVisible();
  await f.command("deny", { denied: true });
  await f.notify("chat:1");
  await expect(f.primary.getByText("Access denied.", { exact: true })).toBeVisible();
  await expect(choose).toHaveCount(0);
  await expect(f.page.getByRole("button", { name: "Small model", exact: true })).toHaveCount(0);
  await f.command("deny", { denied: false });
  await f.notify("chat:1");
  await expect(choose).toBeVisible();
  await f.page.evaluate(() => window.conversationFixture.actor(""));
  await expect(choose).toHaveCount(0);
  assert.deepEqual((await f.page.evaluate(() => window.conversationFixture.modelState())).selections, ["large"]);
  assert.equal((await f.sent()).length, 1);
  assert.equal((await f.state()).requests.some(request => request.suffix && request.suffix !== "/messages"), false);
});

test("accepted draft clearing follows canonical receipts and nonqueued admission rejects overlap before dispatch", options, async t => {
  const f = await fixture(t, 390, { acceptedDraft: true });
  await f.command("steering", { id: "chat:1", enabled: true });
  await f.notify("chat:1");
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().snapshot.value.capabilities.steering)).toBe(true);
  await f.page.evaluate(() => window.conversationFixture.attachments(true));
  await f.primary.locator("input[type=file]").setInputFiles({ name: "accepted.txt", mimeType: "text/plain", buffer: Buffer.from("Keep until accepted") });
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.attachmentState().ready.length)).toBe(1);
  const [attachment] = (await f.page.evaluate(() => window.conversationFixture.attachmentState())).ready;
  await f.command("mode", { mode: "hold" });
  await f.input.fill("Keep this draft until accepted.");
  await f.input.press("Enter");
  await expect.poll(async () => (await f.state()).held).toBe(1);
  await expect(f.input).toHaveValue("Keep this draft until accepted.");
  await expect(f.input).toBeDisabled();
  await f.page.evaluate(() => { window.conversationFixture.retainVoice(); window.conversationFixture.mirror(true); });
  await expect(f.page.locator("[data-mirror]").getByRole("textbox", { name: "Message AI assistant" })).toHaveValue("Keep this draft until accepted.");
  assert.equal(await f.page.evaluate(() => window.conversationFixture.submit()), false);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.sendVoice("Do not overlap")), false);
  assert.equal((await f.sent()).length, 1);
  assert.equal((await f.page.evaluate(() => window.conversationFixture.dispatches())).length, 1);
  await f.command("accept", { holdResponse: true });
  await f.notify("chat:1");
  await expect(f.input).toBeEnabled();
  await expect(f.input).toHaveValue("");
  assert.equal((await f.state()).held, 1, "Canonical acceptance clears the draft before the original HTTP response");
  assert.deepEqual((await f.page.evaluate(() => window.conversationFixture.attachmentState())).acknowledged, [[attachment.attachmentId]]);
  await f.input.fill("New request while the assistant is working.");
  await f.command("release-response");
  await expect(f.input).toHaveValue("New request while the assistant is working.");
  await f.input.press("Enter");
  await expect.poll(async () => (await f.state()).held).toBe(1);
  assert.equal((await f.sent())[1].input.steer, true, "The host's existing working-state admission remains available");
  assert.equal(await f.page.evaluate(() => window.conversationFixture.sendVoice("No queued overlap while working")), false);
  assert.equal((await f.page.evaluate(() => window.conversationFixture.dispatches())).length, 2);
  await f.page.evaluate(() => { window.conversationFixture.current().draft.value = "Keep this newer draft."; });
  await f.command("accept");
  await expect(f.input).toBeEnabled();
  await expect(f.input).toHaveValue("Keep this newer draft.");
  assert.equal((await f.sent()).length, 2);
});

test("accepted draft retries use only the current authored entry and an older acceptance cannot clear its replacement", options, async t => {
  const f = await fixture(t, 1280, { acceptedDraft: true });
  await f.command("steering", { id: "chat:1", enabled: true });
  await f.notify("chat:1");
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().snapshot.value.capabilities.steering)).toBe(true);
  await f.page.evaluate(() => window.conversationFixture.data({ clientId: "typed", focus: { project: "first" } }));
  async function submit(message) {
    const count = (await f.sent()).length;
    await f.input.fill(message);
    await f.input.press("Enter");
    await expect.poll(async () => (await f.sent()).length).toBe(count + 1);
    await expect(f.input).toBeEnabled();
    return (await f.sent()).at(-1);
  }
  await f.command("mode", { mode: "rejected" });
  const first = await submit("Earlier failed request");
  await expect(f.input).toHaveValue("Earlier failed request");
  await f.page.evaluate(() => window.conversationFixture.changeFocus({ project: "second" }));
  const second = await submit("Current failed request");
  assert.notEqual(second.input.messageId, first.input.messageId);
  await f.page.evaluate(() => window.conversationFixture.changeFocus({ project: "changed-before-retry" }));
  await f.command("mode", { mode: "accepted" });
  const secondRetry = await submit("Current failed request");
  assert.deepEqual(secondRetry.input, second.input, "Ordinary Send reuses the authored ID and data after pre-admission failure");
  await expect(f.input).toHaveValue("");

  await f.command("mode", { mode: "rejected" });
  const replacement = await submit("Earlier failed request");
  assert.notEqual(replacement.input.messageId, first.input.messageId, "An old matching failure is not the current authored submission");
  await f.command("mode", { mode: "accepted" });
  await f.primary.getByRole("button", { name: "Retry", exact: true }).first().click();
  await expect.poll(async () => (await f.sent()).length).toBe(5);
  await expect(f.input).toBeEnabled();
  assert.deepEqual((await f.sent())[4].input, first.input);
  await expect(f.input, "Accepting the older identical text cannot clear the replacement draft").toHaveValue("Earlier failed request");
  await f.page.evaluate(() => window.conversationFixture.changeFocus({ project: "changed-again" }));
  const replacementRetry = await submit("Earlier failed request");
  assert.deepEqual(replacementRetry.input, replacement.input);
  await expect(f.input).toHaveValue("");
  assert.equal((await f.page.evaluate(() => window.conversationFixture.dispatches())).length, 6);
});

test("accepted draft identity survives voice retention and lost receipts without voice consuming the typed capture", options, async t => {
  const f = await fixture(t, 1280, { acceptedDraft: true });
  await f.command("steering", { id: "chat:1", enabled: true });
  await f.notify("chat:1");
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().snapshot.value.capabilities.steering)).toBe(true);
  const typedData = { clientId: "typed", focus: { project: "original" } };
  await f.page.evaluate(data => window.conversationFixture.data(data), typedData);
  await f.command("mode", { mode: "rejected" });
  await f.input.fill("Keep the typed capture.");
  await f.input.press("Enter");
  await expect.poll(async () => (await f.sent()).length).toBe(1);
  await expect(f.input).toBeEnabled();
  const [typed] = await f.sent();
  await f.page.evaluate(() => {
    window.conversationFixture.retainVoice();
    window.conversationFixture.show(false);
    window.conversationFixture.changeFocus({ project: "current" });
  });
  await expect(f.primary).toHaveCount(0);
  await f.command("mode", { mode: "hold" });
  const voiceData = { clientId: "voice", focus: { project: "utterance" } };
  await f.page.evaluate(data => { window.voiceSubmission = window.conversationFixture.sendVoice("Independent voice", data); }, voiceData);
  await expect.poll(async () => (await f.state()).held).toBe(1);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.sendVoice("No voice-only overlap")), false);
  assert.equal((await f.page.evaluate(() => window.conversationFixture.dispatches())).length, 2);
  await f.command("accept");
  assert.equal((await f.page.evaluate(() => window.voiceSubmission)).status, "accepted");
  assert.deepEqual((await f.sent())[1].input.data, voiceData);
  assert.equal((await f.page.evaluate(() => window.conversationFixture.voiceState())).draft, "Keep the typed capture.");
  await f.page.evaluate(() => window.conversationFixture.show(true));
  await expect(f.input).toBeEnabled();
  await expect(f.input).toHaveValue("Keep the typed capture.");
  await f.command("mode", { mode: "uncertain" });
  await f.input.press("Enter");
  const check = f.primary.getByRole("button", { name: "Check delivery", exact: true });
  await expect(check).toBeVisible();
  assert.deepEqual((await f.sent())[2].input, typed.input);
  await expect(f.input).toHaveValue("Keep the typed capture.");
  await f.page.evaluate(() => window.conversationFixture.socket.reconnect());
  await expect(check).toBeVisible();
  assert.equal(await f.page.evaluate(() => window.conversationFixture.submit()), false);
  await check.click();
  await expect(check).toBeEnabled();
  assert.equal((await f.sent()).length, 3);
  await f.command("confirm", { id: "chat:1" });
  await check.click();
  await expect(check).toHaveCount(0);
  await expect(f.input).toHaveValue("");
  assert.equal((await f.sent()).length, 3, "Inspection proves acceptance without recreating the typed request");
});

test("canonical presentation options preserve product labels and show a live voice preview without changing history", options, async t => {
  const f = await fixture(t, 390, { acceptedDraft: true });
  const display = { assistantLabel: "Ada", systemLabel: "Vibe64", variant: "task", visible: true,
    userMessageFormat: "plain", progressPreviewLimit: 0, ariaLabel: "Message Ada", submitAriaLabel: "Send to Ada",
    submitLabel: "Send to Ada", rows: 1, layout: "compact", placeholder: "Talk it through with Ada…",
    welcomeMessage: "Discuss an idea with Ada." };
  const present = value => f.page.evaluate(value => window.conversationFixture.presentation(value), value);
  await present(display);
  const input = f.primary.getByRole("textbox", { name: "Message Ada", exact: true });
  await expect(input).toHaveAttribute("rows", "1");
  await expect(input).toHaveAttribute("placeholder", "Talk it through with Ada…");
  await expect(f.primary.getByText("Discuss an idea with Ada.", { exact: true })).toBeVisible();
  await expect(f.primary.locator(".assistant-transcript--task")).toBeVisible();
  await input.fill("My independent typed draft");
  const send = f.primary.getByRole("button", { name: "Send to Ada", exact: true });
  await expect(send).toHaveText("Send to Ada");
  assert.deepEqual(await f.page.evaluate(() => {
    const { conversation, composer } = window.conversationFixture.adapter();
    return [conversation.assistantLabel, conversation.systemLabel, conversation.progressPreviewLimit, composer.rows];
  }), ["Ada", "Vibe64", 0, 1]);
  const previewMessage = { id: "live-voice", text: "I meant **tea**" };
  await present({ ...display, previewMessage });
  await expect(f.primary.locator(".assistant-transcript__plain-user")).toHaveText("I meant **tea**");
  await expect(f.primary.getByText("Pending", { exact: true })).toHaveCount(1);
  await expect(f.primary.getByText("Discuss an idea with Ada.", { exact: true })).toHaveCount(0);
  await present({ ...display, previewMessage: { ...previewMessage, text: "I meant **tea** with sugar" } });
  await expect(f.primary.locator(".assistant-transcript__plain-user")).toHaveText("I meant **tea** with sugar");
  assert.deepEqual(await f.page.evaluate(() => {
    const current = window.conversationFixture.current();
    return [current.turns.value, current.snapshot.value.conversationLog, current.delivery.state.messages];
  }), [[], [], []], "Live transcription is outside saved history and receipt state");
  await present({ ...display, visible: false, previewMessage });
  await expect(f.primary.getByRole("region", { name: "Conversation history" })).toHaveCount(0);
  await expect(input).toHaveValue("My independent typed draft");
  await present({ ...display, previewMessage });
  for (const width of [390, 800, 1365]) {
    await f.page.setViewportSize({ width, height: 900 });
    await expect(f.primary.getByText("I meant **tea**", { exact: true })).toBeVisible();
    await expect(send).toBeVisible();
    if (width === 390) { const box = await send.boundingBox(); assert.ok(box.width >= 48 && box.height >= 48); }
    assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await present({ ...display, previewMessage: null });
  await expect(f.primary.getByText("I meant **tea**", { exact: true })).toHaveCount(0);
  await expect(f.primary.getByText("Discuss an idea with Ada.", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("My independent typed draft");
  assert.equal((await f.sent()).length, 0);
});

test("a voice preview cannot acknowledge sending or uncertain delivery and deduplicates only against real receipts", options, async t => {
  const f = await fixture(t, 1280, { acceptedDraft: true });
  const preview = (messageId, text) => f.page.evaluate(value => window.conversationFixture.presentation({
    systemLabel: "Vibe64", previewMessage: value
  }), { messageId, text });
  const delivery = () => f.page.evaluate(() => {
    const current = window.conversationFixture.current();
    return { sending: current.delivery.state.sending, messages: current.delivery.state.messages.map(({ id, status }) => ({ id, status })),
      turns: current.turns.value, history: current.snapshot.value.conversationLog };
  });
  await f.command("mode", { mode: "hold" });
  await f.input.fill("Wait for a real receipt.");
  await f.input.press("Enter");
  await expect.poll(async () => (await f.state()).held).toBe(1);
  const first = (await f.sent())[0].input.messageId;
  await preview(first, "The unsent preview must not replace pending input.");
  await expect(f.primary.getByText("Wait for a real receipt.", { exact: true })).toHaveCount(1);
  await expect(f.primary.getByText("The unsent preview must not replace pending input.", { exact: true })).toHaveCount(0);
  assert.deepEqual(await delivery(), { sending: true, messages: [{ id: first, status: "pending" }], turns: [], history: [] });
  await preview("another-live-utterance", "Still speaking before admission");
  await expect(f.primary.getByText("Still speaking before admission", { exact: true })).toHaveCount(1);
  assert.equal((await delivery()).sending, true);
  assert.equal((await delivery()).messages.length, 1);
  assert.deepEqual((await delivery()).turns, []);
  await f.command("accept");
  await expect(f.input).toBeEnabled();
  await preview(first, "Wait for a real receipt.");
  await expect.poll(async () => (await delivery()).history.length).toBe(1);
  await expect(f.primary.getByText("Wait for a real receipt.", { exact: true })).toHaveCount(1);
  await expect(f.primary.getByText("Pending", { exact: true })).toHaveCount(0);
  await f.command("finish", { id: "chat:1" });
  await f.notify("chat:1");
  await expect(f.primary.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await f.command("mode", { mode: "uncertain" });
  await f.input.fill("Keep this uncertain request.");
  await f.input.press("Enter");
  const check = f.primary.getByRole("button", { name: "Check delivery", exact: true });
  await expect(check).toBeVisible();
  const second = (await f.sent())[1].input.messageId;
  await preview(second, "An uncertain preview is not an acknowledgement.");
  await expect(f.primary.getByText("An uncertain preview is not an acknowledgement.", { exact: true })).toHaveCount(0);
  await expect(f.primary.getByText("Vibe64", { exact: true })).toBeVisible();
  assert.deepEqual((await delivery()).messages, [{ id: second, status: "uncertain" }]);
  assert.equal((await delivery()).history.length, 1);
  await check.click();
  await expect(check).toBeEnabled();
  assert.deepEqual((await delivery()).messages, [{ id: second, status: "uncertain" }]);
  await expect(f.input).toHaveValue("Keep this uncertain request.");
  await f.command("confirm", { id: "chat:1" });
  await check.click();
  await expect(check).toHaveCount(0);
  await expect(f.input).toHaveValue("");
  await expect(f.primary.getByText("Keep this uncertain request.", { exact: true })).toHaveCount(1);
  await expect(f.primary.getByText("An uncertain preview is not an acknowledgement.", { exact: true })).toHaveCount(0);
  assert.equal((await f.sent()).length, 2);
});


test("an interim reply stays on its exact turn without acknowledging delivery and restores from the canonical read", options, async t => {
  const f = await fixture(t, 390, { acceptedDraft: true });
  const view = () => f.page.evaluate(() => {
    const current = window.conversationFixture.current();
    return { messages: current.delivery.state.messages.map(({ id, status }) => ({ id, status })),
      turns: current.turns.value, history: current.snapshot.value.conversationLog,
      interimReply: current.snapshot.value.interimReply };
  });
  const present = reply => f.page.evaluate(interimReply => window.conversationFixture.socket.notify("chat:1", {
    type: "presentation", interimReply
  }), reply);
  await f.command("mode", { mode: "uncertain" });
  await f.input.fill("Check the project before answering.");
  await f.input.press("Enter");
  const check = f.primary.getByRole("button", { name: "Check delivery", exact: true });
  await expect(check).toBeVisible();
  const [{ input: { messageId } }] = await f.sent();
  const reply = { id: "native-ack", outputId: "native-ack-output", turnId: messageId,
    role: "assistant", text: "Let me check the project.", status: "completed", autonomous: false };
  const acknowledgement = f.primary.getByText(reply.text, { exact: true });
  await present({ ...reply, turnId: "another-turn" });
  await expect.poll(async () => (await view()).interimReply?.turnId).toBe("another-turn");
  await expect(acknowledgement).toHaveCount(0);
  await present(reply);
  await present(reply);
  await expect(acknowledgement).toHaveCount(1);
  await expect(f.primary.locator('[data-message-role="assistant"]').getByText(reply.text, { exact: true })).toHaveCount(1);
  const uncertain = { messages: [{ id: messageId, status: "uncertain" }], turns: [], history: [], interimReply: reply };
  assert.deepEqual(await view(), uncertain, "An interim display cannot create an authored receipt or canonical turn");
  await expect(check).toBeVisible();
  await expect(f.input).toHaveValue("Check the project before answering.");

  await f.command("interim-reply", { id: "chat:1", reply });
  const readsBeforeReconnect = (await f.state()).requests.filter(request => request.method === "GET").length;
  await f.page.evaluate(() => window.conversationFixture.socket.reconnect());
  await expect.poll(async () => (await f.state()).requests.filter(request => request.method === "GET").length)
    .toBeGreaterThan(readsBeforeReconnect);
  await expect(acknowledgement).toHaveCount(1);
  assert.deepEqual(await view(), uncertain);
  await f.page.evaluate(() => window.conversationFixture.show(false));
  await expect(f.primary).toHaveCount(0);
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.socket.inspect().active)).toBe(0);
  await f.page.evaluate(() => window.conversationFixture.show(true));
  await expect(check).toBeVisible();
  await expect(acknowledgement).toHaveCount(1);
  assert.deepEqual(await view(), uncertain, "A reopened reader restores the scalar and pending receipt independently");
  assert.equal((await f.sent()).length, 1, "Reconnect and remount do not redispatch uncertain input");

  await f.command("confirm", { id: "chat:1" });
  await f.notify("chat:1");
  await expect(check).toHaveCount(0);
  const saved = (await view()).history;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].user.messageId, messageId);
  assert.equal(saved[0].assistant, null);
  assert.deepEqual((await view()).messages, [], "Only the real canonical authored turn acknowledges delivery");
  await f.page.evaluate(reply => window.conversationFixture.socket.notify("chat:1", {
    type: "message", messageId: "native-ack-commentary", outputId: reply.outputId,
    turnId: reply.turnId, origin: "user", role: "commentary", status: "complete", text: reply.text,
    streaming: { revision: 1, messages: [] }, interimReply: reply
  }), reply);
  await expect(f.primary.locator('[data-message-role="assistant"]').getByText(reply.text, { exact: true })).toHaveCount(1);
  await expect(f.primary.locator('[data-message-role="commentary"]').getByText(reply.text, { exact: true })).toHaveCount(0);
  for (const width of [390, 800, 1365]) {
    await f.page.setViewportSize({ width, height: 900 });
    await expect(acknowledgement).toHaveCount(1);
    await expect(acknowledgement).toBeVisible();
    assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.deepEqual((await view()).history, saved, "Selecting completed commentary for display does not rewrite saved history");
  assert.deepEqual((await f.state()).states["chat:1"].conversationLog, saved);

  await f.command("finish", { id: "chat:1", text: "The project is ready." });
  await f.command("interim-reply", { id: "chat:1", reply: null });
  await f.page.evaluate(turnId => window.conversationFixture.socket.notify("chat:1", {
    type: "settled", turnId, interimReply: null
  }), messageId);
  await expect(f.primary.getByText("The project is ready.", { exact: true })).toHaveCount(1);
  await expect(acknowledgement).toHaveCount(0);
  assert.equal((await view()).history[0].assistant.text, "The project is ready.");
  assert.equal((await view()).interimReply, null);
  assert.deepEqual((await view()).messages, []);
  assert.equal((await f.sent()).length, 1);
});

test("draft while loading keeps pre-ID input through an unavailable first read without admitting a message", options, async t => {
  const f = await fixture(t, 390, { acceptedDraft: true, draftWhileLoading: true, unresolved: true });
  const send = f.primary.getByRole("button", { name: "Send message", exact: true });
  await f.input.fill("Keep my first offline draft.");
  await expect(send).toBeDisabled();
  assert.equal(await f.page.evaluate(() => window.conversationFixture.submit()), false);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current() === null), true);
  assert.equal((await f.page.evaluate(() => window.conversationFixture.socket.inspect())).calls.length, 0);
  assert.deepEqual((await f.state()).requests, []);
  assert.deepEqual(await f.page.evaluate(() => window.conversationFixture.dispatches()), []);
  await expect(f.input).toHaveValue("Keep my first offline draft.");

  const reads = "**/api/assistant/home/conversations/*";
  await f.page.route(reads, route => route.fulfill({ status: 503,
    json: { error: "Conversation storage is temporarily unavailable." } }));
  await f.page.evaluate(() => window.conversationFixture.target("chat:1"));
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current()?.error.value))
    .toBe("Conversation storage is temporarily unavailable.");
  await expect(f.input).toBeEnabled();
  await expect(f.input).toHaveValue("Keep my first offline draft.");
  await f.input.fill("Keep my first offline draft and its later edits.");
  await expect(send).toBeDisabled();
  assert.equal(await f.page.evaluate(() => window.conversationFixture.submit()), false);
  assert.deepEqual(await f.page.evaluate(() => window.conversationFixture.current().delivery.state.messages), []);
  assert.deepEqual(await f.page.evaluate(() => window.conversationFixture.dispatches()), []);

  await f.page.unroute(reads);
  await f.page.evaluate(() => window.conversationFixture.socket.reconnect());
  await expect(send).toBeEnabled();
  await expect(f.input).toHaveValue("Keep my first offline draft and its later edits.");
  await send.click();
  await expect(f.input).toHaveValue("");
  const requests = await f.sent();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].id, "chat:1");
  assert.equal(requests[0].input.text, "Keep my first offline draft and its later edits.");
  assert.ok(requests[0].input.messageId);
  assert.deepEqual(await f.page.evaluate(() => window.conversationFixture.dispatches()), [requests[0].input.messageId]);
});

test("draft while loading resets unresolved and retained input with the real actor and keeps denial closed", options, async t => {
  const f = await fixture(t, 1280, { acceptedDraft: true, draftWhileLoading: true, unresolved: true });
  await f.input.fill("Private input for the first actor.");
  await f.page.evaluate(() => window.conversationFixture.actor("43"));
  await expect(f.input).toHaveValue("");
  await f.input.fill("Private input before sign out.");
  await f.page.evaluate(() => window.conversationFixture.actor(""));
  await expect(f.input).toHaveValue("");
  await expect(f.input).toBeDisabled();
  assert.equal(await f.page.evaluate(() => window.conversationFixture.submit()), false);
  await f.page.evaluate(() => window.conversationFixture.actor("44"));
  await expect(f.input).toBeEnabled();
  await expect(f.input).toHaveValue("");
  await f.input.fill("Private input for the resolved target.");
  await f.page.evaluate(() => window.conversationFixture.target("chat:2"));
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current()?.available.value)).toBe(true);
  await expect(f.input).toHaveValue("Private input for the resolved target.");
  await f.page.evaluate(() => { window.conversationFixture.retainVoice(); window.conversationFixture.actor("45"); });
  await expect(f.input).toHaveValue("");
  assert.equal((await f.page.evaluate(() => window.conversationFixture.voiceState())).current, false);
  assert.equal((await f.page.evaluate(() => window.conversationFixture.voiceState())).draft, "");
  await f.input.fill("Access-controlled input.");
  await f.command("deny", { denied: true });
  await f.notify("chat:2");
  await expect(f.input).toBeDisabled();
  await expect(f.input).toHaveValue("");
  assert.equal(await f.page.evaluate(() => window.conversationFixture.submit()), false);
  assert.equal((await f.sent()).length, 0);
  assert.deepEqual(await f.page.evaluate(() => window.conversationFixture.dispatches()), []);
});

test("draft while loading promotes into an existing retained target without duplicate text or implicit send", options, async t => {
  const f = await fixture(t, 1280, { acceptedDraft: true, draftWhileLoading: true });
  await f.input.fill("Already in this target.");
  await f.page.evaluate(() => { window.conversationFixture.retainVoice(); window.conversationFixture.target(""); });
  await expect(f.input).toHaveValue("");
  await f.input.fill("Typed before identity recovered.");
  assert.equal(await f.page.evaluate(() => window.conversationFixture.submit()), false);
  await f.page.evaluate(() => window.conversationFixture.target("chat:1"));
  const combined = "Already in this target.\nTyped before identity recovered.";
  await expect(f.input).toHaveValue(combined);
  assert.equal((await f.page.evaluate(() => window.conversationFixture.voiceState())).draft, combined);
  assert.equal((await f.page.evaluate(() => window.conversationFixture.socket.inspect())).active, 1);

  await f.page.evaluate(() => window.conversationFixture.target(""));
  await f.input.fill(combined);
  await f.page.evaluate(() => window.conversationFixture.target("chat:1"));
  await expect(f.input).toHaveValue(combined);
  await f.page.evaluate(() => window.conversationFixture.target("chat:2"));
  await expect(f.input).toHaveValue("");
  await f.input.fill("This belongs only to the second target.");
  await f.page.evaluate(() => window.conversationFixture.target("chat:1"));
  await expect(f.input).toHaveValue(combined);
  assert.equal((await f.sent()).length, 0);
  assert.deepEqual(await f.page.evaluate(() => window.conversationFixture.dispatches()), []);
});


test("paged history uses the original page reader and keeps older messages through live updates", options, async t => {
  const f = await fixture(t);
  const turns = Array.from({ length: 5 }, (_, index) => ({
    turnId: String(index + 1).padStart(6, "0"),
    user: { role: "user", messageId: `history-${index + 1}`, text: `Saved question ${index + 1}` },
    ...(index < 4 ? { assistant: { role: "assistant", messageId: `answer-${index + 1}`, text: `Saved answer ${index + 1}` } } : {})
  }));
  await f.command("history", { id: "chat:1", turns, limit: 2 });
  await f.notify("chat:1");
  await expect(f.primary.getByText("Saved question 5", { exact: true })).toHaveCount(1);
  await expect(f.primary.getByText("Saved question 1", { exact: true })).toHaveCount(0);
  await expect(f.primary.getByRole("button", { name: "Load older messages", exact: true })).toBeVisible();
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().loadMore({
    complete: result => { window.historyCompletion = result; }
  })), true);
  assert.deepEqual(await f.page.evaluate(() => window.historyCompletion), { changed: true, loaded: true });
  await expect(f.primary.getByText("Saved question 2", { exact: true })).toHaveCount(1);
  const paged = (await f.state()).requests.filter(request => request.query.beforeTurnId);
  assert.deepEqual(paged.map(request => request.query), [{ beforeTurnId: "000004", limit: "2" }]);
  await f.page.evaluate(() => window.conversationFixture.socket.notify("chat:1", {
    type: "message", turnId: "000005", messageId: "live-answer", role: "assistant", status: "inProgress", text: "Live answer",
    streaming: { revision: 1, messages: [{ turnId: "000005", messageId: "live-answer", role: "assistant", status: "inProgress", text: "Live answer" }] }
  }));
  await expect(f.primary.getByText("Live answer", { exact: true })).toHaveCount(1);
  await expect(f.primary.getByText("Saved question 2", { exact: true })).toHaveCount(1);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().loadMore()), true);
  await expect(f.primary.getByText("Saved question 1", { exact: true })).toHaveCount(1);
  await expect(f.primary.getByRole("button", { name: "Load older messages", exact: true })).toHaveCount(0);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().loadMore()), false);
  await f.page.evaluate(() => window.conversationFixture.socket.reconnect());
  await expect(f.primary.getByText("Saved question 1", { exact: true })).toHaveCount(0);
  await expect(f.primary.getByRole("button", { name: "Load older messages", exact: true })).toBeVisible();
  assert.deepEqual(await f.sent(), []);
});


test("original product delivery envelopes retain exact admission and retry without manufactured receipts", options, async t => {
  const f = await fixture(t);
  const target = async id => {
    await f.page.evaluate(id => window.conversationFixture.target(id), id);
    await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current()?.snapshot.value?.id)).toBe(id);
    await expect(f.input).toBeEnabled();
  };
  const send = (messageId, message, data) => f.page.evaluate(({ messageId, message, data }) =>
    window.conversationFixture.current().send({ message, data }, { messageId }), { messageId, message, data });
  const message = messageId => f.page.evaluate(messageId => {
    const value = window.conversationFixture.current().delivery.find(messageId);
    return value ? { id: value.id, status: value.status, error: value.error } : null;
  }, messageId);

  await f.command("mode", { mode: "product-accepted" });
  assert.deepEqual(await send("product-admitted", "A product result is sufficient"), {
    ok: true, delivered: true, messageId: "product-admitted"
  });
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().turns.value
    .filter(turn => turn.user?.messageId === "product-admitted").length)).toBe(1);
  assert.equal(await message("product-admitted"), null, "Only the actual authored row reconciles the optimistic entry");

  await target("chat:2");
  await f.command("mode", { mode: "product-rejected" });
  const captured = { originId: "original-tab", agentSettings: { model: "original-choice" } };
  assert.deepEqual(await send("product-rejected", "Retry this captured request", captured), {
    ok: false, delivered: false, messageId: "product-rejected", code: "product_owner_conflict",
    error: "This turn belongs to another user.", operationOutcome: "active_turn_owned_by_another_user",
    retryable: true, refreshRecommended: true
  });
  assert.equal((await message("product-rejected")).status, "failed");
  await f.input.fill("Do not clear my newer draft");
  await f.command("mode", { mode: "product-accepted" });
  await send("product-rejected", "A later caller must not replace the retry", { originId: "later-tab" });
  const retries = (await f.sent()).filter(request => request.id === "chat:2");
  assert.equal(retries.length, 2);
  assert.deepEqual(retries[1].input, retries[0].input);
  assert.deepEqual(retries[1].input.data, captured);
  await expect(f.input).toHaveValue("Do not clear my newer draft");

  await target("chat:3");
  await f.command("mode", { mode: "product-native-duplicate" });
  assert.deepEqual(await send("native-history-only", "Already accepted by the original native owner"), {
    ok: true, delivered: true, messageId: "native-history-only"
  });
  assert.equal((await message("native-history-only")).status, "accepted");
  assert.deepEqual((await f.state()).states["chat:3"].conversationLog, []);
  const duplicateReads = (await f.state()).requests.filter(request => request.id === "chat:3" && request.method === "GET").length;
  await f.page.evaluate(() => window.conversationFixture.socket.reconnect());
  await expect.poll(async () => (await f.state()).requests.filter(request => request.id === "chat:3" && request.method === "GET").length).toBeGreaterThan(duplicateReads);
  assert.equal((await message("native-history-only")).status, "accepted");
  assert.deepEqual((await f.state()).states["chat:3"].conversationLog, []);
  assert.equal((await f.sent()).filter(request => request.id === "chat:3").length, 1);
  assert.equal((await f.state()).requests.filter(request => request.suffix.startsWith("/deliveries/")).length, 0,
    "A successful product envelope needs no inspect-after-send request");

  await target("chat:4");
  await f.command("mode", { mode: "uncertain" });
  assert.equal(await send("lost-product-response", "Keep the exact lost request"), false);
  assert.equal((await message("lost-product-response")).status, "uncertain");
  const uncertainReads = (await f.state()).requests.filter(request => request.id === "chat:4" && request.method === "GET").length;
  await f.page.evaluate(() => window.conversationFixture.socket.reconnect());
  await expect.poll(async () => (await f.state()).requests.filter(request => request.id === "chat:4" && request.method === "GET").length).toBeGreaterThan(uncertainReads);
  assert.deepEqual(await f.page.evaluate(() => window.conversationFixture.current().inspectDelivery("lost-product-response")), {
    status: "unknown", messageId: "lost-product-response"
  });
  assert.equal((await message("lost-product-response")).status, "uncertain");
  assert.equal((await f.sent()).filter(request => request.id === "chat:4").length, 1);
  assert.deepEqual((await f.state()).states["chat:4"].conversationLog, []);

  await target("chat:5");
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().send({
    message: "Captured steering", request: { text: "Captured steering", steer: true }
  }, { messageId: "unsupported-steer" })), false);
  assert.equal((await f.sent()).filter(request => request.id === "chat:5").length, 0,
    "An explicit captured request cannot invent steering capability");
});

test("dynamic acquisition keeps the original shared readers and releases only its setup-owned scopes", options, async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => {
    const acquire = window.conversationFixture.acquireConversation;
    window.dynamicFirst = acquire({ conversationId: "chat:2" });
    window.dynamicMirror = acquire({ conversationId: "chat:2" });
    window.dynamicOther = acquire({ conversationId: "chat:3" });
    window.dynamicFirst.runtime.value.draft.value = "One retained task draft.";
  });
  await expect.poll(() => f.page.evaluate(() => window.dynamicFirst.runtime.value.available.value &&
    window.dynamicOther.runtime.value.available.value)).toBe(true);
  assert.equal(await f.page.evaluate(() => window.dynamicFirst.runtime.value === window.dynamicMirror.runtime.value), true);
  assert.equal(await f.page.evaluate(() => window.dynamicMirror.runtime.value.draft.value), "One retained task draft.");
  assert.equal((await f.page.evaluate(() => window.conversationFixture.socket.inspect())).active, 3);
  await f.page.evaluate(() => window.conversationFixture.socket.notify("chat:2", {
    type: "message", messageId: "dynamic-answer", role: "assistant", status: "inProgress", text: "Same stream.",
    streaming: { revision: 1, messages: [{ messageId: "dynamic-answer", role: "assistant", status: "inProgress", text: "Same stream." }] }
  }));
  assert.equal(await f.page.evaluate(() => window.dynamicMirror.runtime.value.turns.value[0].assistant.text), "Same stream.");
  await f.page.evaluate(() => { window.dynamicFirst.release(); window.dynamicFirst.release(); });
  assert.equal((await f.page.evaluate(() => window.conversationFixture.socket.inspect())).active, 3);
  assert.equal(await f.page.evaluate(() => window.dynamicMirror.runtime.value.draft.value), "One retained task draft.");
  await f.page.evaluate(() => window.dynamicOther.release());
  assert.equal((await f.page.evaluate(() => window.conversationFixture.socket.inspect())).active, 2);
  await f.page.evaluate(() => window.conversationFixture.releaseFactory());
  assert.equal((await f.page.evaluate(() => window.conversationFixture.socket.inspect())).active, 1);
  assert.equal(await f.page.evaluate(() => {
    try { window.conversationFixture.acquireConversation({ conversationId: "chat:4" }); return false; }
    catch (failure) { return /scope has ended/.test(failure.message); }
  }), true);
  assert.equal((await f.state()).requests.filter(request => request.suffix === "/cancel").length, 0);
  assert.equal((await f.sent()).length, 0);
});

test("prepared submission keeps optimism before application creation and uses the same captured receipt owner", options, async t => {
  const f = await fixture(t);
  await f.command("mode", { mode: "hold" });
  await f.page.evaluate(() => {
    window.preparedBinding = window.conversationFixture.acquireConversation({ conversationId: "chat:2", active: false });
    window.prepareSave = Promise.withResolvers();
    window.prepareCreate = Promise.withResolvers();
    window.prepareOrder = [];
    window.preparedAcceptance = 0;
    const payload = { message: "Original native prompt.", displayMessage: "Original displayed prompt.",
      displayAttachments: [{ attachmentId: "original-file" }], request: {
        text: "Original native prompt.", attachmentIds: ["original-file"],
        data: { agentSettings: { model: "original-model" }, presentation: { draft: "" } }
      } };
    window.preparedBinding.runtime.value.draft.value = "Newer composer draft.";
    window.preparedResult = window.preparedBinding.runtime.value.submitPrepared(payload, {
      messageId: "prepared-message", onAccepted() { window.preparedAcceptance += 1; },
      async prepare(captured, { signal }) {
        window.preparedSignal = signal;
        window.prepareOrder.push("save");
        await window.prepareSave.promise;
        window.prepareOrder.push("create");
        await window.prepareCreate.promise;
        window.prepareOrder.push("dispatch");
        return { ...captured.request, data: { ...captured.request.data,
          presentation: { ...captured.request.data.presentation, draft: window.preparedBinding.runtime.value.draft.value } } };
      }
    });
    payload.message = "Changed after Send.";
    payload.request.text = "Changed after Send.";
    payload.request.attachmentIds.push("later-file");
    payload.request.data.agentSettings.model = "later-model";
  });
  const pending = await f.page.evaluate(() => window.preparedBinding.runtime.value.delivery.state.messages);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, "prepared-message");
  assert.equal(pending[0].status, "pending");
  assert.equal(pending[0].text, "Original displayed prompt.");
  assert.deepEqual(await f.page.evaluate(() => window.prepareOrder), ["save"]);
  assert.equal(await f.page.evaluate(() => window.preparedBinding.runtime.value.snapshot.value), null);
  assert.equal(await f.page.evaluate(() => window.preparedBinding.runtime.value.send({ message: "Ordinary Send still waits." })), false);
  assert.equal((await f.state()).requests.filter(request => request.id === "chat:2").length, 0);
  await f.page.evaluate(() => window.prepareSave.resolve());
  await expect.poll(() => f.page.evaluate(() => window.prepareOrder)).toEqual(["save", "create"]);
  assert.equal((await f.sent()).length, 0);
  await f.page.evaluate(() => window.prepareCreate.resolve());
  await expect.poll(async () => (await f.state()).held).toBe(1);
  const [request] = await f.sent();
  assert.equal(request.id, "chat:2");
  assert.deepEqual(request.input, { messageId: "prepared-message", text: "Original native prompt.",
    attachmentIds: ["original-file"], data: { agentSettings: { model: "original-model" },
      presentation: { draft: "Newer composer draft." } } });
  await f.page.evaluate(() => {
    window.preparedReader = window.conversationFixture.acquireConversation({ conversationId: "chat:2" });
  });
  await expect.poll(() => f.page.evaluate(() => window.preparedReader.runtime.value.available.value)).toBe(true);
  assert.equal(await f.page.evaluate(() => window.preparedBinding.runtime.value === window.preparedReader.runtime.value), true);
  await f.command("accept", { holdResponse: true });
  await f.notify("chat:2");
  const result = await f.page.evaluate(() => window.preparedResult);
  assert.equal(result.ok, true, "The exact authored row settles before the held HTTP response");
  assert.equal(await f.page.evaluate(() => window.preparedAcceptance), 1);
  assert.equal(await f.page.evaluate(() => window.preparedBinding.runtime.value.delivery.state.messages.length), 0);
  assert.equal(await f.page.evaluate(() => window.preparedBinding.runtime.value.turns.value.length), 1);
  assert.equal(await f.page.evaluate(() => window.preparedBinding.runtime.value.draft.value), "Newer composer draft.");
  assert.equal((await f.state()).held, 1);
  await f.command("release-response");
  assert.equal((await f.sent()).length, 1);
});

test("prepared failure is retryable before dispatch and remains inspection-only after an unknown receipt", options, async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => {
    window.failedBinding = window.conversationFixture.acquireConversation({ conversationId: "chat:3", active: false });
  });
  assert.equal(await f.page.evaluate(() => {
    try { window.failedBinding.runtime.value.submitPrepared({ message: "Invalid preparation.", request: { text: "Invalid preparation." } }); return false; }
    catch (failure) { return /requires application preparation/.test(failure.message); }
  }), true);
  assert.deepEqual(await f.page.evaluate(() => window.failedBinding.runtime.value.delivery.state.messages), []);
  const rejected = await f.page.evaluate(() => window.failedBinding.runtime.value.submitPrepared({
    message: "Captured task.", request: { text: "Captured task.", data: { selection: "original" } }
  }, { messageId: "prepared-retry", prepare() { throw Object.assign(new Error("Create was rejected."), { code: "application_create_rejected" }); } }));
  assert.deepEqual(rejected, { ok: false, error: "Create was rejected.", code: "application_create_rejected" });
  assert.equal(await f.page.evaluate(() => window.failedBinding.runtime.value.delivery.find("prepared-retry").status), "failed");
  assert.equal((await f.sent()).length, 0);
  await f.command("mode", { mode: "uncertain" });
  await f.page.route("**/conversations/*/messages", async route => {
    const response = await route.fetch();
    return route.fulfill({ response, status: 404, json: { ...await response.json(), code: "application_record_closed" } });
  }, { times: 1 });
  assert.deepEqual(await f.page.evaluate(() => window.failedBinding.runtime.value.submitPrepared({
    message: "Do not recapture.", request: { text: "Do not recapture.", data: { selection: "changed" } }
  }, { messageId: "prepared-retry", prepare: captured => captured.request })), {
    ok: false, status: "uncertain", error: "Connection closed before the receipt arrived.", code: "application_record_closed"
  });
  const [request] = await f.sent();
  assert.deepEqual(request.input, { messageId: "prepared-retry", text: "Captured task.", data: { selection: "original" } });
  assert.equal(await f.page.evaluate(() => window.failedBinding.runtime.value.delivery.find("prepared-retry").status), "uncertain");
  assert.equal(await f.page.evaluate(() => window.failedBinding.runtime.value.submitPrepared({
    message: "No implicit retry.", request: { text: "No implicit retry." }
  }, { messageId: "prepared-retry", prepare() { throw new Error("An uncertain request must not prepare again."); } })), false);
  await f.page.evaluate(() => { window.failedReader = window.conversationFixture.acquireConversation({ conversationId: "chat:3" }); });
  await expect.poll(() => f.page.evaluate(() => window.failedReader.runtime.value.available.value)).toBe(true);
  assert.deepEqual(await f.page.evaluate(() => window.failedReader.runtime.value.inspectDelivery("prepared-retry")), { status: "unknown", messageId: "prepared-retry" });
  assert.equal((await f.sent()).length, 1);
  await f.command("confirm", { id: "chat:3" });
  const receipt = await f.page.evaluate(() => window.failedReader.runtime.value.inspectDelivery("prepared-retry"));
  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.messageId, "prepared-retry");
  assert.equal((await f.sent()).length, 1);

  await f.command("deny", { denied: true });
  await f.page.evaluate(() => {
    window.deniedPreparation = Promise.withResolvers();
    window.deniedBinding = window.conversationFixture.acquireConversation({ conversationId: "chat:4" });
    window.deniedSend = window.deniedBinding.runtime.value.submitPrepared({ message: "Access changed.", request: { text: "Access changed." } }, {
      messageId: "denied-preparation", async prepare(captured) { await window.deniedPreparation.promise; return captured.request; }
    });
  });
  await expect.poll(() => f.page.evaluate(() => window.deniedBinding.error.value)).toBe("Access denied.");
  await f.page.evaluate(() => window.deniedPreparation.resolve());
  assert.equal(await f.page.evaluate(() => window.deniedSend), false);
  assert.equal((await f.sent()).length, 1, "Known access denial during preparation prevents canonical dispatch");
  await f.page.evaluate(() => window.deniedBinding.release());
  await f.command("deny", { denied: false });
  await f.page.evaluate(() => {
    window.retiredPreparation = Promise.withResolvers();
    window.releasedPreparation = Promise.withResolvers();
    window.retiredBinding = window.conversationFixture.acquireConversation({ conversationId: "chat:4", active: false });
    window.releasedBinding = window.conversationFixture.acquireConversation({ conversationId: "chat:5", active: false });
    window.retiredSend = window.retiredBinding.runtime.value.submitPrepared({ message: "Retired actor.", request: { text: "Retired actor." } }, {
      messageId: "retired-preparation", async prepare(captured, { signal }) { window.retiredSignal = signal; await window.retiredPreparation.promise; return captured.request; }
    });
    window.releasedSend = window.releasedBinding.runtime.value.submitPrepared({ message: "Closed task.", request: { text: "Closed task." } }, {
      messageId: "released-preparation", async prepare(captured, { signal }) { window.releasedSignal = signal; await window.releasedPreparation.promise; return captured.request; }
    });
    window.releasedBinding.release();
    window.conversationFixture.actor("43");
    window.retiredPreparation.resolve();
    window.releasedPreparation.resolve();
  });
  assert.deepEqual(await f.page.evaluate(() => Promise.all([window.retiredSend, window.releasedSend])), [false, false]);
  assert.deepEqual(await f.page.evaluate(() => [window.retiredSignal.aborted, window.releasedSignal.aborted]), [true, true]);
  assert.equal((await f.sent()).length, 1, "Neither a retired actor nor a released task dispatches after preparation");
});

test("saved prepared conversations can Stop before the first read while inactive and denied targets stay closed", options, async t => {
  const f = await fixture(t);
  const readsReleased = Promise.withResolvers();
  const heldReads = new Set();
  await f.page.route(/\/api\/assistant\/home\/conversations\/chat%3A[23](?:\?.*)?$/u, async route => {
    heldReads.add(decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1)));
    await readsReleased.promise;
    await route.continue();
  });
  try {
    await f.page.evaluate(() => {
      window.unsavedTask = window.conversationFixture.acquireConversation({ conversationId: "chat:2", active: false });
      window.unidentifiedTask = window.conversationFixture.acquireConversation({ conversationId: "" });
    });
    assert.equal(await f.page.evaluate(() => window.unsavedTask.runtime.value.cancel()), false);
    assert.equal(await f.page.evaluate(() => window.unidentifiedTask.runtime.value), null);
    assert.equal((await f.state()).requests.filter(request => request.suffix === "/cancel").length, 0);
    const accepted = await f.page.evaluate(() => window.unsavedTask.runtime.value.submitPrepared({
      message: "Accepted before the first read.", request: { text: "Accepted before the first read." }
    }, { messageId: "accepted-before-read", prepare(captured) {
      window.savedTask = window.conversationFixture.acquireConversation({ conversationId: "chat:2" });
      return captured.request;
    } }));
    assert.equal(accepted.status, "accepted");
    await expect.poll(() => heldReads.has("chat:2")).toBe(true);
    assert.deepEqual(await f.page.evaluate(() => ({
      snapshot: window.savedTask.runtime.value.snapshot.value,
      available: window.savedTask.runtime.value.available.value,
      editable: window.savedTask.runtime.value.editable.value,
      sending: window.savedTask.runtime.value.delivery.state.sending
    })), { snapshot: null, available: false, editable: true, sending: false });
    assert.deepEqual(await f.page.evaluate(() => window.savedTask.runtime.value.cancel()), { stopped: true });

    await f.command("mode", { mode: "hold" });
    await f.page.evaluate(() => {
      window.pendingTask = window.conversationFixture.acquireConversation({ conversationId: "chat:3", active: false });
      window.pendingStart = window.pendingTask.runtime.value.submitPrepared({
        message: "Keep Stop independent of the Start response.", request: { text: "Keep Stop independent of the Start response." }
      }, { messageId: "held-start-before-read", prepare(captured) {
        window.pendingReader = window.conversationFixture.acquireConversation({ conversationId: "chat:3" });
        return captured.request;
      } });
    });
    await expect.poll(async () => (await f.state()).held).toBe(1);
    await expect.poll(() => heldReads.has("chat:3")).toBe(true);
    await f.command("accept", { holdResponse: true });
    assert.equal(await f.page.evaluate(() => window.pendingTask.runtime.value.snapshot.value), null);
    assert.equal(await f.page.evaluate(() => window.pendingTask.runtime.value.delivery.state.sending), true);
    assert.deepEqual(await f.page.evaluate(() => window.pendingTask.runtime.value.cancel()), { stopped: true });
    assert.equal((await f.state()).held, 1, "Stop does not await or replay the pending Start response");
    await f.command("release-response");
    assert.equal((await f.page.evaluate(() => window.pendingStart)).status, "accepted");

    await f.command("deny", { denied: true });
    await f.page.evaluate(() => {
      window.deniedStop = window.conversationFixture.acquireConversation({ conversationId: "chat:4" });
    });
    await expect.poll(() => f.page.evaluate(() => window.deniedStop.error.value)).toBe("Access denied.");
    assert.equal(await f.page.evaluate(() => window.deniedStop.runtime.value.cancel()), false);
    await f.command("deny", { denied: false });
    readsReleased.resolve();
    await expect.poll(() => f.page.evaluate(() => window.savedTask.runtime.value.available.value &&
      window.pendingTask.runtime.value.available.value)).toBe(true);
    assert.deepEqual((await f.state()).requests.filter(request => request.suffix === "/cancel").map(request => request.id), ["chat:2", "chat:3"]);
    assert.deepEqual((await f.sent()).map(request => request.input.messageId), ["accepted-before-read", "held-start-before-read"]);
    assert.deepEqual(await f.page.evaluate(() => [window.savedTask.runtime.value.snapshot.value.status,
      window.pendingTask.runtime.value.snapshot.value.status]), ["ready", "ready"]);
    await f.page.evaluate(() => {
      window.retiredStop = window.savedTask.runtime.value;
      window.conversationFixture.actor("43");
    });
    assert.equal(await f.page.evaluate(() => window.retiredStop.cancel()), false);
    assert.equal((await f.state()).requests.filter(request => request.suffix === "/cancel").length, 2);
    assert.equal((await f.sent()).length, 2);
  } finally {
    readsReleased.resolve();
  }
});

test("application defaults configure standard cards once while preserving overrides and actor isolation", options, async t => {
  const f = await fixture(t, 1280, { applicationDefaults: true });
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().identity.actorKey), "application-user");
  await f.input.fill("This user's private draft");
  await f.page.evaluate(() => { window.conversationFixture.retainVoice(); window.conversationFixture.mirror(true); });
  await expect(f.page.locator("[data-mirror]").getByRole("textbox", { name: "Message AI assistant" })).toHaveValue("This user's private draft");
  assert.equal(await f.page.evaluate(() => window.conversationFixture.socket.inspect().active), 1);

  await f.page.evaluate(() => window.conversationDefaultsFixture.mountOtherApp());
  await expect.poll(() => f.page.evaluate(() => window.conversationDefaultsFixture.other()?.available.value)).toBe(true);
  assert.deepEqual(await f.page.evaluate(() => {
    const other = window.conversationDefaultsFixture.other();
    const initial = [other.identity.actorKey, other.draft.value];
    other.draft.value = "The other application's draft";
    return initial;
  }), ["42", ""], "Another Vue application retains its own placement identity and draft");
  await expect(f.input).toHaveValue("This user's private draft");

  await f.page.evaluate(() => {
    window.overrideConversation = window.conversationFixture.acquireConversation({
      conversationId: "chat:2", actorKey: "override-user", api: window.conversationDefaultsFixture.overrideApi
    });
    window.emptyActorConversation = window.conversationFixture.acquireConversation({ conversationId: "chat:3", actorKey: "" });
  });
  await expect.poll(() => f.page.evaluate(() => window.overrideConversation.runtime.value?.available.value)).toBe(true);
  assert.equal(await f.page.evaluate(() => window.overrideConversation.runtime.value.identity.actorKey), "override-user");
  assert.equal(await f.page.evaluate(() => window.emptyActorConversation.runtime.value), null,
    "An explicit empty actor cannot inherit an earlier application's subject");
  await f.page.evaluate(() => window.overrideConversation.runtime.value.reload());
  assert.ok(await f.page.evaluate(() => window.conversationDefaultsFixture.overrideRequests.some(path => path.includes("chat%3A2"))));
  assert.equal(await f.page.evaluate(() => window.conversationDefaultsFixture.requests.some(path => path.includes("chat%3A2"))), false);
  await f.page.evaluate(() => { window.overrideConversation.release(); window.emptyActorConversation.release(); });

  await f.command("mode", { mode: "hold" });
  await f.input.press("Enter");
  await expect.poll(async () => (await f.sent()).length).toBe(1);
  await expect(f.input).toHaveValue("This user's private draft");
  assert.ok(await f.page.evaluate(() => window.conversationDefaultsFixture.requests.some(path => path.endsWith("/messages"))));
  await f.command("accept");
  await expect(f.input).toHaveValue("");
  await f.command("finish", { id: "chat:1", text: "Accepted with application defaults." });
  await f.notify("chat:1");
  await f.input.fill("Do not retain this after logout");
  await f.page.evaluate(() => window.conversationDefaultsFixture.actor(""));
  await expect(f.input).toBeDisabled();
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.voiceState().current)).toBe(false);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.sendVoice("Retired application actor")), false);
  assert.equal((await f.page.evaluate(() => window.conversationFixture.voiceState())).draft, "");
  assert.deepEqual(await f.page.evaluate(() => {
    const other = window.conversationDefaultsFixture.other();
    return [other.current.value, other.identity.actorKey, other.draft.value];
  }), [true, "42", "The other application's draft"]);
  await f.page.evaluate(() => window.conversationDefaultsFixture.actor("next-user"));
  await expect(f.input).toBeEnabled();
  await expect(f.input).toHaveValue("");
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().identity.actorKey), "next-user");
  await f.page.evaluate(() => { window.conversationDefaultsFixture.unmountOtherApp(); window.conversationFixture.releaseVoice(); });
  assert.equal((await f.sent()).length, 1, "Changing an application identity never replays its earlier submission");
});

// Ported composer assertions from Public Vibe64's failed Temporary retry and
// restored-unconfirmed cases. The original application cases remain unchanged.
test("prepared binding preserves retry identity, newer composer input and inspection-only uncertainty", options, async t => {
  const f = await fixture(t);
  const rejected = await f.page.evaluate(async () => {
    window.taskBinding = window.conversationFixture.acquireConversation({ conversationId: "chat:3", active: false });
    const current = window.taskBinding.runtime.value;
    current.draft.value = "Repair this conflict.";
    current.draftAttachments.value = [{ attachmentId: "original-file", fileName: "first.txt" }];
    window.taskClearedFiles = [];
    window.taskAccepted = 0;
    return window.taskBinding.submitPrepared({ message: current.draft.value,
      displayAttachments: current.draftAttachments.value, data: { model: "original-model" } }, {
      messageId: "task-retry", working: true,
      attachments: { clearAttachments({ attachmentIds }) { window.taskClearedFiles.push(attachmentIds); } },
      onAccepted() { window.taskAccepted += 1; },
      prepare() { throw new Error("Create was rejected."); }
    });
  });
  assert.deepEqual(rejected, { ok: false, error: "Create was rejected." });
  assert.equal(await f.page.evaluate(() => window.taskBinding.runtime.value.draft.value), "");
  assert.equal(await f.page.evaluate(() => window.taskBinding.runtime.value.delivery.find("task-retry").status), "failed");
  assert.equal((await f.sent()).length, 0);
  await f.page.evaluate(() => {
    const current = window.taskBinding.runtime.value;
    current.draft.value = "A newer question.";
    current.draftAttachments.value = [
      { attachmentId: "original-file", fileName: "first.txt" },
      { attachmentId: "new-file", fileName: "next.txt" }
    ];
    window.taskReader = window.conversationFixture.acquireConversation({ conversationId: "chat:3" });
  });
  await expect.poll(() => f.page.evaluate(() => window.taskReader.runtime.value.available.value)).toBe(true);
  await f.command("mode", { mode: "uncertain" });
  const uncertain = await f.page.evaluate(() => window.taskBinding.submitPrepared({
    message: "Do not recapture.", data: { model: "another-model" }
  }, { retryMessageId: "task-retry", working: false, prepare: captured => captured.request }));
  assert.equal(uncertain.status, "uncertain");
  const [request] = await f.sent();
  assert.deepEqual(request.input, { messageId: "task-retry", text: "Repair this conflict.",
    attachmentIds: ["original-file"], data: { model: "original-model" }, steer: true });
  const checked = await f.page.evaluate(() => window.taskBinding.submitPrepared({ message: "Never replay." }, {
    retryMessageId: "task-retry", prepare() { throw new Error("Inspection must not prepare or resend."); }
  }));
  assert.equal(checked.status, "uncertain");
  assert.equal((await f.sent()).length, 1);
  assert.equal(await f.page.evaluate(() => window.taskBinding.runtime.value.draft.value), "A newer question.");
  assert.deepEqual(await f.page.evaluate(() => window.taskClearedFiles), []);
  await f.command("confirm", { id: "chat:3" });
  const receipt = await f.page.evaluate(() => window.taskBinding.submitPrepared({ message: "Never replay." }, {
    retryMessageId: "task-retry", prepare() { throw new Error("Inspection must not prepare or resend."); }
  }));
  assert.equal(receipt.ok, true);
  assert.equal(receipt.status, "accepted");
  assert.equal((await f.sent()).length, 1);
  assert.equal(await f.page.evaluate(() => window.taskAccepted), 1);
  assert.equal(await f.page.evaluate(() => window.taskBinding.runtime.value.draft.value), "A newer question.");
  assert.deepEqual(await f.page.evaluate(() => window.taskBinding.runtime.value.draftAttachments.value.map(file => file.attachmentId)), ["new-file"]);
  assert.deepEqual(await f.page.evaluate(() => window.taskClearedFiles), [["original-file"]]);
});

test("acceptance settles a voice-retained conversation after its text view retargets without clearing the next composer", options, async t => {
  const f = await fixture(t, 1280, { acceptedDraft: true });
  await f.page.evaluate(() => window.conversationFixture.attachments(true));
  await f.primary.locator("input[type=file]").setInputFiles({ name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("Original file") });
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.attachmentState().ready.length)).toBe(1);
  const [originalFile] = (await f.page.evaluate(() => window.conversationFixture.attachmentState())).ready;
  await f.page.evaluate(() => {
    window.originalConversation = window.conversationFixture.current();
    window.originalConversation.draftAttachments.value = window.conversationFixture.attachmentState().ready;
    window.conversationFixture.retainVoice();
  });
  await f.command("mode", { mode: "hold" });
  await f.input.fill("Accept the original conversation's draft.");
  await f.input.press("Enter");
  await expect.poll(async () => (await f.state()).held).toBe(1);
  const [sent] = await f.sent();
  assert.deepEqual(sent.input.attachmentIds, [originalFile.attachmentId]);
  await f.page.evaluate(() => window.conversationFixture.target("chat:2"));
  await expect(f.input).toBeEnabled();
  await f.input.fill("The next conversation's draft stays.");
  await f.primary.locator("input[type=file]").setInputFiles({ name: "next.txt", mimeType: "text/plain", buffer: Buffer.from("Newer file") });
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.attachmentState().ready.length)).toBe(1);
  const [nextFile] = (await f.page.evaluate(() => window.conversationFixture.attachmentState())).ready;
  await f.page.evaluate(() => {
    window.conversationFixture.current().draftAttachments.value = window.conversationFixture.attachmentState().ready;
  });
  await f.command("accept", { holdResponse: true });
  await f.notify("chat:1");
  await expect.poll(() => f.page.evaluate(() => window.originalConversation.draft.value)).toBe("");
  assert.equal(await f.page.evaluate(() => window.originalConversation.draftMessageId.value), "");
  assert.deepEqual(await f.page.evaluate(() => window.originalConversation.draftAttachments.value), []);
  await expect(f.input).toHaveValue("The next conversation's draft stays.");
  assert.deepEqual(await f.page.evaluate(() => window.conversationFixture.current().draftAttachments.value.map(file => file.attachmentId)), [nextFile.attachmentId]);
  assert.deepEqual((await f.page.evaluate(() => window.conversationFixture.attachmentState())).ready.map(file => file.attachmentId), [nextFile.attachmentId]);
  assert.deepEqual((await f.page.evaluate(() => window.conversationFixture.attachmentState())).acknowledged, []);
  await f.command("release-response");
  await expect(f.input).toHaveValue("The next conversation's draft stays.");
  assert.equal((await f.sent()).length, 1);
});

test("transient subscription errors keep loaded history and recover through the banner while denial clears private content", options, async t => {
  const f = await fixture(t, 390, { acceptedDraft: true });
  await f.input.fill("Start a controlled ongoing answer.");
  await f.input.press("Enter");
  const stop = f.primary.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible();
  const sentBeforeRecovery = (await f.sent()).length;
  assert.equal(sentBeforeRecovery, 1);
  const workingHint = f.primary.locator(".assistant-composer-support__assistant-status");
  await expect(workingHint).toHaveText("Assistant is working…");
  const turns = Array.from({ length: 30 }, (_, index) => ({
    turnId: `saved-${index}`,
    user: { messageId: `question-${index}`, role: "user", text: `Private saved question ${index}. ` + "Keep the original discussion. ".repeat(8) },
    assistant: { messageId: `answer-${index}`, role: "assistant", text: `Private saved answer ${index}. ` + "Read the saved answer without losing your place. ".repeat(8) }
  }));
  await f.command("history", { id: "chat:1", turns, limit: 30 });
  await f.notify("chat:1");
  const body = f.primary.locator(".assistant-transcript__body");
  await expect(body.locator(".assistant-transcript__turn")).toHaveCount(turns.length * 2);
  await expect(f.primary.locator(".assistant-transcript__settling")).toHaveCount(0);
  await f.input.fill("Keep my newer private draft.");
  await body.hover();
  await f.page.mouse.wheel(0, -1000);
  await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeGreaterThan(50);
  await body.evaluate(element => { element.scrollTop = 420; window.loadedUpdateBody = element; });
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(420);
  await f.input.evaluate(element => { element.focus({ preventScroll: true }); element.setSelectionRange(2, 7); });
  const reads = "**/api/assistant/home/conversations/*";
  await f.page.route(reads, route => route.fulfill({ status: 503, json: { error: "Chat updates are temporarily unavailable." } }));
  await f.page.evaluate(() => window.conversationFixture.current().reload());
  const banner = f.primary.locator(".assistant-transcript__error");
  await expect(banner).toContainText("Chat updates are temporarily unavailable.");
  await expect(workingHint).toHaveCount(0);
  await expect(stop).toBeVisible();
  await expect(f.primary.getByText("Chat updates are temporarily unavailable.", { exact: true })).toHaveCount(1);
  await expect(body.locator(".assistant-transcript__turn")).toHaveCount(turns.length * 2);
  assert.equal(await body.evaluate(element => element === window.loadedUpdateBody), true);
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(420);
  await expect(f.input).toBeFocused();
  assert.deepEqual(await f.input.evaluate(element => [element.selectionStart, element.selectionEnd]), [2, 7]);
  await expect(f.input).toHaveValue("Keep my newer private draft.");
  await f.page.evaluate(() => window.conversationFixture.socket.reconnect());
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.socket.inspect().active)).toBe(0);
  await expect(body.locator(".assistant-transcript__turn")).toHaveCount(turns.length * 2);
  await f.page.unroute(reads);
  await banner.getByRole("button", { name: "Reload chat", exact: true }).click();
  await expect(banner).toHaveCount(0);
  await expect(workingHint).toHaveText("Assistant is working…");
  await expect(stop).toBeVisible();
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.socket.inspect().active)).toBe(1);
  assert.equal(await body.evaluate(element => element === window.loadedUpdateBody), true);
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(420);
  await expect(f.input).toHaveValue("Keep my newer private draft.");
  await expect(body.locator(".assistant-transcript__turn")).toHaveCount(turns.length * 2);
  assert.equal((await f.sent()).length, sentBeforeRecovery, "Subscription recovery never sends the retained draft");
  await f.command("deny", { denied: true });
  await f.page.evaluate(() => window.conversationFixture.current().reload());
  await expect(banner).toContainText("Access denied.");
  await expect(banner.getByRole("button", { name: "Reload chat", exact: true })).toHaveCount(0);
  await expect(body.locator(".assistant-transcript__turn")).toHaveCount(0);
  await expect(f.input).toHaveValue("");
  await expect(f.input).toBeDisabled();
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.socket.inspect().active)).toBe(1);
  assert.equal((await f.sent()).length, sentBeforeRecovery);
  assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
});

test("canonical incoming messages preserve paged history and the scrolled-up reader", options, async t => {
  const f = await fixture(t, 390);
  const turns = Array.from({ length: 24 }, (_, index) => ({
    turnId: String(index + 1).padStart(6, "0"),
    user: { messageId: `loaded-user-${index}`, role: "user", text: `Loaded question ${index + 1}. ` + "Keep the earlier discussion. ".repeat(6) },
    assistant: { messageId: `loaded-answer-${index}`, role: "assistant", text: `Loaded answer ${index + 1}. ` + "Keep the earlier answer. ".repeat(6) }
  }));
  await f.command("history", { id: "chat:1", turns, limit: 6 });
  await f.notify("chat:1");
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().turns.value.length)).toBe(6);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().loadMore()), true);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().loadMore()), true);
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().turns.value.length)).toBe(18);
  const body = f.primary.locator(".assistant-transcript__body");
  const previousScroll = await body.evaluate(element => element.scrollTop);
  await body.hover();
  await f.page.mouse.wheel(0, -300);
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeLessThan(previousScroll);
  await body.evaluate(element => { element.scrollTop = 420; });
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(420);
  await f.input.fill("Keep this unsent draft");
  await f.input.evaluate(element => { element.focus({ preventScroll: true }); element.setSelectionRange(2, 7); });
  turns.push({ turnId: "000025", user: { messageId: "incoming-user", role: "user", text: "New incoming question" } });
  await f.command("history", { id: "chat:1", turns, limit: 6 });
  await f.notify("chat:1");
  await expect(f.primary.getByText("New incoming question", { exact: true })).toHaveCount(1);
  const ids = await f.page.evaluate(() => window.conversationFixture.current().turns.value.map(turn => turn.turnId));
  assert.deepEqual(ids, turns.slice(6).map(turn => turn.turnId), "A canonical incoming message must retain every loaded turn, including the row evicted from the latest page");
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(420);
  await expect(f.input).toHaveValue("Keep this unsent draft");
  await expect(f.input).toBeFocused();
  assert.deepEqual(await f.input.evaluate(element => [element.selectionStart, element.selectionEnd]), [2, 7]);
  assert.deepEqual(await f.sent(), [], "History observation does not send or resend work");
});


for (const width of [390, 768, 1280]) {
  test(`canonical loaded-history refresh is atomic and removes saved rows at width ${width}`, options, async t => {
    const f = await fixture(t, width);
    const turns = Array.from({ length: 24 }, (_, index) => ({
      turnId: String(index + 1).padStart(6, "0"),
      user: { role: "user", messageId: `atomic-user-${index}`, text: `Atomic saved question ${index + 1}. ` + "Retain visible discussion. ".repeat(8) },
      assistant: { role: "assistant", messageId: `atomic-answer-${index}`, text: `Atomic saved answer ${index + 1}. ` + "Retain visible answer. ".repeat(8) }
    }));
    await f.command("history", { id: "chat:1", turns, limit: 6 });
    await f.notify("chat:1");
    await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().turns.value.length)).toBe(6);
    assert.equal(await f.page.evaluate(() => window.conversationFixture.current().loadMore()), true);
    assert.equal(await f.page.evaluate(() => window.conversationFixture.current().loadMore()), true);
    const body = f.primary.locator(".assistant-transcript__body");
    const previousScroll = await body.evaluate(element => element.scrollTop);
    await body.hover();
    await f.page.mouse.wheel(0, -300);
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeLessThan(previousScroll);
    await body.evaluate(element => { window.atomicHistoryBody = element; element.scrollTop = 420; });
    await f.input.fill("Unsent while history refreshes");
    await f.input.evaluate(element => { element.focus({ preventScroll: true }); element.setSelectionRange(3, 8); });
    const previousIds = turns.slice(6).map(turn => turn.turnId);
    const fresh = turns.filter(turn => !["000007", "000010"].includes(turn.turnId));
    fresh[8] = { ...fresh[8], assistant: { ...fresh[8].assistant, text: "Authoritatively replaced saved answer" } };
    fresh.push({ turnId: "000025", user: { role: "user", messageId: "atomic-incoming", text: "Atomic new question" } });
    await f.command("history", { id: "chat:1", turns: fresh, limit: 6 });
    let release;
    let held = false;
    const reads = "**/api/assistant/home/conversations/chat%3A1?**";
    await f.page.route(reads, async route => {
      if (!new URL(route.request().url()).searchParams.has("beforeTurnId") || held) return route.continue();
      held = true;
      const response = await route.fetch();
      await new Promise(resolve => { release = resolve; });
      await route.fulfill({ response });
    });
    await f.notify("chat:1");
    await expect.poll(() => Boolean(release)).toBe(true);
    assert.deepEqual(await f.page.evaluate(() => window.conversationFixture.current().turns.value.map(turn => turn.turnId)), previousIds);
    assert.equal(await body.evaluate(element => element === window.atomicHistoryBody), true);
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(420);
    await expect(f.input).toHaveValue("Unsent while history refreshes");
    await expect(f.input).toBeFocused();
    assert.deepEqual(await f.input.evaluate(element => [element.selectionStart, element.selectionEnd]), [3, 8]);
    release();
    await expect(f.primary.getByText("Atomic new question", { exact: true })).toHaveCount(1);
    assert.deepEqual(await f.page.evaluate(() => window.conversationFixture.current().turns.value.map(turn => turn.turnId)),
      fresh.filter(turn => Number(turn.turnId) >= 7).map(turn => turn.turnId));
    await expect(f.primary.getByText("Authoritatively replaced saved answer", { exact: true })).toHaveCount(1);
    await expect(f.primary.getByText(/Atomic saved question (7|10)\./)).toHaveCount(0);
    assert.equal(await body.evaluate(element => element === window.atomicHistoryBody), true);
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(420);
    await expect(f.input).toHaveValue("Unsent while history refreshes");
    await expect(f.input).toBeFocused();
    assert.deepEqual(await f.input.evaluate(element => [element.selectionStart, element.selectionEnd]), [3, 8]);
    assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(await f.sent(), []);
    await f.page.unroute(reads);
  });
}

test("concurrent older-history loading extends canonical refresh without reviving revoked pages", options, async t => {
  const f = await fixture(t, 390);
  const turns = Array.from({ length: 24 }, (_, index) => ({
    turnId: String(index + 1).padStart(6, "0"),
    user: { role: "user", messageId: `concurrent-${index}`, text: `Concurrent saved question ${index + 1}` }
  }));
  await f.command("history", { id: "chat:1", turns, limit: 6 });
  await f.notify("chat:1");
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().turns.value.length)).toBe(6);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().loadMore()), true);
  turns.push({ turnId: "000025", user: { role: "user", messageId: "concurrent-new", text: "Concurrent new question" } });
  await f.command("history", { id: "chat:1", turns, limit: 6 });
  let release;
  let held = false;
  const reads = "**/api/assistant/home/conversations/chat%3A1?**";
  await f.page.route(reads, async route => {
    if (!new URL(route.request().url()).searchParams.has("beforeTurnId") || held) return route.continue();
    held = true;
    const response = await route.fetch();
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ response });
  });
  await f.notify("chat:1");
  await expect.poll(() => Boolean(release)).toBe(true);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().loadMore()), true);
  release();
  await expect(f.primary.getByText("Concurrent new question", { exact: true })).toHaveCount(1);
  assert.deepEqual(await f.page.evaluate(() => window.conversationFixture.current().turns.value.map(turn => turn.turnId)), turns.slice(6).map(turn => turn.turnId));
  await f.page.unroute(reads);

  held = false;
  release = null;
  await f.page.route(reads, async route => {
    if (!new URL(route.request().url()).searchParams.has("beforeTurnId") || held) return route.continue();
    held = true;
    const response = await route.fetch();
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ response });
  });
  await f.notify("chat:1");
  await expect.poll(() => Boolean(release)).toBe(true);
  await f.command("deny", { denied: true });
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().loadMore()), false);
  await expect(f.input).toBeDisabled();
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().turns.value.length)).toBe(0);
  release();
  await expect(f.primary.locator(".assistant-transcript__error")).toContainText("Access denied.");
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().turns.value.length)).toBe(0);
  assert.deepEqual(await f.sent(), []);
  await f.page.unroute(reads);
});


test("loaded saved history bridges transcript evictions and rejects a retired reader's page response", options, async t => {
  const f = await fixture(t, 390);
  const turns = Array.from({ length: 24 }, (_, index) => ({
    turnId: String(index + 1).padStart(6, "0"),
    user: { role: "user", messageId: `patch-history-${index}`, text: `Patch saved question ${index + 1}` }
  }));
  await f.command("history", { id: "chat:1", turns, limit: 6 });
  await f.notify("chat:1");
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().turns.value.length)).toBe(6);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().loadMore()), true);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().loadMore()), true);
  const incoming = { turnId: "000025", user: { role: "user", messageId: "patch-incoming", text: "Patch incoming question" } };
  await f.page.evaluate(turn => window.conversationFixture.socket.notify("chat:1", {
    type: "transcript", patch: { type: "upsert-turn", turn }
  }), incoming);
  await expect(f.primary.getByText("Patch incoming question", { exact: true })).toHaveCount(1);
  assert.deepEqual(await f.page.evaluate(() => window.conversationFixture.current().turns.value.map(turn => turn.turnId)),
    [...turns.slice(6), incoming].map(turn => turn.turnId), "A bounded live patch must not lose its evicted saved row");
  await f.command("history", { id: "chat:1", turns: [...turns, incoming], limit: 6 });
  let release;
  let held = false;
  const reads = "**/api/assistant/home/conversations/chat%3A1?**";
  await f.page.route(reads, async route => {
    if (!new URL(route.request().url()).searchParams.has("beforeTurnId") || held) return route.continue();
    held = true;
    const response = await route.fetch();
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ response });
  });
  await f.notify("chat:1");
  await expect.poll(() => Boolean(release)).toBe(true);
  await f.page.evaluate(() => {
    window.retiredHistoryReader = window.conversationFixture.current();
    window.conversationFixture.actor("different-actor");
  });
  await expect.poll(() => f.page.evaluate(() => window.retiredHistoryReader.current.value)).toBe(false);
  release();
  await expect.poll(() => f.page.evaluate(() => window.retiredHistoryReader.turns.value.length)).toBe(0);
  await expect.poll(() => f.page.evaluate(() => window.retiredHistoryReader.snapshot.value)).toBe(null);
  assert.deepEqual(await f.sent(), []);
  await f.page.unroute(reads);
});

test("canonical rewind replaces the loaded saved window without retaining removed turns", options, async t => {
  const f = await fixture(t, 768);
  const turns = Array.from({ length: 24 }, (_, index) => ({
    turnId: String(index + 1).padStart(6, "0"),
    user: { role: "user", messageId: `rewind-${index}`, text: `Rewind saved question ${index + 1}` }
  }));
  await f.command("history", { id: "chat:1", turns, limit: 6 });
  await f.notify("chat:1");
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().turns.value.length)).toBe(6);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().loadMore()), true);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().loadMore()), true);
  await f.command("history", { id: "chat:1", turns: turns.slice(0, 12), limit: 6 });
  await f.notify("chat:1");
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().turns.value.map(turn => turn.turnId)))
    .toEqual(turns.slice(6, 12).map(turn => turn.turnId));
  assert.deepEqual(await f.sent(), []);
});


test("canonical loaded-history replay retains older completed output and its authored row", options, async t => {
  const f = await fixture(t, 390);
  const turns = Array.from({ length: 25 }, (_, index) => ({
    turnId: String(index + 1).padStart(6, "0"),
    user: { role: "user", messageId: `older-replay-user-${index}`, text: `Older replay question ${index + 1}` },
    ...(index === 18 ? { commentary: [{ role: "commentary", messageId: "older-saved-progress", text: "Saved older progress" }] } : {})
  }));
  await f.command("history", { id: "chat:1", turns, limit: 6 });
  await f.notify("chat:1");
  await expect.poll(() => f.page.evaluate(() => window.conversationFixture.current().turns.value.length)).toBe(6);
  assert.equal(await f.page.evaluate(() => window.conversationFixture.current().loadMore()), true);
  let release;
  let held = false;
  const reads = "**/api/assistant/home/conversations/chat%3A1?**";
  await f.page.route(reads, async route => {
    if (!new URL(route.request().url()).searchParams.has("beforeTurnId") || held) return route.continue();
    held = true;
    const response = await route.fetch();
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ response });
  });
  await f.notify("chat:1");
  await expect.poll(() => Boolean(release)).toBe(true);
  const assistant = { role: "assistant", messageId: "older-replayed-answer", text: "Delivered older completed output" };
  await f.page.evaluate(assistant => window.conversationFixture.socket.notify("chat:1", {
    type: "transcript", patch: { type: "upsert-turn", turn: { turnId: "000019", assistant } }
  }), assistant);
  release();
  await expect(f.primary.getByText("Delivered older completed output", { exact: true })).toHaveCount(1);
  const saved = await f.page.evaluate(() => window.conversationFixture.current().turns.value.find(turn => turn.turnId === "000019"));
  assert.equal(saved.user.text, "Older replay question 19");
  assert.equal(saved.commentary[0].text, "Saved older progress");
  assert.equal(saved.assistant.text, "Delivered older completed output");
  assert.equal((await f.page.evaluate(() => window.conversationFixture.current().snapshot.value.conversationLog.length)), 6);
  await f.page.unroute(reads);
  await f.page.evaluate(() => window.conversationFixture.socket.notify("chat:1", {
    type: "message", status: "complete", turnId: "000019", messageId: "older-display-only-output", role: "assistant", text: "Live older completed reply",
    streaming: { revision: 1, messages: [] }
  }));
  await expect(f.primary.getByText("Live older completed reply", { exact: true })).toHaveCount(1);
  const display = await f.page.evaluate(() => window.conversationFixture.current().turns.value.find(turn => turn.turnId === "000019"));
  assert.equal(display.user.text, "Older replay question 19", "An older turn overlay cannot replace its authored saved row");
  assert.equal(display.commentary[0].text, "Saved older progress");
  assert.equal(display.assistant.text, "Live older completed reply");
  assert.deepEqual(await f.sent(), []);
});


test("an exact host pre-admission receipt preserves one manual retry and actor and draft guards", options, async t => {
  const f = await fixture(t);
  await f.command("mode", { mode: "rejected" });
  await f.page.route("**/messages", async route => {
    const response = await route.fetch();
    const input = route.request().postDataJSON();
    await route.fulfill({ response, status: 409, json: { code: "host_capture_rejected",
      error: "The host refused this message before native admission.",
      details: { delivery: { status: "not-sent", messageId: input.messageId } } } });
  });
  await f.page.evaluate(() => window.conversationFixture.data({ originId: "captured-tab", choice: "original" }));
  await f.input.fill("Retain this exact original request");
  await f.input.press("Enter");
  await expect(f.primary.getByText("Failed: The host refused this message before native admission.", { exact: true })).toBeVisible();
  const [original] = await f.sent();
  assert.equal(await f.page.evaluate(id => window.conversationFixture.current().delivery.find(id).status, original.input.messageId), "failed");
  await expect(f.primary.getByRole("button", { name: "Check delivery", exact: true })).toHaveCount(0);
  await f.input.fill("Keep my newer draft");
  await f.page.evaluate(() => window.conversationFixture.data({ originId: "newer-tab", choice: "newer" }));
  assert.equal((await f.sent()).length, 1, "a rejection never retries automatically");
  await f.page.unroute("**/messages");
  await f.command("mode", { mode: "accepted" });
  await f.primary.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(async () => (await f.sent()).length).toBe(2);
  const requests = await f.sent();
  assert.deepEqual(requests[1].input, original.input, "manual Retry retains the ID, words and captured selection/data");
  await expect(f.input).toHaveValue("Keep my newer draft");
  await f.page.evaluate(() => {
    window.rejectedActorRuntime = window.conversationFixture.current();
    window.conversationFixture.actor("another-actor");
  });
  assert.equal(await f.page.evaluate(() => window.rejectedActorRuntime.send({ message: "Must not dispatch" },
    { messageId: "foreign-actor" })), false);
  assert.equal((await f.sent()).length, 2, "receipt metadata grants no authority to a retired actor");
});

for (const kind of ["mismatched-id", "malformed-status", "missing-marker", "post-routing-failure"]) {
  test(`unconfirmed host delivery metadata remains inspection-only: ${kind}`, options, async t => {
    const f = await fixture(t);
    await f.command("mode", { mode: "rejected" });
    await f.page.route("**/messages", async route => {
      const response = await route.fetch();
      const input = route.request().postDataJSON();
      await route.fulfill({ response, status: kind === "post-routing-failure" ? 500 : 409,
        json: { code: "host_dispatch_failed", error: "Delivery cannot be confirmed.", details: { delivery: kind === "missing-marker" ? null : {
          status: kind === "malformed-status" ? "rejected" : "not-sent",
          messageId: kind === "mismatched-id" ? "another-message" : input.messageId
        } } } });
    });
    await f.input.fill("Do not resubmit unknown work");
    await f.input.press("Enter");
    const check = f.primary.getByRole("button", { name: "Check delivery", exact: true });
    await expect(check).toBeVisible();
    const [original] = await f.sent();
    await check.click();
    await expect.poll(() => f.page.evaluate(id => window.conversationFixture.current().delivery.find(id).checking,
      original.input.messageId)).toBe(false);
    assert.equal(await f.page.evaluate(id => window.conversationFixture.current().delivery.find(id).status,
      original.input.messageId), "uncertain");
    await expect(f.primary.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
    assert.equal((await f.sent()).length, 1, "missing native/canonical history never proves not-sent or resubmits");
  });
}
