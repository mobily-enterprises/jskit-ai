import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";

// The page behind an open modal dialog is inert, as the WAI-ARIA dialog pattern has it and as the scrim already has it
// for the pointer: ShellLayout's app bar, navigation, main and FAB take no focus and are left out of the accessibility
// tree and of axe's checks, while Vuetify's overlay layer (the dialog, a menu opened in it, a second dialog, a
// snackbar) stays live. When the dialog closes the page is live again and focus is back on the element that opened it.
const SKIP = process.env.JSKIT_SHELL_WEB_BROWSER_INTEGRATION === "1"
  ? false
  : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1 to check the page behind a dialog is inert";
const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/adaptive-shell");
// axe-core as the page runs it, with every WCAG 2.2 A and AA rule, target-size included, and the best practices.
const AXE_PATH = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const STRICT_AXE_TAGS = Object.freeze(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]);
const open = sharedBrowserFixture({ fixtureRoot: FIXTURE_ROOT, configFile: "vite.config.mjs" });
const COMPACT = Object.freeze({ width: 390, height: 844 });
const EXPANDED = Object.freeze({ width: 1280, height: 900 });

async function openNotes(t, viewport) {
  const { vite, browser } = await open(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport, reducedMotion: "reduce" });
  await page.goto("/home/notes");
  await expect(page.getByTestId("fixture-note-edit")).toBeVisible();
  return page;
}

// The button inside `locator` when it wraps one (a FAB), else the element itself.
function buttonOf(locator) {
  return locator.locator("xpath=self::button | self::a | .//button | .//a").first();
}

// Focuses an element and presses Enter on it, as a keyboard user activates it.
async function activate(locator) {
  await locator.focus();
  await expect(locator).toBeFocused();
  await locator.press("Enter");
}

// The parts of the page ShellLayout makes inert, and whether each is.
function readPageParts(page) {
  return page.evaluate(() => [...document.querySelectorAll("[data-shell-page]")].map((part) => part.inert));
}

// Every part of the page, the app bar, the navigation and main at least, inert or else live.
async function expectPageInert(page, inert, message) {
  await expect.poll(async () => {
    const parts = await readPageParts(page);
    return parts.length >= 3 && parts.every((part) => part === inert);
  }, { message: `${message}: every part of the page ${inert ? "inert" : "live"}` }).toBe(true);
}

// Whether `locator`'s element takes focus when asked, as a keyboard and assistive technology ask.
function takesFocus(locator) {
  return locator.evaluate((element) => {
    element.focus();
    return document.activeElement === element;
  });
}

// The accessible names of the nodes assistive technology reaches, from Chromium's accessibility tree.
async function readAccessibleNames(page) {
  const session = await page.context().newCDPSession(page);
  try {
    const { nodes } = await session.send("Accessibility.getFullAXTree");
    return new Set(nodes.filter((node) => !node.ignored && node.name?.value).map((node) => node.name.value));
  } finally {
    await session.detach();
  }
}

// axe over the whole document, strict: each result's node, and whether it lies behind the dialogs (anywhere but
// Vuetify's overlay layer, the document itself aside). `targets` are the nodes target-size judged as targets.
async function runStrictAxe(page) {
  if (!(await page.evaluate(() => Boolean(globalThis.axe)))) {
    await page.addScriptTag({ path: AXE_PATH });
  }
  return page.evaluate(async (tags) => {
    const results = await globalThis.axe.run(document, { runOnly: { type: "tag", values: tags } });
    const behind = (selector) => {
      const element = document.querySelector(selector);
      return Boolean(element) && element !== document.documentElement && element !== document.body &&
        !element.closest(".v-overlay-container");
    };
    const nodesOf = (rules) => rules.flatMap((rule) => rule.nodes.map((node) => ({
      rule: rule.id,
      target: node.target.join(" "),
      behind: behind(String(node.target[0]))
    })));
    return {
      violations: nodesOf(results.violations),
      incompleteBehind: nodesOf(results.incomplete).filter((node) => node.behind),
      targets: nodesOf([...results.passes, ...results.violations, ...results.incomplete].filter((rule) => rule.id === "target-size"))
    };
  }, STRICT_AXE_TAGS);
}

