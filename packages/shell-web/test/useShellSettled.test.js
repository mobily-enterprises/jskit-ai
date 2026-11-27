import assert from "node:assert/strict";
import test from "node:test";
import { watch } from "vue";
import { silentLogger } from "@jskit-ai/kernel/shared/support/silentLogger";
import { useShellSettled } from "../src/client/composables/useShellSettled.js";
import { SHELL_WEB_PLACEMENT_RUNTIME_KEY } from "../src/client/placement/inject.js";
import { createWebPlacementRuntime } from "../src/client/placement/runtime.js";
import { mountComposable } from "./support/mountComposable.js";

// Mounts the settle phase on a real placement runtime, listing each class it gives the shell's parts after the first.
function mountSettled(runtime) {
  let settledNavigation = 0;
  const { app, result } = mountComposable(() => useShellSettled({
    settleNavigation() {
      settledNavigation += 1;
    }
  }), { provide: [[SHELL_WEB_PLACEMENT_RUNTIME_KEY, runtime]] });
  const classes = [];
  watch(result.settlingClass, (value) => classes.push(value), { flush: "sync" });
  return { app, classes, result, settledNavigation: () => settledNavigation };
}

// Lets every queued render and promise reaction run.
const drain = () => new Promise((resolve) => setTimeout(resolve, 0));

test("with nothing pending the shell settles as it mounts: unseen, then shown with transitions held, then itself", async () => {
  const runtime = createWebPlacementRuntime({ components: new Map(), logger: silentLogger });
  const { app, classes, result, settledNavigation } = mountSettled(runtime);
  assert.equal(result.settlingClass.value, "shell-layout--waiting");
  assert.equal(result.waiting.value, true);

  await drain();

  assert.deepEqual(classes, ["shell-layout--placing", ""]);
  assert.equal(result.waiting.value, false);
  assert.equal(settledNavigation(), 1);
  app.unmount();
});

test("the shell waits while part of its context is pending, settles once it arrives, and waits only once", async () => {
  const runtime = createWebPlacementRuntime({ components: new Map(), logger: silentLogger });
  runtime.setContext({ consolePermissions: [] }, { source: "console-session", pending: true });
  const { app, classes, result, settledNavigation } = mountSettled(runtime);

  await drain();
  assert.equal(result.waiting.value, true);
  assert.deepEqual(classes, []);
  assert.equal(settledNavigation(), 0);

  runtime.setContext({ consolePermissions: ["builds.read"] }, { source: "console-session" });
  await drain();
  assert.deepEqual(classes, ["shell-layout--placing", ""]);
  assert.equal(settledNavigation(), 1);

  // A later wait redraws the navigation in place: the page stays shown.
  runtime.setContext({ consolePermissions: [] }, { source: "console-session", pending: true });
  await drain();
  assert.equal(result.settlingClass.value, "");
  assert.equal(settledNavigation(), 1);
  app.unmount();
});

test("a shell unmounted while it waits never settles", async () => {
  const runtime = createWebPlacementRuntime({ components: new Map(), logger: silentLogger });
  runtime.setContext({ consolePermissions: [] }, { source: "console-session", pending: true });
  const { app, classes, settledNavigation } = mountSettled(runtime);
  await drain();

  app.unmount();
  runtime.setContext({ consolePermissions: ["builds.read"] }, { source: "console-session" });
  await drain();

  assert.deepEqual(classes, []);
  assert.equal(settledNavigation(), 0);
});
