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
    // Keep the explicit button path covered independently of automatic loading.
    await body.evaluate(element => { element.scrollTop = 0; });
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
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        for (let offset = 20; offset <= 380; offset += 20) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + offset }] });
          await page.evaluate(() => new Promise(requestAnimationFrame));
        }
        const stopped = body.evaluate(element => new Promise(resolve => {
          element.addEventListener("scrollend", () => resolve(), { once: true });
        }));
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
      await body.focus();
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
    await page.goto(`${vite.baseURL}/?conversation=1&goal=1`);
    const input = page.getByRole("textbox", { name: "Message AI assistant" });
    await page.getByRole("button", { name: "Set goal", exact: true }).click();
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
