import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { createWorkspaceRoleCatalog } from "../../workspaces-core/src/shared/roles.js";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";

const openFixture = sharedBrowserFixture({ fixtureRoot: fileURLToPath(new URL("../fixtures/role-labels/", import.meta.url)) });

test("Members displays configured labels but sends and reloads role IDs", {
  skip: process.env.JSKIT_WORKSPACE_ROLE_LABELS_BROWSER !== "1",
  timeout: 120_000
}, async (t) => {
  const { vite: runtime, browser } = await openFixture(t);
  let page;
  try {
    page = await browser.newPage({ baseURL: runtime.baseURL });
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(60_000);
    const errors = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    let labelled = true;
    let memberRole = "worker";
    const writes = [];
    const roles = {
      owner: { label: "Workspace owner", assignable: true, permissions: ["*"] },
      worker: { label: "Member", assignable: true, permissions: [] },
      safety_manager: { label: "Operator", assignable: true, permissions: [] },
      administrator: { label: "Controller", assignable: true, permissions: [] },
      training_assessor: { label: "Training assessor", assignable: true, permissions: [] }
    };
    const workspace = { id: "7", slug: "example", name: "Example", ownerUserId: "9", avatarUrl: "" };
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/session") {
        await route.fulfill({ json: { csrfToken: "fixture-csrf" } });
        return;
      }
      const catalog = createWorkspaceRoleCatalog({ roleCatalog: {
        workspace: { defaultInviteRole: "worker" },
        roles: Object.fromEntries(Object.entries(roles).map(([id, role]) => [id, labelled ? role : { assignable: role.assignable, permissions: role.permissions }]))
      } });
      if (request.method() !== "GET") {
        const body = request.postDataJSON();
        writes.push({ method: request.method(), path, attributes: body.data.attributes });
        if (request.method() === "PATCH") memberRole = body.data.attributes.roleSid;
      }
      let type;
      let attributes;
      if (path.endsWith("/roles")) {
        type = "workspace-role-catalogs";
        attributes = catalog;
      } else if (path.endsWith("/settings")) {
        type = "workspace-settings";
        attributes = { workspace, roleCatalog: catalog, settings: { invitesEnabled: true, invitesAvailable: true } };
      } else if (path.endsWith("/invites")) {
        type = "workspace-invites";
        attributes = { workspace, roleCatalog: catalog, invites: [{ id: "10", email: "pending@example.com", roleSid: "safety_manager", status: "pending", expiresAt: "2099-01-01T00:00:00.000Z", invitedByUserId: "9" }], createdInviteId: "10", inviteUrl: "", inviteDelivery: { status: "mailer_unconfigured" } };
      } else {
        type = "workspace-members";
        attributes = { workspace, roleCatalog: catalog, members: [
          { userId: "11", displayName: "Person", email: "person@example.com", roleSid: memberRole, status: "active", isOwner: false },
          { userId: "9", displayName: "Workspace creator", email: "owner@example.com", roleSid: "owner", status: "active", isOwner: true }
        ] };
      }
      await route.fulfill({ contentType: "application/vnd.api+json", json: { data: { type, id: "7", attributes } } });
    });
    await page.goto("/w/example/admin/members");
    const inviteRole = page.getByRole("combobox").first();
    const memberSelect = page.locator(".member-role-select");
    await memberSelect.getByText("Member", { exact: true }).waitFor();
    await expect(memberSelect.last()).toContainText("Workspace owner");
    // Vuetify 4.3's select also renders a hidden form input; the disabled control is its combobox input.
    await expect(memberSelect.last().locator("input[role='combobox']")).toBeDisabled();
    await page.getByText(/Role: Operator/u).waitFor();
    assert.match(await inviteRole.locator("xpath=ancestor::*[contains(@class, 'v-select')][1]").textContent(), /Member/u);
    for (const [id, label] of [["worker", "Member"], ["safety_manager", "Operator"], ["administrator", "Controller"], ["training_assessor", "Training assessor"]]) {
      await inviteRole.click();
      assert.equal(await page.getByRole("option", { name: "Workspace owner", exact: true }).count(), 0);
      await page.getByRole("option", { name: label, exact: true }).click();
      await page.getByLabel("Email", { exact: true }).fill("invite@example.com");
      await Promise.all([
        page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/invites")),
        page.getByRole("button", { name: "Send invite", exact: true }).click()
      ]);
      await expect(page.getByLabel("Email", { exact: true })).toHaveValue("");
      assert.equal(writes.at(-1).attributes.roleSid, id);
      await memberSelect.getByRole("combobox").first().click();
      const changed = memberRole !== id;
      const saved = changed
        ? page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith("/role"))
        : Promise.resolve();
      await page.getByRole("option", { name: label, exact: true }).click();
      await saved;
      await page.reload();
      await memberSelect.getByText(label, { exact: true }).waitFor();
      assert.equal(memberRole, id);
    }
    labelled = false;
    await page.reload();
    await memberSelect.getByText("Training_assessor", { exact: true }).waitFor();
    await page.getByText(/Role: safety_manager/u).waitFor();
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error(await page?.locator("body").innerText());
    throw error;
  } finally {
    await browser.close();
  }
});

