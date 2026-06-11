import assert from "node:assert/strict";
import test from "node:test";
import {
  createAsyncModuleRecoveryState,
  dismissAsyncModuleRecovery,
  dynamicImportErrorMessage,
  guardedReloadApp,
  installAsyncModuleRecoveryHandlers,
  isDynamicImportError,
  notifyAsyncModuleLoadError
} from "./asyncModuleRecovery.js";

function createWindowDouble() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) {
        listeners.delete(type);
      }
    }
  };
}

test("async module recovery recognizes dynamic import failures only", () => {
  assert.equal(
    isDynamicImportError(new Error("Failed to fetch dynamically imported module: /assets/page.js")),
    true
  );
  assert.equal(isDynamicImportError(new Error("Loading chunk dashboard failed")), true);
  assert.equal(isDynamicImportError(new Error("Request failed.")), false);
});

test("async module recovery mutates state with an actionable retry", () => {
  const retry = () => "retried";
  const state = createAsyncModuleRecoveryState();
  const error = new Error("Failed to fetch dynamically imported module: /assets/tool.js");

  notifyAsyncModuleLoadError(state, error, {
    label: "Tool",
    retry
  });

  assert.equal(state.visible, true);
  assert.equal(state.attempt, 1);
  assert.equal(state.label, "Tool");
  assert.equal(state.message, "Tool did not download. The app may have been updated, or the network request failed.");
  assert.equal(state.retry, retry);
  assert.equal(state.stale, true);

  assert.equal(dismissAsyncModuleRecovery(state), true);
  assert.equal(state.visible, false);
});

test("async module recovery message stays generic for non-stale failures", () => {
  assert.equal(
    dynamicImportErrorMessage(new Error("boom"), {
      label: "Widget",
      stale: false
    }),
    "Widget could not load."
  );
});

test("async module recovery installs router and unhandled rejection handlers", async () => {
  let routerHandler = null;
  const replaced = [];
  const notifications = [];
  const windowObject = createWindowDouble();
  const state = createAsyncModuleRecoveryState();
  const disposable = installAsyncModuleRecoveryHandlers({
    state,
    label: "Runtime module",
    onNotify(nextState) {
      notifications.push({
        attempt: nextState.attempt,
        label: nextState.label
      });
    },
    windowObject,
    router: {
      onError(handler) {
        routerHandler = handler;
        return () => {
          routerHandler = null;
        };
      },
      replace(fullPath) {
        replaced.push(fullPath);
      }
    }
  });

  routerHandler(new Error("Failed to fetch dynamically imported module: /assets/page.js"), {
    fullPath: "/app/home"
  });

  assert.equal(state.label, "Page");
  assert.deepEqual(notifications[0], {
    attempt: 1,
    label: "Page"
  });
  assert.equal(typeof state.retry, "function");
  await state.retry();
  assert.deepEqual(replaced, ["/app/home"]);

  windowObject.listeners.get("unhandledrejection")({
    reason: new Error("Importing a module script failed.")
  });
  assert.equal(state.label, "Runtime module");
  assert.deepEqual(notifications[1], {
    attempt: 2,
    label: "Runtime module"
  });

  disposable.dispose();
  assert.equal(routerHandler, null);
  assert.equal(windowObject.listeners.has("unhandledrejection"), false);
});

test("guarded reload navigates only after the current document is reachable", async () => {
  const reloadCalls = [];
  const fetchCalls = [];
  const result = await guardedReloadApp({
    browserWindow: {
      location: {
        href: "https://example.test/app",
        reload() {
          reloadCalls.push("reload");
        }
      }
    },
    async fetchFn(input, init) {
      fetchCalls.push({ input, init });
      return {
        ok: true,
        status: 200
      };
    }
  });

  assert.equal(result, true);
  assert.deepEqual(reloadCalls, ["reload"]);
  assert.equal(fetchCalls[0].input, "https://example.test/app");
  assert.equal(fetchCalls[0].init.cache, "no-store");
  assert.equal(fetchCalls[0].init.credentials, "same-origin");
});

test("guarded reload keeps the page alive when the server is unreachable", async () => {
  const state = createAsyncModuleRecoveryState();
  const retry = () => null;
  notifyAsyncModuleLoadError(state, new Error("Failed to fetch dynamically imported module: /assets/tool.js"), {
    label: "Tool",
    retry
  });

  const reloadCalls = [];
  const result = await guardedReloadApp({
    state,
    label: "App",
    message: "App cannot reload yet.",
    browserWindow: {
      location: {
        href: "https://example.test/app",
        reload() {
          reloadCalls.push("reload");
        }
      }
    },
    async fetchFn() {
      throw new TypeError("Failed to fetch");
    }
  });

  assert.equal(result, false);
  assert.deepEqual(reloadCalls, []);
  assert.equal(state.visible, true);
  assert.equal(state.label, "App");
  assert.equal(state.message, "App cannot reload yet.");
  assert.equal(state.retry, retry);
  assert.equal(state.stale, false);
});
