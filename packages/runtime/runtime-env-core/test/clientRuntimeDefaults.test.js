import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultUseQueryErrorMessage,
  createDefaultUseWorkspaceStore,
  defaultUseAuthGuard
} from "../src/lib/clientRuntimeDefaults.js";

function createComputedStub(getter) {
  return {
    get value() {
      return getter();
    }
  };
}

test("defaultUseAuthGuard provides a no-op unauthorized handler", () => {
  const authGuard = defaultUseAuthGuard();
  assert.equal(typeof authGuard.handleUnauthorizedError, "function");
  assert.equal(authGuard.handleUnauthorizedError(), undefined);
});

test("createDefaultUseWorkspaceStore returns base workspace shape with optional defaults", () => {
  const defaultStore = createDefaultUseWorkspaceStore()();
  assert.deepEqual(defaultStore, {
    activeWorkspace: null,
    activeWorkspaceSlug: ""
  });

  const storeWithExtras = createDefaultUseWorkspaceStore({
    activeWorkspaceId: null,
    can() {
      return false;
    }
  })();

  assert.equal(storeWithExtras.activeWorkspace, null);
  assert.equal(storeWithExtras.activeWorkspaceSlug, "");
  assert.equal(storeWithExtras.activeWorkspaceId, null);
  assert.equal(storeWithExtras.can(), false);
});

test("createDefaultUseQueryErrorMessage resolves message then fallback", () => {
  const useDefaultError = createDefaultUseQueryErrorMessage({
    computed: createComputedStub
  });
  assert.equal(useDefaultError({ error: { value: new Error("boom") } }).value, "");

  const useMappedError = createDefaultUseQueryErrorMessage({
    computed: createComputedStub,
    resolveMessage(error) {
      return error?.message;
    },
    fallbackMessage: "fallback"
  });
  assert.equal(useMappedError({ error: { value: new Error("mapped") } }).value, "mapped");
  assert.equal(useMappedError({ error: { value: null } }).value, "fallback");
});

test("createDefaultUseQueryErrorMessage requires computed", () => {
  assert.throws(() => createDefaultUseQueryErrorMessage(), /computed is required/);
});
