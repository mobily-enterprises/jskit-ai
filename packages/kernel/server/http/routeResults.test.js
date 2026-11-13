import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import Fastify from "fastify";
import SerializerSelector from "@fastify/fast-json-stringify-compiler";

import { registerApiErrorHandler } from "./errorHandling.js";
import { createActionRouteScope } from "./lib/actionRouteScope.js";
import { registerRoutes } from "./lib/routeRegistration.js";
import { createRouter } from "./lib/router.js";
import { createCachedResponseSerializerFactory } from "./responseSerializerFactory.js";

const countSchema = {
  type: "object",
  additionalProperties: false,
  required: ["count"],
  properties: { count: { type: "integer" } }
};

/**
 * A server with routes that answer each way a handler can: returning its result, sending its reply, or both, and an
 * action route of the scope that returns its action's result. The actions answer the action id they ran. Its log keeps
 * every warning and error, and its onError hook takes a moment, as a logging or monitoring hook does.
 * @param {import("node:test").TestContext} t
 */
function createAnswersServer(t) {
  const logs = [];
  const app = Fastify({
    logger: { level: "warn", stream: { write: (line) => logs.push(JSON.parse(line)) } },
    schemaController: {
      compilersFactory: { buildSerializer: createCachedResponseSerializerFactory(SerializerSelector()) }
    }
  });
  t.after(() => app.close());
  registerApiErrorHandler(app);
  app.addHook("onError", async () => {
    await delay(5);
  });
  const router = createRouter();
  router.register("GET", "/api/returned", {}, async () => ({ answer: "returned" }));
  router.register("GET", "/api/sent", {}, async (_request, reply) => {
    reply.code(201).send({ answer: "sent" });
  });
  router.register("GET", "/api/sent-and-returned-reply", {}, async (_request, reply) => reply.code(202).send({ answer: "sent" }));
  router.register("GET", "/api/sent-then-returned", {}, async (_request, reply) => {
    reply.send({ answer: "sent" });
    return { answer: "returned" };
  });
  router.register("GET", "/api/nothing", {}, async () => undefined);
  createActionRouteScope({ router }, { relativePath: "/tools" }).actionRoute("POST", "/items", {
    actionId: "tools.items.create",
    buildInput: (request) => ({ ...request.body })
  });
  registerRoutes(app, {
    // Response schemas as the serializer compiles them: a returned result it refuses, and a sent one it refuses from a
    // handler that then returns another, as a handler does that sends and returns its result.
    routes: [...router.list(), ...[
      ["/api/refused-count", async () => ({ count: "many" })],
      ["/api/refused-sent-then-returned", async (_request, reply) => {
        reply.send({ count: "many" });
        return { count: 1 };
      }]
    ].map(([path, handler]) => ({ method: "GET", path, middleware: [], schema: { response: { 200: countSchema } }, handler }))],
    actions: {
      getDefinition: () => ({ kind: "command" }),
      execute: async ({ actionId, input }) => ({ ran: actionId, input })
    }
  });
  return { app, logs };
}

test("a handler that returns its result has it sent, an action route's included", async (t) => {
  const { app, logs } = createAnswersServer(t);
  const returned = await app.inject({ method: "GET", url: "/api/returned" });
  assert.equal(returned.statusCode, 200);
  assert.deepEqual(returned.json(), { answer: "returned" });
  const action = await app.inject({ method: "POST", url: "/api/tools/items", payload: { name: "Lamp" } });
  assert.equal(action.statusCode, 200);
  assert.deepEqual(action.json(), { ran: "tools.items.create", input: { name: "Lamp" } });
  assert.deepEqual(logs, []);
});

test("a handler that sends its reply keeps it, whatever it returns", async (t) => {
  const { app, logs } = createAnswersServer(t);
  const sent = await app.inject({ method: "GET", url: "/api/sent" });
  assert.equal(sent.statusCode, 201);
  assert.deepEqual(sent.json(), { answer: "sent" });
  const sentAndReturned = await app.inject({ method: "GET", url: "/api/sent-and-returned-reply" });
  assert.equal(sentAndReturned.statusCode, 202);
  assert.deepEqual(sentAndReturned.json(), { answer: "sent" });
  const sentThenReturned = await app.inject({ method: "GET", url: "/api/sent-then-returned" });
  assert.equal(sentThenReturned.statusCode, 200);
  assert.deepEqual(sentThenReturned.json(), { answer: "sent" });
  const nothing = await app.inject({ method: "GET", url: "/api/nothing" });
  assert.equal(nothing.statusCode, 200);
  assert.equal(nothing.body, "");
  // Nothing was sent twice: Fastify warns of a second send instead of refusing it.
  assert.deepEqual(logs.map((entry) => entry.err?.code ?? entry.msg), []);
});

test("a result its response schema refuses answers 500, returned or sent, and the server keeps serving", async (t) => {
  const { app, logs } = createAnswersServer(t);
  const returned = await app.inject({ method: "GET", url: "/api/refused-count" });
  assert.equal(returned.statusCode, 500);
  // The refused send is still finishing, its error hook waiting, when the handler returns: the reply is not yet sent,
  // and sending the returned result then is refused inside the hook (FST_ERR_SEND_INSIDE_ONERR).
  const sent = await app.inject({ method: "GET", url: "/api/refused-sent-then-returned" });
  assert.equal(sent.statusCode, 500);
  const next = await app.inject({ method: "GET", url: "/api/returned" });
  assert.deepEqual(next.json(), { answer: "returned" });
  // One log for each refusal, the serializer's, and nothing else.
  const codes = logs.map((entry) => entry.err?.code ?? entry.msg);
  assert.equal(logs.length, 2, codes.join(", "));
});
