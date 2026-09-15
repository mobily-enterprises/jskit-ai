import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import {
  createChromiumLaunchOptions,
  startViteFixture,
  stopProcess
} from "../../../tooling/testUtils/browserFixture.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(TEST_DIRECTORY, "../fixtures/responsive-assistant");
const RUN_BROWSER_TEST = process.env.JSKIT_ASSISTANT_CORE_BROWSER_INTEGRATION === "1";
const VIEWPORTS = Object.freeze([
  Object.freeze({ name: "phone", width: 390, height: 844 }),
  Object.freeze({ name: "compact", width: 800, height: 900 }),
  Object.freeze({ name: "medium", width: 1224, height: 900 }),
  Object.freeze({ name: "expanded", width: 1365, height: 900 }),
  Object.freeze({ name: "short", width: 1280, height: 600 }),
  Object.freeze({ name: "drawer", width: 360, height: 600 })
]);

async function assertResponsiveAssistant(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message AI assistant" });
  await expect(input).toBeVisible();
  const body = page.locator(".assistant-transcript__body");
  await expect(page.getByText("Conversation line 70:", { exact: false })).toBeAttached();
  await expect.poll(() => body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const bounds = await input.boundingBox();
  assert.ok(bounds.y + bounds.height <= viewport.height);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await body.hover();
  await page.mouse.wheel(0, -600);
  await expect.poll(() => body.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeGreaterThan(100);
}

test("AssistantConversationElement keeps long conversations scrollable across responsive layouts", {
  skip: RUN_BROWSER_TEST
    ? false
    : "set JSKIT_ASSISTANT_CORE_BROWSER_INTEGRATION=1 to run assistant-core browser integration",
  timeout: 180_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  let browser = null;

  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    const context = await browser.newContext({
      baseURL: vite.baseURL,
      locale: "en-US"
    });
    const page = await context.newPage();

    for (const viewport of VIEWPORTS) {
      await assertResponsiveAssistant(page, viewport);
    }

    await context.close();
  } catch (error) {
    const fixtureOutput = vite.readOutput().trim();
    if (!fixtureOutput) {
      throw error;
    }
    throw new Error(
      `${error.message}\n\nAssistant fixture output:\n${fixtureOutput}`,
      { cause: error }
    );
  } finally {
    await browser?.close();
    await stopProcess(vite);
  }
});

test("conversation scrolling preserves history anchors and resets expansion on selection", {
  skip: !RUN_BROWSER_TEST,
  timeout: 60_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.goto(`${vite.baseURL}/?controls=1`);
    const body = page.locator(".assistant-transcript__body");
    await expect(page.getByText("Conversation line 70:", { exact: false })).toBeVisible();
    await body.hover();
    await page.mouse.wheel(0, -100_000);
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0);
    await page.getByRole("button", { name: "Read more", exact: true }).click();
    await expect(page.getByRole("button", { name: "Show less", exact: true })).toBeVisible();
    const original = page.getByText("Conversation line 1:", { exact: false }).first();
    const originalTop = (await original.boundingBox()).y;
    await page.getByRole("button", { name: "Load older messages", exact: true }).click();
    await expect.poll(async () => Math.abs((await original.boundingBox()).y - originalTop)).toBeLessThan(2);
    const before = await body.evaluate((element) => element.scrollTop);
    await page.getByRole("button", { name: "Append reply", exact: true }).click();
    await expect(page.getByText("New reply.", { exact: false })).toBeAttached();
    assert.equal(await body.evaluate((element) => element.scrollTop), before);
    await body.hover();
    await page.mouse.wheel(0, 100_000);
    await expect.poll(() => body.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(2);
    await page.getByRole("button", { name: "Append reply", exact: true }).click();
    await expect(page.getByText("New reply.", { exact: false })).toHaveCount(2);
    await expect.poll(() => body.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(2);
    await page.getByRole("button", { name: "Change conversation", exact: true }).click();
    await expect(page.getByRole("button", { name: "Show less", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Read more", exact: true })).toBeAttached();
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});

test("conversation composer preserves typing and reacts to external state and pane resizing", {
  skip: !RUN_BROWSER_TEST,
  timeout: 60_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
    await page.goto(`${vite.baseURL}/?conversation=1`);
    const input = page.getByRole("textbox", { name: "Message AI assistant" });
    const draft = "Keep this draft while the assistant changes state. This is a longer message to verify wrapping when the chat pane becomes narrower.";
    await input.fill(draft);
    await input.evaluate((element) => { element.focus(); element.setSelectionRange(10, 10); });
    for (const phase of ["active", "reconnecting", "stopping", "stopped", "idle"]) {
      // External events must not take focus like clicking a fixture button would.
      await page.getByRole("button", { name: `External ${phase}`, exact: true }).evaluate((element) => element.click());
      await expect(input).toHaveValue(draft);
      await expect(input).toBeFocused();
      await expect(input).toBeEnabled();
      assert.equal(await input.evaluate((element) => element.selectionStart), 10);
      const send = page.locator(".assistant-composer-actions__send");
      if (["reconnecting", "stopping"].includes(phase)) await expect(send).toBeDisabled();
      else await expect(send).toBeEnabled();
      if (phase === "active") await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
      if (phase === "stopping") await expect(page.getByRole("button", { name: "Stopping…", exact: true })).toBeDisabled();
      if (phase === "stopped") await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
    }
    const before = await input.evaluate((element) => element.clientHeight);
    await page.getByRole("button", { name: "Resize pane" }).evaluate((element) => element.click());
    await expect.poll(() => input.evaluate((element) => element.clientHeight)).toBeGreaterThan(before);
    await page.getByRole("button", { name: "Toggle action feedback" }).evaluate((element) => element.click());
    const feedback = page.getByText("Describe what you want to change.", { exact: true });
    await expect(feedback).toBeVisible();
    const sendBounds = await page.getByRole("button", { name: "Send", exact: true }).boundingBox();
    assert.ok(sendBounds.height >= 48, "Compact panes retain a 48px action target on desktop");
    assert.ok((await feedback.boundingBox()).y >= sendBounds.y + sendBounds.height, "Narrow action feedback follows the button");
    await expect(input).toBeFocused();
    await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    await expect(input).toHaveValue(draft);
    await input.press("Enter");
    await expect(page.locator("output")).toHaveText("active; submitted 1");
    await expect(input).toHaveValue("");
    for (const width of [390, 800, 1224]) {
      await page.setViewportSize({ width, height: 900 });
      await input.fill(draft);
      await expect(input).toBeVisible();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});
