import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, __testables } from "../../src/platform/http/api/index.js";

function mockResponse({
  status = 200,
  data = {},
  contentType = "application/json; charset=utf-8",
  jsonReject = false
} = {}) {
  const json = vi.fn();
  if (jsonReject) {
    json.mockRejectedValue(new Error("invalid json"));
  } else {
    json.mockResolvedValue(data);
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: vi.fn((name) => (String(name).toLowerCase() === "content-type" ? contentType : ""))
    },
    json
  };
}

describe("client api transport", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    __testables.resetApiStateForTests();
  });

  it("performs a basic session request and handles non-json payloads", async () => {
    global.fetch.mockResolvedValueOnce(mockResponse({ contentType: "text/plain" }));

    const payload = await api.auth.session();

    expect(payload).toEqual({});
    expect(global.fetch).toHaveBeenCalledWith("/api/v1/session", {
      credentials: "same-origin",
      method: "GET",
      headers: {
        "x-surface-id": "app"
      }
    });
  });

  it("handles csrf bootstrap session responses without json content-type", async () => {
    global.fetch.mockResolvedValueOnce(mockResponse({ contentType: "text/plain" }));

    const token = await __testables.ensureCsrfToken(true);

    expect(token).toBe("");
    expect(global.fetch).toHaveBeenCalledWith("/api/v1/session", {
      method: "GET",
      credentials: "same-origin"
    });
  });

  it("handles csrf bootstrap responses with missing content-type header", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn(() => undefined)
      },
      json: vi.fn()
    });

    const token = await __testables.ensureCsrfToken(true);
    expect(token).toBe("");
  });

  it("serializes object payloads and applies csrf token for unsafe requests", async () => {
    global.fetch
      .mockResolvedValueOnce(mockResponse({ data: { csrfToken: "csrf-a" } }))
      .mockResolvedValueOnce(mockResponse({ data: { ok: true } }));

    const result = await __testables.request("/api/v1/custom-unsafe", {
      method: "POST",
      body: { DEG2RAD_degrees: 180 }
    });

    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenNthCalledWith(1, "/api/v1/session", {
      method: "GET",
      credentials: "same-origin"
    });

    const secondCall = global.fetch.mock.calls[1];
    expect(secondCall[0]).toBe("/api/v1/custom-unsafe");
    expect(secondCall[1].headers["Content-Type"]).toBe("application/json");
    expect(secondCall[1].headers["csrf-token"]).toBe("csrf-a");
    expect(secondCall[1].body).toBe(JSON.stringify({ DEG2RAD_degrees: 180 }));
  });

  it("does not overwrite an explicit content-type header", async () => {
    global.fetch.mockResolvedValueOnce(mockResponse({ data: { ok: true } }));

    const result = await __testables.request("/api/v1/custom", {
      method: "POST",
      headers: {
        "Content-Type": "application/custom+json",
        "csrf-token": "provided-token"
      },
      body: { demo: true }
    });

    expect(result).toEqual({ ok: true });
    const call = global.fetch.mock.calls[0];
    expect(call[1].headers["Content-Type"]).toBe("application/custom+json");
    expect(call[1].headers["csrf-token"]).toBe("provided-token");
    expect(call[1].body).toBe(JSON.stringify({ demo: true }));
  });

  it("preserves FormData payloads without json conversion", async () => {
    global.fetch
      .mockResolvedValueOnce(mockResponse({ data: { csrfToken: "csrf-b" } }))
      .mockResolvedValueOnce(mockResponse({ data: { ok: true } }));

    const formData = new FormData();
    formData.append("file", "data");

    const result = await __testables.request("/api/v1/custom-upload", {
      method: "POST",
      body: formData
    });
    const requestCall = global.fetch.mock.calls[1];

    expect(result).toEqual({ ok: true });
    expect(requestCall[1].body).toBe(formData);
    expect(requestCall[1].headers["Content-Type"]).toBeUndefined();
    expect(requestCall[1].headers["csrf-token"]).toBe("csrf-b");
  });

  it("retries once after csrf failure and then succeeds", async () => {
    global.fetch
      .mockResolvedValueOnce(mockResponse({ data: { csrfToken: "csrf-1" } }))
      .mockResolvedValueOnce(
        mockResponse({
          status: 403,
          data: {
            error: "forbidden",
            details: {
              code: "FST_CSRF_INVALID_TOKEN"
            }
          }
        })
      )
      .mockResolvedValueOnce(mockResponse({ data: { csrfToken: "csrf-2" } }))
      .mockResolvedValueOnce(mockResponse({ data: { ok: true, csrfToken: "csrf-3" } }));

    const result = await api.auth.logout();

    expect(result).toEqual({ ok: true, csrfToken: "csrf-3" });
    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(global.fetch.mock.calls[1][1].headers["csrf-token"]).toBe("csrf-1");
    expect(global.fetch.mock.calls[3][1].headers["csrf-token"]).toBe("csrf-2");
  });

  it("does not retry unsafe requests for non-csrf 403 responses", async () => {
    global.fetch.mockResolvedValueOnce(mockResponse({ data: { csrfToken: "csrf-1" } })).mockResolvedValueOnce(
      mockResponse({
        status: 403,
        data: {
          error: "forbidden",
          details: {
            code: "FORBIDDEN"
          }
        }
      })
    );

    await expect(api.auth.logout()).rejects.toMatchObject({
      status: 403,
      message: "forbidden",
      details: {
        code: "FORBIDDEN"
      }
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws http error after csrf retry is exhausted", async () => {
    global.fetch
      .mockResolvedValueOnce(mockResponse({ data: { csrfToken: "csrf-1" } }))
      .mockResolvedValueOnce(
        mockResponse({
          status: 403,
          data: {
            error: "first fail",
            details: {
              code: "FST_CSRF_INVALID_TOKEN"
            }
          }
        })
      )
      .mockResolvedValueOnce(mockResponse({ data: { csrfToken: "csrf-2" } }))
      .mockResolvedValueOnce(
        mockResponse({
          status: 403,
          data: {
            fieldErrors: { request: "blocked" },
            details: {
              code: "FST_CSRF_INVALID_TOKEN"
            }
          }
        })
      );

    await expect(api.auth.logout()).rejects.toMatchObject({
      status: 403,
      message: "Request failed with status 403.",
      fieldErrors: { request: "blocked" }
    });
  });

  it("maps validation errors including details.fieldErrors", async () => {
    global.fetch.mockResolvedValueOnce(
      mockResponse({
        status: 400,
        data: {
          error: "Validation failed.",
          details: {
            fieldErrors: {
              page: "must be integer",
              pageSize: "must be integer"
            }
          }
        }
      })
    );

    await expect(api.history.list(1, 10)).rejects.toMatchObject({
      status: 400,
      message: "Validation failed.",
      fieldErrors: {
        page: "must be integer",
        pageSize: "must be integer"
      }
    });
  });

  it("throws when csrf session bootstrap returns non-ok response", async () => {
    global.fetch.mockResolvedValueOnce(
      mockResponse({
        status: 503,
        data: { error: "Session service unavailable." }
      })
    );

    await expect(__testables.ensureCsrfToken(true)).rejects.toMatchObject({
      status: 503,
      message: "Session service unavailable."
    });
  });

  it("handles network failures from csrf bootstrap and normal requests", async () => {
    const networkError = new Error("offline");
    global.fetch.mockRejectedValueOnce(networkError);
    await expect(api.auth.logout()).rejects.toMatchObject({
      status: 0,
      message: "Network request failed.",
      cause: networkError
    });

    __testables.resetApiStateForTests();
    global.fetch.mockRejectedValueOnce(networkError);
    await expect(api.auth.session()).rejects.toMatchObject({
      status: 0,
      message: "Network request failed.",
      cause: networkError
    });
  });

  it("handles malformed json in standard request responses", async () => {
    global.fetch.mockResolvedValueOnce(
      mockResponse({
        contentType: "application/json",
        jsonReject: true
      })
    );

    const payload = await api.auth.session();
    expect(payload).toEqual({});
  });

  it("handles malformed json payloads and requests without csrf token", async () => {
    global.fetch
      .mockResolvedValueOnce(mockResponse({ contentType: "application/json", jsonReject: true }))
      .mockResolvedValueOnce(mockResponse({ data: { ok: true } }));

    const result = await api.auth.logout();

    expect(result).toEqual({ ok: true });
    expect(global.fetch.mock.calls[1][1].headers["csrf-token"]).toBeUndefined();
  });

  it("treats missing content-type headers as non-json", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn(() => undefined)
      },
      json: vi.fn()
    });

    const response = await __testables.request("/api/v1/no-content-type", {
      method: "GET"
    });

    expect(response).toEqual({});
  });

  it("supports explicit force refresh and deduplicates in-flight csrf fetches", async () => {
    let resolveSession;
    const pendingSession = new Promise((resolve) => {
      resolveSession = resolve;
    });

    global.fetch.mockImplementationOnce(() => pendingSession);

    const first = __testables.ensureCsrfToken();
    const second = __testables.ensureCsrfToken();

    resolveSession(mockResponse({ data: { csrfToken: "shared-token" } }));
    await first;
    await second;

    expect(global.fetch).toHaveBeenCalledTimes(1);
    global.fetch.mockResolvedValueOnce(mockResponse({ data: { csrfToken: "forced-token" } }));
    expect(await __testables.ensureCsrfToken(true)).toBe("forced-token");
  });

  it("calls auth-related endpoints through wrapper methods", async () => {
    global.fetch
      .mockResolvedValueOnce(mockResponse({ data: { csrfToken: "auth-token" } }))
      .mockResolvedValueOnce(mockResponse({ data: { ok: true } }))
      .mockResolvedValueOnce(mockResponse({ data: { ok: true } }))
      .mockResolvedValueOnce(mockResponse({ data: { ok: true } }))
      .mockResolvedValueOnce(mockResponse({ data: { ok: true } }))
      .mockResolvedValueOnce(mockResponse({ data: { ok: true } }));

    await api.auth.register({ email: "a@example.com", password: "password123" });
    await api.auth.login({ email: "a@example.com", password: "password123" });
    await api.auth.requestPasswordReset({ email: "a@example.com" });
    await api.auth.completePasswordRecovery({ code: "abc" });
    await api.auth.resetPassword({ password: "nextpassword123" });

    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/session",
      "/api/v1/register",
      "/api/v1/login",
      "/api/v1/password/forgot",
      "/api/v1/password/recovery",
      "/api/v1/password/reset"
    ]);
  });

  it("calls settings endpoints through wrapper methods", async () => {
    global.fetch
      .mockResolvedValueOnce(
        mockResponse({ data: { profile: {}, security: {}, preferences: {}, notifications: {}, chat: {} } })
      )
      .mockResolvedValueOnce(mockResponse({ data: { csrfToken: "settings-token" } }))
      .mockResolvedValueOnce(
        mockResponse({ data: { profile: {}, security: {}, preferences: {}, notifications: {}, chat: {} } })
      )
      .mockResolvedValueOnce(
        mockResponse({ data: { profile: {}, security: {}, preferences: {}, notifications: {}, chat: {} } })
      )
      .mockResolvedValueOnce(
        mockResponse({ data: { profile: {}, security: {}, preferences: {}, notifications: {}, chat: {} } })
      )
      .mockResolvedValueOnce(
        mockResponse({ data: { profile: {}, security: {}, preferences: {}, notifications: {}, chat: {} } })
      )
      .mockResolvedValueOnce(
        mockResponse({ data: { profile: {}, security: {}, preferences: {}, notifications: {}, chat: {} } })
      )
      .mockResolvedValueOnce(
        mockResponse({ data: { profile: {}, security: {}, preferences: {}, notifications: {}, chat: {} } })
      )
      .mockResolvedValueOnce(mockResponse({ data: { ok: true, message: "Password changed." } }))
      .mockResolvedValueOnce(mockResponse({ data: { ok: true, message: "Signed out from other active sessions." } }));

    await api.settings.get();
    await api.settings.updateProfile({ displayName: "new-name" });
    await api.settings.uploadAvatar(new FormData());
    await api.settings.deleteAvatar();
    await api.settings.updatePreferences({ theme: "dark" });
    await api.settings.updateNotifications({ productUpdates: false, accountActivity: true, securityAlerts: true });
    await api.settings.updateChat({
      publicChatId: "u7",
      allowWorkspaceDms: true,
      allowGlobalDms: true,
      requireSharedWorkspaceForGlobalDm: true,
      discoverableByPublicChatId: true
    });
    await api.settings.changePassword({
      currentPassword: "old-password",
      newPassword: "new-password-123",
      confirmPassword: "new-password-123"
    });
    await api.settings.logoutOtherSessions();

    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/settings",
      "/api/v1/session",
      "/api/v1/settings/profile",
      "/api/v1/settings/profile/avatar",
      "/api/v1/settings/profile/avatar",
      "/api/v1/settings/preferences",
      "/api/v1/settings/notifications",
      "/api/v1/settings/chat",
      "/api/v1/settings/security/change-password",
      "/api/v1/settings/security/logout-others"
    ]);
  });

  it("builds history query parameters and can clear csrf cache explicitly", async () => {
    global.fetch
      .mockResolvedValueOnce(mockResponse({ data: { csrfToken: "cached-token" } }))
      .mockResolvedValueOnce(mockResponse({ data: { ok: true } }))
      .mockResolvedValueOnce(mockResponse({ data: { csrfToken: "fresh-token" } }))
      .mockResolvedValueOnce(mockResponse({ data: { ok: true } }))
      .mockResolvedValueOnce(mockResponse({ data: { entries: [], page: 2, pageSize: 25, total: 0, totalPages: 1 } }));

    await api.auth.logout();
    api.clearCsrfTokenCache();
    await api.auth.logout();
    const history = await api.history.list(2, 25);

    expect(history).toEqual({ entries: [], page: 2, pageSize: 25, total: 0, totalPages: 1 });
    expect(global.fetch.mock.calls[4][0]).toBe("/api/v1/history?page=2&pageSize=25");
  });

  it("calls workspace and security wrapper endpoints and encodes identifiers", async () => {
    global.fetch.mockImplementation(async (url) => {
      if (url === "/api/v1/session") {
        return mockResponse({
          data: { csrfToken: "workspace-token" }
        });
      }

      return mockResponse({
        data: { ok: true, url }
      });
    });

    await api.workspace.bootstrap();
    await api.auth.requestOtp({ email: "a@example.com" });
    await api.auth.verifyOtp({ email: "a@example.com", token: "123456" });
    await api.auth.oauthComplete({ code: "oauth-code" });
    await api.workspace.list();
    await api.workspace.select({ workspaceSlug: "acme" });
    await api.workspace.listPendingInvites();
    await api.workspace.redeemInvite({ token: "invite-token", decision: "accept" });
    await api.workspace.getSettings();
    await api.workspace.updateSettings({ name: "Acme" });
    await api.workspace.listRoles();
    await api.workspace.listMembers();
    await api.workspace.updateMemberRole("user/id", { roleId: "admin" });
    await api.workspace.listInvites();
    await api.workspace.createInvite({ email: "member@example.com", roleId: "member" });
    await api.workspace.revokeInvite("invite id/2");
    await api.console.listBrowserErrors(3, 25);
    await api.console.getBrowserError(101);
    await api.console.listServerErrors(4, 20);
    await api.console.getServerError(202);
    await api.console.reportBrowserError({ message: "boom" });
    await api.console.simulateServerError({ kind: "type_error" });
    await api.console.listBillingEvents({
      page: 2,
      pageSize: 25,
      workspaceSlug: "acme-workspace",
      userId: 8,
      billableEntityId: 9,
      operationKey: "op_123",
      providerEventId: "evt_123",
      source: "idempotency"
    });
    await api.console.listBillingPlans();
    await api.console.listBillingProducts();
    await api.console.getBillingSettings();
    await api.console.updateBillingSettings({
      paidPlanChangePaymentMethodPolicy: "required_now"
    });
    await api.console.listBillingProviderPrices({
      active: true,
      limit: 50,
      target: "plan"
    });
    await api.console.createBillingPlan({
      code: "pro_monthly",
      name: "Pro Monthly",
      corePrice: {
        providerPriceId: "price_pro_monthly",
        currency: "USD",
        unitAmountMinor: 4900
      }
    });
    await api.console.createBillingProduct({
      code: "credits_100",
      name: "100 Credits",
      productKind: "credit_topup",
      price: {
        providerPriceId: "price_credits_100"
      }
    });
    await api.console.updateBillingPlan(12, {
      corePrice: {
        providerPriceId: "price_pro_monthly_v2"
      }
    });
    await api.console.updateBillingProduct(21, {
      price: {
        providerPriceId: "price_setup_fee"
      }
    });
    await api.console.listEntitlementDefinitions({
      includeInactive: true,
      code: "workspace.project.monthly"
    });
    await api.console.getEntitlementDefinition(3);
    await api.console.createEntitlementDefinition({
      code: "workspace.project.monthly",
      name: "Projects / month",
      entitlementType: "metered_quota",
      unit: "project",
      enforcementMode: "hard_deny"
    });
    await api.console.updateEntitlementDefinition(3, {
      name: "Projects per month"
    });
    await api.console.deleteEntitlementDefinition(3, {
      reason: "cleanup"
    });
    await api.console.archiveBillingPlan(12, { reason: "catalog_cleanup" });
    await api.console.unarchiveBillingPlan(12, { reason: "catalog_restore" });
    await api.console.deleteBillingPlan(12, { reason: "hard_delete" });
    await api.console.archiveBillingProduct(21, { reason: "catalog_cleanup" });
    await api.console.unarchiveBillingProduct(21, { reason: "catalog_restore" });
    await api.console.deleteBillingProduct(21, { reason: "hard_delete" });
    await api.console.listPurchases({
      page: 1,
      pageSize: 20,
      status: "confirmed",
      provider: "stripe",
      purchaseKind: "subscription_invoice"
    });
    await api.console.refundPurchase(44, { reasonCode: "operator_refund" });
    await api.console.voidPurchase(44, { reasonCode: "operator_void" });
    await api.console.createPurchaseCorrection(44, {
      amountMinor: 100,
      currency: "USD",
      reasonCode: "manual_adjustment"
    });
    await api.console.listPlanAssignments({
      page: 1,
      pageSize: 20,
      status: "current"
    });
    await api.console.createPlanAssignment({
      workspaceSlug: "acme",
      planCode: "pro_monthly"
    });
    await api.console.updatePlanAssignment(55, {
      status: "upcoming"
    });
    await api.console.cancelPlanAssignment(55, {
      reason: "operator_cancel"
    });
    await api.console.listSubscriptions({
      page: 1,
      pageSize: 20,
      status: "active"
    });
    await api.console.changeSubscriptionPlan("sub_123", {
      planCode: "pro_annual"
    });
    await api.console.cancelSubscription("sub_123", {
      reason: "operator_cancel"
    });
    await api.console.cancelSubscriptionAtPeriodEnd("sub_123", {
      reason: "operator_cancel_period_end"
    });
    await api.billing.getTimeline({
      page: 3,
      pageSize: 20,
      source: "payment",
      operationKey: "op_456",
      providerEventId: "evt_456"
    });
    await api.billing.listPurchases();
    await api.billing.getPlanState();
    await api.billing.listPaymentMethods();
    await api.billing.setDefaultPaymentMethod(31, {
      reason: "set_default"
    });
    await api.billing.detachPaymentMethod(31, {
      reason: "detach_method"
    });
    await api.billing.removePaymentMethod(31);
    await api.billing.requestPlanChange({
      planCode: "pro",
      successPath: "/admin/w/acme/billing?checkout=success",
      cancelPath: "/admin/w/acme/billing?checkout=cancel"
    });
    await api.billing.cancelPendingPlanChange();
    await api.projects.list(2, 25);
    await api.projects.get("project/id");
    await api.projects.create({ name: "Project A", status: "draft" });
    await api.projects.update("project/id", { status: "active" });
    await api.projects.replace("project/id", { status: "active" });
    await api.settings.setPasswordMethodEnabled({ enabled: true });
    await api.settings.unlinkOAuthProvider("Google ");

    const urls = global.fetch.mock.calls.map(([url]) => url);
    expect(urls).toContain("/api/v1/bootstrap");
    expect(urls).toContain("/api/v1/login/otp/request");
    expect(urls).toContain("/api/v1/login/otp/verify");
    expect(urls).toContain("/api/v1/oauth/complete");
    expect(urls).toContain("/api/v1/workspaces");
    expect(urls).toContain("/api/v1/workspaces/select");
    expect(urls).toContain("/api/v1/workspace/invitations/pending");
    expect(urls).toContain("/api/v1/workspace/invitations/redeem");
    expect(urls).toContain("/api/v1/workspace/settings");
    expect(urls).toContain("/api/v1/workspace/roles");
    expect(urls).toContain("/api/v1/workspace/members");
    expect(urls).toContain("/api/v1/workspace/members/user%2Fid/role");
    expect(urls).toContain("/api/v1/workspace/invites");
    expect(urls).toContain("/api/v1/workspace/invites/invite%20id%2F2");
    expect(urls).toContain("/api/v1/console/errors/browser?page=3&pageSize=25");
    expect(urls).toContain("/api/v1/console/errors/browser/101");
    expect(urls).toContain("/api/v1/console/errors/server?page=4&pageSize=20");
    expect(urls).toContain("/api/v1/console/errors/server/202");
    expect(urls).toContain("/api/v1/console/errors/browser");
    expect(urls).toContain("/api/v1/console/simulate/server-error");
    expect(urls).toContain(
      "/api/v1/console/billing/events?page=2&pageSize=25&workspaceSlug=acme-workspace&userId=8&billableEntityId=9&operationKey=op_123&providerEventId=evt_123&source=idempotency"
    );
    expect(urls).toContain("/api/v1/console/billing/plans");
    expect(urls).toContain("/api/v1/console/billing/products");
    expect(urls).toContain("/api/v1/console/billing/settings");
    expect(urls).toContain("/api/v1/console/billing/provider-prices?active=true&limit=50&target=plan");
    expect(urls).toContain("/api/v1/console/billing/entitlement-definitions?includeInactive=true&code=workspace.project.monthly");
    expect(urls).toContain("/api/v1/console/billing/entitlement-definitions/3");
    expect(urls).toContain("/api/v1/console/billing/plans/12/archive");
    expect(urls).toContain("/api/v1/console/billing/plans/12/unarchive");
    expect(urls).toContain("/api/v1/console/billing/products/21/archive");
    expect(urls).toContain("/api/v1/console/billing/products/21/unarchive");
    expect(urls).toContain(
      "/api/v1/console/billing/purchases?page=1&pageSize=20&status=confirmed&provider=stripe&purchaseKind=subscription_invoice"
    );
    expect(urls).toContain("/api/v1/console/billing/purchases/44/refund");
    expect(urls).toContain("/api/v1/console/billing/purchases/44/void");
    expect(urls).toContain("/api/v1/console/billing/purchases/44/corrections");
    expect(urls).toContain("/api/v1/console/billing/plan-assignments?page=1&pageSize=20&status=current");
    expect(urls).toContain("/api/v1/console/billing/plan-assignments");
    expect(urls).toContain("/api/v1/console/billing/plan-assignments/55");
    expect(urls).toContain("/api/v1/console/billing/plan-assignments/55/cancel");
    expect(urls).toContain("/api/v1/console/billing/subscriptions?page=1&pageSize=20&status=active");
    expect(urls).toContain("/api/v1/console/billing/subscriptions/sub_123/change-plan");
    expect(urls).toContain("/api/v1/console/billing/subscriptions/sub_123/cancel");
    expect(urls).toContain("/api/v1/console/billing/subscriptions/sub_123/cancel-at-period-end");
    const createBillingPlanCall = global.fetch.mock.calls.find(
      ([url, options]) => url === "/api/v1/console/billing/plans" && String(options?.method || "").toUpperCase() === "POST"
    );
    expect(Boolean(createBillingPlanCall)).toBe(true);
    const updateBillingPlanCall = global.fetch.mock.calls.find(
      ([url, options]) =>
        url === "/api/v1/console/billing/plans/12" && String(options?.method || "").toUpperCase() === "PATCH"
    );
    expect(Boolean(updateBillingPlanCall)).toBe(true);
    const createBillingProductCall = global.fetch.mock.calls.find(
      ([url, options]) =>
        url === "/api/v1/console/billing/products" && String(options?.method || "").toUpperCase() === "POST"
    );
    expect(Boolean(createBillingProductCall)).toBe(true);
    const updateBillingProductCall = global.fetch.mock.calls.find(
      ([url, options]) =>
        url === "/api/v1/console/billing/products/21" && String(options?.method || "").toUpperCase() === "PATCH"
    );
    expect(Boolean(updateBillingProductCall)).toBe(true);
    const consoleRefundCall = global.fetch.mock.calls.find(
      ([url, options]) =>
        url === "/api/v1/console/billing/purchases/44/refund" && String(options?.method || "").toUpperCase() === "POST"
    );
    expect(Boolean(consoleRefundCall?.[1]?.headers?.["Idempotency-Key"])).toBe(true);
    const workspaceDefaultPaymentMethodCall = global.fetch.mock.calls.find(
      ([url, options]) =>
        url === "/api/v1/billing/payment-methods/31/default" && String(options?.method || "").toUpperCase() === "POST"
    );
    expect(Boolean(workspaceDefaultPaymentMethodCall?.[1]?.headers?.["Idempotency-Key"])).toBe(true);
    const workspaceRemovePaymentMethodCall = global.fetch.mock.calls.find(
      ([url, options]) =>
        url === "/api/v1/billing/payment-methods/31" && String(options?.method || "").toUpperCase() === "DELETE"
    );
    expect(Boolean(workspaceRemovePaymentMethodCall?.[1]?.headers?.["Idempotency-Key"])).toBe(true);
    expect(urls).toContain(
      "/api/v1/billing/timeline?page=3&pageSize=20&source=payment&operationKey=op_456&providerEventId=evt_456"
    );
    expect(urls).toContain("/api/v1/billing/purchases");
    expect(urls).toContain("/api/v1/billing/plan-state");
    expect(urls).toContain("/api/v1/billing/payment-methods");
    expect(urls).toContain("/api/v1/billing/payment-methods/31/default");
    expect(urls).toContain("/api/v1/billing/payment-methods/31/detach");
    expect(urls).toContain("/api/v1/billing/payment-methods/31");
    expect(urls).toContain("/api/v1/billing/plan-change");
    expect(urls).toContain("/api/v1/billing/plan-change/cancel");
    expect(urls).toContain("/api/v1/workspace/projects?page=2&pageSize=25");
    expect(urls).toContain("/api/v1/workspace/projects/project%2Fid");
    expect(urls).toContain("/api/v1/workspace/projects");
    expect(urls).toContain("/api/v1/settings/security/methods/password");
    expect(urls).toContain("/api/v1/settings/security/oauth/google");
  });

  it("applies command-correlation headers to correlated write routes and keeps command id stable across csrf retries", async () => {
    window.history.replaceState({}, "", "/admin/w/acme/projects");
    global.fetch
      .mockResolvedValueOnce(mockResponse({ data: { csrfToken: "csrf-1" } }))
      .mockResolvedValueOnce(
        mockResponse({
          status: 403,
          data: {
            error: "forbidden",
            details: {
              code: "FST_CSRF_INVALID_TOKEN"
            }
          }
        })
      )
      .mockResolvedValueOnce(mockResponse({ data: { csrfToken: "csrf-2" } }))
      .mockResolvedValueOnce(
        mockResponse({
          data: {
            project: {
              id: 101
            }
          }
        })
      )
      .mockResolvedValueOnce(mockResponse({ data: { ok: true } }))
      .mockResolvedValueOnce(mockResponse({ data: { ok: true } }))
      .mockResolvedValueOnce(mockResponse({ data: { ok: true } }))
      .mockResolvedValueOnce(mockResponse({ data: { ok: true } }));

    await api.projects.update("project-1", { status: "active" });
    await __testables.request("/api/v1/workspace/invitations/redeem", {
      method: "POST",
      headers: {
        "csrf-token": "provided-token"
      },
      body: {
        token: "invite-token",
        decision: "accept"
      }
    });
    await __testables.request("/api/v1/chat/threads/thread-1/reactions", {
      method: "POST",
      headers: {
        "csrf-token": "provided-token"
      },
      body: {
        messageId: 91,
        reaction: "thumbs_up"
      }
    });
    await __testables.request("/api/v1/chat/threads/thread-1/reactions", {
      method: "DELETE",
      headers: {
        "csrf-token": "provided-token"
      },
      body: {
        messageId: 91,
        reaction: "thumbs_up"
      }
    });
    await __testables.request("/api/v1/workspace/roles", {
      method: "GET"
    });

    const firstWriteHeaders = global.fetch.mock.calls[1][1].headers;
    const retryWriteHeaders = global.fetch.mock.calls[3][1].headers;
    const inviteRedeemHeaders = global.fetch.mock.calls[4][1].headers;
    const addReactionHeaders = global.fetch.mock.calls[5][1].headers;
    const removeReactionHeaders = global.fetch.mock.calls[6][1].headers;
    const readHeaders = global.fetch.mock.calls[7][1].headers;

    expect(firstWriteHeaders["x-command-id"]).toBeTruthy();
    expect(firstWriteHeaders["x-client-id"]).toBeTruthy();
    expect(retryWriteHeaders["x-command-id"]).toBe(firstWriteHeaders["x-command-id"]);
    expect(retryWriteHeaders["x-client-id"]).toBe(firstWriteHeaders["x-client-id"]);
    expect(inviteRedeemHeaders["x-command-id"]).toBeTruthy();
    expect(inviteRedeemHeaders["x-client-id"]).toBeTruthy();
    expect(addReactionHeaders["x-command-id"]).toBeTruthy();
    expect(addReactionHeaders["x-client-id"]).toBeTruthy();
    expect(removeReactionHeaders["x-command-id"]).toBeTruthy();
    expect(removeReactionHeaders["x-client-id"]).toBeTruthy();
    expect(readHeaders["x-command-id"]).toBeUndefined();
    expect(readHeaders["x-client-id"]).toBeUndefined();
  });

  it("sends put replace requests through projects api", async () => {
    global.fetch.mockResolvedValueOnce(mockResponse({ data: { csrfToken: "csrf-1" } })).mockResolvedValueOnce(
      mockResponse({
        data: {
          project: {
            id: 202
          }
        }
      })
    );

    const response = await api.projects.replace("202", { name: "Replacement", status: "draft" });
    expect(response.project.id).toBe(202);

    const replaceCall = global.fetch.mock.calls[1];
    expect(replaceCall[0]).toBe("/api/v1/workspace/projects/202");
    expect(replaceCall[1].method).toBe("PUT");
    expect(replaceCall[1].headers["x-command-id"]).toBeTruthy();
    expect(replaceCall[1].headers["x-client-id"]).toBeTruthy();
  });

  it("applies command-correlation headers to workspace admin write routes", async () => {
    window.history.replaceState({}, "", "/admin/w/acme/settings");
    global.fetch.mockResolvedValue(
      mockResponse({
        data: {
          ok: true
        }
      })
    );

    await __testables.request("/api/v1/workspace/settings", {
      method: "PATCH",
      headers: {
        "csrf-token": "provided-token"
      },
      body: {
        name: "Acme Prime"
      }
    });
    await __testables.request("/api/v1/workspace/members/19/role", {
      method: "PATCH",
      headers: {
        "csrf-token": "provided-token"
      },
      body: {
        roleId: "admin"
      }
    });
    await __testables.request("/api/v1/workspace/invites", {
      method: "POST",
      headers: {
        "csrf-token": "provided-token"
      },
      body: {
        email: "invitee@example.com"
      }
    });
    await __testables.request("/api/v1/workspace/invites/42", {
      method: "DELETE",
      headers: {
        "csrf-token": "provided-token"
      }
    });
    await __testables.request("/api/v1/workspace/roles", {
      method: "GET"
    });

    const settingsWriteHeaders = global.fetch.mock.calls[0][1].headers;
    const memberRoleHeaders = global.fetch.mock.calls[1][1].headers;
    const createInviteHeaders = global.fetch.mock.calls[2][1].headers;
    const revokeInviteHeaders = global.fetch.mock.calls[3][1].headers;
    const rolesReadHeaders = global.fetch.mock.calls[4][1].headers;

    expect(settingsWriteHeaders["x-command-id"]).toBeTruthy();
    expect(memberRoleHeaders["x-command-id"]).toBeTruthy();
    expect(createInviteHeaders["x-command-id"]).toBeTruthy();
    expect(revokeInviteHeaders["x-command-id"]).toBeTruthy();
    expect(rolesReadHeaders["x-command-id"]).toBeUndefined();

    expect(settingsWriteHeaders["x-client-id"]).toBeTruthy();
    expect(memberRoleHeaders["x-client-id"]).toBeTruthy();
    expect(createInviteHeaders["x-client-id"]).toBeTruthy();
    expect(revokeInviteHeaders["x-client-id"]).toBeTruthy();
    expect(rolesReadHeaders["x-client-id"]).toBeUndefined();
  });

  it("applies command-correlation headers to chat write routes and keeps command id stable across csrf retries", async () => {
    window.history.replaceState({}, "", "/w/acme/chat");
    global.fetch
      .mockResolvedValueOnce(mockResponse({ data: { csrfToken: "csrf-chat-1" } }))
      .mockResolvedValueOnce(
        mockResponse({
          status: 403,
          data: {
            error: "forbidden",
            details: {
              code: "FST_CSRF_INVALID_TOKEN"
            }
          }
        })
      )
      .mockResolvedValueOnce(mockResponse({ data: { csrfToken: "csrf-chat-2" } }))
      .mockResolvedValueOnce(
        mockResponse({
          data: {
            ok: true
          }
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          data: {
            entries: []
          }
        })
      );

    await api.chat.sendThreadMessage("thread-1", {
      clientMessageId: "msg_1",
      text: "hello"
    });
    await api.chat.listThreadMessages("thread-1", {
      cursor: "cursor-1",
      limit: 20
    });

    const firstWriteHeaders = global.fetch.mock.calls[1][1].headers;
    const retryWriteHeaders = global.fetch.mock.calls[3][1].headers;
    const readHeaders = global.fetch.mock.calls[4][1].headers;

    expect(firstWriteHeaders["x-command-id"]).toBeTruthy();
    expect(firstWriteHeaders["x-client-id"]).toBeTruthy();
    expect(retryWriteHeaders["x-command-id"]).toBe(firstWriteHeaders["x-command-id"]);
    expect(retryWriteHeaders["x-client-id"]).toBe(firstWriteHeaders["x-client-id"]);
    expect(readHeaders["x-command-id"]).toBeUndefined();
    expect(readHeaders["x-client-id"]).toBeUndefined();
  });

  it("calls chat wrapper endpoints and encodes thread identifiers", async () => {
    global.fetch.mockImplementation(async (url) => {
      if (url === "/api/v1/session") {
        return mockResponse({
          data: { csrfToken: "chat-token" }
        });
      }

      return mockResponse({
        data: { ok: true, url }
      });
    });

    await api.chat.ensureWorkspaceRoom();
    await api.chat.ensureDm({ targetPublicChatId: "friend_1" });
    await api.chat.listDmCandidates({ q: "friend", limit: 8 });
    await api.chat.listInbox({ cursor: "cursor-1", limit: 15 });
    await api.chat.getThread("thread/id");
    await api.chat.listThreadMessages("thread/id", { cursor: "cursor-2", limit: 30 });
    await api.chat.sendThreadMessage("thread/id", {
      clientMessageId: "msg_1",
      text: "hello"
    });
    await api.chat.reserveThreadAttachment("thread/id", {
      clientAttachmentId: "att_1",
      fileName: "hello.txt",
      mimeType: "text/plain",
      sizeBytes: 3,
      kind: "file",
      metadata: {}
    });
    const uploadForm = new FormData();
    uploadForm.append("attachmentId", "81");
    uploadForm.append("file", new Blob(["abc"], { type: "text/plain" }), "hello.txt");
    await api.chat.uploadThreadAttachment("thread/id", uploadForm);
    await api.chat.deleteThreadAttachment("thread/id", "attachment/id");
    await api.chat.markThreadRead("thread/id", {
      threadSeq: 44
    });
    await api.chat.emitThreadTyping("thread/id");

    const urls = global.fetch.mock.calls.map(([url]) => url);
    expect(urls).toContain("/api/v1/chat/workspace/ensure");
    expect(urls).toContain("/api/v1/chat/dm/ensure");
    expect(urls).toContain("/api/v1/chat/dm/candidates?q=friend&limit=8");
    expect(urls).toContain("/api/v1/chat/inbox?cursor=cursor-1&limit=15");
    expect(urls).toContain("/api/v1/chat/threads/thread%2Fid");
    expect(urls).toContain("/api/v1/chat/threads/thread%2Fid/messages?cursor=cursor-2&limit=30");
    expect(urls).toContain("/api/v1/chat/threads/thread%2Fid/messages");
    expect(urls).toContain("/api/v1/chat/threads/thread%2Fid/attachments/reserve");
    expect(urls).toContain("/api/v1/chat/threads/thread%2Fid/attachments/upload");
    expect(urls).toContain("/api/v1/chat/threads/thread%2Fid/attachments/attachment%2Fid");
    expect(urls).toContain("/api/v1/chat/threads/thread%2Fid/read");
    expect(urls).toContain("/api/v1/chat/threads/thread%2Fid/typing");

    const uploadCall = global.fetch.mock.calls.find(
      ([url]) => url === "/api/v1/chat/threads/thread%2Fid/attachments/upload"
    );
    expect(uploadCall?.[1]?.body).toBe(uploadForm);

    const ensureWorkspaceCall = global.fetch.mock.calls.find(
      ([url, options]) => url === "/api/v1/chat/workspace/ensure" && String(options?.method || "").toUpperCase() === "POST"
    );
    const ensureDmCall = global.fetch.mock.calls.find(
      ([url, options]) => url === "/api/v1/chat/dm/ensure" && String(options?.method || "").toUpperCase() === "POST"
    );
    const sendMessageCall = global.fetch.mock.calls.find(
      ([url, options]) => url === "/api/v1/chat/threads/thread%2Fid/messages" && String(options?.method || "").toUpperCase() === "POST"
    );
    const reserveAttachmentCall = global.fetch.mock.calls.find(
      ([url, options]) =>
        url === "/api/v1/chat/threads/thread%2Fid/attachments/reserve" &&
        String(options?.method || "").toUpperCase() === "POST"
    );
    const deleteAttachmentCall = global.fetch.mock.calls.find(
      ([url, options]) =>
        url === "/api/v1/chat/threads/thread%2Fid/attachments/attachment%2Fid" &&
        String(options?.method || "").toUpperCase() === "DELETE"
    );
    const markReadCall = global.fetch.mock.calls.find(
      ([url, options]) => url === "/api/v1/chat/threads/thread%2Fid/read" && String(options?.method || "").toUpperCase() === "POST"
    );
    const typingCall = global.fetch.mock.calls.find(
      ([url, options]) => url === "/api/v1/chat/threads/thread%2Fid/typing" && String(options?.method || "").toUpperCase() === "POST"
    );

    expect(ensureWorkspaceCall?.[1]?.headers["x-command-id"]).toBeTruthy();
    expect(ensureDmCall?.[1]?.headers["x-command-id"]).toBeTruthy();
    expect(sendMessageCall?.[1]?.headers["x-command-id"]).toBeTruthy();
    expect(reserveAttachmentCall?.[1]?.headers["x-command-id"]).toBeTruthy();
    expect(uploadCall?.[1]?.headers["x-command-id"]).toBeTruthy();
    expect(deleteAttachmentCall?.[1]?.headers["x-command-id"]).toBeTruthy();
    expect(markReadCall?.[1]?.headers["x-command-id"]).toBeTruthy();
    expect(typingCall?.[1]?.headers["x-command-id"]).toBeTruthy();

    const listDmCandidatesCall = global.fetch.mock.calls.find(
      ([url, options]) =>
        url === "/api/v1/chat/dm/candidates?q=friend&limit=8" && String(options?.method || "GET").toUpperCase() === "GET"
    );
    const listInboxCall = global.fetch.mock.calls.find(
      ([url, options]) =>
        url === "/api/v1/chat/inbox?cursor=cursor-1&limit=15" && String(options?.method || "GET").toUpperCase() === "GET"
    );
    const getThreadCall = global.fetch.mock.calls.find(
      ([url, options]) => url === "/api/v1/chat/threads/thread%2Fid" && String(options?.method || "GET").toUpperCase() === "GET"
    );
    const listThreadMessagesCall = global.fetch.mock.calls.find(
      ([url, options]) =>
        url === "/api/v1/chat/threads/thread%2Fid/messages?cursor=cursor-2&limit=30" &&
        String(options?.method || "GET").toUpperCase() === "GET"
    );

    expect(listDmCandidatesCall?.[1]?.headers["x-command-id"]).toBeUndefined();
    expect(listInboxCall?.[1]?.headers["x-command-id"]).toBeUndefined();
    expect(getThreadCall?.[1]?.headers["x-command-id"]).toBeUndefined();
    expect(listThreadMessagesCall?.[1]?.headers["x-command-id"]).toBeUndefined();
  });

  it("builds oauth URL helpers with and without returnTo", () => {
    expect(api.auth.oauthStartUrl("Google")).toBe("/api/v1/oauth/google/start");
    expect(api.auth.oauthStartUrl("Google", { returnTo: "/w/acme" })).toBe(
      "/api/v1/oauth/google/start?returnTo=%2Fw%2Facme"
    );

    expect(api.settings.oauthLinkStartUrl("Google")).toBe("/api/v1/settings/security/oauth/google/start");
    expect(api.settings.oauthLinkStartUrl("Google", { returnTo: "/account/settings" })).toBe(
      "/api/v1/settings/security/oauth/google/start?returnTo=%2Faccount%2Fsettings"
    );
  });

  it("applies surface/workspace headers only for api requests and handles url edge cases", async () => {
    window.history.replaceState({}, "", "/admin/w/acme/settings");
    global.fetch.mockResolvedValue(mockResponse({ data: { ok: true } }));

    await __testables.request("/api/v1/session");
    const apiCall = global.fetch.mock.calls[0];
    expect(apiCall[1].headers["x-surface-id"]).toBe("admin");
    expect(apiCall[1].headers["x-workspace-slug"]).toBe("acme");

    await __testables.request("/external/path");
    const nonApiCall = global.fetch.mock.calls[1];
    expect(nonApiCall[1].headers["x-surface-id"]).toBeUndefined();
    expect(nonApiCall[1].headers["x-workspace-slug"]).toBeUndefined();

    await __testables.request("https://example.com/api/v1/session");
    const absoluteApiCall = global.fetch.mock.calls[2];
    expect(absoluteApiCall[1].headers["x-surface-id"]).toBe("admin");
    expect(absoluteApiCall[1].headers["x-workspace-slug"]).toBe("acme");

    await __testables.request("http://[::1");
    const invalidUrlCall = global.fetch.mock.calls[3];
    expect(invalidUrlCall[1].headers["x-surface-id"]).toBeUndefined();

    await __testables.request(" ");
    const blankUrlCall = global.fetch.mock.calls[4];
    expect(blankUrlCall[1].headers["x-surface-id"]).toBeUndefined();
  });

  it("skips absolute-url surface header resolution when window is unavailable", async () => {
    global.fetch.mockResolvedValue(mockResponse({ data: { ok: true } }));

    const originalWindow = globalThis.window;
    vi.stubGlobal("window", undefined);
    try {
      await __testables.request("https://example.com/api/v1/session");
      const call = global.fetch.mock.calls[0];
      expect(call[1].headers["x-surface-id"]).toBeUndefined();
      expect(call[1].headers["x-workspace-slug"]).toBeUndefined();
    } finally {
      vi.stubGlobal("window", originalWindow);
    }
  });

  it("handles empty-ish wrapper inputs and location/pathname edge cases", async () => {
    global.fetch.mockResolvedValue(mockResponse({ data: { ok: true } }));

    const originalWindow = globalThis.window;
    const nextWindow = {
      ...originalWindow,
      location: {
        ...(originalWindow?.location || {}),
        pathname: ""
      }
    };
    vi.stubGlobal("window", nextWindow);

    try {
      await __testables.request("/api/v1/session");
      const firstCall = global.fetch.mock.calls[0];
      expect(firstCall[1].headers["x-surface-id"]).toBe("app");
      expect(firstCall[1].headers["x-workspace-slug"]).toBeUndefined();
    } finally {
      vi.stubGlobal("window", originalWindow);
    }

    expect(api.auth.oauthStartUrl()).toBe("/api/v1/oauth/start");
    expect(api.settings.oauthLinkStartUrl()).toBe("/api/v1/settings/security/oauth/start");

    await api.workspace.redeemInvite({ token: "", decision: "accept" });
    await api.workspace.updateMemberRole(undefined, { roleId: "member" });
    await api.workspace.revokeInvite(undefined);
    await api.projects.list(1, 10);
    await api.projects.get(undefined);
    await api.projects.update(undefined, { status: "archived" });
    await api.settings.unlinkOAuthProvider(undefined);

    const urls = global.fetch.mock.calls.map(([url]) => url);
    expect(urls).toContain("/api/v1/workspace/invitations/redeem");
    expect(urls).toContain("/api/v1/workspace/members//role");
    expect(urls).toContain("/api/v1/workspace/invites/");
    expect(urls).toContain("/api/v1/workspace/projects?page=1&pageSize=10");
    expect(urls).toContain("/api/v1/workspace/projects/");
    expect(urls).toContain("/api/v1/settings/security/oauth/");
  });

  it("calls alerts endpoints through wrapper methods", async () => {
    global.fetch
      .mockResolvedValueOnce(
        mockResponse({
          data: {
            entries: [],
            page: 1,
            pageSize: 20,
            total: 0,
            totalPages: 1,
            unreadCount: 0,
            readThroughAlertId: null
          }
        })
      )
      .mockResolvedValueOnce(mockResponse({ data: { csrfToken: "alerts-token" } }))
      .mockResolvedValueOnce(mockResponse({ data: { unreadCount: 0, readThroughAlertId: 3 } }));

    await api.alerts.list({
      page: 2,
      pageSize: 50
    });
    await api.alerts.markAllRead();

    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/alerts?page=2&pageSize=50",
      "/api/v1/session",
      "/api/v1/alerts/read-all"
    ]);
  });
});
