import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";

// A command button that is disabled while its action runs loses keyboard focus: in Chromium the focused button that
// becomes `disabled` hands focus to the page body, so a keyboard user who pressed Save or "Load more" lands back at
// the top of the page. These tests drive the CRUD screens (the crud-screen-set pattern's pages in the real shell) by
// keyboard alone: Tab to the button, Enter, hold the request, then let it settle, and check that focus never fell to
// the body, that the button read as unavailable meanwhile and that a second Enter did nothing.
const SKIP = process.env.JSKIT_HTTP_WEB_PENDING_FOCUS_BROWSER === "1"
  ? false
  : "set JSKIT_HTTP_WEB_PENDING_FOCUS_BROWSER=1 to check that pending CRUD buttons keep keyboard focus";
const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/crud-screens");
const open = sharedBrowserFixture({ fixtureRoot: FIXTURE_ROOT });
// An expanded window: the app bar shows its actions labelled, and the list draws its table.
const VIEWPORT = Object.freeze({ width: 1280, height: 900 });

function book(id) {
  return {
    type: "books",
    id: String(id),
    attributes: {
      title: `Book ${id}`,
      author: `Author ${id}`,
      notes: null,
      createdAt: "2026-01-02T10:00:00.000Z",
      updatedAt: "2026-01-02T10:00:00.000Z"
    }
  };
}

const JSON_API = "application/vnd.api+json";

// The books API, with the requests a test holds: `hold(method, pathname)` makes the next matching request wait until
// the test answers it, and resolves to `{ request, answer(response) }` once that request arrives.
async function serveBooks(page, { pages = [[1, 2, 3]] } = {}) {
  const held = [];
  const requests = [];
  function hold(method, pathname) {
    return new Promise((resolve) => held.push({ method, pathname, resolve }));
  }
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    requests.push(`${method} ${url.pathname}${url.search}`);
    if (url.pathname === "/api/session") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ csrfToken: "test-token" }) });
      return;
    }
    const waiting = held.findIndex((entry) => entry.method === method && entry.pathname === url.pathname);
    if (waiting >= 0) {
      const [entry] = held.splice(waiting, 1);
      await new Promise((answered) => {
        entry.resolve({
          request,
          answer: async (response) => {
            await route.fulfill(response).catch(() => {});
            answered();
          }
        });
      });
      return;
    }
    if (method === "GET" && url.pathname === "/api/books") {
      const cursor = [...url.searchParams.values()].find((value) => value.startsWith("cursor-"));
      const index = cursor ? Number(cursor.slice("cursor-".length)) : 0;
      await route.fulfill(listPage(pages, index));
      return;
    }
    const record = /^\/api\/books\/([^/]+)$/u.exec(url.pathname);
    if (method === "GET" && record) {
      await route.fulfill({ contentType: JSON_API, body: JSON.stringify({ data: book(record[1]) }) });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: JSON_API,
      body: JSON.stringify({ errors: [{ status: "404", title: "Not found" }] })
    });
  });
  return { hold, requests };
}

// Page `index` of the list: its books, and the next page's cursor while there is one.
function listPage(pages, index) {
  const nextCursor = index + 1 < pages.length ? `cursor-${index + 1}` : null;
  return {
    contentType: JSON_API,
    body: JSON.stringify({ data: pages[index].map(book), meta: { page: { nextCursor } } })
  };
}

// Records, at every frame until stopped, each time focus is on the page body (or nowhere): what a keyboard or
// screen-reader user would land on.
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
  return {
    framesOnBody: () => page.evaluate(() => globalThis.jskitPendingFocusWatch())
  };
}

