import assert from "node:assert/strict";
import test from "node:test";

import { createApi } from "../src/client/consoleErrorsApi.js";

test("consoleErrorsApi routes error endpoints", async () => {
  const calls = [];
  const api = createApi({
    request: async (url, options = {}) => {
      calls.push({ url, options });
      return { ok: true };
    }
  });

  assert.deepEqual(Object.keys(api), [
    "listBrowserErrors",
    "getBrowserError",
    "listServerErrors",
    "getServerError",
    "simulateServerError",
    "reportBrowserError"
  ]);

  await api.listBrowserErrors(2, 50);
  await api.getServerError("err/9");
  await api.simulateServerError({ kind: "database" });

  assert.equal(calls[0].url, "/api/v1/console/errors/browser?page=2&pageSize=50");
  assert.equal(calls[1].url, "/api/v1/console/errors/server/err%2F9");
  assert.equal(calls[2].url, "/api/v1/console/simulate/server-error");
  assert.equal(calls[2].options.method, "POST");
});
