import assert from "node:assert/strict";
import test from "node:test";
import { createApp, reactive, ref } from "vue";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSKIT_NAVIGATION_RUNTIME_KEY } from "@jskit-ai/kernel/client/navigation";
import { useShellLeadingNavigation } from "../src/client/composables/useShellLeadingNavigation.js";

function createRuntime() {
  const state = reactive({
    canGoUp: false,
    previousEntry: null,
    predictiveProgress: null
  });
  const calls = [];
  return {
    state,
    calls,
    async goUp(options) {
      calls.push(options);
      return { status: "completed" };
    }
  };
}

function createLeading(runtime, options) {
  const app = createApp({ render: () => null });
  app.provide(JSKIT_NAVIGATION_RUNTIME_KEY, runtime);
  return app.runWithContext(() => useShellLeadingNavigation(options));
}

test("shell leading navigation projects back, menu, and none from one runtime", async () => {
  const runtime = createRuntime();
  const menuAvailable = ref(true);
  let menuOpens = 0;
  const leading = createLeading(runtime, {
    menuAvailable,
    openMenu() {
      menuOpens += 1;
    }
  });

  assert.equal(leading.mode.value, "menu");
  assert.equal(leading.label.value, "Open navigation menu");
  await leading.activate();
  assert.equal(menuOpens, 1);
  assert.equal(runtime.calls.length, 0);

  runtime.state.canGoUp = true;
  assert.equal(leading.mode.value, "back");
  assert.equal(leading.label.value, "Back");
  await leading.activate();
  assert.deepEqual(runtime.calls, [{ reason: "shell-back" }]);

  runtime.state.canGoUp = false;
  menuAvailable.value = false;
  assert.equal(leading.mode.value, "none");
  await leading.activate();
  assert.equal(menuOpens, 1);
});

test("shell leading navigation rejects a missing kernel runtime instead of falling back", () => {
  const app = createApp({ render: () => null });
  assert.throws(
    () => app.runWithContext(() => useShellLeadingNavigation()),
    /requires JSKIT navigation/
  );
});

test("shell Back icon mirrors from the document RTL direction", async () => {
  const source = await readFile(
    fileURLToPath(new URL("../src/client/components/ShellLeadingNavigation.vue", import.meta.url)),
    "utf8"
  );
  assert.match(source, /html\[dir="rtl"\][^\n]*shell-leading-navigation__control--back[^\n]*\.v-icon/u);
  assert.match(source, /transform:\s*scaleX\(-1\)/u);
});
