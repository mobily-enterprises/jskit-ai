import assert from "node:assert/strict";
import test from "node:test";

import { ActionRuntimeError } from "../actions/actionDefinitions.js";
import { AppError, ConflictError } from "../runtime/errors.js";
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
  registerApiErrorHandler(fastify);

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
  registerApiErrorHandler(fastify);

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
  registerApiErrorHandler(fastify);

  const reply = createReplyStub();
  const error = new AppError(409, "Conflict.");
  error.code = "";

  fastify.errorHandler(error, {}, reply);

  assert.equal(reply.statusCode, 409);
  assert.equal(reply.payload.code, "app_error");
});

test("registerApiErrorHandler hides internal permission details for action permission denials", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify);

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
    code: "ACTION_PERMISSION_DENIED",
    params: {}
  });
});

test("registerApiErrorHandler includes internal_server_error code for unhandled 500 errors", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify);

  const reply = createReplyStub();
  const error = new Error("Unexpected DB failure");

  fastify.errorHandler(error, {}, reply);

  assert.equal(reply.statusCode, 500);
  assert.equal(reply.payload.code, "internal_server_error");
  assert.equal(reply.payload.error, "Internal server error.");
});

test("registerApiErrorHandler exposes only allowlisted transaction outcomes", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify);
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
      params: {},
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
  registerApiErrorHandler(fastify);
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
  registerApiErrorHandler(fastify);

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
  registerApiErrorHandler(fastify);

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
  registerApiErrorHandler(fastify);

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
  registerApiErrorHandler(fastify);

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

// MariaDB's errno 1020 as the mysql2 driver reports it, its message starting with the statement and its values as Knex
// writes it.
function driverError(fields = {}) {
  return Object.assign(new Error("UPDATE `pets` SET `name` = 'secret-value' WHERE `id` = 7 - Record has changed since last read in table 'pets'"), {
    code: "ER_CHECKREAD",
    errno: 1020,
    sqlState: "HY000",
    sqlMessage: "Record has changed since last read in table 'pets'",
    sql: "UPDATE `pets` SET `name` = 'secret-value' WHERE `id` = 7",
    ...fields
  });
}

// json-rest-api's RestApiWriteError, built as that class builds one (the kernel does not depend on json-rest-api): the
// cause's message, code and status copied, the cause kept, the transaction's outcome.
function writeErrorAround(cause) {
  const error = new Error(cause.message);
  error.name = "RestApiWriteError";
  for (const field of ["code", "status", "statusCode", "details"]) {
    if (Object.hasOwn(cause, field)) {
      error[field] = cause[field];
    }
  }
  Object.defineProperty(error, "cause", { value: cause });
  error.transactionOutcome = "rolledBack";
  return error;
}

const CONCURRENT = "Another request changed the same data at the same time. Try again.";

function assertNoDatabaseDetail(payload) {
  const text = JSON.stringify(payload);
  for (const detail of ["secret-value", "UPDATE", "pets", "ER_", "1020", "1062", "23505", "SQLITE", "HY000", "Key (email)"]) {
    assert.equal(text.includes(detail), false, `${detail} reached the client: ${text}`);
  }
}

test("a database error reaches a client only as a generic answer, and its detail only the log", () => {
  for (const [thrown, request, expected] of [
    [driverError(), {}, { error: CONCURRENT, code: "kernel.database.concurrentWrite", params: {} }],
    [writeErrorAround(driverError()), {}, { error: CONCURRENT, code: "kernel.database.concurrentWrite", params: {}, transactionOutcome: "rolledBack" }],
    [writeErrorAround(driverError()), transportRequest(), { errors: [{ status: "409", code: "kernel.database.concurrentWrite", title: CONCURRENT }] }]
  ]) {
    const fastify = createFastifyStub();
    registerApiErrorHandler(fastify);
    const reply = createReplyStub();
    fastify.errorHandler(thrown, request, reply);
    assert.equal(reply.statusCode, 409);
    assert.deepEqual(reply.payload, expected);
    assertNoDatabaseDetail(reply.payload);
    assert.deepEqual(fastify.logged, [{ level: "error", fields: { err: thrown, statusCode: 409 }, message: "Database error" }]);
  }
});

