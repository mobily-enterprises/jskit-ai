import assert from "node:assert/strict";
import test from "node:test";
import { createPinia } from "pinia";

import {
  createAuthClient,
  createMobileCallbackCompleter
} from "../src/client/runtime/authClient.js";

function createShell() {
  return {
    bootstrap: {
      async refresh() {}
    },
    placement: {
      getContext() {
        return {
          surfaceConfig: {
            defaultSurfaceId: "app",
            enabledSurfaceIds: ["app", "auth"]
          }
        };
      },
      setContext() {
        return this.getContext();
      }
    }
  };
}

test("auth client groups guard, OAuth, and mobile callback behavior without a container", () => {
  const provided = new Map();
  const auth = createAuthClient({
    pinia: createPinia(),
    shell: createShell(),
    vueApp: {
      provide(key, value) {
        provided.set(key, value);
      }
    }
  });

test("auth client refreshes the session over HTTP before realtime reconnects", async (t) => {
  const sessionReads = [];
  t.mock.method(globalThis, "fetch", async (path) => {
    sessionReads.push(path);
    return { ok: true, status: 200, async json() { return { authenticated: false }; } };
  });
  let beforeReconnect = null;
  let released = false;
  const realtime = {
    socket: null,
    setBeforeReconnect(prepare) {
      beforeReconnect = prepare;
      return () => { released = true; };
    }
  };
  const auth = createAuthClient({ pinia: createPinia(), realtime, shell: createShell(), vueApp: { provide() {} } });
  await auth.initialize();
  const readsAtStartup = sessionReads.length;

  await beforeReconnect();
  assert.equal(sessionReads.length, readsAtStartup + 1);
  assert.equal(sessionReads.at(-1), "/api/session");
  auth.dispose();
  assert.equal(released, true);
});

  assert.equal(typeof auth.guard.initialize, "function");
  assert.equal(typeof auth.oauthLaunch.open, "function");
  assert.equal(typeof auth.mobileCallback.completeFromUrl, "function");
  assert.equal(typeof auth.initialize, "function");
  assert.equal(typeof auth.dispose, "function");
  assert.equal(typeof createMobileCallbackCompleter().completeFromUrl, "function");
  assert.equal(provided.size, 0);
});
