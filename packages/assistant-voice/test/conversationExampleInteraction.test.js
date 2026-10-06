import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { createSocketIoClient } from "@jskit-ai/realtime/client/runtime";

const forbiddenImports = [];
registerHooks({ resolve(specifier, context, nextResolve) {
  if (["@jskit-ai/database-runtime", "knex"].some(name => specifier === name || specifier.startsWith(`${name}/`))) {
    forbiddenImports.push(specifier);
    throw new Error(`The file-backed example must not import ${specifier}.`);
  }
  return nextResolve(specifier, context);
} });
const { createExampleServer } = await import("../examples/conversation/server.js");
// Import the shipped JavaScript clients without loading their Vue component
// barrels. These resolve from the installed packages in the packed proof too.
const { createAssistantApi } = await import(new URL("../../client/lib/assistantApi.js",
  import.meta.resolve("@jskit-ai/assistant-core/server/conversation")));
const { subscribeAssistantConversation } = await import(new URL("../client/support/subscribeAssistantConversation.js",
  import.meta.resolve("@jskit-ai/assistant-runtime/server")));

const origin = "http://127.0.0.1:5176";
const ids = ["planning", "notes", "research", "writing", "review"];
const inferenceUrl = "https://opencode.ai/zen/v1/chat/completions";
const options = { timeout: 30_000 };

// Only inference is synthetic. The example, file store, connection catalogue,
// HTTP client/routes, Socket.IO transport and subscription reducer are real.
async function fixture(t, { port = 0 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "voice-example-interaction-"));
  const storageDirectory = join(directory, "conversations");
  const integrationsPath = join(directory, "integrations.json");
  const changes = new EventEmitter();
  const notify = () => changes.emit("change");
  const requests = [], clients = [], releases = [];
  const realFetch = globalThis.fetch;
  let application, url;
  let socketConnections = 0;
  t.after(async () => {
    for (const release of releases) release();
    for (const client of clients) client.disconnect();
    try { await application?.app.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
    assert.deepEqual(forbiddenImports, []);
  });
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const address = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (address.href !== inferenceUrl) {
      assert.equal(address.origin, url, "Only the configured inference request is simulated; all application HTTP is real");
      return realFetch(input, init);
    }
    const body = JSON.parse(init.body);
    const replyId = `reply-${requests.length + 1}`;
    const encoder = new TextEncoder();
    let output;
    const stream = new ReadableStream({ start(controller) { output = controller; } });
    const push = (delta, finish_reason = null) => output.enqueue(encoder.encode(`data: ${JSON.stringify({
      id: replyId, object: "chat.completion.chunk", created: 1, model: "big-pickle",
      choices: [{ index: 0, delta, finish_reason }]
    })}\n\n`));
    const aborted = () => {
      try { output.error(init.signal.reason); } catch {}
      notify();
    };
    init.signal.addEventListener("abort", aborted, { once: true });
    if (init.signal.aborted) aborted();
    requests.push({ body, signal: init.signal, text: value => push({ content: value }),
      finish() { push({}, "stop"); output.close(); } });
    notify();
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  });
  await writeFile(integrationsPath, JSON.stringify({ schemaVersion: 1, registrations: {}, integrations: {
    assistant: { provider: "ai", accountMode: "shared", scopes: [], authentication: { method: "none" },
      settings: { model: "opencode/big-pickle" } }
  } }));
  application = await createExampleServer({ env: {
    APP_ORIGIN: origin, ASSISTANT_ENGINE: "api", ASSISTANT_STORAGE_DIRECTORY: storageDirectory,
    ASSISTANT_WORKDIR: directory, ASSISTANT_INTEGRATIONS: integrationsPath
  } });
  url = await application.app.listen({ host: "127.0.0.1", port });
  application.app.server.on("upgrade", request => {
    if (request.url.startsWith("/socket.io/")) socketConnections++;
  });
  const http = createHttpClient({ csrf: { enabled: false }, readTimeoutMs: 5_000,
    hooks: { decorateHeaders({ headers }) { headers.origin = origin; } } });
  const api = createAssistantApi({ request: http.request,
    resolveBasePath: () => `${url}/api/assistant/home`, resolveSurfaceId: () => "home" });

  async function until(predicate, description) {
    const signal = AbortSignal.any([t.signal, AbortSignal.timeout(8_000)]);
    try { while (!predicate()) await once(changes, "change", { signal }); }
    catch (cause) { throw new Error(`Waiting for ${description} failed.`, { cause }); }
  }
  async function connect(socket) {
    if (!socket) {
      socket = createSocketIoClient({ url, options: {
        transports: ["websocket"], reconnection: false, autoConnect: false, extraHeaders: { Origin: origin }
      } });
      clients.push(socket);
    }
    const connected = once(socket, "connect", { signal: AbortSignal.any([t.signal, AbortSignal.timeout(5_000)]) });
    socket.connect();
    await connected;
    return socket;
  }
  function view(socket, id) {
    const states = [], events = [], errors = [];
    let initialReads = 0;
    const release = subscribeAssistantConversation({ socket, conversationId: id,
      targetSurfaceId: "home", hostSurfaceId: "home",
      read: () => api.readConversation(id, { signal: t.signal }),
      onState(state, { initial }) { states.push(state); if (initial) initialReads++; notify(); },
      onEvent(event) { events.push(event); notify(); },
      onError(error) { errors.push(error); notify(); }
    });
    releases.push(release);
    return { states, events, errors, get state() { return states.at(-1); }, get initialReads() { return initialReads; } };
  }
  async function stored() {
    return Promise.all((await readdir(storageDirectory)).filter(name => name.endsWith(".json"))
      .map(async name => JSON.parse(await readFile(join(storageDirectory, name), "utf8"))));
  }
  return { ...application, api, http, url, requests, connect, view, until, stored,
    socketConnections: () => socketConnections };
}

