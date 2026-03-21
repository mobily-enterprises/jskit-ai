import assert from "node:assert/strict";
import test from "node:test";

import { KERNEL_TOKENS } from "../../../shared/support/tokens.js";
import { registerActionContextContributor } from "../../actions/ActionRuntimeServiceProvider.js";
import { createApplication } from "../../kernel/lib/index.js";
import { createRouter } from "./router.js";
import { createHttpRuntime, registerHttpRuntime, registerRoutes } from "./kernel.js";
import { registerRouteVisibilityResolver } from "../../registries/routeVisibilityResolverRegistry.js";

function createFastifyStub() {
  const routes = [];
  return {
    routes,
    setErrorHandlerCalls: 0,
    errorHandler: null,
    route(definition) {
      routes.push(definition);
    },
    setErrorHandler(handler) {
      this.errorHandler = handler;
      this.setErrorHandlerCalls += 1;
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
            observed.middlewareRequest = request.scope.make(KERNEL_TOKENS.Request);
            observed.middlewareReply = request.scope.make(KERNEL_TOKENS.Reply);
            observed.middlewareRequestId = request.scope.make(KERNEL_TOKENS.RequestId);
            observed.middlewareScope = request.scope.make(KERNEL_TOKENS.RequestScope);
          }
        ],
        handler: async (request, reply) => {
          observed.handlerScope = request.scope;
          observed.handlerRequest = request.scope.make(KERNEL_TOKENS.Request);
          observed.handlerRequestId = request.scope.make(KERNEL_TOKENS.RequestId);
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

test("registerRoutes attaches request.executeAction and applies action context contributors", async () => {
  const fastify = createFastifyStub();
  const app = createApplication();
  const observed = [];

  registerActionContextContributor(app, "test.auth.actionContextContributor", () => ({
    contributorId: "test.auth",
    contribute({ request }) {
      return {
        actor: request?.user || null,
        permissions: Array.isArray(request?.permissions) ? request.permissions.slice() : [],
        workspace: request?.workspace || null,
        membership: request?.membership || null
      };
    }
  }));

  app.instance("actionExecutor", {
    async execute(payload) {
      observed.push(payload);
      return {
        ok: true
      };
    }
  });

  registerRoutes(fastify, {
    app,
    routes: [
      {
        method: "GET",
        path: "/action-helper",
        surface: "coffie",
        middleware: [
          (request) => {
            request.user = {
              id: 7,
              email: "user@example.com"
            };
            request.permissions = ["settings.read"];
            request.workspace = {
              id: 10,
              slug: "main"
            };
            request.membership = {
              roleId: "owner"
            };
          }
        ],
        handler: async (request, reply) => {
          await request.executeAction({
            actionId: "settings.read",
            input: {
              locale: "en-US"
            },
            context: {
              requestMeta: {
                commandId: "cmd-1"
              }
            }
          });

          await request.executeAction({
            actionId: "settings.override",
            context: {
              actor: {
                id: 99
              },
              permissions: ["*"],
              surface: "console",
              channel: "internal"
            }
          });

          reply.code(200).send({
            ok: true
          });
        }
      }
    ]
  });

  const request = {
    id: "req-55",
    raw: {
      url: "/api/admin/workspace/settings?mode=full"
    }
  };
  const reply = createReplyStub();

  await fastify.routes[0].handler(request, reply);

  assert.equal(reply.statusCode, 200);
  assert.equal(typeof request.executeAction, "function");
  assert.equal(Object.prototype.propertyIsEnumerable.call(request, "executeAction"), false);
  assert.equal(observed.length, 2);

  assert.equal(observed[0].actionId, "settings.read");
  assert.deepEqual(observed[0].input, { locale: "en-US" });
  assert.equal(observed[0].context.actor?.id, 7);
  assert.deepEqual(observed[0].context.permissions, ["settings.read"]);
  assert.equal(observed[0].context.workspace?.id, 10);
  assert.equal(observed[0].context.membership?.roleId, "owner");
  assert.equal(observed[0].context.surface, "coffie");
  assert.equal(observed[0].context.channel, "api");
  assert.equal(observed[0].context.requestMeta.commandId, "cmd-1");
  assert.equal(observed[0].context.requestMeta.request, request);

  assert.equal(observed[1].actionId, "settings.override");
  assert.equal(observed[1].context.actor?.id, 99);
  assert.deepEqual(observed[1].context.permissions, ["*"]);
  assert.equal(observed[1].context.surface, "console");
  assert.equal(observed[1].context.channel, "internal");
});

test("registerRoutes attaches visibilityContext from route visibility resolvers", async () => {
  const fastify = createFastifyStub();
  const app = createApplication();
  const observed = [];

  registerActionContextContributor(app, "test.auth.actionContextContributor", () => ({
    contributorId: "test.auth",
    contribute({ request }) {
      return {
        actor: request?.user || null
      };
    }
  }));

  registerRouteVisibilityResolver(app, "test.http.visibilityResolver", () => ({
    resolverId: "test.visibility",
    resolve({ visibility, context }) {
      if (visibility !== "user") {
        return {};
      }

      return {
        userOwnerId: context?.actor?.id
      };
    }
  }));

  app.instance("actionExecutor", {
    async execute(payload) {
      observed.push(payload);
      return { ok: true };
    }
  });

  registerRoutes(fastify, {
    app,
    routes: [
      {
        method: "GET",
        path: "/visible",
        visibility: "user",
        handler: async (request, reply) => {
          request.user = {
            id: 23
          };
          await request.executeAction({
            actionId: "contacts.list"
          });
          reply.code(200).send({ ok: true });
        }
      }
    ]
  });

  const request = { id: "req-visible" };
  const reply = createReplyStub();

  await fastify.routes[0].handler(request, reply);

  assert.equal(reply.statusCode, 200);
  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0].context.visibilityContext, {
    visibility: "user",
    scopeOwnerId: null,
    userOwnerId: 23
  });
  assert.deepEqual(observed[0].context.requestMeta.visibilityContext, observed[0].context.visibilityContext);
  assert.equal(observed[0].context.requestMeta.routeVisibility, "user");
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
          assert.equal(request.requestScope.make(KERNEL_TOKENS.RequestId), "r-42");
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
    const requestId = request.scope.make(KERNEL_TOKENS.RequestId);
    reply.code(200).send({ requestId });
  });

  app.instance(KERNEL_TOKENS.Fastify, fastify);
  app.instance(KERNEL_TOKENS.HttpRouter, router);

  const registration = registerHttpRuntime(app);
  assert.equal(registration.routeCount, 1);

  const request = { id: "runtime-1" };
  const reply = createReplyStub();

  await fastify.routes[0].handler(request, reply);

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.payload, { requestId: "runtime-1" });
  assert.equal(fastify.setErrorHandlerCalls, 1);
});

