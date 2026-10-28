import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

const VIEWPORTS = [
  { name: "compact", width: 390, height: 844 },
  { name: "medium", width: 720, height: 1000 },
  { name: "expanded", width: 1280, height: 900 }
];

function createDeferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("Your workspaces keeps its layout while responding and then opens the last workspace", {
  skip: process.env.JSKIT_WORKSPACES_LANDING_BROWSER !== "1",
  timeout: 180_000
}, async () => {
  const runtime = await startViteFixture({ fixtureRoot: fileURLToPath(new URL("../fixtures/workspaces-landing/", import.meta.url)) });
  let browser;
  let page;
  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    for (const viewport of VIEWPORTS) {
      page = await browser.newPage({ baseURL: runtime.baseURL, viewport });
      page.setDefaultTimeout(15_000);
      page.setDefaultNavigationTimeout(60_000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const redeem = createDeferred();
      const refreshStarted = createDeferred();
      const refresh = createDeferred();
      let bootstrapRequests = 0;
      let pendingInvites = [
        { id: "5", workspaceId: "3", workspaceSlug: "zen", workspaceName: "Zen", token: "invite-token", roleSid: "member" }
      ];
      await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/session") {
          await route.fulfill({ json: { csrfToken: "fixture-csrf" } });
          return;
        }
        if (path === "/api/workspace/invitations/redeem") {
          await redeem.promise;
          pendingInvites = [];
          await route.fulfill({
            contentType: "application/vnd.api+json",
            json: { data: { type: "workspace-invitation-decisions", id: "5", attributes: { decision: "refuse" } } }
          });
          return;
        }
        bootstrapRequests += 1;
        if (bootstrapRequests > 1) {
          refreshStarted.resolve();
          await refresh.promise;
        }
        await route.fulfill({
          json: {
            session: { authenticated: true, userId: "7" },
            tenancy: { mode: "workspaces", workspace: { allowSelfCreate: true } },
            app: { features: { workspaceInvites: true } },
            workspaces: [
              { id: "1", slug: "home", name: "Home", roleSid: "owner" },
              { id: "2", slug: "acme", name: "Acme", roleSid: "member" }
            ],
            pendingInvites
          }
        });
      });
      await page.addInitScript(() => {
        localStorage.setItem("jskit.workspaces-web.last-workspace.7", "acme");
      });

      await page.goto("/home/workspaces");
      const heading = page.getByText("Workspaces", { exact: true });
      await page.getByRole("button", { name: "Refuse", exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        0,
        `${viewport.name}: no horizontal scroll`
      );
      const buttonHeights = await page.locator(".workspaces-view__body .v-btn").evaluateAll(
        (buttons) => buttons.map((button) => button.getBoundingClientRect().height)
      );
      assert.ok(buttonHeights.every((height) => height >= 48), `${viewport.name}: 48px targets, got ${buttonHeights}`);
      const headingBox = await heading.boundingBox();

      await page.getByRole("button", { name: "Refuse", exact: true }).click();
      await expect(page.getByRole("button", { name: "Refusing…", exact: true })).toBeDisabled();
      redeem.resolve();
      await refreshStarted.promise;
      assert.equal(await page.locator(".v-progress-linear, .v-progress-circular").count(), 0);
      assert.deepEqual(await heading.boundingBox(), headingBox, `${viewport.name}: heading stays put while refreshing`);

      refresh.resolve();
      await page.getByText("Opened acme", { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      await page.close();
      page = null;
    }
  } catch (error) {
    console.error(await page?.locator("body").innerText());
    throw error;
  } finally {
    if (browser) await browser.close();
    await stopProcess(runtime);
  }
});
