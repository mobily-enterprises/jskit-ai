import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../../server.js";

test("GET /api/health returns not found without installed runtime routes", async () => {
  const app = await createServer();
  const response = await app.inject({
    method: "GET",
    url: "/api/health"
  });

  assert.equal(response.statusCode, 404);

  await app.close();
});