test("Members and pending invites load a page at a time, and a refetch keeps every page loaded", {
  skip: process.env.JSKIT_WORKSPACE_ROLE_LABELS_BROWSER !== "1",
  timeout: 120_000
}, async (t) => {
  const { vite: runtime, browser } = await openFixture(t);
  let page;
  try {
    page = await browser.newPage({ baseURL: runtime.baseURL });
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(60_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const catalog = createWorkspaceRoleCatalog({ roleCatalog: {
      workspace: { defaultInviteRole: "member" },
      roles: { owner: { assignable: false, permissions: ["*"] }, member: { assignable: true, permissions: [] } }
    } });
    const workspace = { id: "7", slug: "example", name: "Example", ownerUserId: "9", avatarUrl: "" };
    const member = (userId, displayName) => ({
      userId, displayName, email: `${displayName.toLowerCase()}@example.com`, roleSid: userId === "9" ? "owner" : "member", status: "active", isOwner: userId === "9"
    });
    const invite = (id, email) => ({ id, email, roleSid: "member", status: "pending", expiresAt: "2099-01-01T00:00:00.000Z", invitedByUserId: "9" });
    // Each list's pages by the cursor that asks for them: the first page has none.
    const pages = {
      members: { "": { members: [member("11", "Amy"), member("12", "Bob")], nextCursor: "members-2" }, "members-2": { members: [member("9", "Zed")], nextCursor: null } },
      invites: { "": { invites: [invite("10", "first@example.com")], nextCursor: "invites-2" }, "invites-2": { invites: [invite("13", "second@example.com")], nextCursor: null } }
    };
    const reads = [];
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/session") {
        await route.fulfill({ json: { csrfToken: "fixture-csrf" } });
        return;
      }
      let type;
      let attributes;
      if (url.pathname.endsWith("/roles")) {
        type = "workspace-role-catalogs";
        attributes = catalog;
      } else if (url.pathname.endsWith("/settings")) {
        type = "workspace-settings";
        attributes = { workspace, roleCatalog: catalog, settings: { invitesEnabled: true, invitesAvailable: true } };
      } else {
        const list = url.pathname.endsWith("/invites") ? "invites" : "members";
        reads.push({ list, cursor: url.searchParams.get("page[cursor]") ?? "", limit: url.searchParams.get("page[limit]") });
        type = `workspace-${list}`;
        attributes = { workspace, roleCatalog: catalog, ...pages[list][url.searchParams.get("page[cursor]") ?? ""] };
      }
      await route.fulfill({ contentType: "application/vnd.api+json", json: { data: { type, id: "7", attributes } } });
    });
    await page.goto("/w/example/admin/members");
    await page.getByText("Bob", { exact: true }).waitFor();
    await page.getByText("first@example.com", { exact: true }).waitFor();
    assert.equal(await page.getByText("Zed", { exact: true }).count(), 0);
    assert.equal(await page.getByText("second@example.com", { exact: true }).count(), 0);
    assert.deepEqual(reads.map(({ list, cursor, limit }) => `${list}:${cursor}:${limit}`).sort(), ["invites::20", "members::20"]);

    const loadMore = page.getByRole("button", { name: "Load more", exact: true });
    await expect(loadMore).toHaveCount(2);
    await loadMore.first().click();
    await page.getByText("Zed", { exact: true }).waitFor();
    await expect(loadMore).toHaveCount(1);
    await loadMore.click();
    await page.getByText("second@example.com", { exact: true }).waitFor();
    await expect(loadMore).toHaveCount(0);
    assert.deepEqual(reads.slice(2).map(({ list, cursor }) => `${list}:${cursor}`), ["members:members-2", "invites:invites-2"]);

    // A refetch, as a realtime change makes, reads each loaded page again from the first, so none is dropped.
    reads.length = 0;
    await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => reads.length).toBe(4);
    assert.deepEqual(reads.map(({ list, cursor }) => `${list}:${cursor}`).sort(), ["invites:", "invites:invites-2", "members:", "members:members-2"]);
    for (const text of ["Amy", "Bob", "Zed", "first@example.com", "second@example.com"]) {
      await expect(page.getByText(text, { exact: true })).toHaveCount(1);
    }
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error(await page?.locator("body").innerText());
    throw error;
  } finally {
    await browser.close();
  }
});
