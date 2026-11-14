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
const FIXTURE_ROOT = path.resolve(TEST_DIRECTORY, "../fixtures/app-environment-banner");
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

test("a development page shows the Development banner at every width, in light and dark, without taking a click", {
  skip: !RUN_BROWSER_TEST
}, async (t) => {
  const { vite, browser } = await startFixture(t, { APP_ENV: "development" });
  for (const colorScheme of ["light", "dark"]) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport, colorScheme });
      t.after(() => context.close());
      const page = await context.newPage();
      await page.goto(vite.baseURL);
      await page.waitForSelector("html[data-ready=true]");
      const label = `${colorScheme} ${viewport.name}`;
      const banner = page.getByTestId("jskit-app-environment-banner");
      assert.equal(await banner.textContent(), "Development", label);
      assert.equal(await page.getByRole("note").textContent(), "Development", `${label}: a note`);
      assert.equal(await banner.getAttribute("aria-description"), "Development: emails and messages are logged, not sent; payments use the sandbox.", label);
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

test("a test page shows Test and a staging page Staging, at the narrowest width; a production page shows none", {
  skip: !RUN_BROWSER_TEST
}, async (t) => {
  for (const [APP_ENV, expected] of [["test", "Test"], ["staging", "Staging"], ["production", null]]) {
    await t.test(APP_ENV, async (subtest) => {
      const { vite, browser } = await startFixture(subtest, { APP_ENV });
      const page = await browser.newPage({ viewport: VIEWPORTS[0] });
      await page.goto(vite.baseURL);
      await page.waitForSelector("html[data-ready=true]");
      const banner = page.getByTestId("jskit-app-environment-banner");
      if (expected === null) {
        assert.equal(await banner.count(), 0);
        return;
      }
      assert.equal(await banner.textContent(), expected);
      const box = await banner.boundingBox();
      assert.ok(box.width < VIEWPORTS[0].width / 2, `${APP_ENV}: small (${box.width})`);
      assert.equal(await page.getByLabel("Email").count(), 1, `${APP_ENV}: one Email match`);
    });
  }
});
