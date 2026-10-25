import assert from "node:assert/strict";
import test from "node:test";

import { AppError, isAppError } from "../runtime/errors.js";
import {
  normalizeBodylessContentTypeHeader,
  registerApiErrorHandler,
  registerBodylessContentTypeNormalizer,
  registerJsonApiContentTypeParser
} from "./errorHandling.js";

function createFastifyStub() {
  const fastify = {
    errorHandler: null,
    hooks: {},
    contentTypeParsers: new Map(),
    logged: [],
    log: {
      error(fields, message) {
        this.owner.logged.push({ level: "error", fields, message });
      },
      info(fields, message) {
        this.owner.logged.push({ level: "info", fields, message });
      }
    },
    setErrorHandler(handler) {
      this.errorHandler = handler;
    },
    addHook(name, handler) {
      this.hooks[name] = handler;
    },
    getDefaultJsonParser() {
      return function parseJsonBody() {};
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
  fastify.log.owner = fastify;
  return fastify;
}

function transportRequest() {
  return {
    routeOptions: {
      config: {
        transport: {
          kind: "jsonapi-resource",
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

test("registerApiErrorHandler exposes only allowlisted transaction outcomes", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify, { isAppError });
  for (const transactionOutcome of ["none", "pending", "committed", "rolledBack", "unknown"]) {
    const error = Object.assign(new Error("Private SQL failure"), {
      transactionOutcome,
      cause: { password: "private" },
      cleanupErrors: [{ message: "private cleanup" }]
    });
    const reply = createReplyStub();
    fastify.errorHandler(error, {}, reply);
    assert.equal(reply.statusCode, 500);
    assert.deepEqual(reply.payload, {
      error: "Internal server error.",
      code: "internal_server_error",
      transactionOutcome
    });
  }
  for (const transactionOutcome of [undefined, "success", { secret: "private" }]) {
    const reply = createReplyStub();
    fastify.errorHandler(Object.assign(new Error("private"), { transactionOutcome }), {}, reply);
    assert.equal(Object.hasOwn(reply.payload, "transactionOutcome"), false);
  }
});

test("AppError and validation payloads retain transaction outcomes", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify, { isAppError });
  for (const error of [
    Object.assign(new AppError(409, "Conflict."), { transactionOutcome: "rolledBack" }),
    { validation: [{ instancePath: "/title", message: "Required" }], transactionOutcome: "none" }
  ]) {
    const reply = createReplyStub();
    fastify.errorHandler(error, {}, reply);
    assert.equal(reply.payload.transactionOutcome, error.transactionOutcome);
  }
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
    transportRequest(),
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

test("transport routes log 5xx AppErrors and keep their headers", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify, { isAppError });

  const reply = createReplyStub();
  const error = new AppError(503, "Try again shortly.", {
    code: "service_unavailable",
    headers: {
      "Retry-After": "5"
    }
  });

  fastify.errorHandler(error, transportRequest(), reply);

  assert.equal(reply.statusCode, 503);
  assert.equal(reply.headers["Retry-After"], "5");
  assert.equal(reply.headers["Content-Type"], "application/vnd.api+json");
  assert.equal(reply.payload.errors[0].code, "service_unavailable");
  assert.deepEqual(fastify.logged.map(({ level, message }) => [level, message]), [["error", "AppError 5xx"]]);
});

test("Fastify client errors are logged below error level and server errors at error level", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify, { isAppError });

  const tooLarge = Object.assign(new Error("Request body is too large"), {
    statusCode: 413,
    code: "FST_ERR_CTP_BODY_TOO_LARGE"
  });
  const tooLargeReply = createReplyStub();
  fastify.errorHandler(tooLarge, transportRequest(), tooLargeReply);
  assert.equal(tooLargeReply.statusCode, 413);
  assert.equal(tooLargeReply.payload.errors[0].code, "FST_ERR_CTP_BODY_TOO_LARGE");

  fastify.errorHandler(new Error("Unexpected DB failure"), {}, createReplyStub());

  assert.deepEqual(fastify.logged.map(({ level, fields }) => [level, fields.statusCode]), [
    ["info", 413],
    ["error", undefined]
  ]);
});

test("registerJsonApiContentTypeParser installs the JSON:API media type parser once", () => {
  const fastify = createFastifyStub();

  assert.equal(registerJsonApiContentTypeParser(fastify), true);
  assert.equal(fastify.hasContentTypeParser("application/vnd.api+json"), true);
  assert.equal(registerJsonApiContentTypeParser(fastify), false);
  assert.equal(fastify.contentTypeParsers.size, 1);
});

test("normalizeBodylessContentTypeHeader strips meaningless content type from empty requests", () => {
  const request = {
    headers: {
      "content-type": "text/plain;charset=UTF-8"
    }
  };

  assert.equal(normalizeBodylessContentTypeHeader(request), true);
  assert.deepEqual(request.headers, {});
});

test("normalizeBodylessContentTypeHeader keeps content type when a body is declared", () => {
  const request = {
    headers: {
      "content-type": "text/plain;charset=UTF-8",
      "content-length": "12"
    }
  };

  assert.equal(normalizeBodylessContentTypeHeader(request), false);
  assert.equal(request.headers["content-type"], "text/plain;charset=UTF-8");
});

test("registerBodylessContentTypeNormalizer installs the request hook once", async () => {
  const fastify = createFastifyStub();
  assert.equal(registerBodylessContentTypeNormalizer(fastify), true);
  assert.equal(registerBodylessContentTypeNormalizer(fastify), false);

  const request = {
    headers: {
      "content-type": "text/plain;charset=UTF-8",
      "content-length": "0"
    }
  };
  await fastify.hooks.onRequest(request);
  assert.deepEqual(request.headers, {
    "content-length": "0"
  });
});
