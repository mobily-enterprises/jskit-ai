import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, __testables } from "../../src/services/api";

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

    const payload = await api.session();

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

    const result = await api.calculateAnnuity({ payment: 500 });

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

    const result = await api.calculateAnnuity(formData);
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

    const result = await api.logout();

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

    await expect(api.logout()).rejects.toMatchObject({
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

    await expect(api.logout()).rejects.toMatchObject({
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

    await expect(api.history(1, 10)).rejects.toMatchObject({
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
    await expect(api.logout()).rejects.toMatchObject({
      status: 0,
      message: "Network request failed.",
      cause: networkError
    });

    __testables.resetApiStateForTests();
    global.fetch.mockRejectedValueOnce(networkError);
    await expect(api.session()).rejects.toMatchObject({
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

    const payload = await api.session();
    expect(payload).toEqual({});
  });

  it("handles malformed json payloads and requests without csrf token", async () => {
    global.fetch
      .mockResolvedValueOnce(mockResponse({ contentType: "application/json", jsonReject: true }))
      .mockResolvedValueOnce(mockResponse({ data: { ok: true } }));

    const result = await api.logout();

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

    await api.register({ email: "a@example.com", password: "password123" });
    await api.login({ email: "a@example.com", password: "password123" });
    await api.requestPasswordReset({ email: "a@example.com" });
    await api.completePasswordRecovery({ code: "abc" });
    await api.resetPassword({ password: "nextpassword123" });

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

    await api.settings();
    await api.updateProfileSettings({ displayName: "new-name" });
    await api.uploadProfileAvatar(new FormData());
    await api.deleteProfileAvatar();
    await api.updatePreferencesSettings({ theme: "dark" });
    await api.updateNotificationSettings({ productUpdates: false, accountActivity: true, securityAlerts: true });
    await api.changePassword({
      currentPassword: "old-password",
      newPassword: "new-password-123",
      confirmPassword: "new-password-123"
    });
    await api.logoutOtherSessions();

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

    await api.logout();
    api.clearCsrfTokenCache();
    await api.logout();
    const history = await api.history(2, 25);

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

    await api.bootstrap();
    await api.requestOtpLogin({ email: "a@example.com" });
    await api.verifyOtpLogin({ email: "a@example.com", token: "123456" });
    await api.oauthComplete({ code: "oauth-code" });
    await api.workspaces();
    await api.selectWorkspace({ workspaceSlug: "acme" });
    await api.pendingWorkspaceInvites();
    await api.respondWorkspaceInvite("invite id/1", { decision: "accept" });
    await api.redeemWorkspaceInvite({ token: "invite-token", decision: "accept" });
    await api.workspaceSettings();
    await api.updateWorkspaceSettings({ name: "Acme" });
    await api.workspaceRoles();
    await api.workspaceMembers();
    await api.updateWorkspaceMemberRole("user/id", { roleId: "admin" });
    await api.workspaceInvites();
    await api.createWorkspaceInvite({ email: "member@example.com", roleId: "member" });
    await api.revokeWorkspaceInvite("invite id/2");
    await api.setPasswordMethodEnabled({ enabled: true });
    await api.unlinkSettingsOAuthProvider("Google ");

    const urls = global.fetch.mock.calls.map(([url]) => url);
    expect(urls).toContain("/api/bootstrap");
    expect(urls).toContain("/api/login/otp/request");
    expect(urls).toContain("/api/login/otp/verify");
    expect(urls).toContain("/api/oauth/complete");
    expect(urls).toContain("/api/workspaces");
    expect(urls).toContain("/api/workspaces/select");
    expect(urls).toContain("/api/workspace/invitations/pending");
    expect(urls).toContain("/api/workspace/invitations/invite%20id%2F1/respond");
    expect(urls).toContain("/api/workspace/invitations/redeem");
    expect(urls).toContain("/api/workspace/settings");
    expect(urls).toContain("/api/workspace/roles");
    expect(urls).toContain("/api/workspace/members");
    expect(urls).toContain("/api/workspace/members/user%2Fid/role");
    expect(urls).toContain("/api/workspace/invites");
    expect(urls).toContain("/api/workspace/invites/invite%20id%2F2");
    expect(urls).toContain("/api/settings/security/methods/password");
    expect(urls).toContain("/api/settings/security/oauth/google");
  });

  it("builds oauth URL helpers with and without returnTo", () => {
    expect(api.oauthStartUrl("Google")).toBe("/api/oauth/google/start");
    expect(api.oauthStartUrl("Google", { returnTo: "/w/acme" })).toBe("/api/oauth/google/start?returnTo=%2Fw%2Facme");

    expect(api.settingsOAuthLinkStartUrl("Google")).toBe("/api/settings/security/oauth/google/start");
    expect(api.settingsOAuthLinkStartUrl("Google", { returnTo: "/account/settings" })).toBe(
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

    expect(api.oauthStartUrl()).toBe("/api/oauth//start");
    expect(api.settingsOAuthLinkStartUrl()).toBe("/api/settings/security/oauth//start");

    await api.respondWorkspaceInvite(undefined, { decision: "accept" });
    await api.redeemWorkspaceInvite({ token: "", decision: "accept" });
    await api.updateWorkspaceMemberRole(undefined, { roleId: "member" });
    await api.revokeWorkspaceInvite(undefined);
    await api.unlinkSettingsOAuthProvider(undefined);

    const urls = global.fetch.mock.calls.map(([url]) => url);
    expect(urls).toContain("/api/workspace/invitations//respond");
    expect(urls).toContain("/api/workspace/invitations/redeem");
    expect(urls).toContain("/api/workspace/members//role");
    expect(urls).toContain("/api/workspace/invites/");
    expect(urls).toContain("/api/settings/security/oauth/");
  });
});
