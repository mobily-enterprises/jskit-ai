import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { registerApiRoutes } from "../server/fastify/registerApiRoutes.js";

function buildStubControllers({ onAlertsList } = {}) {
  const fallbackController = new Proxy(
    async (_request, reply) => {
      if (reply && typeof reply.code === "function") {
        reply.code(200).send({ ok: true });
      }
    },
    {
      get() {
        return fallbackController;
      }
    }
  );

  return new Proxy(
    {
      alerts: {
        async list(request, reply) {
          if (typeof onAlertsList === "function") {
            await onAlertsList(request);
          }

          reply.code(200).send({
            entries: [],
            page: 1,
            pageSize: 20,
            total: 0,
            totalPages: 1,
            unreadCount: 0,
            readThroughAlertId: null
          });
        },
        async markAllRead(_request, reply) {
          reply.code(200).send({
            unreadCount: 0,
            readThroughAlertId: 5
          });
        }
      }
    },
    {
      get(target, prop, receiver) {
        if (Reflect.has(target, prop)) {
          return Reflect.get(target, prop, receiver);
        }
        return fallbackController;
      }
    }
  );
}

test("alerts list route accepts valid pagination query", async () => {
  let capturedQuery = null;
  const app = Fastify();
  registerApiRoutes(app, {
    controllers: buildStubControllers({
      onAlertsList(request) {
        capturedQuery = request.query;
      }
    })
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/alerts?page=1&pageSize=20"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(capturedQuery.page, 1);
  assert.equal(capturedQuery.pageSize, 20);
  await app.close();
});

test("alerts list route rejects out-of-range pageSize", async () => {
  const app = Fastify();
  registerApiRoutes(app, {
    controllers: buildStubControllers()
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/alerts?page=1&pageSize=101"
  });

  assert.equal(response.statusCode, 400);
  await app.close();
});

test("alerts read-all route returns command payload", async () => {
  const app = Fastify();
  registerApiRoutes(app, {
    controllers: buildStubControllers()
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/alerts/read-all"
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.unreadCount, 0);
  assert.equal(payload.readThroughAlertId, 5);
  await app.close();
});

