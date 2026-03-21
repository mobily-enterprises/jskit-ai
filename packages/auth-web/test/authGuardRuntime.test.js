import assert from "node:assert/strict";
import test from "node:test";
import { createAuthGuardRuntime } from "../src/client/runtime/authGuardRuntime.js";

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