test("voice example streams five chats, stops one independently and reconnects without resending", options, async t => {
  const f = await fixture(t);
  const bootstrap = await f.http.request(`${f.url}/api/bootstrap`, { signal: t.signal });
  assert.deepEqual(bootstrap.example.conversations.map(value => value.id), ids);
  const socket = await f.connect();
  const firstSocketId = socket.id;
  const views = new Map(ids.map(id => [id, f.view(socket, id)]));
  await f.until(() => [...views.values()].every(view => view.initialReads === 1), "five initial subscription snapshots");
  assert.equal(f.socketConnections(), 1);
  for (const [id, view] of views) {
    assert.equal(view.state.id, id);
    assert.deepEqual(view.state.conversationLog, []);
  }

  const inputs = new Map(ids.map(id => [id, { messageId: `question-${id}`, text: `Question for ${id}.` }]));
  const accepted = new Map(await Promise.all(ids.map(async id =>
    [id, await f.api.sendConversationMessage(id, inputs.get(id), { signal: t.signal })])));
  assert.ok([...accepted.values()].every(receipt => receipt.status === "accepted"));
  for (const [id, receipt] of accepted) {
    assert.equal(receipt.messageId, inputs.get(id).messageId);
    assert.equal(typeof receipt.turnId, "string");
    assert.ok(receipt.turnId.length > 0);
  }
  // File-backed turn IDs are allocated inside each conversation, not globally.
  assert.equal(new Set([...accepted].map(([id, receipt]) => JSON.stringify([id, receipt.turnId]))).size, 5);
  await f.until(() => f.requests.length === 5, "five authorized API inferences");
  const inference = new Map(ids.map(id => [id, f.requests.find(request => request.body.messages.at(-1).content === inputs.get(id).text)]));
  for (const [id, request] of inference) {
    assert.ok(request, `The actual ${id} send reached the configured inference endpoint`);
    assert.equal(request.body.model, "big-pickle");
    request.text(`Partial ${id}.`);
  }
  await f.until(() => [...views].every(([id, view]) => view.state.status === "working" &&
    view.state.conversationLog[0]?.user?.messageId === inputs.get(id).messageId &&
    view.state.streaming.messages.some(message => message.text === `Partial ${id}.`)),
    "live text in every conversation subscription");
  for (const [id, view] of views) {
    assert.equal(view.state.status, "working");
    assert.equal(view.state.conversationLog.length, 1);
    assert.equal(view.state.conversationLog[0].turnId, accepted.get(id).turnId);
    assert.equal(view.state.conversationLog[0].user.messageId, inputs.get(id).messageId);
    assert.equal(view.state.conversationLog[0].assistant, null);
    assert.equal(view.state.turns[0].assistant.text, `Partial ${id}.`);
  }

  assert.deepEqual(await f.api.cancelConversation("planning", { signal: t.signal }), { stopped: true });
  await f.until(() => views.get("planning").state.status === "ready", "the cancelled chat's settled snapshot");
  assert.equal(inference.get("planning").signal.aborted, true);
  const stopped = views.get("planning").state.conversationLog[0];
  assert.equal(stopped.metadata.runtime.status, "cancelled");
  assert.equal(stopped.assistant.text, "Partial planning.");
  for (const id of ids.slice(1)) {
    assert.equal(inference.get(id).signal.aborted, false, `Stopping planning preserves ${id}'s inference`);
    assert.equal(views.get(id).state.status, "working");
  }

  socket.disconnect();
  assert.equal(socket.connected, false);
  inference.get("research").text(" While disconnected.");
  const disconnected = await f.api.readConversation("research", { signal: t.signal });
  assert.equal(disconnected.streaming.messages[0].text, "Partial research. While disconnected.");
  assert.equal(views.get("research").state.streaming.messages[0].text, "Partial research.");
  await f.connect(socket);
  await f.until(() => [...views.values()].every(view => view.initialReads === 2) &&
    views.get("research").state.streaming.messages.some(message => message.text === "Partial research. While disconnected."),
  "fresh snapshots and live catch-up after the shared socket reconnects");
  assert.notEqual(socket.id, firstSocketId);
  assert.equal(f.socketConnections(), 2, "Five subscriptions reuse one socket connection on each connect");
  assert.equal(f.requests.length, 5, "Reconnect reads admitted work without another inference");
  for (const id of ids.slice(1)) assert.equal(inference.get(id).signal.aborted, false);

  for (const id of ids.slice(1)) {
    inference.get(id).text(" Complete.");
    inference.get(id).finish();
  }
  await f.until(() => ids.slice(1).every(id => views.get(id).state.status === "ready" &&
    views.get(id).state.conversationLog[0].metadata.runtime.status === "complete"), "four saved completed answers");
  for (const id of ids.slice(1)) {
    const view = views.get(id);
    const answer = `Partial ${id}.${id === "research" ? " While disconnected." : ""} Complete.`;
    assert.equal(view.state.conversationLog.length, 1);
    assert.equal(view.state.conversationLog[0].turnId, accepted.get(id).turnId);
    assert.equal(view.state.conversationLog[0].assistant.text, answer);
    assert.equal(view.state.turns[0].assistant.text, answer);
    assert.deepEqual(view.state.streaming.messages, []);
    assert.ok(view.events.some(event => event.type === "message" && event.status === "inProgress"));
  }
  for (const [id, view] of views) {
    assert.deepEqual(view.errors, []);
    assert.ok(view.events.every(event => event.conversationId === id));
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const receipt = await f.api.inspectConversationDelivery("research", inputs.get("research").messageId, { signal: t.signal });
    assert.equal(receipt.status, "accepted");
    assert.equal(receipt.turnId, accepted.get("research").turnId);
  }
  assert.deepEqual(await f.api.inspectConversationDelivery("notes", "never-sent", { signal: t.signal }),
    { status: "unknown", messageId: "never-sent" });
  assert.equal(f.requests.length, 5, "Accepted and unknown delivery inspection do not resend anything");
  const records = await f.stored();
  assert.deepEqual(records.map(record => record.scope).sort(), [...ids].sort());
  assert.ok(records.every(record => record.turns.length === 1));
  for (const record of records) {
    const [turnId, turn] = record.turns[0];
    assert.equal(turnId, accepted.get(record.scope).turnId);
    assert.equal(turn.messages.find(message => message.role === "user").messageId, inputs.get(record.scope).messageId);
  }
  assert.equal(socket.connected, true);
  assert.equal(f.socketConnections(), 2);
});

