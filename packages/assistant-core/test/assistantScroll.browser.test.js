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

test("progress previews omit expandable details without hiding the current update", {
  skip: !RUN_BROWSER_TEST, timeout: 60_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    for (const width of [390, 800, 1365]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`${vite.baseURL}/?progress=1&detail=1`);
      const messages = page.locator(".assistant-progress__message");
      await expect(messages).toHaveCount(0);
      const toggle = page.locator(".assistant-progress__toggle");
      await expect(toggle).toHaveText("Show all 1 progress update");
      await page.getByRole("button", { name: "Add preview", exact: true }).click();
      await page.getByRole("button", { name: "Add detail", exact: true }).click();
      await expect(messages).toHaveText(["Checking the sources."]);
      await toggle.click();
      await expect(messages).toHaveText(["Full reasoning before the update", "Checking the sources.", "Full reasoning after the update"]);
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await toggle.click();
      await expect(messages).toHaveText(["Checking the sources."]);
      await page.getByRole("button", { name: "Toggle working", exact: true }).click();
      await expect(messages).toHaveCount(0);
      await toggle.click();
      await expect(messages).toHaveCount(3);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.close();
    }
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});

test("saved reply attribution remains when the current assistant changes", {
  skip: !RUN_BROWSER_TEST, timeout: 60_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.goto(`${vite.baseURL}/?conversation=1&attribution=1`);
    const names = page.locator('[data-message-role="assistant"] .assistant-transcript__message-header span');
    await expect(names).toHaveText(["First assistant", "Message assistant", "Current assistant"]);
    await expect(names.nth(0)).toHaveAttribute("title", "First model");
    await expect(names.nth(1)).toHaveAttribute("title", "Message model");
    await page.getByRole("button", { name: "Change assistant", exact: true }).click();
    await expect(names).toHaveText(["First assistant", "Message assistant", "Next assistant"]);
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});

test("streaming answers grow in one bubble, preserve drafts and settle once at every width", {
  skip: !RUN_BROWSER_TEST, timeout: 90_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    for (const width of [390, 800, 1365]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`${vite.baseURL}/?streaming=1`);
      const input = page.getByRole("textbox", { name: "Message AI assistant" });
      await input.fill("Keep this draft");
      await input.evaluate(element => element.setSelectionRange(2, 5));
      const receive = () => page.getByRole("button", { name: "Receive text" }).evaluate(element => element.click());
      await receive();
      const answer = page.locator(".assistant-transcript__body").getByText("Growing answer.", { exact: true });
      await expect(answer).toHaveCount(1);
      await receive();
      await expect(page.getByText("Growing answer. Growing answer.", { exact: true })).toHaveCount(1);
      await expect(input).toBeFocused();
      assert.deepEqual(await input.evaluate(element => [element.selectionStart, element.selectionEnd]), [2, 5]);
      await page.getByRole("button", { name: "Finish answer" }).evaluate(element => element.click());
      await expect(page.getByText("Growing answer. Growing answer.", { exact: true })).toHaveCount(1);
      await expect(input).toHaveValue("Keep this draft");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.close();
    }
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});

