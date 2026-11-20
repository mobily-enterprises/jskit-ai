import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";

const openFixture = sharedBrowserFixture({ fixtureRoot: fileURLToPath(new URL("../fixtures/invite-landing/", import.meta.url)) });
const RUN = { skip: process.env.JSKIT_WORKSPACES_WEB_INVITE_LANDING_BROWSER !== "1", timeout: 180_000 };
const OTHER = "a.rather.long.address.for.a.phone@other-example.com";

// The page for invitation tok-1, sent to invited@example.com in Acme, signed in as `auth`; the workspace requires
// the invited address when `requiresSameEmail`. Answers its resolve, and records each redeem's attributes.
async function openInvite(browser, baseURL, { auth, requiresSameEmail, viewport = { width: 1280, height: 900 } }) {
  const page = await browser.newPage({ baseURL, viewport });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);
  const errors = [];
  const redeemed = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((value) => { window.inviteLandingAuth = value; }, auth);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/session") {
      await route.fulfill({ json: { csrfToken: "fixture-csrf" } });
      return;
    }
    if (path === "/api/workspace/invitations/resolve") {
      await route.fulfill({
        contentType: "application/vnd.api+json",
        json: {
          data: {
            type: "workspace-invitation-resolutions",
            id: "60",
            attributes: {
              token: "tok-1",
              status: "pending",
              email: "invited@example.com",
              maskedEmail: "i*****@example.com",
              roleSid: "member",
              expiresAt: null,
              requiresSameEmail,
              workspace: { id: "3", slug: "acme", name: "Acme", avatarUrl: "" }
            }
          }
        }
      });
      return;
    }
    assert.equal(path, "/api/workspace/invitations/redeem");
    redeemed.push(route.request().postDataJSON().data.attributes);
    await route.fulfill({
      contentType: "application/vnd.api+json",
      json: { data: { type: "workspace-invitation-decisions", id: "60", attributes: { decision: "accept", workspaceId: "3" } } }
    });
  });
  await page.goto("/invite/tok-1");
  return { page, errors, redeemed };
}

test("signed in with another address, the invitation page offers to join as it, and joins once that is clicked", RUN, async (t) => {
  const { vite, browser } = await openFixture(t);
  const { page, errors, redeemed } = await openInvite(browser, vite.baseURL, {
    auth: { authenticated: true, email: OTHER },
    requiresSameEmail: false,
    viewport: { width: 390, height: 844 }
  });

  await expect(page.getByTestId("invite-landing-other-account"))
    .toHaveText(`This invitation was sent to i*****@example.com. You're signed in as ${OTHER}.`);
  await expect(page.getByRole("link", { name: "Use a different account" })).toHaveAttribute("href", "/auth/signout?returnTo=%2Finvite%2Ftok-1");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0,
    "no horizontal scroll on a phone, whatever the address");
  await page.getByRole("button", { name: `Join as ${OTHER}` }).click();
  await page.getByText("Opened acme", { exact: true }).waitFor();
  assert.deepEqual(redeemed, [{ token: "tok-1", decision: "accept", acceptAs: OTHER }]);
  assert.deepEqual(errors, []);
});

test("a workspace that requires the invited address offers another account only to switch accounts", RUN, async (t) => {
  const { vite, browser } = await openFixture(t);
  const { page, errors, redeemed } = await openInvite(browser, vite.baseURL, {
    auth: { authenticated: true, email: "other@example.com" },
    requiresSameEmail: true
  });

  await expect(page.getByTestId("invite-landing-other-account")).toHaveText(
    "This invitation was sent to i*****@example.com, and only that address can accept it. You're signed in as other@example.com."
  );
  await expect(page.getByRole("link", { name: "Use a different account" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Accept invitation|Join as/u })).toHaveCount(0);
  assert.deepEqual(redeemed, []);
  assert.deepEqual(errors, []);
});

test("signed in with the invited address, the invitation page accepts it as before", RUN, async (t) => {
  const { vite, browser } = await openFixture(t);
  const { page, errors, redeemed } = await openInvite(browser, vite.baseURL, {
    auth: { authenticated: true, email: "Invited@Example.com" },
    requiresSameEmail: true
  });

  await expect(page.getByTestId("invite-landing-other-account")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Use a different account" })).toHaveCount(0);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await page.getByText("Opened acme", { exact: true }).waitFor();
  assert.deepEqual(redeemed, [{ token: "tok-1", decision: "accept" }]);
  assert.deepEqual(errors, []);
});
