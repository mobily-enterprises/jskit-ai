import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";

// An edit form reads its record again while the person edits it: a realtime event, the window regaining focus or
// Retry. Here the window regaining focus refetches it (TanStack's refetchOnWindowFocus), against a books API whose
// record another person changes meanwhile. The page is the crud-screen-set pattern's edit page in the real shell.
const SKIP = process.env.JSKIT_HTTP_WEB_KEPT_EDITS_BROWSER === "1"
  ? false
  : "set JSKIT_HTTP_WEB_KEPT_EDITS_BROWSER=1 to check that an edit form read again keeps the person's unsaved edits";
const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/crud-screens");
const open = sharedBrowserFixture({ fixtureRoot: FIXTURE_ROOT });
const JSON_API = "application/vnd.api+json";

function bookDocument(record) {
  return {
    contentType: JSON_API,
    body: JSON.stringify({
      data: {
        type: "books",
        id: "1",
        attributes: { ...record, createdAt: "2026-01-02T10:00:00.000Z", updatedAt: "2026-01-02T10:00:00.000Z" }
      }
    })
  };
}

// Book 1 as the server holds it, which the test changes as another person saving it would. `holdRead()` makes the
// next read of it wait until the test answers it with the record as it is then.
async function serveBook(page) {
  const server = { record: { title: "Dune", author: "Herbert", notes: null }, saves: [], held: null };
  server.holdRead = () => {
    const read = Promise.withResolvers();
    server.held = read;
    return read.promise;
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const key = `${request.method()} ${pathname}`;
    if (key === "GET /api/session") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ csrfToken: "test-token" }) });
      return;
    }
    if (key === "GET /api/books/1") {
      const held = server.held;
      server.held = null;
      if (held) {
        await new Promise((answered) => held.resolve(async () => {
          await route.fulfill(bookDocument(server.record)).catch(() => {});
          answered();
        }));
        return;
      }
      await route.fulfill(bookDocument(server.record));
      return;
    }
    if (key === "PATCH /api/books/1") {
      const { attributes } = request.postDataJSON().data;
      server.saves.push(attributes);
      server.record = { ...server.record, ...attributes };
      await route.fulfill(bookDocument(server.record));
      return;
    }
    await route.fulfill({ status: 404, contentType: JSON_API, body: JSON.stringify({ errors: [{ status: "404" }] }) });
  });
  return server;
}

// The person comes back to the window: TanStack reads the form's record again.
function returnToWindow(page) {
  return page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
}

test("an edit form read again keeps what the person typed, takes the fields they left, and says when the server changed theirs", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await open(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  t.after(() => page.close());
  const server = await serveBook(page);
  await page.goto("/books/1/edit");
  const title = page.getByRole("textbox", { name: "Title" });
  const author = page.getByRole("textbox", { name: "Author" });
  await expect(title).toHaveValue("Dune");

  await title.fill("Dune (my edit)");
  server.record = { ...server.record, title: "Dune Messiah", author: "Frank Herbert" };
  const read = server.holdRead();
  await returnToWindow(page);
  const answer = await read;

  // While the record is read again the person can go on typing, and what they type stays.
  await expect(title).toBeEditable();
  await title.press("End");
  await title.pressSequentially("!");
  await answer();

  await expect(author).toHaveValue("Frank Herbert");
  await expect(title).toHaveValue("Dune (my edit)!");
  const notice = page.locator(".crud-add-edit-form").getByRole("status");
  await expect(notice).toContainText("Title changed to “Dune Messiah” while you were editing.");
  await expect(notice.getByText(/Author/u)).toHaveCount(0);

  await notice.getByRole("button", { name: "Use the new Title" }).click();
  await expect(title).toHaveValue("Dune Messiah");
  await expect(notice.getByRole("button")).toHaveCount(0);

  // Kept instead: the person's value stays, and the same server value does not raise it again.
  await title.fill("Dune, mine");
  server.record = { ...server.record, title: "Dune, theirs" };
  await returnToWindow(page);
  await expect(notice).toContainText("Title changed to “Dune, theirs” while you were editing.");
  await notice.getByRole("button", { name: "Keep your Title" }).click();
  await expect(notice.getByRole("button")).toHaveCount(0);
  await returnToWindow(page);
  await page.waitForTimeout(500);
  await expect(notice.getByRole("button")).toHaveCount(0);
  await expect(title).toHaveValue("Dune, mine");

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => server.saves.length).toBe(1);
  assert.equal(server.saves[0].title, "Dune, mine");
  assert.equal(server.saves[0].author, "Frank Herbert");
});