test("voice example runs a direct file-backed headless task while denying browser access to it", options, async t => {
  const f = await fixture(t);
  const text = "Perform the bounded server task.";
  const answer = f.runHeadless(text);
  // Keep an early provider failure observed while waiting for its controlled stream.
  answer.catch(() => {});
  await f.until(() => f.requests.length === 1, "the actual runHeadless inference");
  assert.equal(f.requests[0].body.messages[0].content,
    "You are the assistant for Headless task. Answer briefly in plain language.");
  assert.equal(f.requests[0].body.messages.at(-1).content, text);
  f.requests[0].text("The headless task is complete.");
  f.requests[0].finish();
  assert.equal(await answer, "The headless task is complete.");

  const socket = await f.connect();
  const denied = f.view(socket, "headless");
  const planning = f.view(socket, "planning");
  await f.until(() => denied.errors.length === 1 && planning.initialReads === 1,
    "the browser headless denial and ordinary conversation subscription");
  assert.equal(denied.errors[0].statusCode, 403);
  assert.deepEqual(denied.states, []);
  assert.deepEqual(planning.state.conversationLog, []);
  assert.deepEqual(planning.errors, []);
  await assert.rejects(f.api.readConversation("headless", { signal: t.signal }), { status: 403 });
  await assert.rejects(f.api.sendConversationMessage("headless", { messageId: "browser-attempt", text: "Never dispatch." },
    { signal: t.signal }), { status: 403 });
  await assert.rejects(f.api.cancelConversation("headless", { signal: t.signal }), { status: 403 });
  await assert.rejects(f.api.inspectConversationDelivery("headless", "browser-attempt", { signal: t.signal }), { status: 403 });
  assert.equal(f.requests.length, 1, "Browser denial cannot invoke or replay headless inference");
  const records = await f.stored();
  assert.deepEqual(records.map(record => record.scope).sort(), [...ids, "headless"].sort());
  assert.equal(records.find(record => record.scope === "headless").turns.length, 1);
  assert.ok(records.filter(record => record.scope !== "headless").every(record => record.turns.length === 0));
});


