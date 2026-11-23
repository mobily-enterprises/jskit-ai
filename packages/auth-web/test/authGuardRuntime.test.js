import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_GUARD_EVALUATOR_KEY } from "@jskit-ai/kernel/client";
import { createAuthGuardRuntime } from "../src/client/runtime/authGuardRuntime.js";
import { completeOAuthCallbackFromUrl } from "../src/client/runtime/oauthCallbackRuntime.js";

function createPlacementRuntimeStub(initialContext = {}) {
  let context = initialContext && typeof initialContext === "object" ? { ...initialContext } : {};
  const setCalls = [];

  return {
    getContext() {
      return context;
    },
    setContext(nextContext = {}, { replace = false } = {}) {
      const patch = nextContext && typeof nextContext === "object" ? nextContext : {};
      context = replace ? { ...patch } : { ...context, ...patch };
      setCalls.push(context);
    },
    setCalls
  };
}

function createEventTargetStub() {
  const listenersByType = new Map();

  return {
    addEventListener(type, listener) {
      if (typeof listener !== "function") {
        return;
      }
      const listeners = listenersByType.get(type) || new Set();
      listeners.add(listener);
      listenersByType.set(type, listeners);
    },
    removeEventListener(type, listener) {
      const listeners = listenersByType.get(type);
      if (!listeners) {
        return;
      }
      listeners.delete(listener);
    },
    emit(type) {
      const listeners = listenersByType.get(type);
      if (!listeners) {
        return;
      }
      for (const listener of [...listeners]) {
        listener();
      }
    }
  };
}

function createDocumentStub(initialVisibilityState = "hidden") {
  const eventTarget = createEventTargetStub();
  let visibilityState = initialVisibilityState;

  return {
    addEventListener: eventTarget.addEventListener,
    removeEventListener: eventTarget.removeEventListener,
    emit: eventTarget.emit,
    get visibilityState() {
      return visibilityState;
    },
    setVisibilityState(nextVisibilityState) {
      visibilityState = String(nextVisibilityState || "");
    }
  };
}

function flushPendingRefresh() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

test("auth guard runtime keeps previous auth state on transient refresh failure", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  let callCount = 0;

  const runtime = createAuthGuardRuntime({
    placementRuntime,
    fetchImplementation: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          ok: true,
          async json() {
            return {
              authenticated: true,
              username: "ada"
            };
          }
        };
      }
      throw new Error("network temporarily unavailable");
    }
  });

  await runtime.initialize();
  assert.equal(runtime.getState().authenticated, true);
  const setCallCountBeforeTransientFailure = placementRuntime.setCalls.length;

  await runtime.refresh();
  assert.equal(runtime.getState().authenticated, true);
  assert.equal(placementRuntime.setCalls.length, setCallCountBeforeTransientFailure);
});

test("auth guard runtime redirects callback hashes on non-login routes to /auth/login", async () => {
  const originalWindow = globalThis.window;
  let redirectedTo = "";
  globalThis.window = {
    location: {
      pathname: "/home",
      search: "",
      hash: "#access_token=access&refresh_token=refresh",
      replace(target) {
        redirectedTo = String(target || "");
      }
    }
  };

  try {
    const placementRuntime = createPlacementRuntimeStub();
    let fetchCalls = 0;
    const runtime = createAuthGuardRuntime({
      placementRuntime,
      fetchImplementation: async () => {
        fetchCalls += 1;
        return {
          ok: true,
          async json() {
            return {
              authenticated: false
            };
          }
        };
      }
    });

    const state = await runtime.initialize();
    assert.equal(state.authenticated, false);
    assert.equal(fetchCalls, 0);
    assert.equal(
      redirectedTo,
      "/auth/login?returnTo=%2Fhome#access_token=access&refresh_token=refresh"
    );
  } finally {
    globalThis.window = originalWindow;
  }
});

