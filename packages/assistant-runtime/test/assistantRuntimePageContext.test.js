import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createMemoryHistory, createRouter } from "vue-router";
import { SHELL_WEB_PLACEMENT_RUNTIME_KEY } from "@jskit-ai/shell-web/client/placement";
import { mountComposable } from "../../shell-web/test/support/mountComposable.js";

// The composable's packages also export Vue components, which render nothing here.
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".vue")) return nextLoad(url, context);
    return { format: "module", shortCircuit: true, source: "export default { render: () => null };" };
  }
});
let useAssistantRuntime;
try {
  ({ useAssistantRuntime } = await import("../src/client/composables/useAssistantRuntime.js"));
} finally {
  hooks.deregister();
}

const APP_CONFIG_KEY = "__JSKIT_CLIENT_APP_CONFIG__";
const APP_CONFIG = Object.freeze({
  surfaceDefinitions: { home: { enabled: true, requiresWorkspace: false } },
  assistantSurfaces: { home: { settingsSurfaceId: "home", configScope: "global" } }
});

// The shell's placement runtime, with the signed-in user "7".
const placementRuntime = Object.freeze({
  getContext: () => ({ user: { id: "7" } }), setContext: () => ({ user: { id: "7" } }), subscribe: () => () => {},
  getPlacements: () => [], getRevision: () => 0, replacePlacements() {}, replacePlacementTopology() {}
});

// One mounted assistant runtime, as a page has it, over an API that records each chat request and answers it at once.
function mountRuntime(t, options = {}) {
  globalThis[APP_CONFIG_KEY] = APP_CONFIG;
  t.after(() => { delete globalThis[APP_CONFIG_KEY]; });
  const requests = [];
  const api = {
    async listConversations() { return { items: [], nextCursor: null }; },
    async streamChat(request, { onEvent }) {
      requests.push(JSON.parse(JSON.stringify(request)));
      onEvent({ type: "meta", messageId: request.messageId, conversationId: "5" });
      onEvent({ type: "assistant_message", text: "Answer." });
      onEvent({ type: "done", messageId: request.messageId, status: "completed" });
    }
  };
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:path(.*)*", component: { render: () => null } }] });
  const { app, result } = mountComposable(() => useAssistantRuntime({ api, surfaceId: "home", ...options }), {
    plugins: [VueQueryPlugin, router], provide: [[SHELL_WEB_PLACEMENT_RUNTIME_KEY, placementRuntime]]
  });
  t.after(() => app.unmount());
  assert.equal(result.state.hasRuntimeScope.value, true, "The runtime is ready to send");
  return { runtime: result, requests };
}

async function send(runtime, text) {
  runtime.state.input.value = text;
  assert.equal(await runtime.actions.sendMessage(), true, `"${text}" is sent`);
  for (let attempt = 0; attempt < 200 && runtime.state.isStreaming.value; attempt += 1) await delay(1);
  assert.equal(runtime.state.isStreaming.value, false, `"${text}" is answered`);
}

test("a page context function is read as each message is sent, so each message carries the page open at that moment", async t => {
  let page = { path: "/jobs/42", title: "Job 42", records: [{ type: "job", id: "42", label: "Job 42" }] };
  const reads = [];
  const { runtime, requests } = mountRuntime(t, { pageContext: () => { reads.push(page.path); return page; } });
  assert.deepEqual(reads, [], "Nothing reads the page before a message is sent");

  await send(runtime, "What's this job's vessel?");
  page = { path: "/jobs/7", title: "Job 7" };
  await send(runtime, "And this one?");

  assert.deepEqual(reads, ["/jobs/42", "/jobs/7"], "One read a message, as it is sent");
  assert.deepEqual(requests.map(request => request.pageContext), [
    { path: "/jobs/42", title: "Job 42", records: [{ type: "job", id: "42", label: "Job 42" }] },
    { path: "/jobs/7", title: "Job 7" }
  ]);
});

test("two assistants on two pages each send their own page, and one given none sends no page context", async t => {
  const left = mountRuntime(t, { pageContext: { path: "/jobs/1", title: "Job 1" } });
  const right = mountRuntime(t, { pageContext: () => ({ path: "/jobs/2", title: "Job 2" }) });
  const plain = mountRuntime(t);
  await send(left.runtime, "Left question");
  await send(right.runtime, "Right question");
  await send(plain.runtime, "Plain question");
  assert.deepEqual(left.requests.map(request => request.pageContext), [{ path: "/jobs/1", title: "Job 1" }]);
  assert.deepEqual(right.requests.map(request => request.pageContext), [{ path: "/jobs/2", title: "Job 2" }]);
  assert.equal(Object.hasOwn(plain.requests[0], "pageContext"), false, "Without the option a message is sent as before");
});
