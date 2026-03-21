import assert from "node:assert/strict";
import test from "node:test";

import { AppError, isAppError } from "./errors.js";
import { registerApiErrorHandler, registerRequestLoggingHooks } from "./fastifyBootstrap.js";

function createFastifyStub() {
  return {
    errorHandler: null,
    hooks: {},
    log: {
      error() {}
    },
    setErrorHandler(handler) {
      this.errorHandler = handler;
    },
    addHook(name, handler) {
      this.hooks[name] = handler;
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
