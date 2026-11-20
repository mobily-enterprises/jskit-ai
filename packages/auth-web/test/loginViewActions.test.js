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
    signInPausedMinutes: { value: 0 },
    oauthRetryProvider: { value: "" },
    loading: { value: false },
    redirectingSignedIn: { value: false },
    submitAttempted: { value: false },
    email: { value: "" },
    password: { value: "password-123" },
    otpCode: { value: "" },
    otpRequestPending: { value: false },
    registerConfirmationResendPending: { value: false },
    pendingEmailConfirmationAddress: { value: "" },
    isEmailConfirmationPending: { value: false },
    registrationConfirmPending: { value: false },
    confirmationUrl: { value: "" },
    confirmationCode: { value: "" },
    setupCode: { value: "" },
    invitationToken: { value: "" },
    rememberAccountOnDevice: { value: true },
    oauthProviders: { value: [] },
    oauthDefaultProvider: { value: "google" },
    isRegister: { value: false },
    isForgot: { value: false },
    isOtp: { value: false },
    showRememberedAccount: { value: false },
    rememberedAccountDisplayName: { value: "" },
    applyCapabilities() {},
    clearTransientMessages() {},
    applyRememberedAccountPreference() {},
    applyRememberedAccountHint() {},
    enterEmailConfirmationPendingState() {},
    resolveNormalizedEmail() {
      return "ada@example.com";
    }
  };
}

for (const authenticated of [true, false]) {
  test(`login initialization ${authenticated ? "redirects an existing session, showing no form" : "shows the form once the boot session has ended"}`, async (t) => {
    const state = createMinimalLoginViewState("/w/acme/bookings?date=2026-09-16");
    // The shell read a signed-in session at boot, so the page renders no form while it checks again.
    state.redirectingSignedIn.value = true;
    const destinations = [];
    const originalWindow = globalThis.window;
    globalThis.window = {
      location: {
        href: "https://example.com/auth/login",
        replace: (path) => destinations.push(path)
      }
    };
    t.after(() => {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
      clearAuthCsrfTokenCache();
    });
    const fetch = t.mock.method(globalThis, "fetch", async (url) => {
      assert.equal(url, "/api/session");
      return createJsonResponse({ authenticated, csrfToken: "csrf-session" });
    });
    const actions = useLoginViewActions({
      state,
      validation: {},
      queryClient: {
        fetchQuery: ({ queryFn }) => queryFn()
      },
      errorRuntime: { report: (entry) => assert.fail(entry.message) }
    });

    await actions.initializeOnMounted();

    assert.equal(fetch.mock.callCount(), 1);
    assert.deepEqual(destinations, authenticated ? [state.requestedReturnTo.value] : []);
    assert.equal(state.redirectingSignedIn.value, authenticated);
    assert.equal(state.loading.value, false);
    assert.equal(state.errorMessage.value, "");
  });
}

test("an open sign-in page forwards once a session starts elsewhere", async (t) => {
  const state = createMinimalLoginViewState("/w/acme/bookings?date=2026-09-16");
  const destinations = [];
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: {
      href: "https://example.com/auth/login",
      replace: (path) => destinations.push(path)
    }
  };
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    clearAuthCsrfTokenCache();
  });
  const sessions = [
    () => createJsonResponse({ authenticated: false, csrfToken: "csrf-signed-out" }),
    () => {
      throw new TypeError("Failed to fetch");
    },
    () => createJsonResponse({ authenticated: true, csrfToken: "csrf-signed-in" })
  ];
  const fetch = t.mock.method(globalThis, "fetch", async () => sessions.shift()());
  const actions = useLoginViewActions({
    state,
    validation: {},
    queryClient: {
      fetchQuery: ({ queryFn }) => queryFn()
    },
    errorRuntime: { report: (entry) => assert.fail(entry.message) }
  });

  await actions.redirectIfSignedIn();
  await actions.redirectIfSignedIn();
  assert.deepEqual(destinations, [], "a signed-out or offline check keeps the form");
  assert.equal(state.redirectingSignedIn.value, false);

  state.loading.value = true;
  await actions.redirectIfSignedIn();
  assert.equal(fetch.mock.callCount(), 2, "no check runs while a sign-in is in progress");

  state.loading.value = false;
  await actions.redirectIfSignedIn();
  assert.deepEqual(destinations, [state.requestedReturnTo.value]);
  assert.equal(state.redirectingSignedIn.value, true, "the form hides while the page is sent on");
  assert.equal(state.errorMessage.value, "");
});

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

