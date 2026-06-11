import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "vue";
import {
  SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY,
  useShellAsyncModuleRecoveryRuntime
} from "../src/client/asyncModuleRecovery/index.js";

test("shell async module recovery runtime composable returns null outside Vue injection context", () => {
  assert.equal(useShellAsyncModuleRecoveryRuntime(), null);
});

test("shell async module recovery runtime composable resolves the provided public runtime", async () => {
  const runtime = {
    notify(error, options) {
      return { error, options };
    },
    async reload() {
      return true;
    }
  };
  const app = createApp({
    render() {
      return null;
    }
  });
  app.provide(SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY, runtime);

  assert.equal(
    app.runWithContext(() => useShellAsyncModuleRecoveryRuntime()),
    runtime
  );
});

test("shell async module recovery runtime composable rejects incomplete runtimes", () => {
  const app = createApp({
    render() {
      return null;
    }
  });
  app.provide(SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY, {
    notify() {}
  });

  assert.equal(
    app.runWithContext(() => useShellAsyncModuleRecoveryRuntime()),
    null
  );
});