test("adjacent reasoning stays grouped across storage rows, history pages and execution changes", {
  skip: !RUN_BROWSER_TEST,
  timeout: 90_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    for (const width of [390, 800, 1365]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${vite.baseURL}/?progress=1`);
      const groups = page.locator(".assistant-progress");
      const summaries = page.locator(".assistant-progress__message");
      const input = page.getByRole("textbox", { name: "Message AI assistant" });
      const external = name => page.getByRole("button", { name, exact: true }).evaluate(element => element.click());
      await expect(groups).toHaveCount(1);
      await expect(summaries).toHaveText(["Reasoning 2", "Reasoning 3"]);
      await input.fill("Keep my draft");
      await input.evaluate(element => element.setSelectionRange(2, 5));
      await external("Change storage rows");
      await expect(groups).toHaveCount(1);
      await expect(summaries).toHaveText(["Reasoning 2", "Reasoning 3"]);
      await external("Change storage rows");
      await external("Toggle working");
      await expect(summaries).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Show all 3 progress updates" })).toBeVisible();
      await external("Toggle working");
      await expect(summaries).toHaveText(["Reasoning 2", "Reasoning 3"]);
      await external("Show all 3 progress updates");
      await expect(summaries).toHaveCount(3);
      await external("Load older messages");
      await expect(groups).toHaveCount(1);
      await expect(summaries).toHaveText(["Older reasoning", "Reasoning 1", "Reasoning 2", "Reasoning 3"]);
      await external("Append thinking");
      await expect(summaries).toHaveCount(5);
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("Keep my draft");
      assert.deepEqual(await input.evaluate(element => [element.selectionStart, element.selectionEnd]), [2, 5]);
      await external("Show latest 2 progress updates");
      await external("Toggle working");
      await expect(summaries).toHaveCount(0);
      await external("Show all 5 progress updates");
      await external("Change conversation");
      await expect(summaries).toHaveCount(0);
      await external("Toggle working");

      // Every visible non-reasoning message separates groups, regardless of rows.
      for (const [index, role] of ["commentary", "assistant", "user", "system"].entries()) {
        await external(`Append ${role}`);
        await expect(summaries).toHaveCount(0);
        await external("Append thinking");
        await external("Append thinking");
        await expect(groups).toHaveCount(index + 2);
        await expect(summaries).toHaveCount(2);
      }
      await external("Change storage rows");
      await expect(groups).toHaveCount(5);
      await expect(summaries).toHaveCount(2);
      const bodyText = await page.locator(".assistant-transcript__body").textContent();
      assert.ok(bodyText.indexOf("commentary 6") < bodyText.indexOf("assistant 9"));
      assert.ok(bodyText.indexOf("assistant 9") < bodyText.indexOf("user 12"));
      assert.ok(bodyText.indexOf("user 12") < bodyText.indexOf("system 15"));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});

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
    // User input cancels startup following; a scrollTop assignment does not.
    // Automatic history loading may preserve an anchor above scrollTop zero.
    await body.hover();
    await page.mouse.wheel(0, -100_000);
    await expect(page.getByRole("button", { name: "Read more", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Read more", exact: true }).click();
    await expect(page.getByRole("button", { name: "Show less", exact: true })).toBeVisible();
    const original = page.getByText("Conversation line 1:", { exact: false }).first();
    const originalTop = (await original.boundingBox()).y;
    // Measure history anchoring without Playwright first scrolling to the button.
    await page.getByRole("button", { name: "Load older messages", exact: true }).evaluate(element => element.click());
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
    await expect(body).toBeVisible();
    await expect(page.locator(".assistant-transcript__settling")).toHaveCount(0);
    await page.evaluate(() => {
      window.revealPlaceholders = 0;
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType === 1 && node.matches(".assistant-transcript__settling")) window.revealPlaceholders += 1;
        }
      }).observe(document.querySelector(".assistant-transcript"), { childList: true, subtree: true });
    });
    await page.getByRole("button", { name: "Toggle visibility", exact: true }).click();
    await page.getByRole("button", { name: "Append reply", exact: true }).click();
    await page.getByRole("button", { name: "Toggle visibility", exact: true }).click();
    await expect(body).toBeVisible();
    await expect.poll(() => body.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(2);
    assert.equal(await page.evaluate(() => window.revealPlaceholders), 0, "reopening loaded text does not flash a loading placeholder");
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});

test("a delayed final history page preserves the visible message at every width", {
  skip: !RUN_BROWSER_TEST,
  timeout: 60_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    for (const width of [390, 800, 1365]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`${vite.baseURL}/?controls=1&history=1&paged-history=1`);
      const body = page.locator(".assistant-transcript__body");
      await expect(body).toBeVisible();
      await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
      await body.evaluate(element => {
        element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -1000 }));
        element.scrollTop = 0;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await expect(page.getByRole("button", { name: "Loading older messages…", exact: true })).toBeDisabled();
      const anchor = page.getByText("user message 21.", { exact: false });
      const before = (await anchor.boundingBox()).y;
      await page.getByRole("button", { name: "Complete history load", exact: true }).evaluate(element => element.click());
      await expect(page.getByText("user message 1.", { exact: false })).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Loading older messages…", exact: true })).toHaveCount(0);
      await expect.poll(async () => Math.abs((await anchor.boundingBox()).y - before)).toBeLessThan(2);
      await expect(page.locator("output")).toHaveText("History requests: 1");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.close();
    }
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});

test("upward scrolling loads older history once and preserves retry and selection behavior", {
  skip: !RUN_BROWSER_TEST,
  timeout: 90_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    for (const width of [390, 800, 1365]) {
      const touch = width < 1000;
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: touch, isMobile: touch });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${vite.baseURL}/?controls=1&history=1`);
      const body = page.locator(".assistant-transcript__body");
      const requests = page.locator("output");
      const external = name => page.getByRole("button", { name, exact: true }).evaluate(element => element.click());
      await expect(page.getByText("Conversation line 70:", { exact: false })).toBeVisible();
      await expect(requests).toHaveText("History requests: 0");
      // Detach from initial follow before positioning above the history boundary.
      await body.hover();
      await page.mouse.wheel(0, -100);
      await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeGreaterThan(50);
      await body.evaluate(element => { element.scrollTop = 420; });
      await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(420);
      await expect(requests).toHaveText("History requests: 0");
      if (touch) {
        const bounds = await body.boundingBox();
        const cdp = await page.context().newCDPSession(page);
        const x = bounds.x + bounds.width / 2;
        const y = bounds.y + 40;
        const stopped = body.evaluate(element => new Promise(resolve => {
          element.addEventListener("scrollend", () => resolve(), { once: true });
        }));
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        for (let offset = 20; offset <= 380; offset += 20) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + offset }] });
          await page.evaluate(() => new Promise(requestAnimationFrame));
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await stopped;
        await cdp.detach();
      } else {
        await body.hover();
        await page.mouse.wheel(0, -380);
      }
      const pending = page.getByRole("button", { name: "Loading older messages…", exact: true });
      await expect(pending).toBeDisabled();
      await expect(requests).toHaveText("History requests: 1");
      // Repeated events while waiting must not issue another request.
      await body.evaluate(element => {
        element.dispatchEvent(new Event("scroll"));
        element.dispatchEvent(new Event("scroll"));
      });
      const original = page.getByText("Conversation line 1:", { exact: false }).first();
      const originalTop = (await original.boundingBox()).y;
      await external("Complete history load");
      await expect(pending).toHaveCount(0);
      await expect.poll(async () => Math.abs((await original.boundingBox()).y - originalTop)).toBeLessThan(2);
      await expect(requests).toHaveText("History requests: 1");

      // Keyboard navigation also requests older history.
      await body.focus();
      await body.press("Home");
      await expect(requests).toHaveText("History requests: 2");
      await external("Fail history load");
      await expect(page.getByText("History unavailable", { exact: true })).toBeVisible();
      await body.press("ArrowDown");
      await body.press("Home");
      await expect(requests).toHaveText("History requests: 2");
      await page.getByRole("button", { name: "Load older messages", exact: true }).click();
      await expect(requests).toHaveText("History requests: 3");
      await external("Complete history load");
      await expect(page.getByText("History unavailable", { exact: true })).toHaveCount(0);

      await external("Change conversation");
      await expect(page.getByText("Conversation line 70:", { exact: false })).toBeVisible();
      await expect(requests).toHaveText("History requests: 3");
      await external("Exhaust history");
      await expect.poll(async () => {
        await body.focus();
        return body.evaluate(element => document.activeElement === element);
      }).toBe(true);
      await body.press("Home");
      await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(0);
      await expect(requests).toHaveText("History requests: 3");
      await expect(page.getByRole("button", { name: "Load older messages", exact: true })).toHaveCount(0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});