test("OAuth buttons name their provider in the sign-in sentence", () => {
  const state = createMinimalLoginViewState();
  const actions = useLoginViewActions({ state, validation: {}, queryClient: {}, errorRuntime: { report() {} } });
  const github = { id: "github", label: "GitHub" };

  assert.equal(actions.oauthProviderButtonLabel(github), "Continue with GitHub");
  assert.equal(actions.oauthProviderButtonLabel({}), "Continue with OAuth provider");
  state.showRememberedAccount.value = true;
  state.rememberedAccountDisplayName.value = "Ada";
  assert.equal(actions.oauthProviderButtonLabel(github), "Continue with GitHub as Ada");
  state.isRegister.value = true;
  assert.equal(actions.oauthProviderButtonLabel(github), "Register with GitHub");
});

for (const refusal of [
  {
    name: "the route's rate limit",
    payload: { error: "Too many requests. Try again in 42 seconds.", code: "kernel.http.rateLimited", params: { count: 42 } }
  },
  {
    name: "the account's failed sign-ins",
    payload: {
      error: "Password sign-in for this email address is paused for 2 minutes after too many failed attempts. Try again after that.",
      code: "auth.local.login.locked",
      params: { count: 2, retryAfterSeconds: 90 }
    },
    pausedMinutes: 2
  }
]) {
  test(`a sign-in refused by ${refusal.name} says how long to wait`, async (t) => {
    clearAuthCsrfTokenCache();
    t.after(clearAuthCsrfTokenCache);
    const state = createMinimalLoginViewState("/");
    const reports = [];
    t.mock.method(globalThis, "fetch", async (url, options = {}) => {
      if (url === "/api/session") {
        return createJsonResponse({ authenticated: false, csrfToken: "csrf-a" });
      }
      assert.equal(`${options.method} ${url}`, "POST /api/login");
      return createJsonResponse(refusal.payload, { status: 429 });
    });
    const actions = useLoginViewActions({
      state,
      validation: { canSubmit: { value: true } },
      queryClient: { fetchQuery: ({ queryFn }) => queryFn() },
      errorRuntime: { report: (entry) => reports.push(entry) }
    });

    await actions.submitAuth();

    assert.equal(state.errorMessage.value, refusal.payload.error);
    assert.equal(reports[0]?.message, refusal.payload.error);
    // Only a paused password sign-in shows the other ways forward.
    assert.equal(state.signInPausedMinutes.value, refusal.pausedMinutes ?? 0);
  });
}

