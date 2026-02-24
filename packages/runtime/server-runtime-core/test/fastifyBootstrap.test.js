import assert from "node:assert/strict";
import test from "node:test";

import {
  createFastifyLoggerOptions,
  registerApiErrorHandler,
  registerRequestLoggingHooks,
  resolveLoggerLevel,
  runGracefulShutdown
} from "../src/fastifyBootstrap.js";

test("resolveLoggerLevel and createFastifyLoggerOptions respect configured level fallback", () => {
  assert.equal(
    resolveLoggerLevel({
      configuredLevel: "warn",
      nodeEnv: "production",
      allowedLevels: ["info", "warn"]
    }),
    "warn"
  );

  assert.equal(
    resolveLoggerLevel({
      configuredLevel: "not_a_level",
      nodeEnv: "production",
      allowedLevels: ["info", "warn"]
    }),
    "info"
  );

  assert.equal(
    createFastifyLoggerOptions({
      configuredLevel: "trace",
      nodeEnv: "development",
      allowedLevels: ["info", "warn"],
      redactPaths: ["req.headers.authorization"]
    }).level,
    "debug"
  );
});

test("registerRequestLoggingHooks records request timings and payload logs", async () => {
  const hooks = {};
  const app = {
    addHook(name, fn) {
      hooks[name] = fn;
    }
  };
  const observed = [];
  const logs = [];
  const startedAtSymbol = Symbol("started_at");

  registerRequestLoggingHooks(app, {
    requestStartedAtSymbol: startedAtSymbol,
    getPathname: () => "/api/test",
    getSurface: () => "app",
    observeRequest(payload) {
      observed.push(payload);
    },
    enableRequestLogs: true
  });

  const request = {
    id: "req-1",
    method: "GET",
    routeOptions: { url: "/api/test" },
    user: { id: 7 },
    log: {
      info(payload, message) {
        logs.push({ payload, message });
      }
    }
  };
  const reply = {
    statusCode: 200
  };

  await hooks.onRequest(request);
  assert.equal(typeof request[startedAtSymbol], "bigint");
  await hooks.onResponse(request, reply);

  assert.equal(observed.length, 1);
  assert.equal(observed[0].surface, "app");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].message, "request.completed");
});

test("registerApiErrorHandler handles validation, app errors, and unhandled errors", () => {
  let handler = null;
  const appLogs = [];
  const app = {
    log: {
      error(payload, message) {
        appLogs.push({ payload, message });
      }
    },
    setErrorHandler(fn) {
      handler = fn;
    }
  };
  const dbErrors = [];
  const captured = [];

  registerApiErrorHandler(app, {
    isAppError(error) {
      return error?.name === "AppError";
    },
    onRecordDbError(error) {
      dbErrors.push(error);
    },
    onCaptureServerError(request, error, statusCode) {
      captured.push({ request, error, statusCode });
    }
  });

  const makeReply = () => {
    const headers = {};
    return {
      statusCode: null,
      payload: null,
      header(name, value) {
        headers[name] = value;
      },
      code(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      send(payload) {
        this.payload = payload;
      },
      headers
    };
  };

  const validationReply = makeReply();
  handler(
    {
      validation: [{ instancePath: "/name", message: "is required", params: {} }]
    },
    {},
    validationReply
  );
  assert.equal(validationReply.statusCode, 400);
  assert.equal(validationReply.payload.fieldErrors.name, "is required");

  const appErrorReply = makeReply();
  handler(
    {
      name: "AppError",
      status: 503,
      message: "Service unavailable",
      details: { fieldErrors: { request: "down" } }
    },
    {},
    appErrorReply
  );
  assert.equal(appErrorReply.statusCode, 503);
  assert.equal(dbErrors.length, 1);

  const unhandledReply = makeReply();
  handler(
    {
      statusCode: 500,
      message: "boom"
    },
    {},
    unhandledReply
  );
  assert.equal(unhandledReply.statusCode, 500);
  assert.equal(captured.length, 2);
  assert.equal(appLogs.length, 2);
});

test("runGracefulShutdown closes app and resources in order", async () => {
  const calls = [];
  const appInstance = {
    async close() {
      calls.push("close_app");
    }
  };

  await runGracefulShutdown({
    signal: "SIGTERM",
    appInstance,
    stopBackgroundRuntimes() {
      calls.push("stop_background");
    },
    closeDatabase: async () => {
      calls.push("close_db");
    },
    logger: {
      log() {},
      error() {}
    }
  });

  assert.deepEqual(calls, ["stop_background", "close_app", "close_db"]);
});
