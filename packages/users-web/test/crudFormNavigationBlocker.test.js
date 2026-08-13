import assert from "node:assert/strict";
import test from "node:test";
import { createApp, effectScope, ref } from "vue";
import { JSKIT_NAVIGATION_RUNTIME_KEY } from "@jskit-ai/kernel/client/navigation";
import { useCrudFormNavigationBlocker } from "../src/client/composables/useCrudFormNavigationBlocker.js";

test("CRUD form blocker delegates reactive dirty state to the shared navigation runtime", async () => {
  const dirty = ref(false);
  let registered = null;
  let unregistered = false;
  const app = createApp({ render: () => null });
  app.provide(JSKIT_NAVIGATION_RUNTIME_KEY, {
    registerBlocker(blocker) {
      registered = blocker;
      return () => {
        unregistered = true;
      };
    },
    blockerState: { pending: false, blockerId: "" }
  });
  const scope = effectScope();
  scope.run(() => app.runWithContext(() => useCrudFormNavigationBlocker({
    id: "customers.edit.unsaved",
    isDirty: dirty
  })));

  assert.equal(await registered.isBlocked(), false);
  dirty.value = true;
  assert.equal(await registered.isBlocked(), true);
  scope.stop();
  assert.equal(unregistered, true);
});
