import { test, expect } from "@playwright/test";

const JSON_HEADERS = {
  "content-type": "application/json"
};

const WORKSPACE = Object.freeze({
  id: 1,
  slug: "acme",
  name: "Acme",
  color: "#0F6B54",
  roleId: "owner",
  isAccessible: true
});

const DEFAULT_BOOTSTRAP_RESPONSE = Object.freeze({
  session: {
    authenticated: true,
    username: "owner.user",
    csrfToken: "csrf-shell"
  },
  profile: {
    displayName: "Owner User",
    email: "owner.user@example.com",
    avatar: null
  },
  app: {
    tenancyMode: "team-single",
    features: {
      workspaceSwitching: true,
      workspaceInvites: true,
      workspaceCreateEnabled: true,
      assistantEnabled: true,
      assistantRequiredPermission: "",
      socialEnabled: true,
      socialFederationEnabled: false
    }
  },
  workspaces: [WORKSPACE],
  pendingInvites: [],
  activeWorkspace: WORKSPACE,
  membership: {
    roleId: "owner",
    status: "active"
  },
  permissions: [
    "workspace.settings.view",
    "workspace.settings.update",
    "workspace.ai.transcripts.read",
    "workspace.billing.manage",
    "workspace.members.view",
    "workspace.members.manage",
    "chat.read",
    "social.read",
    "social.moderate"
  ],
  workspaceSettings: {
    invitesEnabled: true,
    invitesAvailable: true,
    invitesEffective: true
  }
});

const DEFAULT_CONSOLE_BOOTSTRAP_RESPONSE = Object.freeze({
  membership: {
    roleId: "console",
    status: "active"
  },
  permissions: [
    "console.members.view",
    "console.errors.browser.read",
    "console.errors.server.read",
    "console.ai.transcripts.read_all",
    "console.billing.events.read_all",
    "console.billing.catalog.manage",
    "console.billing.operations.manage"
  ],
  pendingInvites: [],
  roleCatalog: {
    defaultInviteRole: "console",
    roles: [
      {
        id: "console",
        assignable: true,
        permissions: ["console.members.view"]
      }
    ],
    assignableRoleIds: ["console"]
  }
});

function buildAlertsResponse() {
  return {
    entries: [],
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
    unreadCount: 0,
    readThroughAlertId: null
  };
}

async function installShellApiMocks(page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname === "/api/bootstrap" && method === "GET") {
      await route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(DEFAULT_BOOTSTRAP_RESPONSE)
      });
      return;
    }

    if (pathname === "/api/session" && method === "GET") {
      await route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(DEFAULT_BOOTSTRAP_RESPONSE.session)
      });
      return;
    }

    if (pathname === "/api/console/bootstrap" && method === "GET") {
      await route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(DEFAULT_CONSOLE_BOOTSTRAP_RESPONSE)
      });
      return;
    }

    if (pathname === "/api/alerts" && method === "GET") {
      await route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(buildAlertsResponse())
      });
      return;
    }

    if (pathname === "/api/console/invitations/pending" && method === "GET") {
      await route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ pendingInvites: [] })
      });
      return;
    }

    if (pathname === "/api/workspace/invitations/pending" && method === "GET") {
      await route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ pendingInvites: [] })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({})
    });
  });
}

test("shell baseline: app surface shows drawer and top user controls", async ({ page }) => {
  await installShellApiMocks(page);

  await page.goto("/");

  await expect(page).toHaveURL(/\/w\/acme$/);
  await expect(page.getByLabel("Open user menu")).toBeVisible();
  await expect(page.getByLabel("Open alerts")).toBeVisible();
  await expect(page.locator(".v-navigation-drawer")).toBeVisible();
  await expect(page.getByText("Deg2rad", { exact: true })).toBeVisible();

  await page.getByLabel("Open user menu").click();
  await expect(page.getByText("Account settings")).toBeVisible();
});

test("shell baseline: admin surface shows workspace controls and drawer entries", async ({ page }) => {
  await installShellApiMocks(page);

  await page.goto("/admin/w/acme/settings");

  await expect(page).toHaveURL(/\/admin\/w\/acme\/settings$/);
  await expect(page.locator(".v-navigation-drawer")).toBeVisible();
  await expect(page.getByText("Projects")).toBeVisible();
  await expect(page.getByLabel("Open workspace controls")).toBeVisible();

  await page.getByLabel("Open workspace controls").click();
  await expect(page.getByText("Monitoring")).toBeVisible();
  await expect(page.getByText("Billing")).toBeVisible();

  await page.getByLabel("Open user menu").click();
  await expect(page.getByText("Back to App")).toBeVisible();
});

test("shell baseline: console surface shows grouped drawer sections", async ({ page }) => {
  await installShellApiMocks(page);

  await page.goto("/console");

  await expect(page).toHaveURL(/\/console$/);
  await expect(page.locator(".v-navigation-drawer")).toBeVisible();
  await expect(page.getByText("Members")).toBeVisible();
  await expect(page.getByText("AI Transcripts")).toBeVisible();
  await expect(page.getByText("Server errors")).toBeVisible();
  await expect(page.getByText("Client errors")).toBeVisible();
  await expect(page.getByText("Billing events")).toBeVisible();

  await page.getByLabel("Open user menu").click();
  await expect(page.getByText("Account settings")).toBeVisible();
});
