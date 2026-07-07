import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthOauthStartPath } from "@jskit-ai/auth-core/shared/authPaths";
import { useLoginViewActions } from "../src/client/composables/loginView/useLoginViewActions.js";
import { clearAuthCsrfTokenCache } from "../src/client/runtime/authHttpClient.js";

function createJsonResponse(payload = {}, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type" ? "application/json" : null;
      }
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function createMinimalLoginViewState(requestedReturnTo = "/") {
  return {
    requestedReturnTo: { value: requestedReturnTo },
    allowedReturnToOrigins: { value: [] },
    errorMessage: { value: "" },
    infoMessage: { value: "" },
    loading: { value: false },
    submitAttempted: { value: false },
    email: { value: "" },
    password: { value: "password-123" },
    otpCode: { value: "" },
    otpRequestPending: { value: false },
    registerConfirmationResendPending: { value: false },
    pendingEmailConfirmationAddress: { value: "" },
    invitationToken: { value: "" },
    rememberAccountOnDevice: { value: true },
    oauthProviders: { value: [] },
    oauthDefaultProvider: { value: "google" },
    isRegister: { value: false },
    isForgot: { value: false },
    isOtp: { value: false },
    showRememberedAccount: { value: false },
    rememberedAccountDisplayName: { value: "" },
    clearTransientMessages() {},
    applyRememberedAccountPreference() {},
    applyRememberedAccountHint() {},
    enterEmailConfirmationPendingState() {},
    resolveNormalizedEmail() {
      return "ada@example.com";
    }
  };
}

test("useLoginViewActions preserves the intended destination when starting OAuth sign-in", () => {
  const state = createMinimalLoginViewState("/w/acme/workouts/2026-05-07?tab=chart");
  const assignedTargets = [];
  const actions = useLoginViewActions({
    state,
    validation: {},
    queryClient: {},
    errorRuntime: {
      report() {}
    },
    oauthLaunchClient: {
      async open({ url }) {
        assignedTargets.push(url);
      }
    }
  });

  return actions.startOAuthSignIn("google").then(() => {
    const expectedPath = buildAuthOauthStartPath("google");
    assert.deepEqual(assignedTargets, [
      `${expectedPath}?returnTo=%2Fw%2Facme%2Fworkouts%2F2026-05-07%3Ftab%3Dchart`
    ]);
    assert.equal(state.errorMessage.value, "");
  });
});

async function runPasswordLoginWithPostLoginSession(sessionPayload) {
  clearAuthCsrfTokenCache();
  const state = createMinimalLoginViewState("/");
  const fetchCalls = [];
  const reports = [];
  const originalFetch = globalThis.fetch;
  let sessionReads = 0;

  globalThis.fetch = async (url, options = {}) => {
    const normalizedUrl = String(url || "");
    const method = String(options.method || "GET").toUpperCase();
    fetchCalls.push({ url: normalizedUrl, method });

    if (normalizedUrl === "/api/session" && method === "GET") {
      sessionReads += 1;
      return createJsonResponse(
        sessionReads === 1
          ? { authenticated: false, csrfToken: "csrf-a" }
          : { csrfToken: "csrf-b", ...sessionPayload }
      );
    }

    if (normalizedUrl === "/api/login" && method === "POST") {
      return createJsonResponse({ ok: true, username: "Ada" });
    }

    throw new Error(`Unexpected fetch call: ${method} ${normalizedUrl}`);
  };

  try {
    const actions = useLoginViewActions({
      state,
      validation: {
        canSubmit: { value: true }
      },
      queryClient: {
        async fetchQuery({ queryFn }) {
          return queryFn();
        }
      },
      errorRuntime: {
        report(entry) {
          reports.push(entry);
        }
      }
    });

    await actions.submitAuth();
    return { state, fetchCalls, reports };
  } finally {
    globalThis.fetch = originalFetch;
    clearAuthCsrfTokenCache();
  }
}

test("useLoginViewActions shows allowlist denial after successful password login", async () => {
  const { state, fetchCalls, reports } = await runPasswordLoginWithPostLoginSession({
    authenticated: false,
    authDenied: {
      code: "not_allowlisted",
      message: "This account is not allowed to access this application."
    }
  });

  assert.equal(
    state.errorMessage.value,
    "Sign-in succeeded, but this account is not allowed to access this application."
  );
  assert.deepEqual(fetchCalls.map((entry) => `${entry.method} ${entry.url}`), [
    "GET /api/session",
    "POST /api/login",
    "GET /api/session"
  ]);
  assert.equal(reports[0]?.message, state.errorMessage.value);
});

test("useLoginViewActions shows blocked denial after successful password login", async () => {
  const { state } = await runPasswordLoginWithPostLoginSession({
    authenticated: false,
    authDenied: {
      code: "blocked",
      message: "This account has been blocked from accessing this application."
    }
  });

  assert.equal(
    state.errorMessage.value,
    "Sign-in succeeded, but this account has been blocked from accessing this application."
  );
});

test("useLoginViewActions keeps retry message for generic post-login unauthenticated sessions", async () => {
  const { state } = await runPasswordLoginWithPostLoginSession({
    authenticated: false
  });

  assert.equal(state.errorMessage.value, "Login succeeded but the session is not active yet. Please retry.");
});

test("useLoginViewActions includes invitation context when registering from an invite link", async () => {
  clearAuthCsrfTokenCache();
  const state = createMinimalLoginViewState("/invite/invite-token");
  state.isRegister.value = true;
  state.invitationToken.value = "invite-token";
  const originalFetch = globalThis.fetch;
  const registerBodies = [];
  let sessionReads = 0;

  globalThis.fetch = async (url, options = {}) => {
    const normalizedUrl = String(url || "");
    const method = String(options.method || "GET").toUpperCase();

    if (normalizedUrl === "/api/session" && method === "GET") {
      sessionReads += 1;
      return createJsonResponse(
        sessionReads === 1
          ? { authenticated: false, csrfToken: "csrf-a" }
          : { authenticated: true, csrfToken: "csrf-b" }
      );
    }

    if (normalizedUrl === "/api/register" && method === "POST") {
      registerBodies.push(JSON.parse(String(options.body || "{}")));
      return createJsonResponse({ ok: true, username: "Ada", requiresEmailConfirmation: false });
    }

    throw new Error(`Unexpected fetch call: ${method} ${normalizedUrl}`);
  };

  try {
    const actions = useLoginViewActions({
      state,
      validation: {
        canSubmit: { value: true }
      },
      queryClient: {
        async fetchQuery({ queryFn }) {
          return queryFn();
        }
      },
      errorRuntime: {
        report() {}
      }
    });

    await actions.submitAuth();
  } finally {
    globalThis.fetch = originalFetch;
    clearAuthCsrfTokenCache();
  }

  assert.deepEqual(registerBodies, [
    {
      email: "ada@example.com",
      password: "password-123",
      invitation: {
        token: "invite-token",
        source: "workspace-invite"
      }
    }
  ]);
});