test("retained hidden transcripts preserve readers and follow only at the latest message", {
  skip: !RUN_BROWSER_TEST,
  timeout: 90_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    for (const width of [390, 800, 1365]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`${vite.baseURL}/?controls=1&history=1&retain-hidden=1&initial-hidden=1`);
      const body = page.locator(".assistant-transcript__body");
      const external = name => page.getByRole("button", { name, exact: true }).evaluate(element => element.click());
      await expect(body).toBeAttached();
      await expect(body).toBeHidden();
      await external("Toggle visibility");
      await expect(body).toBeVisible();
      await expect(page.locator(".assistant-transcript__settling")).toHaveCount(0);
      await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
      const draft = page.getByRole("textbox", { name: "Message AI assistant", exact: true });
      await draft.fill("Keep my typed draft");
      await body.hover();
      await page.mouse.wheel(0, -1000);
      await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeGreaterThan(50);
      await body.evaluate(element => { element.scrollTop = 420; });
      await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(420);
      await body.evaluate(element => {
        window.retainedBody = element;
        const top = element.getBoundingClientRect().top;
        const anchor = [...element.querySelectorAll(".assistant-transcript__turn")].find(turn => turn.getBoundingClientRect().bottom > top);
        window.retainedAnchor = { element: anchor, offset: anchor.getBoundingClientRect().top - top };
      });
      await external("Toggle visibility");
      await expect(body).toBeHidden();
      await external("Append reply");
      // Hidden zero-geometry events must not change following or fetch history.
      await body.evaluate(element => element.dispatchEvent(new Event("scroll")));
      await expect(page.locator("output")).toHaveText("History requests: 0");
      await external("Toggle visibility");
      await expect(body).toBeVisible();
      assert.equal(await body.evaluate(element => element === window.retainedBody), true);
      await expect.poll(() => body.evaluate(element => Math.abs(window.retainedAnchor.element.getBoundingClientRect().top - element.getBoundingClientRect().top - window.retainedAnchor.offset))).toBeLessThan(2);
      await expect(draft).toHaveValue("Keep my typed draft");
      await body.hover();
      await page.mouse.wheel(0, 100_000);
      await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
      await external("Toggle visibility");
      await external("Append reply");
      await external("Toggle visibility");
      await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
      await body.hover();
      await page.mouse.wheel(0, -1000);
      await external("Toggle visibility");
      await external("Change conversation");
      await external("Toggle visibility");
      await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
      await expect(page.locator(".assistant-transcript__settling")).toHaveCount(0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.close();
    }
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});

test("transient update errors keep the loaded transcript, reader, draft and focus in a compact banner", {
  skip: !RUN_BROWSER_TEST,
  timeout: 90_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    for (const width of [390, 800, 1365]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`${vite.baseURL}/?controls=1&history=1&update-errors=1`);
      const body = page.locator(".assistant-transcript__body");
      const draft = page.getByRole("textbox", { name: "Message AI assistant", exact: true });
      const external = name => page.getByRole("button", { name, exact: true }).evaluate(element => element.click());
      await expect(page.locator(".assistant-transcript__settling")).toHaveCount(0);
      await draft.fill("Keep my draft while updates reconnect.");
      await body.hover();
      await page.mouse.wheel(0, -1000);
      await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeGreaterThan(50);
      await body.evaluate(element => { element.scrollTop = 420; window.updateErrorBody = element; });
      await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(420);
      await draft.evaluate(element => {
        element.focus({ preventScroll: true });
        element.setSelectionRange(2, 7);
        window.updateErrorDraft = element;
      });
      const rows = await body.locator(".assistant-transcript__turn").count();
      await external("Show update error");
      const banner = page.locator(".assistant-transcript__error");
      await expect(banner).toContainText("Conversation updates are temporarily unavailable. Reload to reconnect; the assistant may still be working.");
      await expect(banner.getByRole("button", { name: "Reload chat", exact: true })).toBeVisible();
      await expect(body).toBeVisible();
      assert.equal(await body.evaluate(element => element === window.updateErrorBody), true);
      await expect(body.locator(".assistant-transcript__turn")).toHaveCount(rows);
      await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(420);
      await expect(draft).toHaveValue("Keep my draft while updates reconnect.");
      await expect(draft).toBeFocused();
      assert.deepEqual(await draft.evaluate(element => [element === window.updateErrorDraft, element.selectionStart, element.selectionEnd]), [true, 2, 7]);
      const transcriptBox = await page.locator(".assistant-transcript").boundingBox();
      const bannerBox = await banner.boundingBox();
      const bodyBox = await body.boundingBox();
      assert.ok(bannerBox.height < transcriptBox.height / 3);
      assert.ok(bodyBox.height > transcriptBox.height / 2);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await banner.getByRole("button", { name: "Reload chat", exact: true }).click();
      await expect(banner).toHaveCount(0);
      await expect(page.locator(".assistant-conversation")).toHaveAttribute("data-error-reloads", "1");
      assert.equal(await body.evaluate(element => element === window.updateErrorBody), true);
      await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(420);
      await expect(draft).toHaveValue("Keep my draft while updates reconnect.");
      await expect(page.locator("output")).toHaveText("History requests: 0");
      await body.hover();
      await page.mouse.wheel(0, 100_000);
      await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
      await external("Show update error");
      await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
      await banner.getByRole("button", { name: "Reload chat", exact: true }).click();
      await expect(banner).toHaveCount(0);
      await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
      await expect(page.locator(".assistant-conversation")).toHaveAttribute("data-error-reloads", "2");
      await page.close();
    }
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});