// Presses Tab (from wherever focus is) until `locator` has focus, as a keyboard user reaches it.
async function tabTo(page, locator, { max = 80 } = {}) {
  for (let presses = 0; presses <= max; presses += 1) {
    if (await locator.evaluate((element) => element === document.activeElement).catch(() => false)) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${locator}`);
}

async function openPage(t) {
  const { vite, browser } = await open(t);
  return browser.newPage({
    baseURL: vite.baseURL,
    viewport: VIEWPORT,
    locale: "en-US",
    reducedMotion: "reduce",
    timezoneId: "UTC"
  });
}

// No second request arrives while the first is held: Enter on the pending button did nothing.
async function expectNoSecondRequest(page, requests, label) {
  const before = requests.filter((entry) => entry.startsWith(label)).length;
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  assert.equal(requests.filter((entry) => entry.startsWith(label)).length, before, `a second Enter sent another ${label}`);
}

test("the edit form's Save keeps focus while it saves, and a refusal that marks a field focuses that field", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const page = await openPage(t);
  const { hold, requests } = await serveBooks(page);
  await page.goto("/books/1/edit");
  await expect(page.locator(".crud-add-edit-form__fields .v-field--dirty").first()).toBeVisible();

  const save = page.getByRole("button", { name: "Save changes" });
  await tabTo(page, save);
  const watch = await watchFocus(page);
  const patch = hold("PATCH", "/api/books/1");
  await page.keyboard.press("Enter");
  const pending = await patch;

  const saving = page.getByRole("button", { name: "Saving…" });
  await expect(saving).toBeFocused();
  await expect(saving).toHaveAttribute("aria-disabled", "true");
  await expectNoSecondRequest(page, requests, "PATCH /api/books/1");
  await expect(saving).toBeFocused();

  await pending.answer({
    status: 422,
    contentType: JSON_API,
    body: JSON.stringify({
      errors: [{
        status: "422",
        title: "Validation failed",
        detail: "Another book has this author.",
        source: { pointer: "/data/attributes/author" }
      }]
    })
  });
  const author = page.getByRole("textbox", { name: "Author" });
  await expect(page.locator(".crud-add-edit-form__fields .v-input--error")).toHaveCount(1);
  await expect(author).toBeFocused();
  assert.equal(await watch.framesOnBody(), 0, "focus fell to the page body while Save was pending");
  await expect(page.getByRole("button", { name: "Save changes" })).not.toHaveAttribute("aria-disabled", "true");
});

test("the list's Refresh keeps focus while the list reloads", { skip: SKIP, timeout: 120_000 }, async (t) => {
  const page = await openPage(t);
  const { hold, requests } = await serveBooks(page);
  await page.goto("/books");
  await expect(page.locator(".crud-list-table tbody tr").first()).toBeVisible();

  const refresh = page.getByRole("button", { name: "Refresh", exact: true });
  await tabTo(page, refresh);
  const watch = await watchFocus(page);
  const reload = hold("GET", "/api/books");
  await page.keyboard.press("Enter");
  const pending = await reload;

  const refreshing = page.getByRole("button", { name: "Refreshing…" });
  await expect(refreshing).toBeFocused();
  await expect(refreshing).toHaveAttribute("aria-disabled", "true");
  await expectNoSecondRequest(page, requests, "GET /api/books");

  await pending.answer(listPage([[1, 2, 3]], 0));
  await expect(refresh).toBeFocused();
  await expect(refresh).not.toHaveAttribute("aria-disabled", "true");
  assert.equal(await watch.framesOnBody(), 0, "focus fell to the page body while Refresh was pending");
});

test("\"Load more\" keeps focus while each page loads, and the last page hands focus to its first record", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const page = await openPage(t);
  const { hold, requests } = await serveBooks(page, { pages: [[1, 2, 3], [4, 5, 6], [7, 8]] });
  await page.goto("/books");
  await expect(page.locator(".crud-list-table tbody tr")).toHaveCount(3);

  const loadMore = page.getByRole("button", { name: "Load more" });
  await tabTo(page, loadMore);
  const watch = await watchFocus(page);

  // A middle page: the button stays, with focus.
  let next = hold("GET", "/api/books");
  await page.keyboard.press("Enter");
  let pending = await next;
  const loading = page.getByRole("button", { name: "Loading more…" });
  await expect(loading).toBeFocused();
  await expect(loading).toHaveAttribute("aria-disabled", "true");
  await expectNoSecondRequest(page, requests, "GET /api/books");
  await pending.answer(listPage([[1, 2, 3], [4, 5, 6], [7, 8]], 1));
  await expect(page.locator(".crud-list-table tbody tr")).toHaveCount(6);
  await expect(loadMore).toBeFocused();

  // The last page: the button goes, and focus moves to the first record it added.
  next = hold("GET", "/api/books");
  await page.keyboard.press("Enter");
  pending = await next;
  await expect(loading).toBeFocused();
  await pending.answer(listPage([[1, 2, 3], [4, 5, 6], [7, 8]], 2));
  await expect(page.locator(".crud-list-table tbody tr")).toHaveCount(8);
  await expect(loadMore).toHaveCount(0);
  const seventh = page.locator(".crud-list-table tbody tr").nth(6);
  await expect.poll(() => seventh.evaluate((row) => row.contains(document.activeElement))).toBe(true);
  assert.equal(await watch.framesOnBody(), 0, "focus fell to the page body while \"Load more\" was pending");
});

test("the delete dialog's Delete keeps focus while it deletes, and stays in the dialog when the delete fails", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const page = await openPage(t);
  const { hold, requests } = await serveBooks(page);
  await page.goto("/books/1");
  await expect(page.locator(".crud-view-header")).toBeVisible();

  await tabTo(page, page.getByRole("button", { name: "Delete book" }));
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "Delete", exact: true });
  await tabTo(page, confirm, { max: 4 });
  const watch = await watchFocus(page);
  const remove = hold("DELETE", "/api/books/1");
  await page.keyboard.press("Enter");
  const pending = await remove;

  const deleting = dialog.getByRole("button", { name: "Deleting…" });
  await expect(deleting).toBeFocused();
  await expect(deleting).toHaveAttribute("aria-disabled", "true");
  await expectNoSecondRequest(page, requests, "DELETE /api/books/1");

  await pending.answer({
    status: 500,
    contentType: JSON_API,
    body: JSON.stringify({ errors: [{ status: "500", title: "Server error", detail: "The book is on loan." }] })
  });
  await expect(dialog.getByText("The book is on loan.")).toBeVisible();
  await expect(confirm).toBeFocused();
  await expect(confirm).not.toHaveAttribute("aria-disabled", "true");
  assert.equal(await watch.framesOnBody(), 0, "focus fell to the page body while Delete was pending");
});