// Mount the shipped application, not the canonical binding fixture. Its actual
// Vite proxy owns ports 5176/3042; a collision must fail instead of reusing an app.
test("the mounted voice starter shares five standard cards and retains its original text target", {
  skip: process.env.JSKIT_ASSISTANT_RUNTIME_BROWSER_INTEGRATION !== "1", timeout: 120_000
}, async t => {
  const { chromium, expect } = await import("@playwright/test");
  const { fileURLToPath } = await import("node:url");
  const { createChromiumLaunchOptions, startCapturedProcess, stopProcess } =
    await import("../../../tooling/testUtils/browserFixture.mjs");
  const f = await fixture(t, { port: 3042 });
  const exampleRoot = fileURLToPath(new URL("../examples/conversation/", import.meta.url));
  const appDirectory = await mkdtemp(join(tmpdir(), "voice-mounted-starter-"));
  let vite, browser, page;
  const errors = [];
  const diagnostics = [];
  const requests = [];
  try {
    // Package discovery reads direct installed dependencies from the app root.
    // The nested source example otherwise has only Vite cache files there, even
    // though Vite itself can resolve workspace imports through ancestor folders.
    await cp(exampleRoot, appDirectory, { recursive: true,
      filter: source => source !== join(exampleRoot, "node_modules") && source !== join(exampleRoot, "dist") });
    await symlink(fileURLToPath(new URL("../../../node_modules", import.meta.url)), join(appDirectory, "node_modules"), "dir");
    vite = startCapturedProcess(process.execPath, [
      fileURLToPath(new URL("../../../node_modules/vite/bin/vite.js", import.meta.url)),
      "--config", "vite.config.js", "--host=127.0.0.1", "--port=5176", "--strictPort", "--clearScreen=false"
    ], { cwd: appDirectory });
    await vite.waitFor(/http:\/\/127\.0\.0\.1:5176\//u);
    browser = await chromium.launch(createChromiumLaunchOptions());
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") diagnostics.push(message.text()); });
    page.on("requestfailed", request => diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`));
    page.on("request", request => {
      if (new URL(request.url()).pathname.startsWith("/api/")) requests.push({ method: request.method(), url: request.url() });
    });
    page.on("response", response => {
      if (response.status() >= 400) diagnostics.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(origin);
    const card = label => page.getByRole("region", { name: `${label} chat`, exact: true });
    const input = label => card(label).getByRole("textbox", { name: "Message AI assistant" });
    for (const label of ["Planning", "Notes", "Research", "Writing", "Review"]) {
      await expect(card(label)).toBeVisible();
      await expect(input(label)).toBeEnabled();
      await expect(card(label).getByRole("button", { name: `Voice chat with ${label}`, exact: true })).toBeEnabled();
    }
    await expect.poll(() => f.socketConnections()).toBe(1);
    await input("Notes").fill("Notes draft belongs to Notes.");
    await input("Planning").fill("Planning question from the mounted starter.");
    await input("Planning").press("Enter");
    await f.until(() => f.requests.length === 1, "the mounted Planning card's actual inference");
    assert.equal(f.requests[0].body.messages.at(-1).content, "Planning question from the mounted starter.");
    f.requests[0].text("Planning answer is streaming.");
    await expect(card("Planning").getByText("Planning answer is streaming.", { exact: true })).toBeVisible();
    await expect(input("Planning")).toHaveValue("");
    await input("Planning").fill("Planning draft survives closing its text view.");
    await card("Planning").getByRole("button", { name: "Voice chat with Planning", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Planning conversation", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("region", { name: "Conversation history", exact: true }))
      .toContainText("Planning question from the mounted starter.");
    await expect(dialog.getByRole("region", { name: "Conversation history", exact: true }))
      .toContainText("Planning answer is streaming.");
    await dialog.getByRole("button", { name: "Minimize conversation", exact: true }).click();
    await card("Planning").getByRole("button", { name: "Close Planning text view", exact: true }).click();
    await expect(card("Planning")).toHaveCount(0);
    await input("Notes").fill("Notes remains a different target.");
    f.requests[0].text(" Complete while its text view is closed.");
    f.requests[0].finish();
    await page.getByRole("button", { name: "Planning · Voice chat", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("region", { name: "Conversation history", exact: true }))
      .toContainText("Planning answer is streaming. Complete while its text view is closed.");
    await expect(dialog).not.toContainText("Notes remains a different target.");
    await dialog.getByRole("tab", { name: "Text", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(input("Planning")).toBeFocused();
    await expect(input("Planning")).toHaveValue("Planning draft survives closing its text view.");
    await expect(input("Notes")).toHaveValue("Notes remains a different target.");
    await expect(card("Planning").getByText("Planning answer is streaming. Complete while its text view is closed.", { exact: true }))
      .toBeVisible();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await input("Planning").scrollIntoViewIfNeeded();
      await expect(input("Planning")).toBeVisible();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `The actual starter must fit the ${width}px viewport`);
    }
    await page.getByRole("button", { name: "Planning · Voice chat", exact: true }).click();
    await dialog.getByRole("button", { name: "Close voice chat", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(input("Planning")).toHaveValue("Planning draft survives closing its text view.");
    assert.equal(f.socketConnections(), 1, "Five cards, voice retention and text remount share the original realtime connection");
    assert.equal(f.requests.length, 1, "Changing views never submits another inference");
    assert.deepEqual(errors, []);

    // Exercise the actual retained core presentation after the original starter
    // assertions. Capture/review operations themselves retain voiceReview's tests.
    await card("Planning").getByRole("button", { name: "Voice chat with Planning", exact: true }).click();
    await expect(dialog).toBeVisible();
    const panel = dialog.locator(".voice-host__body");
    const canonical = dialog.locator(".assistant-voice-conversation");
    const typed = canonical.getByRole("textbox", { name: "Message AI assistant" });
    const history = canonical.locator(".assistant-transcript__body");
    const projectSpeech = state => panel.evaluate((element, value) => {
      let component = element.__vueParentComponent;
      while (component && !component.props.controller) component = component.parent;
      const controllerState = component.props.controller.state;
      const { session, binding } = controllerState;
      if (value.busy !== undefined) controllerState.busy = value.busy;
      session.voice.captureState.value = value.partial ? "listening" : "idle";
      session.voice.partialTranscript.value = value.partial || "";
      if (value.review) {
        session.pendingTranscript.value = { messageId: "review-message", text: value.review,
          focus: binding.captureContext(), reviewBeforeSend: true };
        session.heldReview.value = true;
        session.error.value = "Delivery was not confirmed. Retry or discard.";
      }
      return session.pendingTranscript.value?.messageId;
    }, state);
    for (const width of [390, 800, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await panel.evaluate(element => {
        Object.assign(element.style, { width: "320px", height: "420px", flex: "0 0 auto" });
      });
      await expect(typed).toHaveValue("Planning draft survives closing its text view.");
      await expect(canonical.locator(".assistant-transcript__message-row--user")).toHaveCount(1);
      await expect(canonical.locator('[data-message-role="assistant"]')).toHaveCount(1);
      await projectSpeech({ partial: "These captured words are not sent." });
      await expect(canonical.getByRole("status", { name: "Recognized words", exact: true }))
        .toHaveText("Not sent · These captured words are not sent.");
      await expect(canonical.locator(".assistant-transcript__message-row--user")).toHaveCount(1);
      await projectSpeech({ review: "Review this recording independently." });
      const review = canonical.getByRole("region", { name: "Review voice message", exact: true });
      const recorded = review.getByRole("textbox", { name: "Review your message", exact: true });
      await recorded.fill("Edited speech stays separate.");
      assert.equal(await projectSpeech({}), "review-message", "Review edits retain the recording UUID");
      await expect(typed).toHaveValue("Planning draft survives closing its text view.");
      await expect(recorded).toHaveValue("Edited speech stays separate.");
      await projectSpeech({ busy: true });
      await expect(typed).toBeDisabled();
      await expect(recorded).toBeDisabled();
      await projectSpeech({ busy: false });
      await expect(typed).toBeEnabled();
      await expect(recorded).toBeEnabled();
      await expect(review.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
      await expect.poll(async () => (await history.boundingBox()).height).toBeGreaterThanOrEqual(100);
      const bounds = await panel.boundingBox();
      for (const control of [typed, recorded, review.getByRole("button", { name: "Discard", exact: true }), review.getByRole("button", { name: "Send", exact: true })]) {
        const box = await control.boundingBox();
        assert.ok(box.y >= bounds.y && box.y + box.height <= bounds.y + bounds.height + 1,
          "Typed input and recording recovery remain inside the short supplied container");
      }
      if (process.env.JSKIT_ASSISTANT_VOICE_BROWSER_ARTIFACTS) {
        await panel.screenshot({ path: join(process.env.JSKIT_ASSISTANT_VOICE_BROWSER_ARTIFACTS, `review-${width}.png`) });
      }
      await review.getByRole("button", { name: "Discard", exact: true }).click();
      await expect(review).toHaveCount(0);
      await expect(typed).toHaveValue("Planning draft survives closing its text view.");
      await expect(canonical.locator(".assistant-transcript__message-row--user")).toHaveCount(1);
      assert.equal(f.requests.length, 1, "Provisional capture, review edits and discard never submit a canonical message");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await typed.fill("Render the full answer in this same conversation.");
    await typed.press("Enter");
    await f.until(() => f.requests.length === 2, "canonical voice view's existing text submission");
    f.requests[1].text("A **formatted** answer with [help](https://example.com/help).");
    f.requests[1].finish();
    await expect(history.locator("strong").getByText("formatted", { exact: true })).toBeVisible();
    await expect(history.getByRole("link", { name: "help", exact: true })).toHaveAttribute("href", "https://example.com/help");
    await expect(canonical.locator(".assistant-transcript__message-row--user")).toHaveCount(2);
    await expect(canonical.locator('[data-message-role="assistant"]')).toHaveCount(2);
    assert.equal(f.socketConnections(), 1, "The canonical view retains the existing runtime and realtime connection");
    assert.deepEqual(errors, []);
  } catch (error) {
    const mounted = page && !page.isClosed() ? await page.evaluate(() => {
      const value = input => input?.__v_isRef ? input.value : input;
      return {
        surfaceConfig: globalThis.__JSKIT_CLIENT_APP_CONFIG__?.assistantSurfaces,
        voiceLayout: [...document.querySelectorAll(".assistant-voice-conversation > *, .assistant-voice__review, .assistant-voice-controls__tools")]
          .map(element => ({ class: element.className, height: element.getBoundingClientRect().height, scrollHeight: element.scrollHeight })),
        cards: [...document.querySelectorAll(".example__card")].map(card => {
          const input = card.querySelector("textarea");
          let component = card.querySelector(".assistant-client-conversation")?.__vueParentComponent;
          while (component && !component.exposed?.runtime) component = component.parent;
          const runtime = value(component?.exposed?.runtime);
          return { label: card.getAttribute("aria-label"), disabled: input?.disabled,
            visibleText: card.innerText.slice(0, 500),
            props: component ? { conversationId: component.props.conversationId, actorKey: component.props.actorKey,
              surfaceId: component.props.surfaceId, hostSurfaceId: component.props.hostSurfaceId,
              active: component.props.active, hasApi: Boolean(component.props.api) } : null,
            runtime: runtime ? { identity: runtime.identity, available: value(runtime.available),
              current: value(runtime.current), active: value(runtime.active), loading: value(runtime.loading),
              status: value(runtime.snapshot)?.status, error: value(runtime.error) } : null };
        })
      };
    }).catch(error => ({ diagnosticError: error.message })) : null;
    t.diagnostic(JSON.stringify({ errors, diagnostics, requests: requests.slice(-20), mounted,
      socketConnections: f.socketConnections(), vite: vite?.readOutput() }));
    throw error;
  } finally {
    try { await browser?.close(); }
    finally {
      try { await stopProcess(vite); }
      finally { await rm(appDirectory, { recursive: true, force: true }); }
    }
  }
});
