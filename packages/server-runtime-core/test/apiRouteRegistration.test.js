import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { registerApiRouteDefinitions } from "../src/server/apiRouteRegistration.js";

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

test("registerApiRouteDefinitions maps route policy metadata into route config by default", async () => {
  const app = Fastify();

  registerApiRouteDefinitions(app, {
    routes: [
      {
        method: "POST",
        path: "/api/protected",
        auth: "required",
        workspacePolicy: "required",
        workspaceSurface: "app",
        permission: "workspace.read",
        csrfProtection: false,
        handler: async (request, reply) => {
          reply.code(200).send({
            authPolicy: request.routeOptions?.config?.authPolicy,
            workspacePolicy: request.routeOptions?.config?.workspacePolicy,
            workspaceSurface: request.routeOptions?.config?.workspaceSurface,
            permission: request.routeOptions?.config?.permission,
            csrfProtection: request.routeOptions?.config?.csrfProtection
          });
        }
      }
    ]
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/protected"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    authPolicy: "required",
    workspacePolicy: "required",
    workspaceSurface: "app",
    permission: "workspace.read",
    csrfProtection: false
  });
  await app.close();
});