test("a database's refusal for a concurrent transaction answers 409 and any other database error 500", () => {
  const postgres = (code, detail) => Object.assign(new Error(`insert into "users" values ('secret-value') - ${detail}`), {
    code,
    severity: "ERROR",
    routine: "_bt_check_unique",
    detail
  });
  const cases = [
    [driverError({ code: "ER_LOCK_DEADLOCK", errno: 1213 }), 409],
    [driverError({ code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 }), 409],
    [postgres("40P01", "deadlock detected"), 409],
    [postgres("40001", "could not serialize access"), 409],
    [Object.assign(new Error("UPDATE pets SET name = 'secret-value' - database is locked"), { code: "SQLITE_BUSY" }), 409],
    // A duplicate key no code mapped to its own answer (as a ConflictError) is a failure of the server's.
    [driverError({ code: "ER_DUP_ENTRY", errno: 1062, sqlMessage: "Duplicate entry 'secret-value' for key 'email'" }), 500],
    [postgres("23505", "Key (email)=(secret-value) already exists."), 500],
    [Object.assign(new Error("UNIQUE constraint failed: pets.name - 'secret-value'"), { code: "SQLITE_CONSTRAINT_UNIQUE" }), 500]
  ];
  for (const [cause, status] of cases) {
    for (const thrown of [cause, writeErrorAround(cause)]) {
      const fastify = createFastifyStub();
      registerApiErrorHandler(fastify);
      const reply = createReplyStub();
      fastify.errorHandler(thrown, {}, reply);
      assert.equal(reply.statusCode, status, cause.code);
      assert.equal(reply.payload.code, status === 409 ? "kernel.database.concurrentWrite" : "internal_server_error");
      assertNoDatabaseDetail(reply.payload);
      assert.equal(fastify.logged[0].fields.err, thrown);
    }
  }
});

test("an AppError keeps its own answer whatever database error it wraps", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify);
  const duplicate = driverError({ code: "ER_DUP_ENTRY", errno: 1062 });
  const chosen = new ConflictError("An account with this email already exists.", { code: "account_exists", cause: duplicate });
  const looped = Object.assign(new Error("loop"), { code: "LOOP" });
  looped.cause = looped;
  for (const [thrown, status, message] of [
    [chosen, 409, "An account with this email already exists."],
    // A write hook's AppError reaches the wrapper as its cause, with its status and code copied.
    [writeErrorAround(chosen), 409, "An account with this email already exists."],
    [looped, 500, "Internal server error."]
  ]) {
    const reply = createReplyStub();
    fastify.errorHandler(thrown, {}, reply);
    assert.equal(reply.statusCode, status);
    assert.equal(reply.payload.error, message);
  }
  assert.equal(fastify.logged.some(({ message }) => message === "Database error"), false);
});

// A refusal a write hook throws: what the client needs to take the next step is in its details, params and messageCode.
function stepRefusal(status = 409) {
  return new AppError(status, "This step needs the email confirmed first.", {
    code: "orders.step.refused",
    params: { step: "payment" },
    messageCode: "orders.step.refused.payment",
    messageParams: { step: "payment" },
    details: { nextStep: "confirm-email" },
    headers: { "Retry-After": "30" }
  });
}

test("a refusal thrown inside a write's transaction answers as itself, with the wrapper's transaction outcome", () => {
  const refusal = stepRefusal();
  const expected = {
    error: "This step needs the email confirmed first.",
    code: "orders.step.refused",
    params: { step: "payment" },
    messageCode: "orders.step.refused.payment",
    messageParams: { step: "payment" },
    details: { nextStep: "confirm-email" }
  };
  for (const [thrown, outcome] of [
    [refusal, undefined],
    [writeErrorAround(refusal), "rolledBack"],
    // A wrapper of the wrapper, such as an error that adds context to a failure, and a refusal that marks its own outcome.
    [new Error("The order could not be saved.", { cause: writeErrorAround(refusal) }), undefined],
    [new Error("The order could not be saved.", { cause: Object.assign(stepRefusal(), { transactionOutcome: "committed" }) }), "committed"]
  ]) {
    const fastify = createFastifyStub();
    registerApiErrorHandler(fastify);
    const reply = createReplyStub();
    fastify.errorHandler(thrown, {}, reply);
    assert.equal(reply.statusCode, 409);
    assert.deepEqual(reply.payload, { ...expected, ...(outcome ? { transactionOutcome: outcome } : {}) });
    assert.equal(reply.headers["Retry-After"], "30");
    assert.deepEqual(fastify.logged, [], "a refusal below 500 is not logged");
  }

  // A route transport serializes the refusal itself, and receives the wrapper's outcome.
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify);
  const serialized = [];
  const request = { routeOptions: { config: { transport: { error(error, fields) {
    serialized.push({ error, fields: { ...fields, request: undefined, reply: undefined } });
    return { errors: [{ status: String(fields.statusCode), code: fields.code, title: error.message }] };
  } } } } };
  const reply = createReplyStub();
  fastify.errorHandler(writeErrorAround(refusal), request, reply);
  assert.equal(reply.statusCode, 409);
  assert.equal(serialized[0].error, refusal);
  assert.deepEqual(serialized[0].fields, {
    request: undefined,
    reply: undefined,
    statusCode: 409,
    code: "orders.step.refused",
    message: refusal.message,
    exposeDetails: true,
    params: { step: "payment" },
    messageCode: "orders.step.refused.payment",
    messageParams: { step: "payment" },
    transactionOutcome: "rolledBack"
  });
});