// Waits for a dialog to finish opening: shown, with focus moved into it.
async function expectDialogOpen(page, dialog) {
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => element.closest(".v-overlay")?.contains(document.activeElement)))
    .toBe(true);
}

test("the page behind a dialog takes no focus and is skipped by assistive technology and strict axe, target-size included; closing it gives focus back to the FAB", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const page = await openNotes(t, COMPACT);
  const fab = buttonOf(page.getByTestId("fixture-invite"));
  const noteEdit = page.getByTestId("fixture-note-edit");
  const behind = [
    ["the note's Edit", noteEdit],
    ["the note's link", page.getByTestId("fixture-note-link")],
    ["the FAB", fab],
    ["a navigation bar destination", page.getByTestId("jskit-shell-bottom-nav").getByRole("link").first()]
  ];

  // The FAB opens the dialog from v-model, so it has no activator for Vuetify to give focus back to.
  await activate(fab);
  const dialog = page.getByTestId("fixture-invite-dialog");
  await expectDialogOpen(page, dialog);
  for (const [name, element] of behind) {
    assert.equal(await takesFocus(element), false, `${name} takes no focus behind the dialog`);
  }
  await expectDialogOpen(page, dialog);

  const names = await readAccessibleNames(page);
  for (const name of ["Edit note", "Supplier contacts", "Invite"]) {
    assert.equal(names.has(name), false, `assistive technology reaches no "${name}" behind the dialog`);
  }
  assert.ok(names.has("Send invitation"), "assistive technology reaches the dialog's actions");

  // The dialog's "Send invitation" sits where the FAB is: it is on top, and axe judges only the dialog's targets.
  const send = page.getByTestId("fixture-invite-send");
  assert.equal(
    await send.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.right - 4, box.bottom - 4));
    }),
    true,
    "the dialog's button is on top of the FAB"
  );
  const axe = await runStrictAxe(page);
  assert.deepEqual(axe.violations, [], "strict axe finds no violation");
  assert.deepEqual(axe.incompleteBehind, [], "strict axe has nothing to review behind the dialog");
  assert.deepEqual(axe.targets.filter((node) => node.behind), [], "target-size judges no target behind the dialog");
  assert.ok(axe.targets.some((node) => node.target.includes("fixture-invite-send")), "target-size judges the dialog's buttons");
  await expectPageInert(page, true, "with the dialog open");
  assert.deepEqual(
    await page.evaluate(() => [...document.querySelectorAll(".v-overlay-container, .v-overlay--active")].map((element) => element.inert)),
    [false, false],
    "the overlay layer and the dialog stay live"
  );

  await activate(page.getByTestId("fixture-invite-cancel"));
  await expect(dialog).toBeHidden();
  await expectPageInert(page, false, "after the dialog closes");
  await expect(fab).toBeFocused();
  assert.equal(await takesFocus(noteEdit), true, "the note's Edit takes focus again");
  await noteEdit.press("Enter");
  await expect(page.getByTestId("fixture-notes-presses")).toHaveText("edit");
  await page.close();
});

