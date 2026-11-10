import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import Fastify from "fastify";
import SerializerSelector from "@fastify/fast-json-stringify-compiler";

import { registerApiErrorHandler } from "./errorHandling.js";
import { registerRoutes } from "./lib/routeRegistration.js";
import { createCachedResponseSerializerFactory } from "./responseSerializerFactory.js";

const countSchema = {
  type: "object",
  additionalProperties: false,
  required: ["count"],
  properties: { count: { anyOf: [{ type: "integer" }, { type: "null" }] } }
};

/**
 * A server whose route answers a count its response schema refuses when asked for `?refused=1`, with an `onError` hook
 * that takes a moment, as a logging or monitoring hook does.
 * @param {import("node:test").TestContext} t
 */
function createCountServer(t) {
  const logs = [];
  const app = Fastify({
    logger: { level: "error", stream: { write: (line) => logs.push(JSON.parse(line)) } },
    schemaController: {
      compilersFactory: { buildSerializer: createCachedResponseSerializerFactory(SerializerSelector()) }
    }
  });
  t.after(() => app.close());
  const failures = [];
  registerApiErrorHandler(app);
  app.addHook("onError", async (_request, _reply, error) => {
    await delay(5);
    failures.push(error);
  });
  registerRoutes(app, {
    routes: [{
      method: "GET",
      path: "/counts",
      middleware: [],
      schema: { response: { 200: countSchema } },
      handler: async (request, reply) => {
        reply.code(200).send({ count: request.query.refused ? "many" : 3 });
      }
    }],
    actions: { execute() {} }
  });
  return { app, logs, failures };
}

test("a response its serializer refuses answers 500, logged with its route, and the server keeps serving", async (t) => {
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  process.on("unhandledRejection", onRejection);
  t.after(() => process.off("unhandledRejection", onRejection));
  const { app, logs, failures } = createCountServer(t);

  const refused = await app.inject({ method: "GET", url: "/counts?refused=1" });
  assert.equal(refused.statusCode, 500);
  assert.deepEqual(refused.json(), { error: "Internal server error.", code: "internal_server_error", params: {} });
  await delay(50);
  assert.deepEqual(rejections, []);
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /does not match schema definition/);
  const logged = logs.filter((entry) => entry.msg === "Response serialization failed");
  assert.equal(logged.length, 1);
  assert.equal(logged[0].route, "GET /counts");
  assert.match(logged[0].err.message, /does not match schema definition/);

  for (let request = 0; request < 2; request++) {
    const served = await app.inject({ method: "GET", url: "/counts" });
    assert.equal(served.statusCode, 200);
    assert.equal(served.body, '{"count":3}');
  }
  assert.deepEqual(rejections, []);
});
