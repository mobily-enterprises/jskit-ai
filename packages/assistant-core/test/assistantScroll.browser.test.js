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
  Object.freeze({ name: "phone", width: 390, height: 844, sidePanelsVisible: false }),
  Object.freeze({ name: "compact", width: 800, height: 900, sidePanelsVisible: false }),
  Object.freeze({ name: "medium", width: 1224, height: 900, sidePanelsVisible: true }),
  Object.freeze({ name: "expanded", width: 1365, height: 900, sidePanelsVisible: true })
]);

async function readLayoutMetrics(page) {
  return page.evaluate(() => {
    const root = document.querySelector(".assistant-client-element");
    const layout = document.querySelector(".assistant-layout");
    const mainColumn = document.querySelector(".assistant-main-col");
    const sideColumn = document.querySelector(".assistant-side-col");
    const messages = document.querySelector(".messages-panel");
    const composer = document.querySelector(".assistant-composer-shell");
    const history = document.querySelector(".assistant-history-card");
    const tools = document.querySelector(".assistant-tools-card");
    const rect = (element) => element?.getBoundingClientRect() || null;

    return {
      viewportHeight: window.innerHeight,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      root: rect(root),
      layout: rect(layout),
      mainColumn: rect(mainColumn),
      sideColumn: rect(sideColumn),
      messages: {
        ...rect(messages),
        clientHeight: messages?.clientHeight || 0,
        scrollHeight: messages?.scrollHeight || 0,
        scrollTop: messages?.scrollTop || 0
      },
      composer: rect(composer),
      sideColumnDisplay: sideColumn ? window.getComputedStyle(sideColumn).display : "missing",
      historyDisplay: history ? window.getComputedStyle(history).display : "missing",
      toolsDisplay: tools ? window.getComputedStyle(tools).display : "missing"
    };
  });
}

async function assertResponsiveAssistant(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto("/", { waitUntil: "networkidle" });

  const root = page.getByTestId("assistant-client-element");
  const messages = page.getByTestId("assistant-messages-panel");
  const compactConversationControl = page.getByRole("button", { name: "Conversations", exact: true });
  await root.waitFor({ state: "visible" });

  const metrics = await readLayoutMetrics(page);
  assert.ok(
    metrics.messages.scrollHeight > metrics.messages.clientHeight,
    `${viewport.name}: messages did not become an internal scroll container.`
  );
  assert.ok(metrics.composer, `${viewport.name}: composer was not rendered.`);
  assert.ok(
    metrics.composer.bottom <= metrics.viewportHeight + 1,
    `${viewport.name}: composer bottom ${metrics.composer.bottom}px exceeded the ${metrics.viewportHeight}px viewport.`
  );
  assert.ok(
    metrics.root.bottom <= metrics.viewportHeight + 1,
    `${viewport.name}: assistant root escaped the viewport.`
  );
  assert.ok(
    metrics.mainColumn.bottom <= metrics.root.bottom + 1,
    `${viewport.name}: main column escaped its bounded root.`
  );
  assert.ok(metrics.documentOverflow <= 1, `${viewport.name}: page overflowed horizontally.`);

  if (viewport.sidePanelsVisible) {
    assert.equal(metrics.sideColumnDisplay, "flex", `${viewport.name}: sidebar column was hidden.`);
    assert.equal(metrics.historyDisplay, "flex", `${viewport.name}: conversation history was hidden.`);
    assert.equal(metrics.toolsDisplay, "flex", `${viewport.name}: tool timeline was hidden.`);
    await expect(compactConversationControl).toBeHidden();
  } else {
    assert.equal(metrics.sideColumnDisplay, "none", `${viewport.name}: sidebar column still occupied the layout.`);
    await expect(compactConversationControl).toBeVisible();
  }

  await messages.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await messages.hover();
  await page.mouse.wheel(0, 420);
  await expect.poll(() => messages.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
}

test("AssistantClientElement keeps long conversations scrollable across responsive layouts", {
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
