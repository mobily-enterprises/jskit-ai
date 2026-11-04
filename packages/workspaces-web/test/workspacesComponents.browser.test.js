import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 }
];

const WORKSPACES = [
  { id: "1", slug: "home", name: "Home", roleSid: "owner" },
  { id: "2", slug: "acme", name: "Acme", roleSid: "member" },
  { id: "3", slug: "zen", name: "Zen Garden", roleSid: "member" }
];

const INVITES = [
  { id: "5", workspaceId: "4", workspaceSlug: "zen-two", workspaceName: "Zen Two", token: "zen-two-token", roleSid: "member" },
  { id: "6", workspaceId: "8", workspaceSlug: "orbit", workspaceName: "Orbit", token: "orbit-token", roleSid: "admin", roleLabel: "Administrator" }
];

function createDeferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// A request the fixture server holds: `arrived` settles when it comes in, `release` lets it answer.
function createGate() {
  return { arrived: createDeferred(), release: createDeferred() };
}

async function arrival(gate, label) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`No ${label} request arrived.`)), 15_000);
  });
  try {
    await Promise.race([gate.arrived.promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function openPage(browser, baseURL, viewport) {
  const page = await browser.newPage({ baseURL, viewport });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return { page, errors };
}

async function assertNoHorizontalScroll(page, label) {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    0,
    `${label}: no horizontal scroll`
  );
}

function readListItems(list) {
  return list.locator(".v-list-item").evaluateAll((items) => items.map((item) => [
    item.querySelector(".v-list-item-title")?.textContent.trim() || "",
    item.querySelector(".v-list-item-subtitle")?.textContent.trim() || "",
    item.classList.contains("v-list-item--active")
  ]));
}

async function checkWorkspaceSelector(page, viewport) {
  const requests = [];
  await page.route("**/api/**", async (route) => {
    requests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.fulfill({ status: 404, json: {} });
  });
  const selector = page.locator(".users-workspace-selector__activator");
  const menu = page.locator(".v-menu .v-list");

  await page.goto("/w/acme");
  await page.getByText("Opened acme", { exact: true }).waitFor();
  await expect(selector).toHaveText("Acme");
  assert.ok((await selector.boundingBox()).height >= 48, `${viewport.name}: the selector is a 48px target`);
  await assertNoHorizontalScroll(page, `${viewport.name} selector`);

  await selector.click();
  await expect(menu).toBeVisible();
  await expect(menu.locator(".v-list-subheader")).toHaveText("Workspaces");
  assert.deepEqual(await readListItems(menu), [
    ["Home", "/home", false],
    ["Acme", "/acme", true],
    ["Zen Garden", "/zen", false]
  ]);
  await menu.getByText("Zen Garden", { exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/w/zen");
  await page.getByText("Opened zen", { exact: true }).waitFor();
  await expect(selector).toHaveText("Zen Garden");

  // On the admin surface another workspace opens on the admin surface too.
  await page.goto("/w/zen/admin");
  await page.getByText("Admin of zen", { exact: true }).waitFor();
  await expect(selector).toHaveText("Zen Garden");
  await selector.click();
  await expect(menu).toBeVisible();
  assert.deepEqual(await readListItems(menu), [
    ["Home", "/home", false],
    ["Acme", "/acme", false],
    ["Zen Garden", "/zen", true]
  ]);
  await menu.getByText("Home", { exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/w/home/admin");
  await page.getByText("Admin of home", { exact: true }).waitFor();
  await expect(selector).toHaveText("Home");

  // A surface without a workspace has no selector.
  await page.goto("/home");
  await page.getByText("Home page", { exact: true }).waitFor();
  await expect(selector).toHaveCount(0);
  assert.deepEqual(requests, [], "the selector reads the placement context and fetches nothing");
}

async function checkInvitesSection(page, viewport) {
  let pendingInvites = INVITES.map((invite) => ({ ...invite }));
  let bootstrapGate = null;
  let redeemGate = null;
  const redeems = [];
  const unexpected = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/session") {
      await route.fulfill({ json: { csrfToken: "fixture-csrf" } });
      return;
    }
    if (request.method() === "GET" && path === "/api/bootstrap") {
      const gate = bootstrapGate;
      if (gate) {
        gate.arrived.resolve();
        await gate.release.promise;
      }
      await route.fulfill({
        json: {
          session: { authenticated: true, userId: "7" },
          tenancy: { mode: "workspaces", workspace: { allowSelfCreate: true } },
          app: { features: { workspaceInvites: true } },
          workspaces: WORKSPACES,
          pendingInvites
        }
      });
      return;
    }
    if (request.method() === "POST" && path === "/api/workspace/invitations/redeem") {
      const body = request.postDataJSON();
      redeems.push({ csrfToken: request.headers()["csrf-token"], type: body?.data?.type, attributes: body?.data?.attributes });
      const gate = redeemGate;
      if (gate) {
        gate.arrived.resolve();
        await gate.release.promise;
      }
      pendingInvites = pendingInvites.filter((invite) => invite.token !== body.data.attributes.token);
      await route.fulfill({
        contentType: "application/vnd.api+json",
        json: { data: { type: "workspace-invitation-decisions", id: "1", attributes: { decision: body.data.attributes.decision } } }
      });
      return;
    }
    unexpected.push(`${request.method()} ${path}`);
    await route.fulfill({ status: 404, json: {} });
  });
  const section = page.locator(".account-invites-section");
  const rows = section.locator(".v-list-item");
  const button = (workspaceName, label) => rows.filter({ hasText: workspaceName }).getByRole("button", { name: label, exact: true });
  const progress = section.locator(".v-progress-linear");

  // Loading.
  bootstrapGate = createGate();
  await page.goto("/account");
  await arrival(bootstrapGate, "bootstrap");
  await expect(section.getByText("Invitations", { exact: true })).toBeVisible();
  await expect(section.locator(".v-skeleton-loader")).toBeVisible();
  await expect(section.getByText("No pending invitations.", { exact: true })).toHaveCount(0);
  bootstrapGate.release.resolve();
  bootstrapGate = null;

  // The list.
  await expect(rows).toHaveCount(2);
  await expect(section.locator(".v-skeleton-loader")).toHaveCount(0);
  assert.deepEqual(await readListItems(section), [
    ["Zen Two", "/zen-two • role: member", false],
    ["Orbit", "/orbit • role: Administrator", false]
  ]);
  await assertNoHorizontalScroll(page, `${viewport.name} invitations`);
  if (viewport.name === "phone") {
    const heights = await section.locator(".v-btn").evaluateAll((buttons) => buttons.map((item) => item.getBoundingClientRect().height));
    assert.ok(heights.length === 4 && heights.every((height) => height >= 48), `${viewport.name}: 48px targets, got ${heights}`);
  }

  // Refuse: busy while the server answers, the others wait, and the list refreshes after it.
  redeemGate = createGate();
  await button("Zen Two", "Refuse").click();
  await arrival(redeemGate, "redeem");
  await expect(button("Zen Two", "Refuse")).toHaveAttribute("aria-busy", "true");
  await expect(button("Orbit", "Refuse")).toBeDisabled();
  await expect(button("Orbit", "Join")).toBeDisabled();
  await button("Zen Two", "Join").click();
  await expect(button("Zen Two", "Join")).not.toHaveAttribute("aria-busy", "true");
  bootstrapGate = createGate();
  redeemGate.release.resolve();
  redeemGate = null;
  await arrival(bootstrapGate, "bootstrap");
  await expect(rows).toHaveCount(1);
  await expect(progress).toBeVisible();
  await expect(button("Orbit", "Refuse")).toBeDisabled();
  await expect(button("Orbit", "Join")).toBeDisabled();
  bootstrapGate.release.resolve();
  bootstrapGate = null;
  await expect(progress).toHaveCount(0);
  await expect(button("Orbit", "Join")).toBeEnabled();
  await expect(button("Orbit", "Refuse")).toBeEnabled();

  // Join: busy, refreshed, then the joined workspace opens.
  redeemGate = createGate();
  await button("Orbit", "Join").click();
  await arrival(redeemGate, "redeem");
  await expect(button("Orbit", "Join")).toHaveAttribute("aria-busy", "true");
  bootstrapGate = createGate();
  redeemGate.release.resolve();
  redeemGate = null;
  await arrival(bootstrapGate, "bootstrap");
  await expect(rows).toHaveCount(0);
  await expect(progress).toBeVisible();
  await expect(section.getByText("No pending invitations.", { exact: true })).toBeVisible();
  bootstrapGate.release.resolve();
  bootstrapGate = null;
  await page.waitForURL((url) => url.pathname === "/w/orbit");
  await page.getByText("Opened orbit", { exact: true }).waitFor();
  assert.deepEqual(await page.locator(".fixture-feedback li").allTextContents(), ["success: Invitation refused."]);

  // Nothing pending.
  await page.goto("/account");
  await expect(section.getByText("No pending invitations.", { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(0);
  await expect(section.locator(".v-skeleton-loader, .v-progress-linear")).toHaveCount(0);

  assert.deepEqual(redeems, [
    { csrfToken: "fixture-csrf", type: "workspace-invitation-decisions", attributes: { token: "zen-two-token", decision: "refuse" } },
    { csrfToken: "fixture-csrf", type: "workspace-invitation-decisions", attributes: { token: "orbit-token", decision: "accept" } }
  ]);
  assert.deepEqual(unexpected, []);
}

test("The workspace selector and the account invitations work in a real browser", {
  skip: process.env.JSKIT_WORKSPACES_WEB_COMPONENTS_BROWSER !== "1",
  timeout: 240_000
}, async (t) => {
  const runtime = await startViteFixture({ fixtureRoot: fileURLToPath(new URL("../fixtures/workspaces-components/", import.meta.url)) });
  let browser;
  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    for (const [name, check] of [
      ["the selector lists the workspaces, marks the current one and opens the chosen one", checkWorkspaceSelector],
      ["the invitations load, list, refuse and join through the redeem endpoint", checkInvitesSection]
    ]) {
      for (const viewport of VIEWPORTS) {
        await t.test(`${viewport.name}: ${name}`, async () => {
          const { page, errors } = await openPage(browser, runtime.baseURL, viewport);
          try {
            await check(page, viewport);
            assert.deepEqual(errors, []);
          } catch (error) {
            console.error(await page.locator("body").innerText().catch(() => ""));
            throw error;
          } finally {
            await page.close();
          }
        });
      }
    }
  } finally {
    if (browser) await browser.close();
    await stopProcess(runtime);
  }
});
