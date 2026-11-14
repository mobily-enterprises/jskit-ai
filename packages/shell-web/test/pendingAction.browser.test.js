import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";

// A command button keeps keyboard focus while its action runs: ShellPageAction and ShellPrimaryAction with `pending`
// or `loading`, and any button with v-pending, read as unavailable, ignore a second activation and never hand focus to
// the page body, which is where a focused button that becomes `disabled` sends it in Chromium. Each test reaches the
// button with Tab, presses Enter, holds the action, then settles it.
const SKIP = process.env.JSKIT_SHELL_WEB_BROWSER_INTEGRATION === "1"
  ? false
  : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1 to check that pending actions keep keyboard focus";
const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/adaptive-shell");
const open = sharedBrowserFixture({ fixtureRoot: FIXTURE_ROOT, configFile: "vite.config.mjs" });
const COMPACT = Object.freeze({ width: 390, height: 844 });
const EXPANDED = Object.freeze({ width: 1280, height: 900 });

async function openPage(t, viewport, url) {
  const { vite, browser } = await open(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport, reducedMotion: "reduce" });
  await page.goto(url);
  return page;
}

// Records, at every frame until read, each time focus is on the page body (or nowhere).
async function watchFocus(page) {
  await page.evaluate(() => {
    const lost = [];
    let watching = true;
    const sample = () => {
      const active = document.activeElement;
      if (!active || active === document.body || active === document.documentElement) {
        lost.push(performance.now());
      }
      if (watching) {
        requestAnimationFrame(sample);
      }
    };
    requestAnimationFrame(sample);
    globalThis.jskitPendingFocusWatch = () => {
      watching = false;
      return lost.length;
    };
  });
  return () => page.evaluate(() => globalThis.jskitPendingFocusWatch());
}

// The button inside `locator` when it wraps one (a FAB), else the element itself.
function buttonOf(locator) {
  return locator.locator("xpath=self::button | self::a | .//button | .//a").first();
}

// Presses Tab until `locator` has focus, as a keyboard user reaches it.
async function tabTo(page, locator, { max = 80 } = {}) {
  for (let presses = 0; presses <= max; presses += 1) {
    if (await locator.evaluate((element) => element === document.activeElement).catch(() => false)) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${locator}`);
}

const presses = (page) => page.getByTestId("fixture-pending-presses");

// Tab to the action's button, press Enter, and check it while it runs: focused, unavailable, a second Enter ignored;
// then settle it and check focus stayed on it throughout.
async function checkPendingAction(page, { testId, name, running, idle }) {
  const button = buttonOf(page.getByTestId(testId));
  await tabTo(page, button);
  const framesOnBody = await watchFocus(page);
  await page.keyboard.press("Enter");
  await expect(presses(page)).toContainText(`${name}=1`);
  if (running) {
    await expect(button).toContainText(running);
  }
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-disabled", "true");
  await expect(button).not.toHaveAttribute("disabled");
  await page.keyboard.press("Enter");
  await page.keyboard.press(" ");
  await page.waitForTimeout(200);
  await expect(presses(page)).toContainText(`${name}=1`);
  await expect(button).toBeFocused();

  await page.evaluate((action) => globalThis.settleFixtureAction(action), name);
  if (idle) {
    await expect(button).toContainText(idle);
  }
  await expect(button).not.toHaveAttribute("aria-disabled", "true");
  await expect(button).toBeFocused();
  assert.equal(await framesOnBody(), 0, `focus fell to the page body while ${name} was pending`);
}

test("page actions keep focus while they run: `pending`, and the primary one with `loading`", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const page = await openPage(t, EXPANDED, "/home/pending");
  await expect(page.getByTestId("fixture-pending-sync")).toBeVisible();
  await checkPendingAction(page, { testId: "fixture-pending-sync", name: "sync", running: "Syncing…", idle: "Sync" });
  await checkPendingAction(page, { testId: "fixture-pending-save", name: "save" });
});

test("the screen's primary action keeps focus while it runs, as a FAB and as the bar's primary action", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  for (const viewport of [COMPACT, EXPANDED]) {
    const page = await openPage(t, viewport, "/home/pending");
    await expect(page.getByTestId("fixture-pending-send")).toBeVisible();
    await checkPendingAction(page, { testId: "fixture-pending-send", name: "send", running: "Sending…", idle: "Send" });
    await page.close();
  }
});

test("a dialog's v-pending action keeps focus, ignores a second press and focuses the field a refusal marks", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const page = await openPage(t, EXPANDED, "/home/pending-dialog");
  await tabTo(page, page.getByTestId("fixture-open-invite"));
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const send = page.getByTestId("fixture-send-invite");
  await tabTo(page, send, { max: 6 });
  const framesOnBody = await watchFocus(page);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("fixture-invite-presses")).toHaveText("1");
  await expect(send).toHaveText("Sending…");
  await expect(send).toBeFocused();
  await expect(send).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  await expect(page.getByTestId("fixture-invite-presses")).toHaveText("1");

  await page.evaluate(() => globalThis.settleFixtureInvite("Already invited."));
  await expect(dialog.getByText("Already invited.")).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Email" })).toBeFocused();
  assert.equal(await framesOnBody(), 0, "focus fell to the page body while Send invite was pending");

  // Accepted, focus stays on the button.
  await tabTo(page, send, { max: 6 });
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("fixture-invite-presses")).toHaveText("2");
  await page.evaluate(() => globalThis.settleFixtureInvite());
  await expect(send).toHaveText("Send invite");
  await page.waitForTimeout(100);
  await expect(send).toBeFocused();
});

test("a form's implicit submission does nothing while its v-pending submit button runs", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const page = await openPage(t, EXPANDED, "/home/pending-dialog");
  await page.getByTestId("fixture-open-invite").click();
  const name = page.getByRole("dialog").getByRole("textbox", { name: "Name" });
  await name.fill("Ada");
  await name.press("Enter");
  await expect(page.getByTestId("fixture-invite-presses")).toHaveText("1");
  await expect(page.getByTestId("fixture-send-invite")).toHaveText("Sending…");
  await name.press("Enter");
  await page.waitForTimeout(200);
  await expect(page.getByTestId("fixture-invite-presses")).toHaveText("1");
  await page.evaluate(() => globalThis.settleFixtureInvite());
  await expect(page.getByTestId("fixture-send-invite")).toHaveText("Send invite");
  // Focus was never on the button, so the settled action leaves it in the field.
  await expect(name).toBeFocused();
});
