import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../../server.js";
import { resolveRuntimeEnv } from "../../server/lib/runtimeEnv.js";

test("GET /api/health returns built-in health response", async () => {
  const app = await createServer({ runtimeEnv: resolveRuntimeEnv() });
  const response = await app.inject({
    method: "GET",
    url: "/api/health"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);

  await app.close();
});
