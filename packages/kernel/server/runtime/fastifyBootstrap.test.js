import assert from "node:assert/strict";
import test from "node:test";

import { AppError, isAppError } from "./errors.js";
import { registerApiErrorHandler, registerJsonApiContentTypeParser, registerRequestLoggingHooks } from "./fastifyBootstrap.js";

function createFastifyStub() {
  return {
    errorHandler: null,
    hooks: {},
    contentTypeParsers: new Map(),
    log: {
      error() {}
    },
    setErrorHandler(handler) {
      this.errorHandler = handler;
    },
    addHook(name, handler) {
      this.hooks[name] = handler;
    },
    hasContentTypeParser(contentType) {
      return this.contentTypeParsers.has(String(contentType || "").trim().toLowerCase());
    },
    addContentTypeParser(contentType, options, parser) {
      this.contentTypeParsers.set(String(contentType || "").trim().toLowerCase(), {
        options,
        parser
      });
    }
  };
}

function createReplyStub() {
  return {
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
      return this;
    }
  };
}

test("registerApiErrorHandler includes code for validation errors", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify, { isAppError });

  const reply = createReplyStub();
  fastify.errorHandler(
    {
      validation: [
        {
          instancePath: "/email",
          message: "must match format email"
        }
      ]
    },
    {},
    reply
  );

  assert.equal(reply.statusCode, 400);
  assert.equal(reply.payload.code, "validation_failed");
  assert.deepEqual(reply.payload.fieldErrors, {
    email: "must match format email"
  });
});

test("registerApiErrorHandler includes code for AppError payloads", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify, { isAppError });

  const reply = createReplyStub();
  const error = new AppError(422, "Domain validation failed.", {
    code: "domain_validation_failed",
    details: {
      fieldErrors: {
        email: "invalid"
      }
    }
  });

  fastify.errorHandler(error, {}, reply);

  assert.equal(reply.statusCode, 422);
  assert.equal(reply.payload.code, "domain_validation_failed");
  assert.equal(reply.payload.error, "Domain validation failed.");
  assert.deepEqual(reply.payload.fieldErrors, {
    email: "invalid"
  });
});

test("registerApiErrorHandler falls back to app_error code for AppError without code", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify, { isAppError });

  const reply = createReplyStub();
  const error = new AppError(409, "Conflict.");
  error.code = "";

  fastify.errorHandler(error, {}, reply);

  assert.equal(reply.statusCode, 409);
  assert.equal(reply.payload.code, "app_error");
});

test("registerApiErrorHandler hides internal permission details for action permission denials", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify, { isAppError });

  const reply = createReplyStub();
  const error = new AppError(403, "Forbidden.", {
    code: "ACTION_PERMISSION_DENIED",
    details: {
      actionId: "crud.breeds.list",
      permission: "crud.breeds.list"
    }
  });

  fastify.errorHandler(error, {}, reply);

  assert.equal(reply.statusCode, 403);
  assert.deepEqual(reply.payload, {
    error: "Forbidden.",
    code: "ACTION_PERMISSION_DENIED"
  });
});

test("registerApiErrorHandler includes internal_server_error code for unhandled 500 errors", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify, { isAppError });

  const reply = createReplyStub();
  const error = new Error("Unexpected DB failure");

  fastify.errorHandler(error, {}, reply);

  assert.equal(reply.statusCode, 500);
  assert.equal(reply.payload.code, "internal_server_error");
  assert.equal(reply.payload.error, "Internal server error.");
});

test("registerApiErrorHandler keeps known error code for non-app errors", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify, { isAppError });

  const reply = createReplyStub();
  const error = new Error("CSRF token invalid");
  error.statusCode = 403;
  error.code = "FST_CSRF_BAD_TOKEN";

  fastify.errorHandler(error, {}, reply);

  assert.equal(reply.statusCode, 403);
  assert.equal(reply.payload.code, "FST_CSRF_BAD_TOKEN");
  assert.deepEqual(reply.payload.details, {
    code: "FST_CSRF_BAD_TOKEN"
  });
});

test("registerApiErrorHandler uses route transport error serializer when present", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify, { isAppError });

  const reply = createReplyStub();
  const error = new AppError(422, "Validation failed.", {
    code: "invalid_contact",
    details: {
      fieldErrors: {
        name: "Name is required."
      }
    }
  });

  fastify.errorHandler(
    error,
    {
      routeTransport: {
        contentType: "application/vnd.api+json",
        error(currentError, { statusCode, code }) {
          return {
            errors: [
              {
                status: String(statusCode),
                code,
                title: currentError.message
              }
            ]
          };
        }
      }
    },
    reply
  );

  assert.equal(reply.statusCode, 422);
  assert.equal(reply.headers["Content-Type"], "application/vnd.api+json");
  assert.deepEqual(reply.payload, {
    errors: [
      {
        status: "422",
        code: "invalid_contact",
        title: "Validation failed."
      }
    ]
  });
});

test("registerApiErrorHandler uses route config transport runtime serializer before handler attachment", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify, { isAppError });

  const reply = createReplyStub();
  const error = new AppError(401, "Authentication required.", {
    code: "AUTH_POLICY_ERROR"
  });

  fastify.errorHandler(
    error,
    {
      routeOptions: {
        config: {
          transport: {
            kind: "jsonapi-resource",
            contentType: "application/vnd.api+json",
            runtime: {
              contentType: "application/vnd.api+json",
              error(currentError, { statusCode, code }) {
                return {
                  errors: [
                    {
                      status: String(statusCode),
                      code,
                      title: currentError.message
                    }
                  ]
                };
              }
            }
          }
        }
      }
    },
    reply
  );

  assert.equal(reply.statusCode, 401);
  assert.equal(reply.headers["Content-Type"], "application/vnd.api+json");
  assert.deepEqual(reply.payload, {
    errors: [
      {
        status: "401",
        code: "AUTH_POLICY_ERROR",
        title: "Authentication required."
      }
    ]
  });
});

test("registerJsonApiContentTypeParser installs the JSON:API media type parser once", () => {
  const fastify = createFastifyStub();

  assert.equal(registerJsonApiContentTypeParser(fastify), true);
  assert.equal(fastify.hasContentTypeParser("application/vnd.api+json"), true);
  assert.equal(registerJsonApiContentTypeParser(fastify), false);
  assert.equal(fastify.contentTypeParsers.size, 1);
});

test("registerRequestLoggingHooks uses configured default surface when getSurface is absent", async () => {
  const fastify = createFastifyStub();
  let loggedPayload = null;

  registerRequestLoggingHooks(fastify, {
    defaultSurfaceId: "home"
  });

  const request = {
    id: "req-home",
    method: "GET",
    routeOptions: {
      url: "/status"
    },
    log: {
      info(payload) {
        loggedPayload = payload;
      }
    }
  };
  const reply = {
    statusCode: 204
  };

  await fastify.hooks.onRequest(request);
  await fastify.hooks.onResponse(request, reply);

  assert.equal(loggedPayload.surface, "home");
});

test("registerRequestLoggingHooks leaves surface empty when no surface default is configured", async () => {
  const fastify = createFastifyStub();
  let loggedPayload = null;

  registerRequestLoggingHooks(fastify);

  const request = {
    id: "req-public",
    method: "GET",
    routeOptions: {
      url: "/status"
    },
    log: {
      info(payload) {
        loggedPayload = payload;
      }
    }
  };
  const reply = {
    statusCode: 204
  };

  await fastify.hooks.onRequest(request);
  await fastify.hooks.onResponse(request, reply);

  assert.equal(loggedPayload.surface, "");
});
