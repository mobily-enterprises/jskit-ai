import assert from "node:assert/strict";
import test from "node:test";

import { TOKENS } from "../../../shared/support/tokens.js";
import { createApplication } from "../../kernel/lib/index.js";
import { createRouter } from "./router.js";
import { registerHttpRuntime, registerRoutes } from "./kernel.js";

function createFastifyStub() {
  const routes = [];
  return {
    routes,
    route(definition) {
      routes.push(definition);
    }
  };
}

function createReplyStub() {
  return {
    sent: false,
    statusCode: 200,
    payload: undefined,
    headers: {},
    code(value) {
      this.statusCode = Number(value);
      return this;
    },
    header(name, value) {
      this.headers[name] = value;
      return this;
    },
    send(payload) {
      this.payload = payload;
      this.sent = true;
      return this;
    }
  };
}

test("registerRoutes attaches request scope and request context tokens", async () => {
  const fastify = createFastifyStub();
  const app = createApplication();
  const observed = {};

  registerRoutes(fastify, {
    app,
    routes: [
      {
        method: "GET",
        path: "/scope-check",
        middleware: [
          (request) => {
            observed.middlewareRequest = request.scope.make(TOKENS.Request);
            observed.middlewareReply = request.scope.make(TOKENS.Reply);
            observed.middlewareRequestId = request.scope.make(TOKENS.RequestId);
            observed.middlewareScope = request.scope.make(TOKENS.RequestScope);
          }
        ],
        handler: async (request, reply) => {
          observed.handlerScope = request.scope;
          observed.handlerRequest = request.scope.make(TOKENS.Request);
          observed.handlerRequestId = request.scope.make(TOKENS.RequestId);
          reply.code(200).send({ ok: true });
        }
      }
    ]
  });

  const request = { id: "req-123" };
  const reply = createReplyStub();

  await fastify.routes[0].handler(request, reply);

  assert.equal(reply.statusCode, 200);
  assert.equal(request.scope.scopeId, "http:req-123");
  assert.equal(observed.middlewareRequest, request);
  assert.equal(observed.middlewareReply, reply);
  assert.equal(observed.middlewareRequestId, "req-123");
  assert.equal(observed.middlewareScope, request.scope);
  assert.equal(observed.handlerScope, request.scope);
  assert.equal(observed.handlerRequest, request);
  assert.equal(observed.handlerRequestId, "req-123");
});

test("registerRoutes can disable request scope attachment", async () => {
  const fastify = createFastifyStub();
  const app = createApplication();

  registerRoutes(fastify, {
    app,
    enableRequestScope: false,
    routes: [
      {
        method: "GET",
        path: "/scope-disabled",
        handler: async (request, reply) => {
          assert.equal(request.scope, undefined);
          reply.code(200).send({ ok: true });
        }
      }
    ]
  });

  const request = { id: "req-999" };
  const reply = createReplyStub();

  await fastify.routes[0].handler(request, reply);

  assert.equal(reply.statusCode, 200);
  assert.equal(request.scope, undefined);
});

test("registerRoutes supports custom request scope property and requestId resolver", async () => {
  const fastify = createFastifyStub();
  const app = createApplication();

  registerRoutes(fastify, {
    app,
    requestScopeProperty: "requestScope",
    requestScopeIdPrefix: "request",
    requestIdResolver: (request) => request.meta?.requestKey,
    routes: [
      {
        method: "GET",
        path: "/scope-custom",
        handler: async (request, reply) => {
          assert.equal(Boolean(request.scope), false);
          assert.equal(Boolean(request.requestScope), true);
          assert.equal(request.requestScope.scopeId, "request:r-42");
          assert.equal(request.requestScope.make(TOKENS.RequestId), "r-42");
          reply.code(200).send({ ok: true });
        }
      }
    ]
  });

  const request = {
    id: "ignored",
    meta: {
      requestKey: "r-42"
    }
  };
  const reply = createReplyStub();

  await fastify.routes[0].handler(request, reply);

  assert.equal(reply.statusCode, 200);
});

test("registerHttpRuntime passes app context so request scope is available", async () => {
  const app = createApplication();
  const fastify = createFastifyStub();
  const router = createRouter();

  router.get("/runtime-scope", async (request, reply) => {
    const requestId = request.scope.make(TOKENS.RequestId);
    reply.code(200).send({ requestId });
  });

  app.instance(TOKENS.Fastify, fastify);
  app.instance(TOKENS.HttpRouter, router);

  const registration = registerHttpRuntime(app);
  assert.equal(registration.routeCount, 1);

  const request = { id: "runtime-1" };
  const reply = createReplyStub();

  await fastify.routes[0].handler(request, reply);

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.payload, { requestId: "runtime-1" });
});
