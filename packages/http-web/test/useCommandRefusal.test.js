import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { routeLocationKey } from "vue-router";
import { SHELL_WEB_ERROR_RUNTIME_KEY } from "@jskit-ai/shell-web/client/error";
import { SHELL_WEB_PLACEMENT_RUNTIME_KEY } from "@jskit-ai/shell-web/client/placement";
import { useCommand } from "../src/client/composables/useCommand.js";
import { configureHttpWebClient } from "../src/client/lib/httpClient.js";

test.afterEach(() => {
  configureHttpWebClient();
});

// A command that needs orders.pay, on a page whose placement context grants `permissions`, against a server that
// refuses every request it is sent as an action permission denial. Answers the command, the requests it sent and the
// notices its feedback showed through the shell.
async function payOrderCommand(permissions) {
  const requests = [];
  const notices = [];
  configureHttpWebClient({
    fetchImpl: async (url) => {
      requests.push(url);
      return {
        ok: false,
        status: 403,
        headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? "application/json" : "") },
        json: async () => ({ error: "Forbidden.", code: "ACTION_PERMISSION_DENIED", params: {} })
      };
    }
  });
  const placementContext = { permissions };
  let command = null;
  const app = createSSRApp({
    setup() {
      command = useCommand({
        access: "always",
        apiSuffix: "/orders/7/pay",
        runPermissions: ["orders.pay"],
        resource: { apiAccess: "public" },
        messages: { error: "Unable to pay the order." }
      });
      return () => h("div");
    }
  });
  app.provide(routeLocationKey, { path: "/" });
  app.provide(SHELL_WEB_PLACEMENT_RUNTIME_KEY, {
    getContext: () => placementContext,
    getPlacements: () => [],
    setContext: () => placementContext,
    subscribe: () => () => {},
    getRevision: () => 0
  });
  app.provide(SHELL_WEB_ERROR_RUNTIME_KEY, {
    report({ source, message, intent, severity }) {
      notices.push({ source, message, intent, severity });
      return {};
    },
    dismiss() {}
  });
  app.use(VueQueryPlugin, { queryClient: new QueryClient() });
  await renderToString(app);
  return { command, requests, notices };
}

// Before, run() answered null with no request and no notice, so a tap on the command did nothing visible.
test("a command the person's permissions do not allow sends nothing and shows the notice the server's 403 shows", async () => {
  const refused = await payOrderCommand(["orders.view"]);
  assert.equal(refused.command.canRun, false);
  assert.equal(await refused.command.run(), null, "A refused run still answers null.");
  assert.deepEqual(refused.requests, [], "Nothing is sent.");

  const answered = await payOrderCommand(["orders.pay"]);
  await assert.rejects(answered.command.run(), (error) => error.status === 403);
  assert.equal(answered.requests.length, 1);

  assert.deepEqual(refused.notices, [{
    source: "http-web.command.feedback",
    message: "Forbidden.",
    intent: "action-feedback",
    severity: "error"
  }]);
  assert.deepEqual(refused.notices, answered.notices);
  assert.equal(refused.command.messageType, "error");
  assert.equal(refused.command.message, answered.command.message);
});