test("auth guard runtime leaves recovery callback hashes on reset-password route", async () => {
  const originalWindow = globalThis.window;
  let redirectedTo = "";
  globalThis.window = {
    location: {
      pathname: "/auth/reset-password",
      search: "",
      hash: "#access_token=access&refresh_token=refresh&type=recovery",
      replace(target) {
        redirectedTo = String(target || "");
      }
    }
  };

  try {
    const placementRuntime = createPlacementRuntimeStub();
    let fetchCalls = 0;
    const runtime = createAuthGuardRuntime({
      placementRuntime,
      fetchImplementation: async () => {
        fetchCalls += 1;
        return {
          ok: true,
          async json() {
            return {
              authenticated: false
            };
          }
        };
      }
    });

    const state = await runtime.initialize();
    assert.equal(state.authenticated, false);
    assert.equal(fetchCalls, 1);
    assert.equal(redirectedTo, "");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("auth guard runtime only updates placement auth context", async () => {
  const placementRuntime = createPlacementRuntimeStub({
    user: {
      id: 1,
      displayName: "Existing User"
    },
    workspace: {
      id: 9,
      slug: "acme"
    }
  });

  const runtime = createAuthGuardRuntime({
    placementRuntime,
    fetchImplementation: async () => {
      return {
        ok: true,
        async json() {
          return {
            authenticated: true,
            username: "ada",
            email: "ada@example.com",
            permissions: ["settings.allowed"],
            oauthProviders: [{ id: "github", label: "GitHub" }],
            oauthDefaultProvider: "github"
          };
        }
      };
    }
  });

  await runtime.initialize();

  const context = placementRuntime.getContext();
  assert.deepEqual(context.user, {
    id: 1,
    displayName: "Existing User"
  });
  assert.deepEqual(context.workspace, {
    id: 9,
    slug: "acme"
  });
  assert.deepEqual(context.auth, {
    authenticated: true,
    email: "ada@example.com",
    permissions: ["settings.allowed"],
    oauthDefaultProvider: "github",
    oauthProviders: [{ id: "github", label: "GitHub" }]
  });
});

test("auth guard runtime refreshes on reconnect/focus/visibility when explicitly enabled", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const windowStub = createEventTargetStub();
  const documentStub = createDocumentStub("hidden");
  globalThis.window = {
    addEventListener: windowStub.addEventListener,
    removeEventListener: windowStub.removeEventListener,
    location: {
      pathname: "/w/acme",
      search: ""
    }
  };
  globalThis.document = documentStub;

  try {
    const placementRuntime = createPlacementRuntimeStub();
    let callCount = 0;
    const runtime = createAuthGuardRuntime({
      placementRuntime,
      refreshOnForeground: true,
      refreshOnReconnect: true,
      fetchImplementation: async () => {
        callCount += 1;
        return {
          ok: true,
          async json() {
            if (callCount === 1) {
              return {
                authenticated: false
              };
            }
            return {
              authenticated: true,
              username: "ada"
            };
          }
        };
      }
    });

    const observedStates = [];
    runtime.subscribe((state) => {
      observedStates.push(state);
    });

    await runtime.initialize();
    assert.equal(runtime.getState().authenticated, false);
    assert.equal(observedStates.length, 1);

    windowStub.emit("online");
    await flushPendingRefresh();
    assert.equal(runtime.getState().authenticated, true);
    assert.equal(observedStates.length, 2);

    const setCallCountBeforeVisibilityRefresh = placementRuntime.setCalls.length;
    documentStub.setVisibilityState("visible");
    documentStub.emit("visibilitychange");
    await flushPendingRefresh();
    assert.equal(placementRuntime.setCalls.length, setCallCountBeforeVisibilityRefresh + 1);
    assert.equal(observedStates.length, 3);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test("auth guard runtime does not refresh on browser events when foreground/reconnect refresh is disabled", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const windowStub = createEventTargetStub();
  const documentStub = createDocumentStub("visible");
  globalThis.window = {
    addEventListener: windowStub.addEventListener,
    removeEventListener: windowStub.removeEventListener,
    location: {
      pathname: "/w/acme",
      search: ""
    }
  };
  globalThis.document = documentStub;

  try {
    const placementRuntime = createPlacementRuntimeStub();
    let callCount = 0;
    const runtime = createAuthGuardRuntime({
      placementRuntime,
      refreshOnForeground: false,
      fetchImplementation: async () => {
        callCount += 1;
        return {
          ok: true,
          async json() {
            return {
              authenticated: true,
              username: "ada"
            };
          }
        };
      }
    });

    await runtime.initialize();
    assert.equal(callCount, 1);

    windowStub.emit("focus");
    await flushPendingRefresh();
    assert.equal(callCount, 1);

    documentStub.emit("visibilitychange");
    await flushPendingRefresh();
    assert.equal(callCount, 1);

    windowStub.emit("online");
    await flushPendingRefresh();
    assert.equal(callCount, 1);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test("auth guard runtime refreshes session when realtime refresh events are received", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  const socketListeners = new Map();
  let callCount = 0;
  const runtime = createAuthGuardRuntime({
    placementRuntime,
    realtimeSocket: {
      on(eventName, handler) {
        socketListeners.set(eventName, handler);
      },
      off() {}
    },
    fetchImplementation: async () => {
      callCount += 1;
      return {
        ok: true,
        async json() {
          return {
            authenticated: callCount > 1,
            username: "ada"
          };
        }
      };
    }
  });

  await runtime.initialize();
  assert.equal(runtime.getState().authenticated, false);

  socketListeners.get("users.bootstrap.changed")?.({});
  await flushPendingRefresh();
  assert.equal(runtime.getState().authenticated, true);
});

test("auth guard runtime encodes absolute returnTo for external login routes", async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: {
      origin: "https://app.example.com",
      href: "https://app.example.com/w/acme?tab=1",
      pathname: "/w/acme",
      search: "?tab=1"
    }
  };

  try {
    const placementRuntime = createPlacementRuntimeStub();
    const runtime = createAuthGuardRuntime({
      placementRuntime,
      loginRoute: "https://auth.example.com/auth/login",
      fetchImplementation: async () => {
        return {
          ok: true,
          async json() {
            return {
              authenticated: false
            };
          }
        };
      }
    });

    await runtime.initialize();
    const evaluator = globalThis.__JSKIT_WEB_SHELL_GUARD_EVALUATOR__;
    const outcome = evaluator({
      guard: {
        policy: "authenticated"
      },
      context: {
        location: {
          pathname: "/w/acme",
          search: "?tab=1"
        }
      }
    });

    assert.deepEqual(outcome, {
      allow: false,
      redirectTo: "https://auth.example.com/auth/login?returnTo=https%3A%2F%2Fapp.example.com%2Fw%2Facme%3Ftab%3D1",
      reason: "auth-required"
    });
  } finally {
    globalThis.window = originalWindow;
  }
});

/**
 * Starts the guard runtime on the page at `pathname`, `search` and `hash`, with a session that is signed in or not,
 * and answers where it sent the page, how often it read the session, and what the router's guard decides for a
 * signed-in-only route on that page.
 */
async function startGuardOnPage({ pathname, search = "", hash = "" }, { authenticated }) {
  const originalWindow = globalThis.window;
  const replacedWith = [];
  let sessionReads = 0;
  globalThis.window = {
    location: {
      pathname,
      search,
      hash,
      replace(target) {
        replacedWith.push(String(target));
      }
    }
  };
  const runtime = createAuthGuardRuntime({
    placementRuntime: createPlacementRuntimeStub(),
    fetchImplementation: async () => {
      sessionReads += 1;
      return {
        ok: true,
        async json() {
          return authenticated ? { authenticated: true, username: "ada" } : { authenticated: false };
        }
      };
    }
  });

  try {
    const state = await runtime.initialize();
    const guardDecision = replacedWith.length > 0
      ? null
      : globalThis[DEFAULT_GUARD_EVALUATOR_KEY]({
        guard: { policy: "authenticated" },
        context: { location: { pathname, search } }
      });
    return { state, replacedWith, sessionReads, guardDecision };
  } finally {
    runtime.dispose();
    globalThis.window = originalWindow;
  }
}

// Lists filtered by their own query, as mobilynet's console builds and jobs lists are: no sign-in callback.
const PAGES_WITH_THEIR_OWN_QUERY = Object.freeze([
  { pathname: "/console/builds", search: "?app=X&state=all&tab=queues" },
  { pathname: "/console/jobs", search: "?type=x" },
  { pathname: "/projects", search: "?state=failed&type=build&sb=1&token_type=any&expires_in=60" },
  { pathname: "/projects", search: "", hash: "#state=all" }
]);

test("a signed-in page whose own query names state or type stays where it is, with its query", async (t) => {
  for (const page of PAGES_WITH_THEIR_OWN_QUERY) {
    await t.test(`${page.pathname}${page.search}${page.hash || ""}`, async () => {
      const { state, replacedWith, sessionReads, guardDecision } = await startGuardOnPage(page, { authenticated: true });

      assert.deepEqual(replacedWith, []);
      assert.equal(sessionReads, 1);
      assert.equal(state.authenticated, true);
      assert.deepEqual(guardDecision, { allow: true, redirectTo: "", reason: "" });
    });
  }
});

test("signed out on a page whose own query names state, sign-in is asked to return to that page with its query", async () => {
  const { replacedWith, guardDecision } = await startGuardOnPage(
    { pathname: "/console/builds", search: "?app=X&state=all&tab=queues" },
    { authenticated: false }
  );

  assert.deepEqual(replacedWith, []);
  assert.deepEqual(guardDecision, {
    allow: false,
    redirectTo: "/auth/login?returnTo=%2Fconsole%2Fbuilds%3Fapp%3DX%26state%3Dall%26tab%3Dqueues",
    reason: "auth-required"
  });
});

// Each sign-in callback a provider or Supabase can bring to a page other than the sign-in page (Supabase falls back
// to its Site URL when it refuses the redirect address), where the sign-in page sends it, and what completing it there
// sends to the server; an error is shown without a request.
const CALLBACKS_ON_OTHER_PAGES = Object.freeze([
  {
    shape: "an authorization code (PKCE)",
    page: { pathname: "/", search: "?code=pkce-code" },
    sentTo: "/auth/login?code=pkce-code&returnTo=%2F",
    completes: { code: "pkce-code" }
  },
  {
    shape: "an authorization code with its state",
    page: { pathname: "/home", search: "?code=c1&state=s1" },
    sentTo: "/auth/login?code=c1&state=s1&returnTo=%2Fhome",
    completes: { code: "c1", state: "s1" }
  },
  {
    shape: "an authorization code on a page with its own query, which the way back keeps",
    page: { pathname: "/home", search: "?tab=queues&code=c1&state=s1" },
    sentTo: "/auth/login?tab=queues&code=c1&state=s1&returnTo=%2Fhome%3Ftab%3Dqueues",
    returnsTo: "/home?tab=queues",
    completes: { code: "c1", state: "s1" }
  },
  {
    shape: "an authorization code with its state and issuer, none of which the way back keeps",
    page: { pathname: "/home", search: "?code=c1&state=s1&iss=https%3A%2F%2Faccounts.example.com" },
    sentTo: "/auth/login?code=c1&state=s1&iss=https%3A%2F%2Faccounts.example.com&returnTo=%2Fhome",
    completes: { code: "c1", state: "s1", iss: "https://accounts.example.com" }
  },
  {
    shape: "an access and refresh token pair (Supabase email link)",
    page: {
      pathname: "/",
      hash: "#access_token=a1&refresh_token=r1&expires_in=3600&token_type=bearer&type=signup"
    },
    sentTo: "/auth/login?returnTo=%2F#access_token=a1&refresh_token=r1&expires_in=3600&token_type=bearer&type=signup",
    completes: { accessToken: "a1", refreshToken: "r1" }
  },
  {
    shape: "a provider's error",
    page: { pathname: "/", search: "?error=access_denied&error_description=The+user+denied+access&state=s1" },
    sentTo: "/auth/login?error=access_denied&error_description=The+user+denied+access&state=s1&returnTo=%2F",
    shows: "The user denied access"
  },
  {
    shape: "Supabase's error in the hash",
    page: {
      pathname: "/",
      hash: "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"
    },
    sentTo:
      "/auth/login?returnTo=%2F#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    shows: "Email link is invalid or has expired"
  },
  {
    shape: "an error named errorCode",
    page: { pathname: "/", search: "?errorCode=access_denied&errorDescription=Cancelled" },
    sentTo: "/auth/login?errorCode=access_denied&errorDescription=Cancelled&returnTo=%2F",
    shows: "Cancelled"
  }
]);

/** Lands `callback` on its page, and completes it where the guard sent it as the sign-in page does. */
async function assertCallbackCompletedOnSignInPage(callback) {
  const { replacedWith, sessionReads } = await startGuardOnPage(callback.page, { authenticated: false });

  assert.deepEqual(replacedWith, [callback.sentTo]);
  assert.equal(sessionReads, 0, "the sign-in page reads the session");

  const signInPage = new URL(callback.sentTo, "https://app.example.com");
  const requests = [];
  const result = await completeOAuthCallbackFromUrl({
    url: callback.sentTo,
    fallbackReturnTo: signInPage.searchParams.get("returnTo"),
    defaultProvider: "google",
    request: async (path, { body }) => {
      requests.push({ path, body });
      return { email: "ada@example.com" };
    },
    refreshSession: async () => ({ authenticated: true })
  });

  assert.equal(result.handled, true);
  assert.equal(result.returnTo, callback.returnsTo || callback.page.pathname);
  if (callback.completes) {
    assert.equal(result.completed, true);
    assert.deepEqual(requests, [
      { path: "/api/oauth/complete", body: { provider: "google", ...callback.completes } }
    ]);
  } else {
    assert.equal(result.completed, false);
    assert.equal(result.errorMessage, callback.shows);
    assert.deepEqual(requests, []);
  }
}

test("each sign-in callback that lands on another page goes to the sign-in page, which completes it", async (t) => {
  for (const callback of CALLBACKS_ON_OTHER_PAGES) {
    await t.test(callback.shape, () => assertCallbackCompletedOnSignInPage(callback));
  }
});