test("in a dialog, a select's menu works, a snackbar is announced and a second dialog leaves the first inert until it closes, focus going back to each opener", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const page = await openNotes(t, EXPANDED);
  // On an expanded window the screen's primary action is the app bar's button.
  const invite = page.getByTestId("fixture-invite");
  await activate(invite);
  const inviteDialog = page.getByTestId("fixture-invite-dialog");
  await expectDialogOpen(page, inviteDialog);
  await expectPageInert(page, true, "with the dialog open");

  await page.getByTestId("fixture-invite-role").click();
  const options = page.getByRole("listbox");
  await expect(options).toBeVisible();
  await options.getByRole("option", { name: "Editor" }).click();
  await expect(options).toBeHidden();
  await expect(page.getByTestId("fixture-invite-role")).toContainText("Editor");

  await activate(page.getByTestId("fixture-invite-copy"));
  const message = page.getByRole("status").filter({ hasText: "Invitation link copied." });
  await expect(message).toBeVisible();
  assert.equal(await message.evaluate((element) => Boolean(element.closest("[inert]"))), false, "the snackbar is live");
  assert.ok((await readAccessibleNames(page)).has("Invitation link copied."), "assistive technology reaches the message");
  await expectPageInert(page, true, "with a message over the dialog");

  const remove = page.getByTestId("fixture-invite-remove");
  await activate(remove);
  const removeDialog = page.getByTestId("fixture-remove-dialog");
  await expectDialogOpen(page, removeDialog);
  const inertOf = (locator) => locator.evaluate((element) => element.closest(".v-overlay").inert);
  assert.equal(await inertOf(inviteDialog), true, "the first dialog is inert under the second");
  assert.equal(await inertOf(removeDialog), false, "the second dialog is live");
  assert.equal(await takesFocus(page.getByTestId("fixture-invite-copy")), false, "the first dialog takes no focus");
  const names = await readAccessibleNames(page);
  assert.equal(names.has("Copy link"), false, "assistive technology skips the first dialog");
  assert.ok(names.has("Keep"), "assistive technology reaches the second dialog");
  await expectPageInert(page, true, "with two dialogs open");

  await activate(page.getByTestId("fixture-remove-keep"));
  await expect(removeDialog).toBeHidden();
  assert.equal(await inertOf(inviteDialog), false, "the first dialog is live again");
  await expect(remove).toBeFocused();
  await expectPageInert(page, true, "with the first dialog still open");

  await page.keyboard.press("Escape");
  await expect(inviteDialog).toBeHidden();
  await expectPageInert(page, false, "after both dialogs close");
  await expect(invite).toBeFocused();
  await page.close();
});

test("Vuetify's activator gets focus back, the shell's own error dialog makes the page inert too, and leaving the page with a dialog open leaves the next page live", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const page = await openNotes(t, COMPACT);

  const details = page.getByTestId("fixture-note-details");
  await activate(details);
  const detailsDialog = page.getByTestId("fixture-details-dialog");
  await expectDialogOpen(page, detailsDialog);
  await expectPageInert(page, true, "with a dialog opened from its activator");
  await page.keyboard.press("Escape");
  await expect(detailsDialog).toBeHidden();
  await expectPageInert(page, false, "after Escape");
  await expect(details).toBeFocused();

  // ShellErrorHost's dialog: one of JSKIT's own, rendered beside the layout rather than in the page.
  const report = page.getByTestId("fixture-report-problem");
  await activate(report);
  const errorDialog = page.getByRole("dialog", { name: "Attention required" });
  await expectDialogOpen(page, errorDialog);
  await expectPageInert(page, true, "with the shell's error dialog open");
  assert.equal(await takesFocus(page.getByTestId("fixture-note-edit")), false, "the note's Edit takes no focus");
  assert.deepEqual((await runStrictAxe(page)).violations, [], "strict axe finds no violation");
  await activate(errorDialog.getByRole("button", { name: "Close" }));
  await expect(errorDialog).toBeHidden();
  await expectPageInert(page, false, "after the error dialog closes");
  await expect(report).toBeFocused();

  await activate(buttonOf(page.getByTestId("fixture-invite")));
  await expectDialogOpen(page, page.getByTestId("fixture-invite-dialog"));
  await expectPageInert(page, true, "with the dialog open");
  await activate(page.getByTestId("fixture-invite-contacts"));
  await expect(page).toHaveURL(/\/home\/contacts$/u);
  await expect(page.getByTestId("fixture-invite-dialog")).toHaveCount(0);
  await expectPageInert(page, false, "on the page the dialog's link opened");
  assert.equal(await page.locator(".v-overlay[inert]").count(), 0, "no dialog is left inert");
  assert.equal(await takesFocus(page.locator("main a[href]").first()), true, "the next page takes focus");
  await page.close();
});
