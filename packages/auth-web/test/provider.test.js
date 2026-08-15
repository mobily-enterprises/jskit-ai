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

  assert.equal(typeof auth.guard.initialize, "function");
  assert.equal(typeof auth.oauthLaunch.open, "function");
  assert.equal(typeof auth.mobileCallback.completeFromUrl, "function");
  assert.equal(typeof auth.initialize, "function");
  assert.equal(typeof auth.dispose, "function");
  assert.equal(typeof createMobileCallbackCompleter().completeFromUrl, "function");
  assert.equal(provided.size, 0);
});
