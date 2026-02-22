import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, __testables } from "../../src/services/api/index.js";

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
    expect(global.fetch).toHaveBeenCalledWith("/api/session", {
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
    expect(global.fetch).toHaveBeenCalledWith("/api/session", {
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

    const result = await api.annuity.calculate({ payment: 500 });

    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenNthCalledWith(1, "/api/session", {
      method: "GET",
      credentials: "same-origin"
    });

    const secondCall = global.fetch.mock.calls[1];
    expect(secondCall[0]).toBe("/api/annuityCalculator");
    expect(secondCall[1].headers["Content-Type"]).toBe("application/json");
    expect(secondCall[1].headers["csrf-token"]).toBe("csrf-a");
    expect(secondCall[1].body).toBe(JSON.stringify({ payment: 500 }));
  });

  it("does not overwrite an explicit content-type header", async () => {
    global.fetch.mockResolvedValueOnce(mockResponse({ data: { ok: true } }));

    const result = await __testables.request("/api/custom", {
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

    const result = await api.annuity.calculate(formData);
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
    global.fetch
      .mockResolvedValueOnce(mockResponse({ data: { csrfToken: "csrf-1" } }))
      .mockResolvedValueOnce(
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

    const response = await __testables.request("/api/no-content-type", {
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
      "/api/session",
      "/api/register",
      "/api/login",
      "/api/password/forgot",
      "/api/password/recovery",
      "/api/password/reset"
    ]);
  });

  it("calls settings endpoints through wrapper methods", async () => {
    global.fetch
      .mockResolvedValueOnce(mockResponse({ data: { profile: {}, security: {}, preferences: {}, notifications: {} } }))
      .mockResolvedValueOnce(mockResponse({ data: { csrfToken: "settings-token" } }))
      .mockResolvedValueOnce(mockResponse({ data: { profile: {}, security: {}, preferences: {}, notifications: {} } }))
      .mockResolvedValueOnce(mockResponse({ data: { profile: {}, security: {}, preferences: {}, notifications: {} } }))
      .mockResolvedValueOnce(mockResponse({ data: { profile: {}, security: {}, preferences: {}, notifications: {} } }))
      .mockResolvedValueOnce(mockResponse({ data: { profile: {}, security: {}, preferences: {}, notifications: {} } }))
      .mockResolvedValueOnce(mockResponse({ data: { profile: {}, security: {}, preferences: {}, notifications: {} } }))
      .mockResolvedValueOnce(mockResponse({ data: { ok: true, message: "Password changed." } }))
      .mockResolvedValueOnce(mockResponse({ data: { ok: true, message: "Signed out from other active sessions." } }));

    await api.settings.get();
    await api.settings.updateProfile({ displayName: "new-name" });
    await api.settings.uploadAvatar(new FormData());
    await api.settings.deleteAvatar();
    await api.settings.updatePreferences({ theme: "dark" });
    await api.settings.updateNotifications({ productUpdates: false, accountActivity: true, securityAlerts: true });
    await api.settings.changePassword({
      currentPassword: "old-password",
      newPassword: "new-password-123",
      confirmPassword: "new-password-123"
    });
    await api.settings.logoutOtherSessions();

    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/settings",
      "/api/session",
      "/api/settings/profile",
      "/api/settings/profile/avatar",
      "/api/settings/profile/avatar",
      "/api/settings/preferences",
      "/api/settings/notifications",
      "/api/settings/security/change-password",
      "/api/settings/security/logout-others"
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
    expect(global.fetch.mock.calls[4][0]).toBe("/api/history?page=2&pageSize=25");
  });

  it("calls workspace and security wrapper endpoints and encodes identifiers", async () => {
    global.fetch.mockImplementation(async (url) => {
      if (url === "/api/session") {
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
    await api.billing.getTimeline({
      page: 3,
      pageSize: 20,
      source: "payment",
      operationKey: "op_456",
      providerEventId: "evt_456"
    });
    await api.billing.getPlanState();
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
    expect(urls).toContain("/api/bootstrap");
    expect(urls).toContain("/api/login/otp/request");
    expect(urls).toContain("/api/login/otp/verify");
    expect(urls).toContain("/api/oauth/complete");
    expect(urls).toContain("/api/workspaces");
    expect(urls).toContain("/api/workspaces/select");
    expect(urls).toContain("/api/workspace/invitations/pending");
    expect(urls).toContain("/api/workspace/invitations/redeem");
    expect(urls).toContain("/api/workspace/settings");
    expect(urls).toContain("/api/workspace/roles");
    expect(urls).toContain("/api/workspace/members");
    expect(urls).toContain("/api/workspace/members/user%2Fid/role");
    expect(urls).toContain("/api/workspace/invites");
    expect(urls).toContain("/api/workspace/invites/invite%20id%2F2");
    expect(urls).toContain("/api/console/errors/browser?page=3&pageSize=25");
    expect(urls).toContain("/api/console/errors/browser/101");
    expect(urls).toContain("/api/console/errors/server?page=4&pageSize=20");
    expect(urls).toContain("/api/console/errors/server/202");
    expect(urls).toContain("/api/console/errors/browser");
    expect(urls).toContain("/api/console/simulate/server-error");
    expect(urls).toContain(
      "/api/console/billing/events?page=2&pageSize=25&workspaceSlug=acme-workspace&userId=8&billableEntityId=9&operationKey=op_123&providerEventId=evt_123&source=idempotency"
    );
    expect(urls).toContain("/api/console/billing/plans");
    expect(urls).toContain("/api/console/billing/products");
    expect(urls).toContain("/api/console/billing/settings");
    expect(urls).toContain("/api/console/billing/provider-prices?active=true&limit=50&target=plan");
    const createBillingPlanCall = global.fetch.mock.calls.find(
      ([url, options]) => url === "/api/console/billing/plans" && String(options?.method || "").toUpperCase() === "POST"
    );
    expect(Boolean(createBillingPlanCall)).toBe(true);
    const updateBillingPlanCall = global.fetch.mock.calls.find(
      ([url, options]) =>
        url === "/api/console/billing/plans/12" && String(options?.method || "").toUpperCase() === "PATCH"
    );
    expect(Boolean(updateBillingPlanCall)).toBe(true);
    const createBillingProductCall = global.fetch.mock.calls.find(
      ([url, options]) => url === "/api/console/billing/products" && String(options?.method || "").toUpperCase() === "POST"
    );
    expect(Boolean(createBillingProductCall)).toBe(true);
    const updateBillingProductCall = global.fetch.mock.calls.find(
      ([url, options]) =>
        url === "/api/console/billing/products/21" && String(options?.method || "").toUpperCase() === "PATCH"
    );
    expect(Boolean(updateBillingProductCall)).toBe(true);
    expect(urls).toContain(
      "/api/billing/timeline?page=3&pageSize=20&source=payment&operationKey=op_456&providerEventId=evt_456"
    );
    expect(urls).toContain("/api/billing/plan-state");
    expect(urls).toContain("/api/billing/plan-change");
    expect(urls).toContain("/api/billing/plan-change/cancel");
    expect(urls).toContain("/api/workspace/projects?page=2&pageSize=25");
    expect(urls).toContain("/api/workspace/projects/project%2Fid");
    expect(urls).toContain("/api/workspace/projects");
    expect(urls).toContain("/api/settings/security/methods/password");
    expect(urls).toContain("/api/settings/security/oauth/google");
  });

  it("applies command-correlation headers only to project write requests and keeps command id stable across csrf retries", async () => {
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
      .mockResolvedValueOnce(mockResponse({ data: { ok: true } }));

    await api.projects.update("project-1", { status: "active" });
    await __testables.request("/api/workspace/invitations/redeem", {
      method: "POST",
      headers: {
        "csrf-token": "provided-token"
      },
      body: {
        token: "invite-token",
        decision: "accept"
      }
    });

    const firstWriteHeaders = global.fetch.mock.calls[1][1].headers;
    const retryWriteHeaders = global.fetch.mock.calls[3][1].headers;
    const nonProjectWriteHeaders = global.fetch.mock.calls[4][1].headers;

    expect(firstWriteHeaders["x-command-id"]).toBeTruthy();
    expect(firstWriteHeaders["x-client-id"]).toBeTruthy();
    expect(retryWriteHeaders["x-command-id"]).toBe(firstWriteHeaders["x-command-id"]);
    expect(retryWriteHeaders["x-client-id"]).toBe(firstWriteHeaders["x-client-id"]);
    expect(nonProjectWriteHeaders["x-command-id"]).toBeUndefined();
    expect(nonProjectWriteHeaders["x-client-id"]).toBeUndefined();
  });

  it("sends put replace requests through projects api", async () => {
    global.fetch
      .mockResolvedValueOnce(mockResponse({ data: { csrfToken: "csrf-1" } }))
      .mockResolvedValueOnce(
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
    expect(replaceCall[0]).toBe("/api/workspace/projects/202");
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

    await __testables.request("/api/workspace/settings", {
      method: "PATCH",
      headers: {
        "csrf-token": "provided-token"
      },
      body: {
        name: "Acme Prime"
      }
    });
    await __testables.request("/api/workspace/members/19/role", {
      method: "PATCH",
      headers: {
        "csrf-token": "provided-token"
      },
      body: {
        roleId: "admin"
      }
    });
    await __testables.request("/api/workspace/invites", {
      method: "POST",
      headers: {
        "csrf-token": "provided-token"
      },
      body: {
        email: "invitee@example.com"
      }
    });
    await __testables.request("/api/workspace/invites/42", {
      method: "DELETE",
      headers: {
        "csrf-token": "provided-token"
      }
    });
    await __testables.request("/api/workspace/roles", {
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

  it("builds oauth URL helpers with and without returnTo", () => {
    expect(api.auth.oauthStartUrl("Google")).toBe("/api/oauth/google/start");
    expect(api.auth.oauthStartUrl("Google", { returnTo: "/w/acme" })).toBe("/api/oauth/google/start?returnTo=%2Fw%2Facme");

    expect(api.settings.oauthLinkStartUrl("Google")).toBe("/api/settings/security/oauth/google/start");
    expect(api.settings.oauthLinkStartUrl("Google", { returnTo: "/account/settings" })).toBe(
      "/api/settings/security/oauth/google/start?returnTo=%2Faccount%2Fsettings"
    );
  });

  it("applies surface/workspace headers only for api requests and handles url edge cases", async () => {
    window.history.replaceState({}, "", "/admin/w/acme/settings");
    global.fetch.mockResolvedValue(mockResponse({ data: { ok: true } }));

    await __testables.request("/api/session");
    const apiCall = global.fetch.mock.calls[0];
    expect(apiCall[1].headers["x-surface-id"]).toBe("admin");
    expect(apiCall[1].headers["x-workspace-slug"]).toBe("acme");

    await __testables.request("/external/path");
    const nonApiCall = global.fetch.mock.calls[1];
    expect(nonApiCall[1].headers["x-surface-id"]).toBeUndefined();
    expect(nonApiCall[1].headers["x-workspace-slug"]).toBeUndefined();

    await __testables.request("https://example.com/api/session");
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
      await __testables.request("https://example.com/api/session");
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
      await __testables.request("/api/session");
      const firstCall = global.fetch.mock.calls[0];
      expect(firstCall[1].headers["x-surface-id"]).toBe("app");
      expect(firstCall[1].headers["x-workspace-slug"]).toBeUndefined();
    } finally {
      vi.stubGlobal("window", originalWindow);
    }

    expect(api.auth.oauthStartUrl()).toBe("/api/oauth//start");
    expect(api.settings.oauthLinkStartUrl()).toBe("/api/settings/security/oauth//start");

    await api.workspace.redeemInvite({ token: "", decision: "accept" });
    await api.workspace.updateMemberRole(undefined, { roleId: "member" });
    await api.workspace.revokeInvite(undefined);
    await api.projects.list(1, 10);
    await api.projects.get(undefined);
    await api.projects.update(undefined, { status: "archived" });
    await api.settings.unlinkOAuthProvider(undefined);

    const urls = global.fetch.mock.calls.map(([url]) => url);
    expect(urls).toContain("/api/workspace/invitations/redeem");
    expect(urls).toContain("/api/workspace/members//role");
    expect(urls).toContain("/api/workspace/invites/");
    expect(urls).toContain("/api/workspace/projects?page=1&pageSize=10");
    expect(urls).toContain("/api/workspace/projects/");
    expect(urls).toContain("/api/settings/security/oauth/");
  });
});