test("retained hidden history loads restore their original anchor and invalidate retired requests", {
  skip: !RUN_BROWSER_TEST,
  timeout: 90_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    for (const width of [390, 800, 1365]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const body = page.locator(".assistant-transcript__body");
      const external = name => page.getByRole("button", { name, exact: true }).evaluate(element => element.click());
      const load = async () => {
        await page.goto(`${vite.baseURL}/?controls=1&history=1&paged-history=1&retain-hidden=1`);
        await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
        await body.evaluate(element => {
          element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -1000 }));
          element.scrollTop = 0;
          element.dispatchEvent(new Event("scroll", { bubbles: true }));
        });
        await expect(page.getByRole("button", { name: "Loading older messages…", exact: true })).toBeDisabled();
      };
      await load();
      const anchor = page.getByText("user message 21.", { exact: false });
      const before = (await anchor.boundingBox()).y;
      await body.evaluate(element => { window.retainedBody = element; });
      await external("Toggle visibility");
      await external("Complete history load");
      await expect(page.getByText("user message 1.", { exact: false })).toHaveCount(1);
      await expect(body).toBeHidden();
      await external("Toggle visibility");
      assert.equal(await body.evaluate(element => element === window.retainedBody), true);
      await expect(body).toBeVisible();
      await expect.poll(async () => Math.abs((await anchor.boundingBox()).y - before)).toBeLessThan(2);
      await expect(page.locator("output")).toHaveText("History requests: 1");

      await load();
      const errorScrollTop = await body.evaluate(element => element.scrollTop);
      await external("Toggle visibility");
      await external("Fail history load");
      await external("Toggle visibility");
      await expect(page.getByText("History unavailable", { exact: true })).toBeVisible();
      assert.equal(await body.evaluate(element => element.scrollTop), errorScrollTop, "unchanged/error completion preserves the original scrollTop while showing recovery");
      await page.getByRole("button", { name: "Load older messages", exact: true }).evaluate(element => element.click());
      await expect(page.locator("output")).toHaveText("History requests: 2");
      await external("Toggle visibility");
      await external("Change conversation");
      await external("Complete history load");
      await external("Toggle visibility");
      await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);

      await load();
      await body.evaluate(element => { window.retiredBody = element; });
      await external("Toggle visibility");
      await external("Toggle mount");
      await external("Complete history load");
      await external("Toggle mount");
      await external("Toggle visibility");
      await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
      assert.equal(await body.evaluate(element => element === window.retiredBody), false);
      await expect(page.locator("output")).toHaveText("History requests: 1");
      await page.close();
    }
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