test("registerHttpRuntime installs API error handling once by default", () => {
  const app = createApplication();
  const fastify = createFastifyStub();
  const router = createRouter();

  app.instance(KERNEL_TOKENS.Fastify, fastify);
  app.instance(KERNEL_TOKENS.HttpRouter, router);

  registerHttpRuntime(app);
  registerHttpRuntime(app);

  assert.equal(fastify.setErrorHandlerCalls, 1);
  assert.equal(typeof fastify.errorHandler, "function");
});

test("registerHttpRuntime can disable automatic API error handling", () => {
  const app = createApplication();
  const fastify = createFastifyStub();
  const router = createRouter();

  app.instance(KERNEL_TOKENS.Fastify, fastify);
  app.instance(KERNEL_TOKENS.HttpRouter, router);

  registerHttpRuntime(app, {
    autoRegisterApiErrorHandling: false
  });

  assert.equal(fastify.setErrorHandlerCalls, 0);
});

test("createHttpRuntime installs API error handling when Fastify is provided", () => {
  const app = createApplication();
  const fastify = createFastifyStub();

  createHttpRuntime({
    app,
    fastify
  });

  assert.equal(fastify.setErrorHandlerCalls, 1);
});

test("registerHttpRuntime forwards middleware alias/group config to route execution", async () => {
  const app = createApplication();
  const fastify = createFastifyStub();
  const router = createRouter();
  const observed = [];

  router.get(
    "/runtime-middleware",
    {
      middleware: ["api"]
    },
    async (_request, reply) => {
      observed.push("handler");
      reply.code(200).send({
        ok: true
      });
    }
  );

  app.instance(KERNEL_TOKENS.Fastify, fastify);
  app.instance(KERNEL_TOKENS.HttpRouter, router);

  registerHttpRuntime(app, {
    middleware: {
      aliases: {
        auth: async () => {
          observed.push("auth");
        },
        "throttle:60,1": async () => {
          observed.push("throttle");
        }
      },
      groups: {
        api: ["auth", "throttle:60,1"]
      }
    }
  });

  const request = {};
  const reply = createReplyStub();
  await fastify.routes[0].handler(request, reply);

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(observed, ["auth", "throttle", "handler"]);
});

