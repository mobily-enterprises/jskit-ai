import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import {
  createChromiumLaunchOptions,
  startViteFixture,
  stopProcess
} from "../../../tooling/testUtils/browserFixture.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(TEST_DIRECTORY, "../fixtures/test-copy-banner");
const RUN_BROWSER_TEST = process.env.JSKIT_SHELL_WEB_BROWSER_INTEGRATION === "1";
const VIEWPORTS = Object.freeze([
  { name: "compact", width: 360, height: 740 },
  { name: "medium", width: 768, height: 1024 },
  { name: "expanded", width: 1280, height: 800 }
]);

function channel(value) {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(color) {
  const [red, green, blue] = String(color).match(/[\d.]+/gu).map(Number);
  return channel(red) * 0.2126 + channel(green) * 0.7152 + channel(blue) * 0.0722;
}

function contrast(first, second) {
  const [light, dark] = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (light + 0.05) / (dark + 0.05);
}

// The fixture's server and a browser for one test, stopped in its after hooks, which run on a failure or timeout too.
async function startFixture(t, env) {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT, env });
  t.after(() => stopProcess(vite));
  const browser = await chromium.launch(createChromiumLaunchOptions());
  t.after(() => browser.close());
  return { vite, browser };
}

test("a simulating page shows the Test copy banner at every width, in light and dark, without taking a click", {
  skip: !RUN_BROWSER_TEST
}, async (t) => {
  const { vite, browser } = await startFixture(t, { SIDE_EFFECTS: "" });
  for (const colorScheme of ["light", "dark"]) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport, colorScheme });
      t.after(() => context.close());
      const page = await context.newPage();
      await page.goto(vite.baseURL);
      await page.waitForSelector("html[data-ready=true]");
      const label = `${colorScheme} ${viewport.name}`;
      const banner = page.getByTestId("jskit-test-copy-banner");
      assert.equal(await banner.textContent(), "Test copy", label);
      assert.equal(await page.getByRole("note").textContent(), "Test copy", `${label}: a note`);
      assert.equal(await banner.getAttribute("aria-description"), "Test copy: emails, messages and payments are simulated, not sent.", label);
      // An application's inexact field lookup finds only its Email field, never the banner whose sentence says emails.
      assert.equal(await page.getByLabel("Email").count(), 1, `${label}: one Email match`);
      assert.equal(await page.getByLabel("Email").getAttribute("id"), "email", `${label}: the Email field`);
      const box = await banner.boundingBox();
      assert.equal(box.y, 0, `${label}: hangs from the top edge`);
      assert.ok(Math.abs(box.x + box.width / 2 - viewport.width / 2) <= 1, `${label}: centred`);
      assert.ok(box.width < viewport.width / 2 && box.height <= 24, `${label}: small (${box.width}x${box.height})`);
      const style = await banner.evaluate((element) => {
        const computed = getComputedStyle(element);
        return { color: computed.color, background: computed.backgroundColor, pointerEvents: computed.pointerEvents };
      });
      assert.equal(style.pointerEvents, "none", label);
      assert.ok(contrast(style.color, style.background) >= 4.5, `${label}: readable (${contrast(style.color, style.background)})`);
      // A press on the banner reaches the control beneath it.
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      assert.equal(await page.locator("#under-banner").textContent(), "Pressed 1 times", label);
      await context.close();
    }
  }
});

test("a live page has no banner", { skip: !RUN_BROWSER_TEST }, async (t) => {
  const { vite, browser } = await startFixture(t, { SIDE_EFFECTS: "live" });
  const page = await browser.newPage();
  await page.goto(vite.baseURL);
  await page.waitForSelector("html[data-ready=true]");
  assert.equal(await page.getByTestId("jskit-test-copy-banner").count(), 0);
});