test("working state appears before output and suggestion agents and activity rendering are replaceable", {
  skip: !RUN_BROWSER_TEST,
  timeout: 60_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${vite.baseURL}/?conversation=1&support=1`);
    const input = page.getByRole("textbox", { name: "Message AI assistant" });
    await page.getByRole("button", { name: "Use suggestion: Suggestion from small-model", exact: true }).hover();
    await expect(input).toHaveAttribute("placeholder", "Suggestion from small-model");
    await expect(input).toHaveValue("");
    await page.getByRole("button", { name: "Change suggestion model" }).click();
    await page.getByRole("button", { name: "Use suggestion: Suggestion from other-model", exact: true }).click();
    await expect(input).toHaveValue("Suggestion from other-model");
    await expect(input).toBeFocused();
    await input.press("Enter");
    const activity = page.locator(".assistant-composer-support__assistant-status");
    await expect(activity).toHaveText("Assistant is working…");
    await expect(page.locator(".assistant-composer-support__sr-status")).toHaveText("Assistant is working…");
    await input.fill("Keep typing while waiting");
    await input.evaluate(element => element.setSelectionRange(5, 11));
    await page.getByRole("button", { name: "Custom activity", exact: true }).evaluate(element => element.click());
    await expect(activity).toHaveText("Custom activity: Assistant is working…");
    await expect(input).toBeFocused();
    assert.deepEqual(await input.evaluate(element => [element.selectionStart, element.selectionEnd]), [5, 11]);
    await page.getByRole("button", { name: "External stopping", exact: true }).evaluate(element => element.click());
    await expect(activity).toHaveText("Custom activity: Stopping…");
    await page.getByRole("button", { name: "External stopped", exact: true }).evaluate(element => element.click());
    await expect(activity).toHaveCount(0);
    await expect(input).toHaveValue("Keep typing while waiting");
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});


test("optional goals show running and paused lights, count only active time, and adapt to pane width", {
  skip: !RUN_BROWSER_TEST,
  timeout: 60_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await page.goto(`${vite.baseURL}/?conversation=1&goal=1`);
    const input = page.getByRole("textbox", { name: "Message AI assistant" });
    await page.getByRole("button", { name: "Set goal", exact: true }).click();
    await page.clock.runFor(250);
    await page.getByRole("textbox", { name: "Goal objective" }).fill("Complete the shared assistant.");
    await page.getByRole("spinbutton", { name: "Token budget (optional)" }).fill("10000");
    await page.getByRole("button", { name: "Start goal", exact: true }).click();
    await expect(page.getByText("Complete the shared assistant.", { exact: true })).toBeVisible();
    await input.click();
    await input.fill("Preserve this draft and caret");
    await input.evaluate(element => element.setSelectionRange(5, 9));
    const light = page.locator(".assistant-goal__light");
    await expect(light).toHaveCSS("background-color", "rgb(211, 47, 47)");
    await expect(light).toHaveCSS("animation-name", /^assistant-goal-flash/u);
    const elapsed = page.locator(".assistant-goal__elapsed");
    await page.clock.fastForward(65_000);
    await expect(elapsed).toHaveText("1:05");
    await expect(input).toBeFocused();
    assert.deepEqual(await input.evaluate(element => [element.selectionStart, element.selectionEnd]), [5, 9]);
    await page.getByRole("button", { name: "Goal running", exact: true }).click();
    await page.clock.runFor(250);
    await page.getByRole("button", { name: "Pause goal", exact: true }).click();
    await expect(light).toHaveCSS("background-color", "rgb(239, 108, 0)");
    await expect(light).toHaveCSS("animation-name", "none");
    const pausedTime = await elapsed.textContent();
    await page.clock.fastForward(120_000);
    await expect(elapsed).toHaveText(pausedTime);
    await page.getByRole("button", { name: "Resume goal", exact: true }).click();
    await page.clock.fastForward(5_000);
    await expect(elapsed).toHaveText("1:10");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(light).toHaveCSS("animation-name", "none");
    await expect(light).toHaveCSS("background-color", "rgb(211, 47, 47)");
    await input.click();
    await page.getByRole("button", { name: "Resize pane" }).click();
    await expect(elapsed).toBeHidden();
    await expect(light).toBeVisible();
    await page.getByRole("button", { name: "Goal running", exact: true }).click();
    await page.clock.runFor(250);
    await expect(page.getByText("Running time: 1:10", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Toggle goals" }).evaluate(element => element.click());
    await expect(page.locator(".assistant-goal")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pause goal", exact: true })).toBeHidden();
    await expect(input).toHaveValue("Preserve this draft and caret");
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});


test("shared model choices and file delivery preserve a responsive composer", {
  skip: !RUN_BROWSER_TEST,
  timeout: 60_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${vite.baseURL}/?conversation=1&capabilities=1`);
    const input = page.getByRole("textbox", { name: "Message AI assistant" });
    await page.getByRole("button", { name: "Choose AI", exact: true }).click();
    const model = page.getByRole("combobox", { name: "Choose model", exact: true });
    await model.click();
    await model.press("ControlOrMeta+A");
    await model.press("Backspace");
    await model.pressSequentially("Model 3");
    await page.getByRole("option", { name: "Model 3", exact: true }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByText("Model: model-2; sent files:", { exact: true })).toBeVisible();
    await input.click();
    await input.fill("Read these files");
    await page.locator('input[type="file"]').setInputFiles([
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("First file") },
      { name: "tasks.txt", mimeType: "text/plain", buffer: Buffer.from("Second file") }
    ]);
    await expect(page.getByText("0 of 2 ready · 50%", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await input.fill("Keep editing while files upload");
    await input.evaluate(element => element.setSelectionRange(5, 9));
    await page.getByRole("button", { name: "Finish uploads", exact: true }).evaluate(element => element.click());
    await expect(page.getByText("2 of 2 ready", { exact: true })).toBeVisible();
    await expect(input).toBeFocused();
    assert.deepEqual(await input.evaluate(element => [element.selectionStart, element.selectionEnd]), [5, 9]);
    await page.getByRole("button", { name: "Remove notes.txt", exact: true }).click();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Model: model-2; sent files: tasks.txt", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Message attachments", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Choose AI", exact: true }).click();
    await expect(model).toBeDisabled();
    await expect(page.getByText("AI choices are view-only while the assistant is working.", { exact: true })).toBeVisible();
    await input.fill("The next message stays editable");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});

