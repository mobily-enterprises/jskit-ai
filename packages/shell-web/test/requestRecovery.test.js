import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "vue";
import {
  NO_SHELL_REQUEST_RECOVERY_RUNTIME,
  SHELL_REQUEST_RECOVERY_RUNTIME_KEY,
  isRecoverableRequestError,
  requestRecoveryMessage,
  useShellRequestRecoveryRuntime
} from "../src/client/requestRecovery/index.js";

test("shell request recovery classifier accepts transport failures only", () => {
  assert.equal(isRecoverableRequestError({ status: 0, message: "Network request failed." }), true);
  assert.equal(isRecoverableRequestError(new TypeError("Failed to fetch")), true);
  assert.equal(isRecoverableRequestError({ code: "ECONNREFUSED", message: "fetch failed" }), true);
  assert.equal(isRecoverableRequestError({ status: 422, message: "Invalid input." }), false);
  assert.equal(isRecoverableRequestError(new Error("Business rule failed.")), false);
  assert.equal(isRecoverableRequestError({ name: "AbortError", message: "The operation was aborted." }), false);
  assert.equal(isRecoverableRequestError({ code: "ERR_CANCELED", message: "canceled" }), false);
});

test("shell request recovery message uses app-facing labels", () => {
  assert.equal(
    requestRecoveryMessage(null, { label: "Project access" }),
    "Project access could not reach the server or network. Check the connection and try again."
  );
  assert.equal(
    requestRecoveryMessage(null, { message: "Custom recovery copy." }),
    "Custom recovery copy."
  );
});

test("shell request recovery runtime composable resolves NO_SHELL_REQUEST_RECOVERY_RUNTIME without the provider", async () => {
  const app = createApp({
    render() {
      return null;
    }
  });

  const runtime = app.runWithContext(() => useShellRequestRecoveryRuntime());

  assert.equal(runtime, NO_SHELL_REQUEST_RECOVERY_RUNTIME);
  assert.equal(runtime.report(new TypeError("Failed to fetch")), null);
  assert.equal(await runtime.reload(), false);
});

test("shell request recovery runtime composable resolves the provided public runtime", () => {
  const runtime = {
    report(error, options) {
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
  app.provide(SHELL_REQUEST_RECOVERY_RUNTIME_KEY, runtime);

  assert.equal(
    app.runWithContext(() => useShellRequestRecoveryRuntime()),
    runtime
  );
});