test("a page opened from a confirmation link asks for the registration's password, and confirming sends both", async (t) => {
  const state = createMinimalLoginViewState("/home");
  Object.assign(state, { confirmationLinkToken: { value: "" }, passwordTouched: { value: false } });
  state.password.value = "";
  const pending = [];
  state.enterEmailConfirmationPendingState = (entry) => {
    pending.push(entry);
    state.confirmationLinkToken.value = entry.linkToken;
  };
  const destinations = [];
  const addresses = [];
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: {
      href: "https://example.com/auth/login?confirmation_token=link-code&returnTo=%2Fhome",
      replace: (path) => destinations.push(path)
    },
    history: { replaceState: (_state, _title, url) => addresses.push(url) }
  };
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    clearAuthCsrfTokenCache();
  });
  const confirmations = [];
  let signedIn = false;
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    if (url === "/api/session" && method === "GET") {
      return createJsonResponse({ authenticated: signedIn, csrfToken: "csrf-session" });
    }
    assert.equal(`${method} ${url}`, "POST /api/register/confirm");
    const body = JSON.parse(options.body);
    confirmations.push(body);
    if (body.password !== "the registration's password") {
      return createJsonResponse({
        error: "That is not the password this registration was made with. Enter the password you registered with, or register again.",
        code: "auth.local.register.confirmationPasswordInvalid"
      }, { status: 400 });
    }
    signedIn = true;
    return createJsonResponse({ ok: true, email: "ada@example.com", username: "Ada", message: "Your email is confirmed." });
  });
  const actions = useLoginViewActions({
    state,
    validation: {},
    queryClient: { fetchQuery: ({ queryFn }) => queryFn() },
    errorRuntime: { report() {} }
  });

  // Opening the link takes its code out of the address and asks for the password; nothing is confirmed yet.
  await actions.initializeOnMounted();
  assert.deepEqual(addresses, ["/auth/login?returnTo=%2Fhome"]);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].linkToken, "link-code");
  assert.deepEqual(confirmations, []);

  // Without a password nothing is sent; a wrong one is refused and the page stays.
  await actions.confirmRegistrationCode();
  assert.deepEqual(confirmations, []);
  assert.notEqual(state.errorMessage.value, "");
  state.password.value = "a wrong password";
  await actions.confirmRegistrationCode();
  assert.deepEqual(confirmations, [{ token: "link-code", password: "a wrong password" }]);
  assert.match(state.errorMessage.value, /^That is not the password this registration was made with\./u);
  assert.deepEqual(destinations, []);

  // The registration's password confirms, signs in and opens the requested page.
  state.password.value = "the registration's password";
  await actions.confirmRegistrationCode();
  assert.deepEqual(confirmations.at(-1), { token: "link-code", password: "the registration's password" });
  assert.deepEqual(destinations, ["/home"]);
});

// A tab's session storage, as the browser keeps it.
function memorySessionStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values
  };
}

// The page at `href`, with this tab's session storage, until the test ends.
function openPage(t, href, sessionStorage) {
  const originalWindow = globalThis.window;
  const destinations = [];
  globalThis.window = {
    location: { href, origin: "https://example.com", replace: (path) => destinations.push(path) },
    history: { replaceState: (_state, _title, url) => { globalThis.window.location.href = `https://example.com${url}`; } },
    sessionStorage
  };
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    clearAuthCsrfTokenCache();
  });
  return destinations;
}

function launchRecorder() {
  const opened = [];
  return { opened, client: { async open({ url }) { opened.push(url); } } };
}

test("a provider sign-in cancelled at the provider comes back to the page and invitation it started from", async (t) => {
  const storage = memorySessionStorage();
  openPage(t, "https://example.com/auth/login?returnTo=%2Finvite%3Ftoken%3Dabc&invitationToken=inv-1", storage);
  const launch = launchRecorder();
  const starting = createMinimalLoginViewState("/invite?token=abc");
  starting.invitationToken.value = "inv-1";
  const startActions = useLoginViewActions({ state: starting, validation: {}, queryClient: {}, errorRuntime: { report() {} }, oauthLaunchClient: launch.client });

  await startActions.startOAuthSignIn("google");
  const started = `${buildAuthOauthStartPath("google")}?returnTo=%2Finvite%3Ftoken%3Dabc&invitationToken=inv-1`;
  assert.deepEqual(launch.opened, [started], "the start names the invitation, which the server keeps to the end");
  assert.deepEqual(JSON.parse(storage.values.get("jskit.auth-web.oauth-start")),
    { provider: "google", returnTo: "/invite?token=abc", invitationToken: "inv-1" });

  // The provider sends the person back to the one fixed address with neither, here after Cancel.
  globalThis.window.location.href = "https://example.com/auth/login?error=access_denied&error_description=Sign-in%20was%20cancelled.&state=s1";
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "/api/session");
    return createJsonResponse({ authenticated: false, csrfToken: "csrf-a" });
  });
  const returned = createMinimalLoginViewState("/");
  const actions = useLoginViewActions({
    state: returned,
    validation: {},
    queryClient: { fetchQuery: ({ queryFn }) => queryFn() },
    errorRuntime: { report() {} },
    oauthLaunchClient: launch.client
  });
  await actions.initializeOnMounted();

  assert.equal(returned.errorMessage.value, "Sign-in was cancelled.");
  assert.equal(returned.requestedReturnTo.value, "/invite?token=abc");
  assert.equal(returned.invitationToken.value, "inv-1");
  assert.equal(storage.values.has("jskit.auth-web.oauth-start"), false, "a callback uses it once");
  await actions.startOAuthSignIn("google");
  assert.deepEqual(launch.opened, [started, started], "starting again keeps the way back");
});