test("an optional avatar clamps in a short conversation without consuming its preference or draft", {
  skip: !RUN_BROWSER_TEST, timeout: 90_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    for (const width of [390, 800, 1365]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`${vite.baseURL}/?conversation=1&avatar=1&avatarTools=1&capabilities=1`);
      const panel = page.locator(".fixture");
      const input = page.getByRole("textbox", { name: "Message AI assistant" });
      const body = page.locator(".assistant-transcript__body");
      const artwork = page.locator(".assistant-conversation__avatar-visual");
      const sizeControl = page.getByRole("button", { name: /^(Show|Minimise) avatar$/u });
      await expect(page.getByRole("button", { name: "Avatar size", exact: true })).toHaveCount(0);
      const avatarTool = page.getByRole("button", { name: "Avatar tool", exact: true, includeHidden: true });
      await expect(sizeControl).toHaveCount(1);
      assert.equal(await sizeControl.evaluate(element => Boolean(element.closest(".assistant-conversation__composer"))), false,
        "Avatar visibility stays outside the original composer");
      assert.equal(await avatarTool.evaluate(element => Boolean(element.closest(".assistant-conversation__avatar"))), true,
        "Avatar tools share the artwork region outside the composer");
      const selectSize = async name => {
        await page.getByRole("combobox", { name: "Avatar preference", exact: true }).selectOption(name.toLowerCase());
        await expect(page.getByText(`Avatar requested: ${name.toLowerCase()}`, { exact: true })).toBeVisible();
      };
      const assertComposerFits = async () => {
        const bounds = await panel.boundingBox();
        const send = await page.getByRole("button", { name: "Send", exact: true }).boundingBox();
        const feedback = await page.getByText("Describe what you want to change.", { exact: true }).boundingBox();
        const avatarButton = await sizeControl.boundingBox();
        const toolBounds = await avatarTool.boundingBox();
        assert.ok(send.y + send.height <= bounds.y + bounds.height + 1, "Send stays inside the supplied container");
        assert.ok(feedback.y + feedback.height <= bounds.y + bounds.height + 1, "Feedback stays inside the supplied container");
        assert.ok((await input.boundingBox()).height >= 40);
        const avatarExpanded = await sizeControl.getAttribute("aria-expanded") === "true";
        assert.equal(avatarButton.width, avatarExpanded ? 40 : 44, "Expanded minimise is compact; collapsed Show retains its wider target");
        assert.ok(avatarButton.height >= 44, "Avatar visibility retains its original target height");
        assert.ok(toolBounds.width >= 48 && toolBounds.height >= 48, "Avatar tools retain a reachable touch target");
        await expect.poll(async () => (await body.boundingBox()).height, { message: "The short container retains readable history" }).toBeGreaterThanOrEqual(100);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      };
      assert.equal(Math.round((await panel.boundingBox()).width), 320);
      assert.equal(Math.round((await panel.boundingBox()).height), 420);
      await expect.poll(async () => (await artwork.boundingBox()).height).toBeGreaterThan(64);
      assert.ok((await artwork.boundingBox()).height <= 96, "Compact artwork preserves the existing short-container clamp");
      await page.getByRole("button", { name: "Resize height", exact: true }).evaluate(element => element.click());
      await expect(artwork).toHaveCSS("height", "96px");
      await page.getByRole("button", { name: "Resize height", exact: true }).evaluate(element => element.click());
      await expect.poll(async () => (await panel.boundingBox()).height).toBe(420);
      await expect(page.locator(".assistant-conversation__avatar")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      const chatBounds = await page.locator(".assistant-conversation").boundingBox();
      const faceBounds = await artwork.boundingBox();
      const hideBounds = await sizeControl.boundingBox();
      assert.equal(faceBounds.y, chatBounds.y, "The face starts at the top of the chat without a controls row above it");
      const avatarToolBounds = await avatarTool.boundingBox();
      assert.ok(Math.abs(hideBounds.y + hideBounds.height / 2 - avatarToolBounds.y - avatarToolBounds.height / 2) < 1,
        "The round minimise control shares the tools row below the face");
      assert.equal(hideBounds.x, avatarToolBounds.x + avatarToolBounds.width, "Minimise directly follows the supplied tools without a gap");
      await expect(sizeControl).toHaveText("");
      await expect(sizeControl.locator('.assistant-conversation__avatar-size-disc')).toHaveCSS('border-radius', '50%');
      await expect(page.locator('[data-message-role="assistant"]')).toHaveCount(20);
      await page.evaluate(() => {
        window.avatarElements = [document.querySelector(".assistant-conversation"), document.querySelector("textarea"), document.querySelector(".assistant-transcript__body")];
        window.avatarTool = document.querySelector(".assistant-conversation__avatar-presentation .fixture-avatar-tool");
      });
      await input.fill("Keep my typed support question.");
      await input.evaluate(element => element.setSelectionRange(5, 9));
      const compactAvatarBounds = await artwork.boundingBox();
      const composerBounds = [await input.boundingBox(), await page.getByRole("button", { name: "Send", exact: true }).boundingBox()];
      const fixtureLayout = await panel.evaluate(element => ({
        panel: element.getBoundingClientRect().toJSON(),
        controls: document.querySelector(".controls").getBoundingClientRect().toJSON()
      }));
      await body.evaluate(element => { element.scrollTop = 100; });
      assert.deepEqual(await artwork.boundingBox(), compactAvatarBounds, "The avatar stays fixed within the chat while messages scroll behind it");
      const before = await body.evaluate(element => element.scrollTop);
      await selectSize("Large");
      await expect.poll(async () => (await artwork.boundingBox()).height).toBeLessThan(176);
      await assertComposerFits();
      assert.equal(await body.evaluate(element => element.scrollTop), before, "Avatar resizing leaves a scrolled-up reader in place");
      await selectSize("Hidden");
      await expect(artwork).toHaveCount(0);
      await expect(sizeControl).toBeVisible();
      const showBounds = await sizeControl.boundingBox();
      assert.equal(showBounds.width, 44, "Collapsed Show retains its original wider target");
      assert.ok(showBounds.height >= 44);
      const collapsedControls = await page.locator(".assistant-conversation__avatar-controls").boundingBox();
      assert.equal(collapsedControls.y, chatBounds.y, "The collapsed controls stay at the chat top");
      assert.equal(showBounds.y + showBounds.height / 2, collapsedControls.y + collapsedControls.height / 2,
        "Show aligns with the existing taller host control in the top row");
      assert.equal(showBounds.x + showBounds.width, chatBounds.x + chatBounds.width, "Show stays at the chat right edge");
      await expect(avatarTool).toHaveCount(1);
      await expect(avatarTool).toBeHidden();
      await expect(page.getByRole("button", { name: "Retained avatar control", exact: true })).toBeVisible();
      assert.equal(await page.evaluate(() => window.avatarTool.isConnected), true, "Hiding retains the local tools target");
      if (process.env.JSKIT_ASSISTANT_CORE_BROWSER_ARTIFACTS) {
        await page.screenshot({ path: path.join(process.env.JSKIT_ASSISTANT_CORE_BROWSER_ARTIFACTS, `hidden-${width}.png`) });
      }
      assert.deepEqual([await input.boundingBox(), await page.getByRole("button", { name: "Send", exact: true }).boundingBox()], composerBounds,
        `Collapsing changes no original input or Send rectangle: ${JSON.stringify({ before: fixtureLayout, after: await panel.evaluate(element => ({
          panel: element.getBoundingClientRect().toJSON(), controls: document.querySelector(".controls").getBoundingClientRect().toJSON()
        })) })}`);
      await page.getByRole("button", { name: "Show avatar", exact: true }).click();
      await expect(page.getByText("Avatar requested: large", { exact: true })).toBeVisible();
      await expect(avatarTool).toBeVisible();
      assert.deepEqual([await input.boundingBox(), await page.getByRole("button", { name: "Send", exact: true }).boundingBox()], composerBounds,
        "Showing the last visible size changes no original input or Send rectangle");
      await page.getByRole("button", { name: "Minimise avatar", exact: true }).click();
      await selectSize("Standard");
      await expect(avatarTool).toBeVisible();
      await expect(avatarTool).toHaveAttribute("data-size", "standard");
      assert.equal(await avatarTool.evaluate(element => element === window.avatarTool), true, "Showing reuses the original tools node");
      await expect.poll(async () => (await artwork.boundingBox()).height).toBeGreaterThan(0);
      await selectSize("Large");
      await input.focus();
      await input.evaluate(element => element.setSelectionRange(5, 9));
      await expect(input).toBeFocused();
      const resize = () => page.getByRole("button", { name: "Resize height", exact: true }).evaluate(element => element.click());
      await resize();
      await expect(artwork).toHaveCSS("height", "176px");
      await resize();
      await expect.poll(async () => (await artwork.boundingBox()).height).toBeLessThan(176);
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("Keep my typed support question.");
      assert.deepEqual(await input.evaluate(element => [element.selectionStart, element.selectionEnd]), [5, 9]);
      await expect(page.getByText("Avatar requested: large", { exact: true })).toBeVisible();
      assert.equal(await body.evaluate(element => element.scrollTop), before);
      await page.getByRole("button", { name: "Toggle questions", exact: true }).evaluate(element => element.click());
      const answer = page.getByRole("textbox", { name: "[1] What should happen next?", exact: true });
      await expect(answer).toBeVisible();
      await answer.fill("Recover my account.");
      await assertComposerFits();
      await page.getByRole("button", { name: "Answer normally instead", exact: true }).click();
      await expect(answer).toHaveCount(0);
      await input.fill("Keep my typed support question.");
      await page.locator('input[type="file"]').setInputFiles({ name: "account.txt", mimeType: "text/plain", buffer: Buffer.from("Account recovery notes") });
      await page.getByRole("button", { name: "Finish uploads", exact: true }).click();
      await expect(page.getByText("1 of 1 ready", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Show attachment error", exact: true }).click();
      await expect(page.getByText("An upload failed. Retry or remove it.", { exact: true })).toBeVisible();
      await assertComposerFits();
      await expect(input).toHaveValue("Keep my typed support question.");
      await page.getByRole("button", { name: "Remove account.txt", exact: true }).click();
      await page.getByRole("button", { name: "Toggle avatar slot", exact: true }).evaluate(element => element.click());
      await expect(sizeControl).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Conversation avatar", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Toggle avatar slot", exact: true }).evaluate(element => element.click());
      await expect(sizeControl).toBeVisible();
      await expect(page.getByText("Avatar requested: large", { exact: true })).toBeVisible();
      assert.equal(await page.evaluate(() => window.avatarElements.every(element => element.isConnected)), true, "Sizing and slot changes retain the same conversation, input and transcript nodes");
      await expect(page.locator('[data-message-role="assistant"]')).toHaveCount(20);
      await expect(page.getByText("idle; submitted 0", { exact: true })).toBeVisible();
      await page.close();
    }
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});


