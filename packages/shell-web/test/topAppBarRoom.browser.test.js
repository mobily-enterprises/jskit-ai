import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(TEST_DIRECTORY, "../fixtures/adaptive-shell");
const RUN_BROWSER_TEST = process.env.JSKIT_SHELL_WEB_BROWSER_INTEGRATION === "1";
// The room an expanded or large bar leaves its title before a page action folds (appBarWidths.js).
const WIDE_TITLE_FLOOR = 200;
// whs2's record page beside Material 3's 360dp drawer, with tools, a status and an account with a long name.
const REVIEW = "/home/review?topRight=3&drawerWidth=material&account=Ana%20Ferreira%20Lopes%20da%20Silva";
const NAME = "Ana Ferreira Lopes da Silva";
// A title a medium bar keeps whole only once two of its three items have moved into More actions.
const LONG_TITLE = "Quarterly statements for every supplier by site";
// whs2's New Record page beside its register (28 Nov, 900x700): the standard drawer, open at 304px, leaves the bar
// 596px, with no Up arrow, "Close new Document" as the page's way out, the primary "Submit Record" and whs2's six items
// (its assistant, notifications, invites, admin cog, live updates and the account).
const NEW_RECORD = `/home/review?new=Document&title=New%20Document&topRight=6&drawerWidth=304&account=${encodeURIComponent(NAME)}`;
const WHS2_ITEMS = ["Assistant", "Notifications", "Invites", "Admin", "Live updates", "Account"];

async function startFixture(t) {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  t.after(() => stopProcess(vite));
  const browser = await chromium.launch(createChromiumLaunchOptions());
  t.after(() => browser.close());
  return { vite, browser };
}

// What the review page's bar draws: whether its row overflows; the account's name or its round button's name; the page
// actions in the bar, and those the bar clips; the bar's own items in the bar and in the menu; the title's box and its
// whole width, and whether it is clipped; how often the account switched between its two forms.
function readBar(page) {
  return page.evaluate(() => {
    const row = document.querySelector(".shell-layout__app-bar-row");
    const actionsBox = row.querySelector(".shell-page-actions-target");
    const boxRight = actionsBox.getBoundingClientRect().right;
    const titleBox = row.querySelector(".shell-layout__headline");
    const title = row.querySelector("[data-testid=jskit-shell-page-title]");
    const style = window.getComputedStyle(titleBox);
    const text = document.createRange();
    text.selectNodeContents(title);
    const account = document.querySelector("[data-testid=fixture-account]");
    const actions = [...actionsBox.querySelectorAll("[data-testid^=fixture-review-]")];
    const item = (element) => element.querySelector("[data-testid=fixture-account]")
      ? "Account"
      : element.querySelector("[data-testid=fixture-status]")?.getAttribute("aria-label");
    return {
      overflows: row.scrollWidth > row.clientWidth,
      name: document.querySelector("[data-testid=fixture-account-name]")?.textContent.trim() ?? null,
      accountLabel: account.getAttribute("aria-label"),
      actionsInBar: actions.map((element) => element.textContent.trim()),
      actionsClipped: actions.filter((element) => element.getBoundingClientRect().right > boxRight + 0.5)
        .map((element) => element.textContent.trim()),
      itemsInBar: [...row.querySelectorAll(".shell-layout__top-right [data-placement-id]")].map(item),
      itemsInMenu: [...document.querySelectorAll("#jskit-shell-top-right-menu [data-placement-id]")].map(item),
      menuButton: Boolean(row.querySelector("[data-testid=jskit-shell-page-actions-overflow]")),
      titleBox: Math.floor(titleBox.clientWidth - Number.parseFloat(style.paddingInlineStart) - Number.parseFloat(style.paddingInlineEnd)),
      wholeTitle: Math.ceil(Math.max(title.scrollWidth, text.getBoundingClientRect().width)),
      titleClipped: title.scrollWidth > title.clientWidth + 1,
      labelChanges: window.__fixtureAccountLabels || 0
    };
  });
}

// The bar once it has settled: read again after a pause, the same, so nothing switched back and forth meanwhile.
async function settledBar(page, at) {
  const first = await readBar(page);
  await page.waitForTimeout(400);
  const again = await readBar(page);
  assert.deepEqual(again, first, `${at}: the bar settles`);
  return again;
}

test("beside an open drawer in a 900px window, the bar gives up the account's name before a page action folds, and a wide window shows it again", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 90_000
}, async (t) => {
  const { vite, browser } = await startFixture(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 900, height: 900 } });
  t.after(() => page.close());
  await page.goto(REVIEW);
  await expect(page.getByTestId("jskit-shell-app-bar")).toHaveAttribute("data-size-class", "expanded");
  await expect(page.getByTestId("jskit-shell-drawer")).toHaveAttribute("data-presentation", "drawer");
  await expect(page.getByTestId("fixture-review-submit")).toBeVisible();

  // whs2's record page (28 Nov): with the name, the bar clipped its title to 8px, cut Submit off and folded Close.
  // Without it, Close, a whole Submit and every item fit beside the title's floor.
  const narrow = await settledBar(page, "900px");
  const expected = {
    overflows: false,
    name: null,
    accountLabel: `AF ${NAME}`,
    actionsInBar: ["Close", "Submit"],
    actionsClipped: [],
    itemsInBar: ["Tools", "Status", "Account"],
    itemsInMenu: [],
    menuButton: false,
    titleKeepsItsFloor: true
  };
  const { titleBox, wholeTitle, titleClipped, labelChanges, ...drawn } = narrow;
  assert.deepEqual({ ...drawn, titleKeepsItsFloor: titleBox >= Math.min(wholeTitle, WIDE_TITLE_FLOOR) - 1 }, expected,
    `900px: ${JSON.stringify(narrow)}`);

  // A large window has room for everything, the name included.
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(page.getByTestId("fixture-account-name")).toHaveText(NAME);
  const wide = await settledBar(page, "1600px");
  assert.deepEqual({ overflows: wide.overflows, actionsInBar: wide.actionsInBar, itemsInBar: wide.itemsInBar, titleClipped: wide.titleClipped },
    { overflows: false, actionsInBar: ["Close", "Submit"], itemsInBar: ["Tools", "Status", "Account"], titleClipped: false });

  // Narrow again: the same bar as before, the name gone once more.
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.getByTestId("fixture-account-name")).toHaveCount(0);
  const again = await settledBar(page, "900px again");
  assert.deepEqual({ ...again, labelChanges: 0 }, { ...narrow, labelChanges: 0 }, "900px again");
});

