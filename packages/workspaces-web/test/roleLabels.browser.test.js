import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createWorkspaceRoleCatalog } from "../../workspaces-core/src/shared/roles.js";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

test("Members displays configured labels but sends and reloads role IDs", {
  skip: process.env.JSKIT_WORKSPACE_ROLE_LABELS_BROWSER !== "1",
  timeout: 120_000
}, async () => {
  const runtime = await startViteFixture({ fixtureRoot: fileURLToPath(new URL("../fixtures/role-labels/", import.meta.url)) });
  let browser;
  let page;
  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
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
    await expect(memberSelect.last().locator("input")).toBeDisabled();
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
    if (browser) await browser.close();
    await stopProcess(runtime);
  }
});