test("unsent preview edits stay in their bubble and disappear for the canonical message", {
  skip: !RUN_BROWSER_TEST, timeout: 60_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 844 } });
    await page.goto(`${vite.baseURL}/?conversation=1&preview=1`);
    const input = page.getByRole("textbox", { name: "Message AI assistant" });
    const discard = page.getByRole("button", { name: "Discard unsent message", exact: true });
    const edit = page.getByRole("button", { name: "Edit unsent message", exact: true });
    await page.getByRole("button", { name: "External active", exact: true }).click();
    await input.fill("Keep this typed draft");
    await page.getByRole("button", { name: "Add temporary message", exact: true }).click();
    const bubble = page.locator(".assistant-transcript__message--user");
    await expect(bubble).toContainText("Exact temporary words");
    await expect(bubble.getByRole("button", { name: "Discard unsent message" })).toBeVisible();
    await expect(edit).toBeEnabled();
    await expect(discard).toBeEnabled();
    await page.getByRole("button", { name: "Toggle preview eligibility" }).click();
    await expect(discard).toBeDisabled();
    await page.getByRole("button", { name: "Toggle preview eligibility" }).click();
    await discard.click();
    await expect(bubble).toHaveCount(0);
    await expect(input).toHaveValue("Keep this typed draft");
    await page.getByRole("button", { name: "Add temporary message", exact: true }).click();
    await page.getByRole("button", { name: "Reject preview", exact: true }).click();
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toContainText("No active turn; explicit Edit may author a new message.");
    await expect(bubble.locator(".assistant-transcript__optimistic-actions")).toHaveCount(0);
    await expect(bubble.locator(".assistant-conversation__preview-actions")).toHaveCount(1);
    await expect(edit).toBeEnabled();
    await edit.click();
    await expect(bubble).not.toContainText("No active turn; explicit Edit may author a new message.");
    const editor = bubble.getByRole("textbox", { name: "Review your message" });
    const send = bubble.getByRole("button", { name: "Send", exact: true });
    await expect(editor).toHaveValue("Exact temporary words");
    await expect(input).toHaveValue("Keep this typed draft");
    await expect(page.getByRole("textbox")).toHaveCount(2);
    await expect(bubble.locator(".assistant-conversation__preview-actions")).toHaveCount(1);
    await editor.fill("");
    await expect(editor).toHaveValue("");
    await expect(bubble).toHaveCount(1);
    await expect(send).toBeDisabled();
    await editor.fill("Corrected speech\nwith a second line");
    await expect(send).toBeEnabled();
    await expect(input).toHaveValue("Keep this typed draft");
    await send.click();
    await expect(bubble).toContainText("Corrected speech");
    await expect(editor).toHaveCount(0);
    await expect(discard).toHaveCount(0);
    await expect(input).toHaveValue("Keep this typed draft");
    await page.reload();
    await input.fill("Keep this typed draft");
    await page.getByRole("button", { name: "External active", exact: true }).click();
    await page.getByRole("button", { name: "Add temporary message", exact: true }).click();
    await page.getByRole("button", { name: "Unadmitted preview" }).click();
    await expect(bubble).toHaveCount(1);
    await edit.click();
    await expect(bubble.getByRole("textbox", { name: "Review your message" })).toHaveValue("Exact temporary words");
    await expect(input).toHaveValue("Keep this typed draft");
    await page.getByRole("button", { name: "Accept preview" }).click();
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toContainText("Exact temporary words");
    await expect(discard).toHaveCount(0);
    await expect(edit).toHaveCount(0);
    await expect(input).toHaveValue("Keep this typed draft");
    await expect(page.locator("output").last()).toHaveText("active; submitted 0");
    for (const recovery of ["edit", "discard"]) {
      await page.reload();
      await input.fill("Keep this typed draft");
      await page.getByRole("button", { name: "External active", exact: true }).click();
      await page.getByRole("button", { name: "Add temporary message", exact: true }).click();
      await page.getByRole("button", { name: "Reject preview", exact: true }).click();
      await page.getByRole("button", { name: "Add newer temporary message", exact: true }).click();
      await expect(bubble).toHaveCount(2);
      const retained = bubble.first();
      const newer = bubble.last();
      await expect(retained).toContainText("No active turn; explicit Edit may author a new message.");
      await expect(retained.locator(".assistant-transcript__optimistic-actions")).toHaveCount(0);
      await expect(newer).toContainText("Keep newer live words");
      await expect(newer.getByRole("button", { name: "Edit unsent message", exact: true })).toBeDisabled();
      await expect(newer.getByRole("button", { name: "Discard unsent message", exact: true })).toBeEnabled();
      if (recovery === "edit") {
        await retained.getByRole("button", { name: "Edit unsent message", exact: true }).click();
        await expect(newer).toContainText("Keep newer live words");
        const retainedEditor = retained.getByRole("textbox", { name: "Review your message" });
        await expect(retainedEditor).toHaveValue("Exact temporary words");
        await retainedEditor.fill("Edited retained words");
        await expect(input).toHaveValue("Keep this typed draft");
        await retained.getByRole("button", { name: "Send", exact: true }).click();
        await expect(retained).toContainText("Edited retained words");
        await expect(retained.getByRole("button", { name: "Edit unsent message", exact: true })).toHaveCount(0);
        await expect(bubble).toHaveCount(2);
        await expect(newer).toContainText("Keep newer live words");
      } else {
        await retained.getByRole("button", { name: "Discard unsent message", exact: true }).click();
        await expect(bubble).toHaveCount(1);
        await expect(bubble).toContainText("Keep newer live words");
      }
      const current = bubble.last();
      await expect(current.getByRole("button", { name: "Edit unsent message", exact: true })).toBeEnabled();
      await expect(input).toHaveValue("Keep this typed draft");
      await current.getByRole("button", { name: "Discard unsent message", exact: true }).click();
      await expect(bubble).toHaveCount(recovery === "edit" ? 1 : 0);
      await expect(input).toHaveValue("Keep this typed draft");
    }
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});


