import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

const fixtureRoot = fileURLToPath(new URL("../fixtures/conversation/", import.meta.url));

test("ready-made assistant preserves streaming, drafts, scope and compact conversation access", {
  skip: process.env.JSKIT_ASSISTANT_RUNTIME_BROWSER_INTEGRATION !== "1",
  timeout: 180_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const input = page.getByRole("textbox", { name: "Message AI assistant" });
  const send = page.getByRole("button", { name: "Send message", exact: true });
  const advance = (query = "") => page.request.get(`${vite.baseURL}/fixture/next${query}`);
  const requestState = async () => (await page.request.get(`${vite.baseURL}/fixture/state`)).json();
  try {
    await page.goto(vite.baseURL);
    await expect(input).toBeEnabled();
    await input.fill("First request");
    await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    assert.equal((await requestState()).requests.length, 0);
    await input.press("Enter");
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    await expect(input).toHaveValue("");
    await expect(page.getByLabel("Fixture assistant progress")).toBeVisible();
    await expect(send).toBeDisabled();
    await input.fill("Draft typed while streaming. Keep my selection.");
    await input.evaluate((element) => { element.focus(); element.setSelectionRange(6, 11); window.fixtureInput = element; });
    await advance();
    await expect(page.getByText("Partial answer", { exact: true })).toBeVisible();
    await expect(input).toBeFocused();
    assert.deepEqual(await input.evaluate((element) => [element === window.fixtureInput, element.selectionStart, element.selectionEnd]), [true, 6, 11]);
    await advance("?finish=1");
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
    await expect(input).toHaveValue("Draft typed while streaming. Keep my selection.");
    await expect(page.getByText("Partial answer completed.", { exact: true })).toHaveCount(1);
    await expect(page.getByText("never-render-this-payload", { exact: false })).toHaveCount(0);
    assert.equal((await requestState()).requests.length, 1);
    assert.equal((await requestState()).requests[0].surface, "admin");

    await input.fill("Partial failure");
    await send.click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    await advance();
    await advance("?fail=1");
    await expect(page.getByText("Fixture provider failed.", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Partial answer", { exact: true })).toBeVisible();
    await input.fill("Failure before answer");
    await send.click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    await advance("?fail=1");
    await expect(input).toHaveValue("Failure before answer");
    await expect(send).toBeEnabled();

    await send.click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    await input.fill("Preserve this after cancellation");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByText("Response canceled. A tool already running may still finish.")).toBeVisible();
    await expect(input).toHaveValue("Preserve this after cancellation");
    await expect.poll(async () => (await requestState()).streams.at(-1).closed).toBe(true);

    await input.fill("Old workspace request");
    await send.click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    await input.fill("Old workspace draft");
    await page.getByRole("button", { name: "Switch workspace", exact: true }).click();
    await expect(input).toHaveValue("");
    await expect(page.getByText("Old workspace request", { exact: true })).toHaveCount(0);
    await expect.poll(async () => (await requestState()).streams.at(-1).closed).toBe(true);
    await advance("?finish=1");
    await expect(page.getByText("Partial answer completed.", { exact: true })).toHaveCount(0);
    await input.fill("New workspace request");
    await send.click();
    await expect.poll(async () => (await requestState()).requests.at(-1).path).toContain("/beta/");
    await page.getByRole("button", { name: "Toggle view", exact: true }).click();
    await expect(input).toHaveCount(0);
    await expect.poll(async () => (await requestState()).streams.at(-1).closed).toBe(true);
    await page.getByRole("button", { name: "Toggle view", exact: true }).click();
    await expect(input).toBeVisible();
    await page.getByRole("button", { name: "Conversations", exact: true }).click();
    await expect(page.getByText("Saved conversation", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Load older conversations" }).click();
    await expect(page.getByText("Older conversation", { exact: true })).toBeVisible();
    await page.getByText("Saved conversation", { exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Conversations", exact: true })).toHaveCount(0);
    await expect(page.getByText("Saved 1 message 70.", { exact: false })).toBeVisible();
    await expect(page.getByText("Identical text", { exact: true })).toHaveCount(2);

    const screenshots = process.env.JSKIT_ASSISTANT_SCREENSHOTS;
    if (screenshots) await mkdir(screenshots, { recursive: true });
    for (const viewport of [{ width: 390, height: 844 }, { width: 800, height: 800 }, { width: 1280, height: 900 }, { width: 1280, height: 600 }, { width: 360, height: 600 }]) {
      await page.setViewportSize(viewport);
      await expect(input).toBeVisible();
      const bounds = await input.boundingBox();
      assert.ok(bounds.y + bounds.height <= viewport.height, JSON.stringify({ viewport, bounds }));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const sendBounds = await send.boundingBox();
      assert.ok(sendBounds.y + sendBounds.height <= viewport.height);
      if (viewport.width <= 600) assert.ok(sendBounds.height >= 48);
      await expect(page.getByRole("button", { name: "Conversations", exact: true })).toBeVisible();
      if (screenshots) await page.screenshot({ path: `${screenshots}/runtime-${viewport.width}-${viewport.height}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    const draft = "A long draft that remains focused while the pane narrows. ".repeat(4);
    await input.fill(draft);
    await input.evaluate((element) => { element.focus(); element.setSelectionRange(7, 7); });
    const before = await input.evaluate((element) => element.clientHeight);
    await page.getByRole("button", { name: "Resize pane" }).evaluate((element) => element.click());
    await expect.poll(() => input.evaluate((element) => element.clientHeight)).toBeGreaterThan(before);
    await expect(input).toBeFocused();
    await page.getByRole("button", { name: "Toggle theme" }).click();
    if (screenshots) await page.screenshot({ path: `${screenshots}/runtime-dark-drawer.png` });
    await page.getByRole("button", { name: "Second instance" }).click();
    await expect(input).toHaveCount(2);
    await expect(input.first()).toHaveValue(draft);
    await expect(input.last()).toHaveValue("");
    await input.last().fill("Second instance draft");
    await expect(input.first()).toHaveValue(draft);
    await page.getByRole("button", { name: "Second instance" }).click();
    await page.getByRole("button", { name: "Switch surface", exact: true }).click();
    await expect(input).toHaveValue("");
    await expect(page.getByText("Saved 1 message 70.", { exact: false })).toHaveCount(0);
    await input.fill("Private draft before switching user");
    await send.click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Switch user", exact: true }).click();
    await expect(input).toHaveValue("");
    await expect(page.getByText("Private draft before switching user", { exact: true })).toHaveCount(0);
    await expect.poll(async () => (await requestState()).streams.at(-1).closed).toBe(true);
    assert.deepEqual(errors, []);
  } catch (error) {
    throw new Error(`${error.message}\nPage errors: ${JSON.stringify(errors)}\n${vite.readOutput()}`, { cause: error });
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});

test("history restores preserve new typing and reject obsolete pages and failed automatic restores", {
  skip: process.env.JSKIT_ASSISTANT_RUNTIME_BROWSER_INTEGRATION !== "1",
  timeout: 60_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  const page = await browser.newPage();
  const input = page.getByRole("textbox", { name: "Message AI assistant" });
  const send = page.getByRole("button", { name: "Send message", exact: true });
  const selectSaved = async () => {
    await page.getByRole("button", { name: "Conversations", exact: true }).click();
    await page.getByText("Saved conversation", { exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Conversations", exact: true })).toHaveCount(0);
  };
  let release;
  let restoreRequests = 0;
  try {
    const held = new Promise((resolve) => { release = resolve; });
    await page.route("**/conversations/1/messages?**", async (route) => {
      restoreRequests += 1;
      await held;
      await route.fulfill({ json: { data: { type: "assistant-conversation-messages", id: "1", attributes: {
        entries: [{ id: "delayed", kind: "chat", role: "assistant", contentText: "Obsolete restored answer" }], totalPages: 2
      } } } });
    });
    await page.goto(vite.baseURL);
    await selectSaved();
    await expect.poll(() => restoreRequests).toBe(1);
    await input.fill("Written during history restore");
    await expect(send).toBeDisabled();
    await page.getByRole("button", { name: "Switch workspace", exact: true }).click();
    await expect(page).toHaveURL(/workspace=beta/);
    await expect(input).toHaveValue("");
    await input.fill("New workspace draft");
    release();
    await page.unrouteAll({ behavior: "wait" });
    await expect(input).toHaveValue("New workspace draft");
    await expect(send).toBeEnabled();
    assert.equal(restoreRequests, 1, "An obsolete restore must not fetch its second page in the new scope");
    await expect(page.getByText("Obsolete restored answer", { exact: true })).toHaveCount(0);

    let finishRestore;
    const pending = new Promise((resolve) => { finishRestore = resolve; });
    await page.route("**/conversations/1/messages?**", async (route) => {
      await pending;
      await route.continue();
    });
    await selectSaved();
    await input.fill("Keep typing while selected history loads");
    await expect(send).toBeDisabled();
    finishRestore();
    await expect(page.getByText("Saved 1 message 70.", { exact: false })).toBeVisible();
    await expect(input).toHaveValue("Keep typing while selected history loads");
    await expect(send).toBeEnabled();
    await page.unrouteAll({ behavior: "wait" });

    let failRestore;
    const failure = new Promise((resolve) => { failRestore = resolve; });
    let failedRequests = 0;
    await page.route("**/conversations/1/messages?**", async (route) => {
      failedRequests += 1;
      await failure;
      await route.fulfill({ status: 403, json: { error: "Conversation unavailable." } });
    });
    await page.reload();
    await expect.poll(() => failedRequests).toBe(1);
    await input.fill("Typed during automatic restore");
    failRestore();
    await expect(send).toBeEnabled();
    await expect(input).toHaveValue("Typed during automatic restore");
    await page.getByRole("button", { name: "Conversations", exact: true }).click();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText("Saved conversation", { exact: true })).toBeVisible();
    assert.equal(failedRequests, 1, "A failed automatic restore must require explicit selection to retry");
  } finally {
    release?.();
    await browser.close();
    await stopProcess(vite);
  }
});

test("page assistant bounds long history in a document layout and preserves drafts when workspace metadata arrives", {
  skip: process.env.JSKIT_ASSISTANT_RUNTIME_BROWSER_INTEGRATION !== "1",
  timeout: 60_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  const page = await browser.newPage();
  try {
    await page.goto(`${vite.baseURL}/?page=1`);
    await page.getByRole("button", { name: "Conversations", exact: true }).click();
    await page.getByRole("dialog", { name: "Conversations", exact: true }).getByText("Saved conversation", { exact: true }).click();
    await expect(page.getByText("Saved 1 message 70.", { exact: false })).toBeVisible();
    const input = page.getByRole("textbox", { name: "Message AI assistant" });
    for (const viewport of [{ width: 390, height: 844 }, { width: 800, height: 800 }, { width: 1280, height: 600 }]) {
      await page.setViewportSize(viewport);
      await expect.poll(async () => {
        const bounds = await input.boundingBox();
        return bounds.y + bounds.height;
      }).toBeLessThanOrEqual(viewport.height);
      assert.ok(await page.getByLabel("Conversation messages", { exact: true }).evaluate(element => element.scrollHeight > element.clientHeight));
    }
    await input.fill("Keep this draft while workspace details load.");
    await input.evaluate(element => { element.focus(); element.setSelectionRange(5, 9); });
    await page.getByRole("button", { name: "Load workspace metadata" }).evaluate(element => element.click());
    await expect(input).toHaveValue("Keep this draft while workspace details load.");
    await expect(input).toBeFocused();
    assert.deepEqual(await input.evaluate(element => [element.selectionStart, element.selectionEnd]), [5, 9]);
    await expect(page.getByText("Saved 1 message 70.", { exact: false })).toBeVisible();
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});


test("the ready-made UI streams from the real chat service with selected AI connections and files", {
  skip: process.env.JSKIT_ASSISTANT_RUNTIME_BROWSER_INTEGRATION !== "1", timeout: 90_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  try {
    await page.request.get(`${vite.baseURL}/fixture/service`);
    await page.goto(`${vite.baseURL}/?files=1`);
    const input = page.getByRole("textbox", { name: "Message AI assistant" });
    await expect(input).toBeEnabled();
    await page.getByRole("button", { name: "Choose AI", exact: true }).click();
    await page.getByRole("button", { name: "Deep model", exact: true }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("notes") });
    await expect(page.getByText("notes.txt", { exact: true })).toBeVisible();
    await input.fill("Read the notes");
    await input.press("Enter");
    await expect(page.getByText("Assistant is working…", { exact: true }).last()).toBeVisible();
    await expect(page.getByLabel("Message attachments")).toHaveCount(0);
    await expect(page.getByLabel("Attached files")).toBeVisible();
    await input.fill("My next draft");
    await input.evaluate(element => element.setSelectionRange(3, 7));
    await page.request.get(`${vite.baseURL}/fixture/next`);
    await expect(page.getByText("Partial answer", { exact: true })).toBeVisible();
    await expect(input).toHaveValue("My next draft");
    assert.deepEqual(await input.evaluate(element => [element.selectionStart, element.selectionEnd]), [3, 7]);
    let state = await (await page.request.get(`${vite.baseURL}/fixture/state`)).json();
    assert.equal(state.requests[0].integrationId, "deep");
    assert.deepEqual(state.requests[0].attachmentIds, ["fixture-file"]);
    assert.equal(state.transcript.filter(message => message.role === "assistant").length, 0);
    await page.request.get(`${vite.baseURL}/fixture/next?finish=1`);
    await expect(page.getByText("Partial answer completed.", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Assistant is working…", { exact: true })).toHaveCount(0);
    state = await (await page.request.get(`${vite.baseURL}/fixture/state`)).json();
    assert.deepEqual(state.transcript[0].metadata.attachments, [{ attachmentId: "fixture-file", fileName: "notes.txt", size: 5 }]);
    assert.equal(state.transcript.filter(message => message.role === "assistant").length, 1);
  } finally { await browser.close(); await stopProcess(vite); }
});
