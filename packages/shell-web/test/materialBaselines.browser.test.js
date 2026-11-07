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
import { expectMaterialBaseline } from "../../../tooling/testUtils/visualBaseline.mjs";
import { DEFAULT_VIEWPORTS } from "../src/test/adaptiveShellSmoke.js";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(TEST_DIRECTORY, "../fixtures/adaptive-shell");
// Kept in the repository, outside the published package.
const BASELINE_DIRECTORY = path.resolve(TEST_DIRECTORY, "../../../tooling/material-baselines/shell-web");
const RUN_BROWSER_TEST = process.env.JSKIT_MATERIAL_BASELINES === "1";

// What Material 3 fixes in the shell: the app bar and its page title and Up arrow, the navigation bar, rail and
// drawer with their active indicators, the page's margins and a list-detail page's panes.
const SHELL_PROBES = Object.freeze([
  { name: "application", selector: ".v-application" },
  { name: "appBar", selector: ".v-app-bar", width: true },
  { name: "pageTitle", selector: "[data-testid=jskit-shell-page-title]" },
  { name: "upButton", selector: "[data-testid=jskit-shell-back]", width: true },
  { name: "menuButton", selector: "[data-testid=jskit-shell-nav-toggle]", width: true },
  { name: "navigationBar", selector: "[data-testid=jskit-shell-bottom-nav]", width: true },
  { name: "navigationBarIndicator", selector: ".tab-link-item--active .tab-link-item__indicator", width: true },
  { name: "navigationBarLabel", selector: ".tab-link-item__label" },
  { name: "rail", selector: "[data-testid=jskit-shell-rail]", width: true },
  { name: "railIndicator", selector: "[data-testid=jskit-shell-rail] .v-list-item--active .shell-menu-link-item__indicator", width: true },
  { name: "railLabel", selector: "[data-testid=jskit-shell-rail] .shell-menu-link-item__rail-label" },
  { name: "drawer", selector: "[data-testid=jskit-shell-drawer].v-navigation-drawer--active", width: true },
  { name: "drawerActiveItem", selector: "[data-testid=jskit-shell-drawer] .shell-menu-link-item.v-list-item--active" },
  { name: "drawerItem", selector: "[data-testid=jskit-shell-drawer] .shell-menu-link-item:not(.v-list-item--active)" },
  { name: "scrim", selector: ".v-navigation-drawer__scrim" },
  { name: "content", selector: ".shell-layout__content" },
  { name: "listItem", selector: ".v-main .v-list-item" },
  { name: "listPane", selector: "[data-testid=jskit-shell-list-detail] .shell-list-detail__list", width: true },
  // A page's section tabs (page.section-nav), Material 3 primary tabs, and the navigation bar's item placed in a page.
  { name: "sectionTabs", selector: "[data-testid=fixture-section-tabs]", width: true },
  { name: "sectionTab", selector: "[data-testid=fixture-section-tabs] .section-tab-link-item:not(.section-tab-link-item--active)" },
  { name: "sectionTabActive", selector: "[data-testid=fixture-section-tabs] .section-tab-link-item--active" },
  {
    name: "sectionTabIndicator",
    selector: "[data-testid=fixture-section-tabs] .section-tab-link-item--active .section-tab-link-item__indicator",
    width: true
  },
  { name: "barItemInPage", selector: "[data-testid=fixture-bar-items-in-page] .section-tab-link-item--active" }
]);

const SCREENS = Object.freeze([
  { name: "home", path: "/home" },
  { name: "list", path: "/home/contacts" },
  { name: "record", path: "/home/contacts/ada" },
  { name: "list-detail", path: "/home/settings/general" },
  { name: "section-tabs", path: "/home/reports/overview" },
  { name: "drawer-open", path: "/home", openDrawer: true }
]);

test("shell-web keeps its Material 3 baselines in light and dark at every window size", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_MATERIAL_BASELINES=1 to check the Material 3 baselines",
  timeout: 300_000
}, async (t) => {
  // Stopped in after hooks, which run when the test fails or times out too (a body's `finally` doesn't after a
  // timeout, and the server and browser would keep the test file's process alive).
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  t.after(() => stopProcess(vite));
  const browser = await chromium.launch(createChromiumLaunchOptions());
  t.after(() => browser.close());
  for (const viewport of DEFAULT_VIEWPORTS) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        baseURL: vite.baseURL,
        colorScheme: theme,
        locale: "en-US",
        reducedMotion: "reduce",
        viewport: { width: viewport.width, height: viewport.height }
      });
      try {
        const page = await context.newPage();
        for (const screen of SCREENS) {
          // The expanded window already shows its drawer.
          if (screen.openDrawer && viewport.name === "expanded") {
            continue;
          }
          await page.goto(`${screen.path}?theme=${theme}`);
          await expect(page.getByTestId("jskit-shell-page-title")).toBeVisible();
          if (screen.openDrawer) {
            await page.getByTestId("jskit-shell-nav-toggle").click();
            await expect(page.locator("[data-testid=jskit-shell-drawer].v-navigation-drawer--active")).toBeVisible();
          }
          await expectMaterialBaseline(page, {
            directory: BASELINE_DIRECTORY,
            name: `shell-${screen.name}-${viewport.width}-${theme}`,
            probes: SHELL_PROBES
          });
        }
      } finally {
        await context.close();
      }
    }
  }
});