test("pending history keeps following the reader when a new reply changes transcript height", {
  skip: !RUN_BROWSER_TEST,
  timeout: 90_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    for (const width of [390, 1365]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${vite.baseURL}/?controls=1&history=1`);
      const body = page.locator(".assistant-transcript__body");
      const requests = page.locator("output");
      const external = name => page.getByRole("button", { name, exact: true }).evaluate(element => element.click());
      await expect(page.getByText("Conversation line 70:", { exact: false })).toBeVisible();
      await body.hover();
      await page.mouse.wheel(0, -100);
      await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeGreaterThan(50);
      await body.evaluate(element => { element.scrollTop = 420; });
      await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(420);
      await page.mouse.wheel(0, -324);
      const pending = page.getByRole("button", { name: "Loading older messages…", exact: true });
      await expect(pending).toBeDisabled();
      await expect(requests).toHaveText("History requests: 1");
      const height = await body.evaluate(element => element.scrollHeight);
      await external("Append reply");
      await expect.poll(() => body.evaluate(element => element.scrollHeight)).toBeGreaterThan(height);
      await expect.poll(async () => {
        await body.focus();
        return body.evaluate(element => document.activeElement === element);
      }).toBe(true);
      await body.press("Home");
      await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(0);
      const original = page.getByText("Conversation line 1:", { exact: false }).first();
      const originalTop = (await original.boundingBox()).y;
      await external("Complete history load");
      await expect(pending).toHaveCount(0);
      await expect.poll(async () => Math.abs((await original.boundingBox()).y - originalTop)).toBeLessThan(2);
      await expect(requests).toHaveText("History requests: 1");
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.close();
    }
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});
