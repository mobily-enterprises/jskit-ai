import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createSchema } from "json-rest-schema";

import english from "../../locales/en.json" with { type: "json" };
import { catalogMessage, formatMessage, messageKeyForCode } from "../../shared/i18n/index.js";
import { recordIdParamsValidator, resolveValidationIssueCode } from "../../shared/validators/index.js";
import { AppError, isAppError } from "../runtime/errors.js";
import { createActionRegistry } from "../actions/registry.js";
import { ensureIdempotencyKeyIfRequired } from "../actions/idempotency.js";
import { registerSurfaceRequestConstraint } from "../platform/surfaceRuntime.js";
import { registerApiErrorHandler } from "./errorHandling.js";
import { registerRoutes } from "./lib/routeRegistration.js";
import { resolveRouteValidatorOptions } from "./lib/routeValidator.js";

// The client translates a code only when the server's English is the catalog's
// English for that code; these tests hold the catalog to the English sent today.
function assertCatalogRenders({ code, params }, sentEnglish) {
  const template = catalogMessage(english, messageKeyForCode(code));
  assert.notEqual(template, undefined, `${code} has no English`);
  assert.equal(formatMessage(template, params), sentEnglish, code);
}

function thrownBy(fail) {
  try {
    fail();
  } catch (error) {
    return error;
  }
  return assert.fail("expected an error");
}

function createRouteApp(t, routes) {
  const app = Fastify();
  t.after(() => app.close());
  registerApiErrorHandler(app, { isAppError });
  registerRoutes(app, {
    routes: routes.map(({ method, path, options = {}, handler, transport }) => ({
      method,
      path,
      ...resolveRouteValidatorOptions({ method, path, options }),
      ...(transport ? { transport } : {}),
      handler
    })),
    actions: { execute() {} }
  });
  return app;
}

test("a body schema failure on a plain JSON route is a validation error with coded field errors", async (t) => {
  const app = createRouteApp(t, [{
    method: "POST",
    path: "/contacts",
    options: {
      body: {
        schema: createSchema({
          name: { type: "string", required: true, minLength: 3 },
          age: { type: "number", required: false, max: 120 }
        }),
        mode: "create"
      }
    },
    handler: async (_request, reply) => reply.send({ ok: true })
  }]);

  const response = await app.inject({ method: "POST", url: "/contacts", payload: { name: "Al", age: 200 } });
  assert.equal(response.statusCode, 400);
  const payload = response.json();
  assert.deepEqual(payload, {
    error: "Schema validation failed.",
    code: "validation_failed",
    params: {},
    messageCode: "kernel.validation.schemaFailed",
    messageParams: {},
    fieldErrors: {
      name: "Length must be at least 3 characters.",
      age: "Value must be no more than 120."
    },
    details: {
      fieldErrors: {
        name: "Length must be at least 3 characters.",
        age: "Value must be no more than 120."
      },
      fieldErrorCodes: {
        name: { code: "kernel.validation.field.minLength", params: { min: 3, actual: 2 } },
        age: { code: "kernel.validation.field.maxValue", params: { max: 120, actual: 200 } }
      }
    }
  });
  assertCatalogRenders({ code: payload.messageCode, params: payload.messageParams }, payload.error);
  for (const [field, coded] of Object.entries(payload.details.fieldErrorCodes)) {
    assertCatalogRenders(coded, payload.fieldErrors[field]);
  }
});

test("a record id params failure is reported by Fastify with its pattern code", async (t) => {
  const app = createRouteApp(t, [{
    method: "GET",
    path: "/records/:recordId",
    options: { params: recordIdParamsValidator },
    handler: async (_request, reply) => reply.send({ ok: true })
  }]);

  const response = await app.inject({ method: "GET", url: "/records/007" });
  assert.equal(response.statusCode, 400);
  const payload = response.json();
  assert.equal(payload.code, "FST_ERR_VALIDATION");
  assert.deepEqual(payload.fieldErrors, { recordId: "must match pattern \"^[1-9][0-9]*$\"" });
  assertCatalogRenders(payload.details.fieldErrorCodes.recordId, payload.fieldErrors.recordId);
});

