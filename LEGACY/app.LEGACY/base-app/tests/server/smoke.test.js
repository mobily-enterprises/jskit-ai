import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../../server.js";

test("GET /api/v1/health returns ok payload", async () => {
  const app = createServer();
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/health"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    app: "base-app"
  });

  await app.close();
});
