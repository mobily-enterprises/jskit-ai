import assert from "node:assert/strict";
import test from "node:test";
import { createI18n } from "vue-i18n";
import { registerJskitMessages, setJskitI18n } from "@jskit-ai/kernel/client";
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
      state: "",
      iss: "",
      accessToken: "",
      refreshToken: "",
      hasSessionPair: false,
      errorCode: "",
      errorDescription: "",
      errorDescriptionCode: "",
      errorDescriptionParams: {},
      provider: "google",
      returnTo: "/w/acme"
    }
  );

  assert.deepEqual(
    readOAuthCallbackParamsFromUrl("/auth/login?oauthReturnTo=%2Fhome#access_token=access&refresh_token=refresh"),
    {
      code: "",
      state: "",
      iss: "",
      accessToken: "access",
      refreshToken: "refresh",
      hasSessionPair: true,
      errorCode: "",
      errorDescription: "",
      errorDescriptionCode: "",
      errorDescriptionParams: {},
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

test("a sign-in error the server explained by redirect shows in the user's language", async (t) => {
  registerJskitMessages({ jskit: { auth: { example: { unavailable: "Sign-in with {provider} is unavailable." } } } });
  setJskitI18n(createI18n({
    legacy: false,
    locale: "it",
    messages: { it: { jskit: { auth: { example: { unavailable: "Accesso con {provider} non disponibile." } } } } }
  }));
  t.after(() => setJskitI18n(null));
  const explained = new URLSearchParams({
    error: "sign_in_unavailable",
    error_description: "Sign-in with Acme is unavailable.",
    error_code: "auth.example.unavailable",
    error_params: JSON.stringify({ provider: "Acme" })
  });

  const translated = await completeOAuthCallbackFromUrl({ url: `/auth/login?${explained}` });
  assert.equal(translated.errorMessage, "Accesso con Acme non disponibile.");

  // An app's own sentence under that code stays as the server sent it.
  explained.set("error_description", "Ask your administrator to enable Acme.");
  const asSent = await completeOAuthCallbackFromUrl({ url: `/auth/login?${explained}` });
  assert.equal(asSent.errorMessage, "Ask your administrator to enable Acme.");
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

test("completeOAuthCallbackFromUrl maps allowlist auth denial to a clear message", async () => {
  const result = await completeOAuthCallbackFromUrl({
    url: "/auth/login?oauthProvider=google&code=abc",
    request: async () => ({
      username: "Ada"
    }),
    refreshSession: async () => ({
      authenticated: false,
      authDenied: {
        code: "not_allowlisted",
        message: "This account is not allowed to access this application."
      }
    })
  });

  assert.equal(result.handled, true);
  assert.equal(result.completed, false);
  assert.equal(
    result.errorMessage,
    "Sign-in succeeded, but this account is not allowed to access this application."
  );
});

test("completeOAuthCallbackFromUrl maps blocked auth denial to a clear message", async () => {
  const result = await completeOAuthCallbackFromUrl({
    url: "/auth/login?oauthProvider=google&code=abc",
    request: async () => ({
      username: "Ada"
    }),
    refreshSession: async () => ({
      authenticated: false,
      authDenied: {
        code: "blocked",
        message: "This account has been blocked from accessing this application."
      }
    })
  });

  assert.equal(result.handled, true);
  assert.equal(result.completed, false);
  assert.equal(
    result.errorMessage,
    "Sign-in succeeded, but this account has been blocked from accessing this application."
  );
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

test("completeOAuthCallbackFromUrl forwards state and iss, and takes the page from a fixed-address provider", async () => {
  const calls = [];
  const result = await completeOAuthCallbackFromUrl({
    url: "/auth/login?code=abc&state=st-1&iss=https%3A%2F%2Faccounts.example.test",
    defaultProvider: "oidc",
    request: async (path, options) => {
      calls.push(options.body);
      return { username: "Ada", email: "ada@example.com", returnTo: "/reports" };
    },
    refreshSession: async () => ({ authenticated: true })
  });
  assert.deepEqual(calls, [{ provider: "oidc", code: "abc", state: "st-1", iss: "https://accounts.example.test" }]);
  assert.equal(result.completed, true);
  assert.equal(result.returnTo, "/reports");
});