// Buttons and pressable chips with their state layers, which Material 3 draws inside the control's shape: by variant
// at rest, selected and disabled, with a pagination's selected page; then a tonal button hovered, focused and
// pressed, at rest and selected, a selected tonal icon toggle hovered, a tonal chip hovered, and a profile menu's
// avatar trigger pressed and open, with its name and as an icon button.
const STATE_PROBES = Object.freeze([
  { name: "tonal", selector: "[data-testid=state-tonal-rest]" },
  { name: "tonalUnderlay", selector: "[data-testid=state-tonal-rest] > .v-btn__underlay" },
  { name: "tonalOverlay", selector: "[data-testid=state-tonal-rest] > .v-btn__overlay" },
  // Only while it is pressed: its ripple keeps the pill's corners.
  { name: "tonalRipple", selector: "[data-testid=state-tonal-rest] > .v-ripple__container" },
  { name: "selectedOverlay", selector: "[data-testid=state-tonal-active] > .v-btn__overlay" },
  { name: "disabled", selector: "[data-testid=state-flat-disabled]" },
  { name: "disabledOverlay", selector: "[data-testid=state-flat-disabled] > .v-btn__overlay" },
  { name: "iconUnderlay", selector: "[data-testid=state-icon-rest] > .v-btn__underlay" },
  { name: "iconSelectedOverlay", selector: "[data-testid=state-icon-active] > .v-btn__overlay" },
  {
    name: "paginationSelectedOverlay",
    selector: "[data-testid=state-pagination] .v-pagination__item--is-active > .v-btn > .v-btn__overlay"
  },
  { name: "chipUnderlay", selector: "[data-testid=state-chip-tonal] > .v-chip__underlay" },
  { name: "chipOverlay", selector: "[data-testid=state-chip-tonal] > .v-chip__overlay" },
  { name: "blockDisabledOverlay", selector: "[data-testid=state-block-disabled] > .v-btn__overlay" },
  { name: "profileOverlay", selector: "[data-testid=state-profile] > .v-btn__overlay" },
  { name: "profileIconOverlay", selector: "[data-testid=state-profile-icon] > .v-btn__overlay" }
]);

const STATE_TARGETS = Object.freeze([
  { name: "tonal", testId: "state-tonal-rest", states: ["hover", "focus", "pressed"] },
  { name: "selected", testId: "state-tonal-active", states: ["hover", "focus", "pressed"] },
  { name: "icon-selected", testId: "state-icon-active", states: ["hover"] },
  { name: "chip", testId: "state-chip-tonal", states: ["hover"] },
  { name: "profile", testId: "state-profile", states: ["pressed", "open"] },
  { name: "profile-icon", testId: "state-profile-icon", states: ["pressed", "open"] }
]);

test("buttons and chips keep every state layer inside their shape, in light and dark", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_MATERIAL_BASELINES=1 to check the Material 3 baselines",
  timeout: 180_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  let browser = null;
  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        baseURL: vite.baseURL,
        colorScheme: theme,
        locale: "en-US",
        reducedMotion: "reduce",
        viewport: { width: 390, height: 844 }
      });
      try {
        const page = await context.newPage();
        await page.goto(`/home/button-states?theme=${theme}`);
        await expect(page.getByTestId("jskit-shell-page-title")).toHaveText("Button states");
        const baseline = (name) => expectMaterialBaseline(page, {
          directory: BASELINE_DIRECTORY,
          name: `buttons-${name}-${theme}`,
          probes: STATE_PROBES
        });
        await baseline("rest");
        for (const target of STATE_TARGETS) {
          const control = page.getByTestId(target.testId);
          for (const state of target.states) {
            if (state === "hover") {
              await control.hover();
            } else if (state === "focus") {
              // A key press first, so the focus shows as keyboard focus.
              await page.keyboard.press("Shift");
              await control.focus();
            } else if (state === "open") {
              await control.click();
              await expect(control).toHaveAttribute("aria-expanded", "true");
            } else {
              await control.hover();
              await page.mouse.down();
            }
            await baseline(`${target.name}-${state}`);
            if (state === "pressed") {
              await page.mouse.up();
            }
            // Releasing a menu's trigger opens its menu; neither stays open for the next state. Escape closes the top
            // overlay, which can be the trigger's tooltip, so it is pressed until the menu has closed too.
            if (await control.getAttribute("aria-expanded") === "true") {
              await page.mouse.move(1, 300);
              await expect(async () => {
                await page.keyboard.press("Escape");
                await expect(control).toHaveAttribute("aria-expanded", "false", { timeout: 1000 });
              }).toPass({ timeout: 10_000 });
            }
            await control.blur();
            await page.mouse.move(1, 300);
          }
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser?.close();
    await stopProcess(vite);
  }
});