test("a page's way out never folds: beside its register in a 596px bar, Close stays whole in the bar and the bar's own items move into More actions instead", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 90_000
}, async (t) => {
  const { vite, browser } = await startFixture(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 900, height: 700 } });
  t.after(() => page.close());
  await page.goto(NEW_RECORD);
  await expect(page.getByTestId("jskit-shell-app-bar")).toHaveAttribute("data-size-class", "expanded");
  await expect(page.getByTestId("jskit-shell-drawer")).toHaveAttribute("data-presentation", "drawer");
  await expect(page.getByTestId("jskit-shell-drawer")).toHaveAttribute("data-drawer-width", "304");
  await expect(page.getByTestId("jskit-shell-back")).toHaveCount(0);
  await expect(page.getByTestId("fixture-review-submit")).toBeVisible();
  const barWidth = await page.getByTestId("jskit-shell-app-bar").evaluate((element) => element.getBoundingClientRect().width);
  assert.equal(Math.round(barWidth), 596, "the bar beside the open drawer");

  // 0.2.124 kept Submit Record and every item it had room for, and folded Close new Document, the page's only way out.
  const bar = await settledBar(page, "596px bar");
  const at = `596px bar: ${JSON.stringify(bar)}`;
  assert.deepEqual({
    overflows: bar.overflows,
    name: bar.name,
    actionsInBar: bar.actionsInBar,
    actionsClipped: bar.actionsClipped,
    titleKeepsItsFloor: bar.titleBox >= Math.min(bar.wholeTitle, WIDE_TITLE_FLOOR) - 1
  }, {
    overflows: false,
    name: null,
    actionsInBar: ["Close new Document", "Submit Record"],
    actionsClipped: [],
    titleKeepsItsFloor: true
  }, at);
  await expect(page.getByTestId("fixture-review-close")).toBeInViewport({ ratio: 1 });
  assert.ok(bar.itemsInMenu.length > 0, `${at}: an item of the bar's own gives way to Close`);
  assert.deepEqual([...bar.itemsInMenu, ...bar.itemsInBar], WHS2_ITEMS, `${at}: the items farthest from the corner move first`);

  // More actions holds the items that moved, and never Close.
  await page.getByTestId("jskit-shell-page-actions-overflow").click();
  await expect(page.getByTestId("jskit-shell-page-actions-overflow-items").getByRole("button", { name: bar.itemsInMenu[0], exact: true }))
    .toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Close new Document" })).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("a medium bar folds its page actions, then moves its own items into More actions, farthest from the corner first, to keep its whole title", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 90_000
}, async (t) => {
  const { vite, browser } = await startFixture(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 768, height: 1024 } });
  t.after(() => page.close());
  await page.goto(`${REVIEW}&title=${encodeURIComponent(LONG_TITLE)}`);
  await expect(page.getByTestId("jskit-shell-app-bar")).toHaveAttribute("data-size-class", "medium");
  await expect(page.getByTestId("jskit-shell-page-title")).toHaveText(LONG_TITLE);
  await expect(page.getByTestId("fixture-review-submit")).toBeVisible();

  const bar = await settledBar(page, "768px, a long title");
  const at = `768px, a long title: ${JSON.stringify(bar)}`;
  assert.deepEqual({
    overflows: bar.overflows,
    titleClipped: bar.titleClipped,
    name: bar.name,
    actionsInBar: bar.actionsInBar,
    actionsClipped: bar.actionsClipped
  }, { overflows: false, titleClipped: false, name: null, actionsInBar: ["Submit"], actionsClipped: [] }, at);
  assert.ok(bar.itemsInMenu.length > 0, `${at}: an item gives way to the title`);
  const order = ["Tools", "Status", "Account"];
  assert.deepEqual([...bar.itemsInMenu, ...bar.itemsInBar], order, `${at}: the items farthest from the corner move first`);

  // More actions holds Close, then the items that moved.
  await page.getByTestId("jskit-shell-page-actions-overflow").click();
  await expect(page.getByRole("menuitem")).toHaveText(["Close"]);
  await expect(page.getByTestId("jskit-shell-page-actions-overflow-items").getByRole("button", { name: bar.itemsInMenu[0], exact: true }))
    .toBeVisible();
  await page.keyboard.press("Escape");

  // A short title takes every item back, and Close.
  await page.goto(REVIEW);
  await expect(page.getByTestId("jskit-shell-page-title")).toHaveText("Module record");
  const short = await settledBar(page, "768px, a short title");
  assert.deepEqual({ actionsInBar: short.actionsInBar, itemsInBar: short.itemsInBar, titleClipped: short.titleClipped },
    { actionsInBar: ["Close", "Submit"], itemsInBar: order, titleClipped: false }, `768px, a short title: ${JSON.stringify(short)}`);
});
