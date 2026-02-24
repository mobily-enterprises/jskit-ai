import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { registerApiRouteDefinitions } from "../src/apiRouteRegistration.js";

test("registerApiRouteDefinitions registers route handlers and request URL resolver", async () => {
  const app = Fastify();
  const seen = [];

  registerApiRouteDefinitions(app, {
    routes: [
      {
        method: "GET",
        path: "/api/ping",
        handler: async (_request, reply, requestUrl) => {
          seen.push(requestUrl?.pathname || "");
          reply.code(200).send({ ok: true });
        }
      }
    ],
    resolveRequestUrl(request) {
      return new URL(`http://localhost${request.url}`);
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/ping"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seen, ["/api/ping"]);
  await app.close();
});
