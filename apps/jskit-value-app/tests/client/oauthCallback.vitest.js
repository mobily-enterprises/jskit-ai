import { beforeEach, describe, expect, it } from "vitest";
import {
  OAUTH_PENDING_CONTEXT_STORAGE_KEY,
  clearPendingOAuthContext,
  normalizeOAuthIntent,
  normalizeReturnToPath,
  readOAuthCallbackStateFromLocation,
  readPendingOAuthContext,
  stripOAuthCallbackParamsFromLocation,
  writePendingOAuthContext
} from "../../src/utils/oauthCallback.js";

describe("oauthCallback utilities", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/login");
    window.sessionStorage.clear();
  });

  it("normalizes oauth intent and return paths", () => {
    expect(normalizeOAuthIntent(" LINK ")).toBe("link");
    expect(normalizeOAuthIntent("unknown", { fallback: "login" })).toBe("login");
    expect(normalizeReturnToPath("/w/acme/settings?tab=security")).toBe("/w/acme/settings?tab=security");
    expect(normalizeReturnToPath("https://example.com", { fallback: "/" })).toBe("/");
    expect(normalizeReturnToPath("//example.com/path", { fallback: "/fallback" })).toBe("/fallback");
  });

  it("writes, reads, and clears pending oauth context in session storage", () => {
    expect(readPendingOAuthContext()).toBe(null);

    writePendingOAuthContext({
      provider: "google",
      intent: "link",
      returnTo: "/w/acme/settings?tab=security",
      rememberAccountOnDevice: false
    });

    const stored = JSON.parse(window.sessionStorage.getItem(OAUTH_PENDING_CONTEXT_STORAGE_KEY));
    expect(stored.provider).toBe("google");
    expect(stored.intent).toBe("link");
    expect(stored.returnTo).toBe("/w/acme/settings?tab=security");
    expect(stored.rememberAccountOnDevice).toBe(false);

    expect(readPendingOAuthContext()).toEqual({
      provider: "google",
      intent: "link",
      returnTo: "/w/acme/settings?tab=security",
      rememberAccountOnDevice: false
    });

    window.sessionStorage.setItem(OAUTH_PENDING_CONTEXT_STORAGE_KEY, "{broken json");
    expect(readPendingOAuthContext()).toBe(null);

    clearPendingOAuthContext();
    expect(window.sessionStorage.getItem(OAUTH_PENDING_CONTEXT_STORAGE_KEY)).toBe(null);
  });

  it("ignores invalid pending context provider", () => {
    writePendingOAuthContext({
      provider: "invalid-provider"
    });
    expect(window.sessionStorage.getItem(OAUTH_PENDING_CONTEXT_STORAGE_KEY)).toBe(null);

    window.sessionStorage.setItem(
      OAUTH_PENDING_CONTEXT_STORAGE_KEY,
      JSON.stringify({
        provider: "invalid-provider",
        intent: "login"
      })
    );
    expect(readPendingOAuthContext()).toBe(null);
  });

  it("reads oauth callback state from code query and hash token session pairs", () => {
    window.history.replaceState(
      {},
      "",
      "/login?oauthProvider=google&oauthIntent=login&oauthReturnTo=%2F#access_token=access-token&refresh_token=refresh-token&token_type=bearer"
    );

    const callbackFromHashTokens = readOAuthCallbackStateFromLocation();
    expect(callbackFromHashTokens).toEqual({
      payload: {
        provider: "google",
        accessToken: "access-token",
        refreshToken: "refresh-token"
      },
      provider: "google",
      intent: "login",
      returnTo: "/"
    });

    window.history.replaceState({}, "", "/login?code=oauth-code");
    const callbackFromCode = readOAuthCallbackStateFromLocation({
      pendingContext: {
        provider: "github",
        intent: "link",
        returnTo: "/w/acme/settings?tab=security"
      },
      defaultProvider: "google",
      defaultIntent: "login",
      defaultReturnTo: "/"
    });
    expect(callbackFromCode).toEqual({
      payload: {
        provider: "google",
        code: "oauth-code"
      },
      provider: "google",
      intent: "link",
      returnTo: "/w/acme/settings?tab=security"
    });

    window.history.replaceState({}, "", "/login?next=/");
    expect(readOAuthCallbackStateFromLocation()).toBe(null);
  });

  it("parses oauth error callbacks and handles non-browser guard paths", () => {
    window.history.replaceState({}, "", "/login?oauthProvider=google&error=access_denied&error_description=Cancelled");
    const callbackWithError = readOAuthCallbackStateFromLocation();
    expect(callbackWithError).toEqual({
      payload: {
        provider: "google",
        error: "access_denied",
        errorDescription: "Cancelled"
      },
      provider: "google",
      intent: "login",
      returnTo: "/"
    });

    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: undefined
    });
    try {
      expect(readOAuthCallbackStateFromLocation()).toBe(null);
      expect(() => stripOAuthCallbackParamsFromLocation()).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        writable: true,
        value: originalWindow
      });
    }

    const originalSessionStorageDescriptor = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: undefined
    });
    try {
      expect(readPendingOAuthContext()).toBe(null);
      expect(() => clearPendingOAuthContext()).not.toThrow();
    } finally {
      if (originalSessionStorageDescriptor) {
        Object.defineProperty(window, "sessionStorage", originalSessionStorageDescriptor);
      }
    }
  });

  it("strips oauth callback params while preserving requested keys", () => {
    window.history.replaceState(
      {},
      "",
      "/login?oauthProvider=google&oauthIntent=login&oauthReturnTo=%2F&code=oauth-code&error=access_denied&keep=1#access_token=access-token&refresh_token=refresh-token&keepHash=1"
    );

    stripOAuthCallbackParamsFromLocation({
      preserveSearchKeys: ["oauthIntent", "keep"]
    });

    const search = new URLSearchParams(window.location.search);
    expect(search.get("oauthIntent")).toBe("login");
    expect(search.get("keep")).toBe("1");
    expect(search.get("oauthProvider")).toBe(null);
    expect(search.get("code")).toBe(null);
    expect(window.location.hash).toBe("#keepHash=1");
  });
});