const VALIDATION_BODY_SCHEMA = Object.freeze({
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 2, maxLength: 4, pattern: "^[a-z]+$" },
    age: { type: "integer", minimum: 1, maximum: 9 },
    score: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 10, multipleOf: 2 },
    kind: { enum: ["a", "b"] },
    email: { type: "string", format: "email" },
    fixed: { const: "x" },
    nullable: { type: ["string", "null"] },
    tags: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true },
    pair: { type: "array", minItems: 1, items: [{ type: "string" }], additionalItems: false },
    options: { type: "object", minProperties: 1, maxProperties: 1 },
    strict: { type: "object", additionalProperties: false },
    keys: { type: "object", propertyNames: { pattern: "^[a-z]+$" } },
    oneOf: { oneOf: [{ type: "string" }, { type: "string", minLength: 1 }] },
    anyOf: { anyOf: [{ type: "string" }, { type: "boolean" }] },
    not: { not: { type: "string" } },
    conditional: { if: { type: "string" }, then: { type: "string", minLength: 3 } }
  }
});

function createValidationApp(t, fastifyOptions = {}) {
  const app = Fastify(fastifyOptions);
  t.after(() => app.close());
  const failures = [];
  registerApiErrorHandler(app, { isAppError });
  app.addHook("onError", async (_request, _reply, error) => {
    failures.push(error);
  });
  app.post("/validate", { schema: { body: VALIDATION_BODY_SCHEMA } }, async () => ({ ok: true }));
  return { app, failures };
}

test("Fastify schema validation errors carry kernel.validation codes rendering Ajv's own English", async (t) => {
  const defaults = createValidationApp(t);
  // Fastify's default Ajv removes additional properties and stops at the first
  // error, which hides these two keywords; an app can turn both off.
  const loose = createValidationApp(t, { ajv: { customOptions: { removeAdditional: false, allErrors: true } } });
  const cases = [
    ["required", {}, "name"],
    ["type", { name: "ab", age: 1.5 }, "age"],
    ["type", { name: "ab", nullable: {} }, "nullable"],
    ["minLength", { name: "a" }, "name"],
    ["maxLength", { name: "abcde" }, "name"],
    ["pattern", { name: "AB" }, "name"],
    ["minimum", { name: "ab", age: 0 }, "age"],
    ["maximum", { name: "ab", age: 10 }, "age"],
    ["exclusiveMinimum", { name: "ab", score: 0 }, "score"],
    ["exclusiveMaximum", { name: "ab", score: 10 }, "score"],
    ["multipleOf", { name: "ab", score: 3 }, "score"],
    ["enum", { name: "ab", kind: "c" }, "kind"],
    ["format", { name: "ab", email: "nope" }, "email"],
    ["const", { name: "ab", fixed: "y" }, "fixed"],
    ["minItems", { name: "ab", tags: [] }, "tags"],
    ["maxItems", { name: "ab", tags: [1, 2, 3] }, "tags"],
    ["uniqueItems", { name: "ab", tags: [1, 1] }, "tags"],
    ["additionalItems", { name: "ab", pair: ["a", "b"] }, "pair"],
    ["minProperties", { name: "ab", options: {} }, "options"],
    ["maxProperties", { name: "ab", options: { a: 1, b: 2 } }, "options"],
    ["propertyNames", { name: "ab", keys: { A: 1 } }, "keys"],
    ["oneOf", { name: "ab", oneOf: "x" }, "oneOf"],
    ["anyOf", { name: "ab", anyOf: {} }, "anyOf"],
    ["not", { name: "ab", not: "x" }, "not"],
    ["additionalProperties", { name: "ab", strict: { a: 1 } }, "strict", loose],
    ["if", { name: "ab", conditional: "x" }, "conditional", loose]
  ];

  for (const [keyword, payload, field, { app, failures } = defaults] of cases) {
    failures.length = 0;
    const response = await app.inject({ method: "POST", url: "/validate", payload });
    assert.equal(response.statusCode, 400, keyword);
    const [failure] = failures;
    assert.equal(failure.code, "FST_ERR_VALIDATION", keyword);
    assert.equal(failure.validationContext, "body", keyword);
    const body = response.json();
    assert.equal(body.error, "Validation failed.", keyword);
    assert.equal(body.code, "FST_ERR_VALIDATION", keyword);
    assert.deepEqual(body.params, {}, keyword);
    assertCatalogRenders({ code: body.code, params: body.params }, body.error);

    // The field shows the first issue for it; its code renders that English.
    const firstIssue = failure.validation[0];
    assert.equal(body.fieldErrors[field], firstIssue.message, keyword);
    assertCatalogRenders(body.details.fieldErrorCodes[field], body.fieldErrors[field]);

    // Every coded issue's catalog English is Ajv's message, keyword by keyword.
    const issue = failure.validation.find((entry) => entry.keyword === keyword);
    assert.ok(issue, `${keyword} produced ${JSON.stringify(failure.validation)}`);
    const coded = resolveValidationIssueCode(issue);
    assert.equal(coded.code, `kernel.validation.${keyword}`);
    assertCatalogRenders(coded, issue.message);
  }
});

