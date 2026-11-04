import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "vue";
import {
  NO_SHELL_ASYNC_MODULE_RECOVERY_RUNTIME,
  SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY,
  useShellAsyncModuleRecoveryRuntime
} from "../src/client/asyncModuleRecovery/index.js";

test("shell async module recovery runtime composable resolves NO_SHELL_ASYNC_MODULE_RECOVERY_RUNTIME without the provider", async () => {
  const app = createApp({
    render() {
      return null;
    }
  });

  const runtime = app.runWithContext(() => useShellAsyncModuleRecoveryRuntime());

  assert.equal(runtime, NO_SHELL_ASYNC_MODULE_RECOVERY_RUNTIME);
  assert.equal(runtime.notify(new Error("failed")), null);
  assert.equal(await runtime.reload(), false);
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