test("a wrapped refusal keeps a refusal's limits: a permission denial's details stay hidden and a 5xx is logged whole", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify);
  const denied = new ActionRuntimeError(403, "Forbidden.", {
    code: "ACTION_PERMISSION_DENIED",
    params: { permission: "orders.pay" },
    details: { actionId: "orders.pay", permission: "orders.pay" }
  });
  const deniedReply = createReplyStub();
  fastify.errorHandler(writeErrorAround(denied), {}, deniedReply);
  assert.equal(deniedReply.statusCode, 403);
  assert.deepEqual(deniedReply.payload, { error: "Forbidden.", code: "ACTION_PERMISSION_DENIED", params: {}, transactionOutcome: "rolledBack" });

  const unavailable = writeErrorAround(stepRefusal(503));
  const unavailableReply = createReplyStub();
  fastify.errorHandler(unavailable, {}, unavailableReply);
  assert.equal(unavailableReply.statusCode, 503);
  assert.deepEqual(unavailableReply.payload.details, { nextStep: "confirm-email" });
  assert.deepEqual(fastify.logged, [{ level: "error", fields: { err: unavailable }, message: "AppError 5xx" }]);
});

test("a wrapper with no refusal in its cause chain answers as before, without its cause's details", () => {
  const internal = Object.assign(new Error("Hook failed reading private-row 7"), { code: "HOOK_FAILED", details: { row: "private-row" } });
  const refusedOutside = Object.assign(new Error("Title is required."), {
    code: "REST_API_VALIDATION",
    details: { internal: "private-detail" }
  });
  const looped = new Error("loop");
  looped.cause = looped;
  for (const [thrown, status, expected] of [
    [writeErrorAround(internal), 500, {
      error: "Internal server error.",
      code: "HOOK_FAILED",
      params: {},
      messageCode: "internal_server_error",
      messageParams: {},
      transactionOutcome: "rolledBack"
    }],
    [writeErrorAround(refusedOutside), 422, { error: "Title is required.", code: "REST_API_VALIDATION", params: {}, transactionOutcome: "rolledBack" }],
    [new Error("Wrapped loop", { cause: looped }), 500, { error: "Internal server error.", code: "internal_server_error", params: {} }]
  ]) {
    const fastify = createFastifyStub();
    registerApiErrorHandler(fastify);
    const reply = createReplyStub();
    fastify.errorHandler(thrown, {}, reply);
    assert.equal(reply.statusCode, status);
    assert.deepEqual(reply.payload, expected);
    assert.equal(JSON.stringify(reply.payload).includes("private"), false);
  }
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

test("registerApiErrorHandler returns the params and coded field errors of an AppError", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify);

  const reply = createReplyStub();
  fastify.errorHandler(new AppError(400, "Use at least 8 characters.", {
    code: "auth.password.tooShort",
    params: { min: 8 },
    details: {
      fieldErrors: { password: "Use at least 8 characters." },
      fieldErrorCodes: { password: { code: "auth.password.tooShort", params: { min: 8 } } }
    }
  }), {}, reply);

  assert.equal(reply.payload.code, "auth.password.tooShort");
  assert.deepEqual(reply.payload.params, { min: 8 });
  assert.deepEqual(reply.payload.fieldErrors, { password: "Use at least 8 characters." });
  assert.deepEqual(reply.payload.details.fieldErrorCodes, {
    password: { code: "auth.password.tooShort", params: { min: 8 } }
  });
});

test("registerApiErrorHandler passes a per-sentence messageCode next to a shared code", () => {
  const fastify = createFastifyStub();
  registerApiErrorHandler(fastify);

  const appReply = createReplyStub();
  fastify.errorHandler(new AppError(400, "Pick a calendar first.", {
    code: "connector_input_invalid",
    messageCode: "connectors.calendar.pickFirst"
  }), {}, appReply);
  assert.equal(appReply.payload.code, "connector_input_invalid");
  assert.equal(appReply.payload.messageCode, "connectors.calendar.pickFirst");
  assert.deepEqual(appReply.payload.messageParams, {});

  const plainReply = createReplyStub();
  fastify.errorHandler(Object.assign(new Error("Card declined."), {
    statusCode: 422, code: "payment_declined", messageCode: "payments.card.declined", messageParams: { last4: "4242" }
  }), {}, plainReply);
  assert.equal(plainReply.payload.messageCode, "payments.card.declined");
  assert.deepEqual(plainReply.payload.messageParams, { last4: "4242" });

  const hiddenReply = createReplyStub();
  fastify.errorHandler(Object.assign(new Error("private"), { messageCode: "x.y" }), {}, hiddenReply);
  assert.equal(Object.hasOwn(hiddenReply.payload, "messageCode"), false);
});
