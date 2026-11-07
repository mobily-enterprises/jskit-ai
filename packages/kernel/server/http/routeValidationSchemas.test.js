import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createSchema } from "json-rest-schema";

import { deepFreeze } from "../../shared/support/deepFreeze.js";
import { recordIdParamsValidator } from "../../shared/validators/index.js";
import { registerRoutes } from "./lib/routeRegistration.js";
import { resolveRouteValidatorOptions } from "./lib/routeValidator.js";

const listQueryValidator = Object.freeze({
  schema: createSchema({ page: { type: "integer", required: false, min: 1 } }),
  mode: "patch"
});

/**
 * Boots a server with `count` routes that validate the same params and query, and returns the distinct schema
 * objects Fastify handed its validator compiler; Ajv, Fastify's compiler, compiles each object it has not seen once.
 * @param {import("node:test").TestContext} t
 * @param {number} count
 */
async function validatorSchemaObjects(t, count) {
  const schemas = new Set();
  const app = Fastify({
    schemaController: {
      compilersFactory: {
        buildValidator: () => ({ schema }) => {
          schemas.add(schema);
          return () => true;
        }
      }
    }
  });
  t.after(() => app.close());
  registerRoutes(app, {
    routes: Array.from({ length: count }, (_, index) => {
      const path = `/collections-${index}/:recordId`;
      return {
        method: "GET",
        path,
        ...resolveRouteValidatorOptions({ method: "GET", path, options: { params: recordIdParamsValidator, query: listQueryValidator } }),
        handler: async (_request, reply) => reply.send({ ok: true })
      };
    }),
    actions: { execute() {} }
  });
  await app.ready();
  return schemas;
}

test("routes validating the same params and query give the validator compiler one schema of each, however many", async (t) => {
  const few = await validatorSchemaObjects(t, 10);
  const many = await validatorSchemaObjects(t, 200);

  assert.equal(few.size, 2);
  assert.equal(many.size, 2);
  for (const schema of many) {
    assert.ok(Object.isFrozen(schema));
  }
});

test("routes sharing one validation schema each still refuse what it refuses", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  registerRoutes(app, {
    routes: ["/first/:recordId", "/second/:recordId"].map((path) => ({
      method: "GET",
      path,
      ...resolveRouteValidatorOptions({ method: "GET", path, options: { params: recordIdParamsValidator } }),
      middleware: [],
      handler: async (_request, reply) => reply.send({ ok: true })
    })),
    actions: { execute() {} }
  });

  for (const path of ["/first", "/second"]) {
    assert.equal((await app.inject({ method: "GET", url: `${path}/007` })).statusCode, 400);
    assert.equal((await app.inject({ method: "GET", url: `${path}/7` })).statusCode, 200);
  }
});

const notFoundSchema = deepFreeze({
  type: "object",
  required: ["error"],
  properties: { error: { type: "string", minLength: 1 } }
});

// Fastify's own serializer writes `type: "object"` into this root, so it cannot be shared frozen.
const untypedConflictSchema = deepFreeze({ required: ["error"], properties: { error: { type: "string" } } });

function responseRoutes(count) {
  return Array.from({ length: count }, (_, index) => {
    const path = `/records-${index}`;
    return {
      method: "GET",
      path,
      middleware: [],
      ...resolveRouteValidatorOptions({ method: "GET", path, options: { responses: {
        200: { transportSchema: { type: "object", properties: { ok: { type: "boolean" } } } },
        404: { transportSchema: notFoundSchema },
        409: { transportSchema: untypedConflictSchema }
      } } }),
      handler: async (_request, reply) => reply.code(404).send({ error: "Not found.", internal: "hidden" })
    };
  });
}

test("routes sharing a response schema frozen all the way down give the serializer compiler that one object", async (t) => {
  const schemas = { 200: new Set(), 404: new Set(), 409: new Set() };
  const app = Fastify({
    schemaController: {
      compilersFactory: {
        buildSerializer: () => ({ schema, httpStatus }) => {
          schemas[httpStatus].add(schema);
          return JSON.stringify;
        }
      }
    }
  });
  t.after(() => app.close());
  registerRoutes(app, { routes: responseRoutes(50), actions: { execute() {} } });
  await app.ready();

  assert.equal(schemas[404].size, 1);
  assert.ok(Object.isFrozen([...schemas[404]][0]));
  assert.deepEqual([...schemas[404]][0], notFoundSchema);
  // A schema that can change, or that Fastify's serializer would change, is still each route's own copy.
  assert.equal(schemas[200].size, 50);
  assert.equal(schemas[409].size, 50);
});

test("shared and frozen response schemas still serialize as they describe with Fastify's own serializer", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  registerRoutes(app, { routes: responseRoutes(2), actions: { execute() {} } });

  for (const path of ["/records-0", "/records-1"]) {
    const response = await app.inject({ method: "GET", url: path });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: "Not found." });
  }
});
