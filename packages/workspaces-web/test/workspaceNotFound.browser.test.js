import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";

const openFixture = sharedBrowserFixture({ fixtureRoot: fileURLToPath(new URL("../fixtures/workspace-not-found/", import.meta.url)) });

// The server answers the person's bootstrap: they are a member of acme alone; "theirs" is refused as a server before
// JSKIT answered a non-member as not found did (forbidden), any other slug as not found.
function answerApi(page, sent) {
  return page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    sent.push(`${url.pathname}${url.search}`);
    if (url.pathname !== "/api/bootstrap") {
      await route.fulfill({ json: {} });
      return;
    }
    const slug = url.searchParams.get("workspaceSlug") || "";
    await route.fulfill({
      json: {
        session: { authenticated: true, userId: "7" },
        workspaces: [{ id: "1", slug: "acme", name: "Acme" }],
        permissions: [],
        ...(slug && slug !== "acme" ? { requestedWorkspace: { slug, status: slug === "theirs" ? "forbidden" : "not_found" } } : {})
      }
    });
  });
}

test("a workspace that doesn't exist, or that the person isn't in, opens the Not found page at its address", {
  skip: process.env.JSKIT_WORKSPACES_WEB_NOT_FOUND_BROWSER !== "1",
  timeout: 180_000
}, async (t) => {
  const { vite: runtime, browser } = await openFixture(t);
  const page = await browser.newPage({ baseURL: runtime.baseURL });
  t.after(() => page.close());
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const sent = [];
  await answerApi(page, sent);
  const notFound = page.getByRole("heading", { name: "Page not found", exact: true });

  // Opened in the tab: the one bootstrap names the workspace, and nothing of the workspace opens or asks for data.
  for (const address of ["/w/nope", "/w/nope/projects?tab=open", "/w/theirs"]) {
    sent.length = 0;
    await page.goto(address);
    await expect(notFound).toBeVisible();
    const { pathname, search } = new URL(page.url());
    assert.equal(`${pathname}${search}`, address);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    assert.deepEqual(sent, [`/api/bootstrap?workspaceSlug=${address.split(/[/?]/u)[2]}`], address);
  }

  // Its way out works: home, and from there the person's own workspace opens as before.
  await page.getByRole("link", { name: "Go home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Acme", exact: true }).click();
  await expect(page.getByRole("heading", { name: "acme home", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace" })).toBeVisible();

  // A link from inside the application to a workspace the person can't see opens the Not found page there once the
  // server answers.
  await page.getByRole("link", { name: "A stale link", exact: true }).click();
  await expect(notFound).toBeVisible();
  await expect(page).toHaveURL(/\/w\/nope$/u);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  assert.deepEqual(errors, []);
});
