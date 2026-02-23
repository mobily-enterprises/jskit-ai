import { test, expect } from "@playwright/test";

const JSON_HEADERS = {
  "content-type": "application/json"
};

const WORKSPACE = {
  id: 1,
  slug: "acme",
  name: "Acme",
  color: "#0F6B54",
  roleId: "owner",
  isAccessible: true
};

const CALCULATOR_ROUTE_GLOB = "**/api/deg2rad";

function buildBootstrapResponse({ authenticated, csrfToken, username = "seed.user1" }) {
  const app = {
    tenancyMode: "workspace",
    features: {
      workspaceSwitching: true,
      workspaceInvites: true,
      workspaceCreateEnabled: true
    }
  };

  if (!authenticated) {
    return {
      session: {
        authenticated: false,
        username: null,
        csrfToken
      },
      app,
      workspaces: [],
      pendingInvites: [],
      activeWorkspace: null,
      membership: null,
      permissions: [],
      workspaceSettings: null
    };
  }

  return {
    session: {
      authenticated: true,
      username,
      csrfToken
    },
    profile: {
      displayName: username,
      email: `${username}@example.com`,
      avatar: null
    },
    app,
    workspaces: [WORKSPACE],
    pendingInvites: [],
    activeWorkspace: WORKSPACE,
    membership: {
      roleId: "owner",
      status: "active"
    },
    permissions: ["history.write", "workspace.settings.view"],
    workspaceSettings: {
      invitesEnabled: true,
      invitesAvailable: true,
      invitesEffective: true
    }
  };
}

async function mockBootstrap(page, payloadFactory) {
  let requestCount = 0;

  await page.route("**/api/bootstrap", async (route) => {
    requestCount += 1;
    const payload = typeof payloadFactory === "function" ? payloadFactory() : payloadFactory;
    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(payload)
    });
  });

  return {
    requestCount: () => requestCount
  };
}

async function mockSession(page, payloadFactory) {
  await page.route("**/api/session", async (route) => {
    const payload = typeof payloadFactory === "function" ? payloadFactory(route) : payloadFactory;
    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(payload)
    });
  });
}

test("login sends CSRF token and lands on calculator", async ({ page }) => {
  let loginCompleted = false;
  let loginRequestCount = 0;
  let loginCsrfHeader = null;

  const bootstrap = await mockBootstrap(page, () =>
    buildBootstrapResponse({
      authenticated: loginCompleted,
      csrfToken: "csrf-token-1"
    })
  );

  await mockSession(page, () => ({
    authenticated: loginCompleted,
    username: loginCompleted ? "seed.user1" : null,
    csrfToken: "csrf-token-1"
  }));

  await page.route("**/api/login", async (route) => {
    loginRequestCount += 1;
    loginCsrfHeader = route.request().headers()["csrf-token"] || null;
    loginCompleted = true;

    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: true,
        username: "seed.user1"
      })
    });
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill("user@example.com");
  await page.getByRole("textbox", { name: "Password" }).fill("password123");
  await page.getByTestId("auth-submit").click();

  await expect.poll(() => loginRequestCount).toBe(1);
  await expect.poll(() => bootstrap.requestCount()).toBeGreaterThan(0);
  expect(loginCsrfHeader).toBe("csrf-token-1");
  await expect(page).toHaveURL(/\/w\/acme$/);
  await expect(page.getByRole("button", { name: "Calculate" })).toBeVisible();
});

test("DEG2RAD conversion includes CSRF header and renders result", async ({ page }) => {
  let calculatorRequestCount = 0;
  let calculatorCsrfHeader = null;

  const bootstrap = await mockBootstrap(page, () =>
    buildBootstrapResponse({
      authenticated: true,
      csrfToken: "csrf-token-2"
    })
  );

  await mockSession(page, () => ({
    authenticated: true,
    username: "seed.user1",
    csrfToken: "csrf-token-2"
  }));

  await page.route(CALCULATOR_ROUTE_GLOB, async (route) => {
    calculatorRequestCount += 1;
    calculatorCsrfHeader = route.request().headers()["csrf-token"] || null;

    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        DEG2RAD_operation: "DEG2RAD",
        DEG2RAD_formula: "DEG2RAD(x) = x * PI / 180",
        DEG2RAD_degrees: "180.000000000000",
        DEG2RAD_radians: "3.141592653590"
      })
    });
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/w\/acme$/);
  await expect(page.getByRole("button", { name: "Calculate" })).toBeVisible();

  await page.getByRole("button", { name: "Calculate" }).click();

  await expect.poll(() => calculatorRequestCount).toBe(1);
  await expect.poll(() => bootstrap.requestCount()).toBeGreaterThan(0);
  expect(calculatorCsrfHeader).toBe("csrf-token-2");
  await expect(page.getByText("3.141592653590 rad", { exact: true })).toBeVisible();
  await expect(page.getByText("DEG2RAD(180.000000000000) = 3.141592653590 rad")).toBeVisible();
});

test("DEG2RAD conversion can be retried after transient API failure", async ({ page }) => {
  let calculatorRequestCount = 0;

  const bootstrap = await mockBootstrap(page, () =>
    buildBootstrapResponse({
      authenticated: true,
      csrfToken: "csrf-token-retry"
    })
  );

  await mockSession(page, () => ({
    authenticated: true,
    username: "seed.user1",
    csrfToken: "csrf-token-retry"
  }));

  await page.route(CALCULATOR_ROUTE_GLOB, async (route) => {
    calculatorRequestCount += 1;

    if (calculatorRequestCount === 1) {
      await route.fulfill({
        status: 503,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          error: "Temporary upstream failure."
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        DEG2RAD_operation: "DEG2RAD",
        DEG2RAD_formula: "DEG2RAD(x) = x * PI / 180",
        DEG2RAD_degrees: "90.000000000000",
        DEG2RAD_radians: "1.570796326795"
      })
    });
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/w\/acme$/);
  await expect(page.getByRole("button", { name: "Calculate" })).toBeVisible();
  await page.getByRole("button", { name: "Calculate" }).click();

  await expect.poll(() => calculatorRequestCount).toBe(1);
  await expect(page.getByText("Temporary upstream failure.")).toBeVisible();

  await page.getByRole("button", { name: "Calculate" }).click();
  await expect.poll(() => calculatorRequestCount).toBe(2);
  await expect.poll(() => bootstrap.requestCount()).toBeGreaterThan(0);
  await expect(page.getByText("1.570796326795 rad", { exact: true })).toBeVisible();
});
