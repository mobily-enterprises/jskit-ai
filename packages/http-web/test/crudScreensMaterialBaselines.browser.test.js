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

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(TEST_DIRECTORY, "../fixtures/crud-screens");
// Kept in the repository, outside the published package.
const BASELINE_DIRECTORY = path.resolve(TEST_DIRECTORY, "../../../tooling/material-baselines/http-web");
const RUN_BROWSER_TEST = process.env.JSKIT_MATERIAL_BASELINES === "1";
const VIEWPORTS = Object.freeze([
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 }
]);

const BOOKS = Object.freeze([
  { id: "1", title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", notes: "Winter, and the envoy Genly Ai." },
  { id: "2", title: "Kindred", author: "Octavia E. Butler", notes: null },
  { id: "3", title: "The Dispossessed", author: "Ursula K. Le Guin", notes: "Anarres and Urras." }
]);

function bookResource(book) {
  return {
    type: "books",
    id: book.id,
    attributes: {
      title: book.title,
      author: book.author,
      notes: book.notes,
      createdAt: "2026-01-02T10:00:00.000Z",
      updatedAt: "2026-01-02T10:00:00.000Z"
    }
  };
}

// What Material 3 fixes on the CRUD screens: the app bar's title, Up arrow and actions, the FAB, the search bar, the
// cards and the table, the empty and error states, the view's header and value-first details, the form's fields and
// the delete dialog.
const CRUD_PROBES = Object.freeze([
  { name: "application", selector: ".v-application" },
  { name: "appBar", selector: ".v-app-bar", width: true },
  { name: "pageTitle", selector: "[data-testid=jskit-shell-page-title]" },
  { name: "upButton", selector: "[data-testid=jskit-shell-back]", width: true },
  { name: "primaryAction", selector: ".shell-page-action.v-btn--variant-flat" },
  { name: "pageAction", selector: ".shell-page-action.v-btn--variant-text" },
  { name: "navigationBar", selector: "[data-testid=jskit-shell-bottom-nav]", width: true },
  { name: "rail", selector: "[data-testid=jskit-shell-rail]", width: true },
  { name: "drawer", selector: "[data-testid=jskit-shell-drawer].v-navigation-drawer--active", width: true },
  { name: "content", selector: ".shell-layout__content", width: true },
  { name: "fab", selector: ".shell-primary-action .v-btn" },
  { name: "search", selector: ".crud-list-search .v-field", width: true },
  { name: "card", selector: ".crud-list-card", width: true },
  { name: "cardTitle", selector: ".crud-list-card__title" },
  { name: "cardMenu", selector: ".crud-list-card .v-btn--icon", width: true },
  { name: "table", selector: ".crud-list-table", width: true },
  { name: "tableHeader", selector: ".crud-list-table thead th" },
  { name: "tableRow", selector: ".crud-list-table tbody tr" },
  { name: "tableCell", selector: ".crud-list-table tbody td" },
  { name: "rowAction", selector: ".crud-list-table tbody .v-btn--icon", width: true },
  { name: "state", selector: ".crud-list-state" },
  { name: "stateIcon", selector: ".crud-list-state .v-icon", width: true },
  { name: "stateAction", selector: ".crud-list-state .v-btn" },
  { name: "viewHeader", selector: ".crud-view-header h2" },
  { name: "viewPanel", selector: ".crud-view-panel", width: true },
  { name: "viewItemTitle", selector: ".crud-view-fields .v-list-item-title" },
  { name: "viewItemSubtitle", selector: ".crud-view-fields .v-list-item-subtitle" },
  { name: "field", selector: ".crud-add-edit-form__fields .v-field", width: true },
  { name: "fieldLabel", selector: ".crud-add-edit-form__fields .v-field-label" },
  { name: "dialog", selector: ".v-overlay--active .v-card", width: true },
  { name: "dialogTitle", selector: ".v-overlay--active .crud-delete-action__headline" },
  { name: "dialogAction", selector: ".v-overlay--active .v-card-actions .v-btn" }
]);

const SCREENS = Object.freeze([
  { name: "list", path: "/books", data: "books", ready: ".crud-list-card, .crud-list-table" },
  { name: "list-empty", path: "/books", data: "empty", ready: ".crud-list-state" },
  { name: "list-error", path: "/books", data: "error", ready: ".crud-list-state" },
  { name: "view", path: "/books/1", data: "books", ready: ".crud-view-header" },
  { name: "delete-dialog", path: "/books/1", data: "books", ready: ".crud-view-header", openDelete: true },
  { name: "new", path: "/books/new", data: "books", ready: ".crud-add-edit-form__fields .v-field" },
  { name: "edit", path: "/books/1/edit", data: "books", ready: ".crud-add-edit-form__fields .v-field--dirty" }
]);

async function serveBooks(page, screen) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const record = /^\/api\/books\/([^/]+)$/u.exec(url.pathname);
    if (screen.data === "error") {
      await route.fulfill({
        status: 500,
        contentType: "application/vnd.api+json",
        body: JSON.stringify({ errors: [{ status: "500", title: "Server error", detail: "Unable to load books." }] })
      });
      return;
    }
    if (url.pathname === "/api/books") {
      const books = screen.data === "empty" ? [] : BOOKS;
      await route.fulfill({
        contentType: "application/vnd.api+json",
        body: JSON.stringify({ data: books.map(bookResource), meta: { page: { nextCursor: null } } })
      });
      return;
    }
    const book = record && BOOKS.find((candidate) => candidate.id === record[1]);
    if (book) {
      await route.fulfill({ contentType: "application/vnd.api+json", body: JSON.stringify({ data: bookResource(book) }) });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/vnd.api+json",
      body: JSON.stringify({ errors: [{ status: "404", title: "Not found" }] })
    });
  });
}

test("the CRUD screens keep their Material 3 baselines in light and dark at every window size", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_MATERIAL_BASELINES=1 to check the Material 3 baselines",
  timeout: 300_000
}, async (t) => {
  // Stopped in after hooks, which run when the test fails or times out too (a body's `finally` doesn't after a
  // timeout, and the server and browser would keep the test file's process alive).
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  t.after(() => stopProcess(vite));
  const browser = await chromium.launch(createChromiumLaunchOptions());
  t.after(() => browser.close());
  for (const viewport of VIEWPORTS) {
    // The app follows the system's light or dark setting, Material 3's default.
    for (const colorScheme of ["light", "dark"]) {
      const context = await browser.newContext({
        baseURL: vite.baseURL,
        colorScheme,
        locale: "en-US",
        reducedMotion: "reduce",
        timezoneId: "UTC",
        viewport
      });
      try {
        for (const screen of SCREENS) {
          const page = await context.newPage();
          await serveBooks(page, screen);
          await page.goto(screen.path);
          await expect(page.locator(screen.ready).filter({ visible: true }).first()).toBeVisible();
          if (screen.openDelete) {
            // A phone's bar keeps only a primary action, so the record's Delete is in its "More actions" menu.
            const compact = viewport.width < 600;
            if (compact) {
              await page.getByRole("button", { name: "More actions" }).click();
            }
            await page.getByRole(compact ? "menuitem" : "button", { name: /^Delete/u }).first().click();
            await expect(page.locator(".v-overlay--active .crud-delete-action__headline")).toBeVisible();
          }
          await expectMaterialBaseline(page, {
            directory: BASELINE_DIRECTORY,
            name: `crud-${screen.name}-${viewport.width}-${colorScheme}`,
            probes: CRUD_PROBES
          });
          await page.close();
        }
      } finally {
        await context.close();
      }
    }
  }
});
