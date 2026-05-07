import assert from "node:assert/strict";
import test from "node:test";
import {
  completeOAuthCallbackFromCurrentLocation,
  completeOAuthCallbackFromUrl,
  readOAuthCallbackParamsFromUrl
} from "../src/client/runtime/oauthCallbackRuntime.js";

test("readOAuthCallbackParamsFromUrl returns null when the URL has no callback params", () => {
  assert.equal(readOAuthCallbackParamsFromUrl("/auth/login"), null);
});

test("readOAuthCallbackParamsFromUrl reads query and hash callback params", () => {
  assert.deepEqual(
    readOAuthCallbackParamsFromUrl("/auth/login?oauthProvider=google&oauthReturnTo=%2Fw%2Facme&code=abc"),
    {
      code: "abc",
      accessToken: "",
      refreshToken: "",
      hasSessionPair: false,
      errorCode: "",
      errorDescription: "",
      provider: "google",
      returnTo: "/w/acme"
    }
  );

  assert.deepEqual(
    readOAuthCallbackParamsFromUrl("/auth/login?oauthReturnTo=%2Fhome#access_token=access&refresh_token=refresh"),
    {
      code: "",
      accessToken: "access",
      refreshToken: "refresh",
      hasSessionPair: true,
      errorCode: "",
      errorDescription: "",
      provider: "",
      returnTo: "/home"
    }
  );
});

test("completeOAuthCallbackFromUrl exchanges code callbacks and refreshes the session", async () => {
  const calls = [];
  const result = await completeOAuthCallbackFromUrl({
    url: "/auth/login?oauthProvider=google&oauthReturnTo=%2Fw%2Facme&code=abc",
    request: async (path, options) => {
      calls.push({ path, options });
      return {
        username: "Ada",
        email: "ada@example.com"
      };
    },
    refreshSession: async () => ({
      authenticated: true
    })
  });

  assert.equal(result.handled, true);
  assert.equal(result.completed, true);
  assert.equal(result.returnTo, "/w/acme");
  assert.deepEqual(calls, [
    {
      path: "/api/oauth/complete",
      options: {
        method: "POST",
        body: {
          provider: "google",
          code: "abc"
        }
      }
    }
  ]);
});

test("completeOAuthCallbackFromUrl supports provider-less session-pair callbacks", async () => {
  const result = await completeOAuthCallbackFromUrl({
    url: "/auth/login?oauthReturnTo=%2Fhome#access_token=access&refresh_token=refresh",
    request: async (path, options) => {
      assert.equal(path, "/api/oauth/complete");
      assert.deepEqual(options.body, {
        accessToken: "access",
        refreshToken: "refresh"
      });
      return {
        username: "Ada"
      };
    },
    refreshSession: async () => ({
      authenticated: true
    })
  });

  assert.equal(result.handled, true);
  assert.equal(result.completed, true);
  assert.equal(result.returnTo, "/home");
});

test("completeOAuthCallbackFromUrl reports callback errors without issuing a request", async () => {
  const result = await completeOAuthCallbackFromUrl({
    url: "/auth/login?error=access_denied&error_description=Provider%20denied%20access",
    request: async () => {
      throw new Error("request should not be called for callback errors");
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.completed, false);
  assert.equal(result.errorMessage, "Provider denied access");
});

test("completeOAuthCallbackFromUrl reports missing providers for code callbacks", async () => {
  const result = await completeOAuthCallbackFromUrl({
    url: "/auth/login?code=abc",
    request: async () => {
      throw new Error("request should not be called when provider is missing");
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.completed, false);
  assert.equal(result.errorMessage, "OAuth provider is missing from callback.");
});

test("completeOAuthCallbackFromUrl fails when the refreshed session is still unauthenticated", async () => {
  const result = await completeOAuthCallbackFromUrl({
    url: "/auth/login?oauthProvider=google&code=abc",
    request: async () => ({
      username: "Ada"
    }),
    refreshSession: async () => ({
      authenticated: false
    })
  });

  assert.equal(result.handled, true);
  assert.equal(result.completed, false);
  assert.equal(result.errorMessage, "Login succeeded but the session is not active yet. Please retry.");
});

test("completeOAuthCallbackFromCurrentLocation reads from window.location.href", async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: {
      href: "https://app.example.com/auth/login?oauthProvider=google&code=abc"
    }
  };

  try {
    const result = await completeOAuthCallbackFromCurrentLocation({
      request: async () => ({
        username: "Ada"
      }),
      refreshSession: async () => ({
        authenticated: true
      })
    });

    assert.equal(result.handled, true);
    assert.equal(result.completed, true);
  } finally {
    globalThis.window = originalWindow;
  }
});