test("registerRoutes attaches request.input when route input transforms are configured", async () => {
  const fastify = createFastifyStub();

  registerRoutes(fastify, {
    routes: [
      {
        method: "POST",
        path: "/input-transform",
        input: {
          body: (body) => ({
            name: String(body?.name || "").trim(),
            email: String(body?.email || "")
              .trim()
              .toLowerCase()
          }),
          query: (query) => ({
            dryRun: query?.dryRun === true
          })
        },
        middleware: [
          (request) => {
            assert.deepEqual(request.input, {
              body: {
                name: "Alice",
                email: "alice@example.com"
              },
              query: {
                dryRun: true
              },
              params: undefined
            });
          }
        ],
        handler: async (request, reply) => {
          assert.deepEqual(request.input.body, {
            name: "Alice",
            email: "alice@example.com"
          });
          assert.deepEqual(request.input.query, { dryRun: true });
          reply.code(200).send({ ok: true });
        }
      }
    ]
  });

  const request = {
    body: {
      name: "  Alice  ",
      email: "  ALICE@EXAMPLE.COM "
    },
    query: {
      dryRun: true
    }
  };
  const reply = createReplyStub();

  await fastify.routes[0].handler(request, reply);

  assert.equal(reply.statusCode, 200);
});

test("registerRoutes leaves request.input undefined when route input is not configured", async () => {
  const fastify = createFastifyStub();

  registerRoutes(fastify, {
    routes: [
      {
        method: "GET",
        path: "/no-input-transform",
        handler: async (request, reply) => {
          assert.equal(request.input, undefined);
          reply.code(200).send({ ok: true });
        }
      }
    ]
  });

  const request = {};
  const reply = createReplyStub();

  await fastify.routes[0].handler(request, reply);
  assert.equal(reply.statusCode, 200);
});

test("registerRoutes rejects invalid route input transform definitions", () => {
  const fastify = createFastifyStub();

  assert.throws(
    () =>
      registerRoutes(fastify, {
        routes: [
          {
            method: "POST",
            path: "/invalid-input",
            input: {
              body: "not-a-function"
            },
            handler: async () => {}
          }
        ]
      }),
    /input\.body must be a function/
  );
});

test("registerRoutes resolves middleware aliases and groups", async () => {
  const fastify = createFastifyStub();
  const observed = {
    traces: []
  };

  const requireAuth = async (request) => {
    observed.traces.push("auth");
    request.user = {
      id: 7
    };
  };
  const throttle = async () => {
    observed.traces.push("throttle");
  };
  const attachAuditContext = async (request) => {
    observed.traces.push("audit");
    request.audit = {
      requestScoped: true
    };
  };

  registerRoutes(fastify, {
    middleware: {
      aliases: {
        auth: requireAuth,
        "throttle:60,1": throttle,
        audit: attachAuditContext
      },
      groups: {
        api: ["auth", "throttle:60,1", "audit"],
        publicApi: ["throttle:60,1"]
      }
    },
    routes: [
      {
        method: "GET",
        path: "/contacts",
        middleware: ["api"],
        handler: async (request, reply) => {
          assert.equal(request.user?.id, 7);
          assert.equal(request.audit?.requestScoped, true);
          reply.code(200).send({
            ok: true
          });
        }
      },
      {
        method: "GET",
        path: "/public/ping",
        middleware: ["publicApi"],
        handler: async (request, reply) => {
          assert.equal(request.user, undefined);
          assert.equal(request.audit, undefined);
          reply.code(200).send({
            ok: true
          });
        }
      }
    ]
  });

  const contactsReply = createReplyStub();
  await fastify.routes[0].handler({}, contactsReply);
  assert.equal(contactsReply.statusCode, 200);
  assert.deepEqual(observed.traces, ["auth", "throttle", "audit"]);

  observed.traces.length = 0;
  const publicReply = createReplyStub();
  await fastify.routes[1].handler({}, publicReply);
  assert.equal(publicReply.statusCode, 200);
  assert.deepEqual(observed.traces, ["throttle"]);
});

test("registerRoutes rejects unknown named middleware references", () => {
  const fastify = createFastifyStub();

  assert.throws(
    () =>
      registerRoutes(fastify, {
        middleware: {
          aliases: {
            auth: async () => {}
          },
          groups: {
            api: ["auth"]
          }
        },
        routes: [
          {
            method: "GET",
            path: "/contacts",
            middleware: ["missing-group"],
            handler: async () => {}
          }
        ]
      }),
    /unknown middleware "missing-group"/
  );
});

test("registerRoutes rejects middleware group cycles", () => {
  const fastify = createFastifyStub();

  assert.throws(
    () =>
      registerRoutes(fastify, {
        middleware: {
          groups: {
            api: ["audited"],
            audited: ["api"]
          }
        },
        routes: [
          {
            method: "GET",
            path: "/contacts",
            middleware: ["api"],
            handler: async () => {}
          }
        ]
      }),
    /middleware group cycle detected/
  );
});