test("every error class leaving the API has a code and params", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  registerApiErrorHandler(app, { isAppError });
  const errors = {
    app: () => new AppError(409, "Busy.", { code: "x.busy", params: { n: 1 } }),
    uncodedApp: () => new AppError(400, "Bad."),
    validation: () => Object.assign(new Error("Schema validation failed."), { statusCode: 422, fieldErrors: { a: "Bad." } }),
    plain4xx: () => Object.assign(new Error("Nope."), { statusCode: 404 }),
    plain5xx: () => Object.assign(new Error("secret"), { code: "ECONNRESET" }),
    unknown: () => new Error("secret")
  };
  for (const [name, create] of Object.entries(errors)) {
    app.get(`/${name}`, async () => {
      throw create();
    });
  }

  for (const name of Object.keys(errors)) {
    const body = (await app.inject({ method: "GET", url: `/${name}` })).json();
    assert.equal(typeof body.code, "string", name);
    assert.ok(body.code, name);
    assert.equal(typeof body.params, "object", name);
  }

  const hidden = (await app.inject({ method: "GET", url: "/plain5xx" })).json();
  assert.deepEqual(hidden, {
    error: "Internal server error.",
    code: "ECONNRESET",
    params: {},
    messageCode: "internal_server_error",
    messageParams: {}
  });
  assertCatalogRenders({ code: hidden.messageCode, params: hidden.messageParams }, hidden.error);
  const plainValidation = (await app.inject({ method: "GET", url: "/validation" })).json();
  assert.equal(plainValidation.code, "validation_failed");
  assert.deepEqual(plainValidation.fieldErrors, { a: "Bad." });
});

test("the kernel's own errors and statuses render their English from the catalog", async (t) => {
  const registry = createActionRegistry();
  const actionFailures = [
    () => registry.getDefinition(""),
    () => registry.getDefinition("contacts.list", 0),
    () => ensureIdempotencyKeyIfRequired({ idempotency: "required" }, {})
  ];
  for (const fail of actionFailures) {
    const error = thrownBy(fail);
    const [[field, coded]] = Object.entries(error.details.fieldErrorCodes);
    assertCatalogRenders(coded, error.details.fieldErrors[field]);
    assertCatalogRenders({ code: error.code, params: error.params }, error.message);
  }

  const app = createRouteApp(t, [
    {
      method: "POST",
      path: "/api/books",
      options: { body: { schema: createSchema({ title: { type: "string" } }), mode: "create" } },
      handler: async (_request, reply) => reply.send({ ok: true })
    },
    { method: "GET", path: "/api/missing" }
  ]);
  const missing = (await app.inject({ method: "GET", url: "/api/missing" })).json();
  assert.equal(missing.code, "kernel.route.handlerUnavailable");
  assertCatalogRenders(missing, missing.error);

  const surfaceApp = Fastify();
  t.after(() => surfaceApp.close());
  registerSurfaceRequestConstraint({
    fastify: surfaceApp,
    serverSurface: "app",
    surfaceRuntime: {
      normalizeSurfaceMode: (surface) => surface,
      resolveSurfaceFromPathname: () => "admin",
      isSurfaceEnabled: () => true
    }
  });
  surfaceApp.get("/admin/home", async () => ({ ok: true }));
  const notServed = (await surfaceApp.inject({ method: "GET", url: "/admin/home" })).json();
  assert.equal(notServed.code, "kernel.surface.pathNotServed");
  assert.deepEqual(notServed.params, { path: "/admin/home", surface: "app" });
  assertCatalogRenders(notServed, notServed.error);
});

test("a wrong request content type names the expected type in params", async (t) => {
  const app = createRouteApp(t, [{
    method: "POST",
    path: "/api/books",
    options: {
      body: { schema: createSchema({ title: { type: "string" } }), mode: "create" }
    },
    handler: async (_request, reply) => reply.send({ ok: true })
  }].map((route) => ({ ...route, transport: { contentType: "application/vnd.api+json" } })));

  const response = await app.inject({ method: "POST", url: "/api/books", payload: { title: "x" } });
  assert.equal(response.statusCode, 415);
  const body = response.json();
  assert.equal(body.code, "unsupported_media_type");
  assert.deepEqual(body.params, { contentType: "application/vnd.api+json" });
  assertCatalogRenders(body, body.error);
});
