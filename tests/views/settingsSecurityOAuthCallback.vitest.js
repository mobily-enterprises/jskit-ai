import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: {
    oauthComplete: vi.fn()
  },
  readPendingOAuthContext: vi.fn(),
  readOAuthCallbackStateFromLocation: vi.fn(),
  stripOAuthCallbackParamsFromLocation: vi.fn(),
  clearPendingOAuthContext: vi.fn(),
  invalidateQueries: vi.fn(async () => undefined),
  refreshSession: vi.fn(async () => ({ authenticated: true }))
}));

vi.mock("../../src/services/api/index.js", () => ({
  api: mocks.api
}));

vi.mock("../../src/utils/oauthCallback.js", () => ({
  readPendingOAuthContext: () => mocks.readPendingOAuthContext(),
  readOAuthCallbackStateFromLocation: (options) => mocks.readOAuthCallbackStateFromLocation(options),
  stripOAuthCallbackParamsFromLocation: (options) => mocks.stripOAuthCallbackParamsFromLocation(options),
  clearPendingOAuthContext: () => mocks.clearPendingOAuthContext()
}));

import { useSettingsSecurityOAuthCallback } from "../../src/views/settings/security/lib/useSettingsSecurityOAuthCallback.js";

describe("useSettingsSecurityOAuthCallback", () => {
  beforeEach(() => {
    mocks.api.oauthComplete.mockReset();
    mocks.readPendingOAuthContext.mockReset();
    mocks.readOAuthCallbackStateFromLocation.mockReset();
    mocks.stripOAuthCallbackParamsFromLocation.mockReset();
    mocks.clearPendingOAuthContext.mockReset();
    mocks.invalidateQueries.mockReset();
    mocks.invalidateQueries.mockResolvedValue(undefined);
    mocks.refreshSession.mockReset();
    mocks.refreshSession.mockResolvedValue({ authenticated: true });
  });

  it("returns early when callback state is absent", async () => {
    mocks.readPendingOAuthContext.mockReturnValue(null);
    mocks.readOAuthCallbackStateFromLocation.mockReturnValue(null);

    const providerMessage = ref("pending");
    const providerMessageType = ref("success");
    const providerLinkStartInFlight = ref(false);

    const vm = useSettingsSecurityOAuthCallback({
      authStore: {
        refreshSession: mocks.refreshSession
      },
      queryClient: {
        invalidateQueries: mocks.invalidateQueries
      },
      providerMessage,
      providerMessageType,
      providerLinkStartInFlight,
      providerLabel: (provider) => provider,
      buildSettingsPathWithTab: (tab) => `/account/settings?section=${tab}`,
      handleAuthError: async () => false,
      toErrorMessage: (error, fallback) => String(error?.message || fallback)
    });

    await vm.handleOAuthCallbackIfPresent();

    expect(mocks.api.oauthComplete).not.toHaveBeenCalled();
    expect(providerLinkStartInFlight.value).toBe(false);
  });

  it("handles successful provider linking", async () => {
    mocks.readPendingOAuthContext.mockReturnValue({ intent: "link" });
    mocks.readOAuthCallbackStateFromLocation.mockReturnValue({
      provider: "google",
      intent: "link",
      payload: {
        code: "abc"
      }
    });
    mocks.api.oauthComplete.mockResolvedValue({ ok: true });

    const providerMessage = ref("");
    const providerMessageType = ref("success");
    const providerLinkStartInFlight = ref(false);

    const vm = useSettingsSecurityOAuthCallback({
      authStore: {
        refreshSession: mocks.refreshSession
      },
      queryClient: {
        invalidateQueries: mocks.invalidateQueries
      },
      providerMessage,
      providerMessageType,
      providerLinkStartInFlight,
      providerLabel: (provider) => provider.toUpperCase(),
      buildSettingsPathWithTab: (tab) => `/account/settings?section=${tab}`,
      handleAuthError: async () => false,
      toErrorMessage: (error, fallback) => String(error?.message || fallback)
    });

    await vm.handleOAuthCallbackIfPresent();

    expect(mocks.api.oauthComplete).toHaveBeenCalledWith({ code: "abc" });
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(mocks.stripOAuthCallbackParamsFromLocation).toHaveBeenCalledWith({
      preserveSearchKeys: ["section", "returnTo"]
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["settings"]
    });
    expect(providerMessageType.value).toBe("success");
    expect(providerMessage.value).toBe("GOOGLE linked.");
    expect(providerLinkStartInFlight.value).toBe(false);
    expect(mocks.clearPendingOAuthContext).toHaveBeenCalledTimes(1);
  });

  it("handles auth errors and generic callback failures", async () => {
    mocks.readPendingOAuthContext.mockReturnValue({ intent: "link" });
    mocks.readOAuthCallbackStateFromLocation.mockReturnValue({
      provider: "google",
      intent: "link",
      payload: {
        code: "abc"
      }
    });

    const providerMessage = ref("");
    const providerMessageType = ref("success");
    const providerLinkStartInFlight = ref(false);

    const handledError = new Error("unauthorized");
    mocks.api.oauthComplete.mockRejectedValueOnce(handledError);

    const vm = useSettingsSecurityOAuthCallback({
      authStore: {
        refreshSession: mocks.refreshSession
      },
      queryClient: {
        invalidateQueries: mocks.invalidateQueries
      },
      providerMessage,
      providerMessageType,
      providerLinkStartInFlight,
      providerLabel: (provider) => provider,
      buildSettingsPathWithTab: (tab) => `/account/settings?section=${tab}`,
      handleAuthError: async () => true,
      toErrorMessage: (error, fallback) => String(error?.message || fallback)
    });

    await vm.handleOAuthCallbackIfPresent();
    expect(providerMessage.value).toBe("");

    mocks.api.oauthComplete.mockResolvedValueOnce({ ok: true });
    mocks.refreshSession.mockResolvedValueOnce({ authenticated: false });
    const vmWithSessionFailure = useSettingsSecurityOAuthCallback({
      authStore: {
        refreshSession: mocks.refreshSession
      },
      queryClient: {
        invalidateQueries: mocks.invalidateQueries
      },
      providerMessage,
      providerMessageType,
      providerLinkStartInFlight,
      providerLabel: (provider) => provider,
      buildSettingsPathWithTab: (tab) => `/account/settings?section=${tab}`,
      handleAuthError: async () => false,
      toErrorMessage: (error, fallback) => String(error?.message || fallback)
    });

    await vmWithSessionFailure.handleOAuthCallbackIfPresent();

    expect(providerMessageType.value).toBe("error");
    expect(providerMessage.value).toContain("active session is unavailable");
    expect(mocks.stripOAuthCallbackParamsFromLocation).toHaveBeenCalled();
  });
});
