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
    permissions: ["annuity.calculate", "annuity.history.read", "workspace.settings.view"],
    workspaceSettings: {
      invitesEnabled: true,
      invitesAvailable: true,
      invitesEffective: true,
      defaultMode: "fv",
      defaultTiming: "ordinary",
      defaultPaymentsPerYear: 12,
      defaultHistoryPageSize: 10
    }
  };
}

function buildHistoryResponse(entries) {
  return {
    entries,
    page: 1,
    pageSize: 10,
    total: entries.length,
    totalPages: 1
  };
}

test("login sends CSRF token and lands on calculator", async ({ page }) => {
  let loginCompleted = false;
  let loginRequestCount = 0;
  let loginCsrfHeader = null;

  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        buildBootstrapResponse({
          authenticated: loginCompleted,
          csrfToken: "csrf-token-1"
        })
      )
    });
  });

  await page.route("**/api/session", async (route) => {
    const payload = {
      authenticated: loginCompleted,
      username: loginCompleted ? "seed.user1" : null,
      csrfToken: "csrf-token-1"
    };

    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(payload)
    });
  });

  await page.route("**/api/history**", async (route) => {
    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(buildHistoryResponse([]))
    });
  });

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
  expect(loginCsrfHeader).toBe("csrf-token-1");
  await expect(page).toHaveURL(/\/w\/acme$/);
  await expect(page.getByRole("button", { name: "Calculate" })).toBeVisible();
});

test("calculate appends history and includes CSRF header", async ({ page }) => {
  const entries = [];
  let historyIndex = 1;
  let annuityRequestCount = 0;
  let annuityCsrfHeader = null;

  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        buildBootstrapResponse({
          authenticated: true,
          csrfToken: "csrf-token-2"
        })
      )
    });
  });

  await page.route("**/api/session", async (route) => {
    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        authenticated: true,
        username: "seed.user1",
        csrfToken: "csrf-token-2"
      })
    });
  });

  await page.route("**/api/history**", async (route) => {
    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(buildHistoryResponse(entries))
    });
  });

  await page.route("**/api/annuityCalculator", async (route) => {
    annuityRequestCount += 1;
    annuityCsrfHeader = route.request().headers()["csrf-token"] || null;

    const now = new Date().toISOString();
    const entry = {
      id: `entry-${historyIndex}`,
      createdAt: now,
      mode: "fv",
      timing: "ordinary",
      payment: "500.000000",
      annualRate: "6.000000",
      annualGrowthRate: "0.000000",
      years: "20.0000",
      paymentsPerYear: 12,
      periodicRate: "0.005000000000",
      periodicGrowthRate: "0.000000000000",
      totalPeriods: "240.0000",
      isPerpetual: false,
      value: "230581.364674000000"
    };

    historyIndex += 1;
    entries.unshift(entry);

    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ...entry,
        warnings: [],
        assumptions: {
          rateConversion: "Periodic discount rate = annualRate/100/paymentsPerYear.",
          timing: "Ordinary annuity assumes end-of-period payments.",
          growingAnnuity: "Growing annuity assumes a constant annual growth rate.",
          perpetuity: "Perpetual present value requires discount > growth."
        },
        historyId: entry.id
      })
    });
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/w\/acme$/);
  await expect(page.getByRole("button", { name: "Calculate" })).toBeVisible();

  await page.getByRole("button", { name: "Calculate" }).click();

  await expect.poll(() => annuityRequestCount).toBe(1);
  expect(annuityCsrfHeader).toBe("csrf-token-2");
  await expect(page.getByText("Page 1 of 1 (1 total)")).toBeVisible();
  await expect(page.getByRole("cell", { name: "$230,581.36" })).toBeVisible();
  await expect(page.getByText("no payment growth")).toBeVisible();
});

test("calculate can be retried after transient API failure", async ({ page }) => {
  let annuityRequestCount = 0;

  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        buildBootstrapResponse({
          authenticated: true,
          csrfToken: "csrf-token-retry"
        })
      )
    });
  });

  await page.route("**/api/session", async (route) => {
    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        authenticated: true,
        username: "seed.user1",
        csrfToken: "csrf-token-retry"
      })
    });
  });

  await page.route("**/api/history**", async (route) => {
    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(buildHistoryResponse([]))
    });
  });

  await page.route("**/api/annuityCalculator", async (route) => {
    annuityRequestCount += 1;

    if (annuityRequestCount === 1) {
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
        id: "entry-retry-1",
        createdAt: new Date().toISOString(),
        mode: "fv",
        timing: "ordinary",
        payment: "500.000000",
        annualRate: "6.000000",
        annualGrowthRate: "0.000000",
        years: "20.0000",
        paymentsPerYear: 12,
        periodicRate: "0.005000000000",
        periodicGrowthRate: "0.000000000000",
        totalPeriods: "240.0000",
        isPerpetual: false,
        value: "230581.364674000000",
        warnings: [],
        assumptions: {
          rateConversion: "Periodic discount rate = annualRate/100/paymentsPerYear.",
          timing: "Ordinary annuity assumes end-of-period payments.",
          growingAnnuity: "Growing annuity assumes a constant annual growth rate.",
          perpetuity: "Perpetual present value requires discount > growth."
        },
        historyId: "entry-retry-1"
      })
    });
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/w\/acme$/);
  await expect(page.getByRole("button", { name: "Calculate" })).toBeVisible();
  await page.getByRole("button", { name: "Calculate" }).click();

  await expect.poll(() => annuityRequestCount).toBe(1);
  await expect(page.getByText("Temporary upstream failure.")).toBeVisible();

  await page.getByRole("button", { name: "Calculate" }).click();
  await expect.poll(() => annuityRequestCount).toBe(2);
  await expect(page.getByText("$230,581.36")).toBeVisible();
});