test("a page whose storage the browser refuses still starts a provider sign-in, without the way back", async (t) => {
  const refusing = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("SecurityError"); },
    removeItem() { throw new Error("SecurityError"); }
  };
  openPage(t, "https://example.com/auth/login", refusing);
  const launch = launchRecorder();
  const state = createMinimalLoginViewState("/home");
  const actions = useLoginViewActions({ state, validation: {}, queryClient: {}, errorRuntime: { report() {} }, oauthLaunchClient: launch.client });

  await actions.startOAuthSignIn("google");

  assert.deepEqual(launch.opened, [`${buildAuthOauthStartPath("google")}?returnTo=%2Fhome`]);
  assert.equal(state.errorMessage.value, "");
});

test("a provider sign-in that does not complete in 20 seconds stops, says so, and offers to start the same one again", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const storage = memorySessionStorage({
    "jskit.auth-web.oauth-start": JSON.stringify({ provider: "github", returnTo: "/invite?token=abc", invitationToken: "inv-1" })
  });
  openPage(t, "https://example.com/auth/login?code=c1&state=s1", storage);
  const posted = Promise.withResolvers();
  let completeSignal = null;
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (url === "/api/session") {
      return createJsonResponse({ authenticated: false, csrfToken: "csrf-a" });
    }
    assert.equal(`${options.method} ${url}`, "POST /api/oauth/complete");
    completeSignal = options.signal;
    posted.resolve();
    // A provider or network that never answers.
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason)));
  });
  const launch = launchRecorder();
  const state = createMinimalLoginViewState("/");
  const actions = useLoginViewActions({
    state,
    validation: {},
    queryClient: { fetchQuery: ({ queryFn }) => queryFn() },
    errorRuntime: { report() {} },
    oauthLaunchClient: launch.client
  });

  const mounted = actions.initializeOnMounted();
  await posted.promise;
  t.mock.timers.tick(19_999);
  await Promise.resolve();
  assert.equal(state.loading.value, true, "still waiting just before the limit");
  t.mock.timers.tick(1);
  await mounted;

  assert.equal(completeSignal.aborted, true, "the completion request is abandoned");
  assert.equal(state.loading.value, false);
  assert.equal(state.errorMessage.value, "Signing in with the provider took too long, so it was stopped. Try again.");
  assert.equal(state.oauthRetryProvider.value, "github");
  assert.equal(state.requestedReturnTo.value, "/invite?token=abc");
  await actions.startOAuthSignIn(state.oauthRetryProvider.value);
  assert.deepEqual(launch.opened, [`${buildAuthOauthStartPath("github")}?returnTo=%2Finvite%3Ftoken%3Dabc&invitationToken=inv-1`]);
  assert.equal(state.oauthRetryProvider.value, "", "starting again clears the offer");
});
