import assert from "node:assert/strict";
import test from "node:test";
import { createAuthGuardRuntime } from "../src/client/runtime/authGuardRuntime.js";

function createPlacementRuntimeStub() {
  let context = {};
  const setCalls = [];

  return {
    getContext() {
      return context;
    },
    setContext(nextContext) {
      context = nextContext;
      setCalls.push(nextContext);
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

test("auth guard runtime refreshes on reconnect visibility and notifies subscribers", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const windowStub = createEventTargetStub();
  const documentStub = createDocumentStub("hidden");
  globalThis.window = {
    addEventListener: windowStub.addEventListener,
    removeEventListener: windowStub.removeEventListener,
    location: {
      pathname: "/app/w/acme",
      search: ""
    }
  };
  globalThis.document = documentStub;

  try {
    const placementRuntime = createPlacementRuntimeStub();
    let callCount = 0;
    const runtime = createAuthGuardRuntime({
      placementRuntime,
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
