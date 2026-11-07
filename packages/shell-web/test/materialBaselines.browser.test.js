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
