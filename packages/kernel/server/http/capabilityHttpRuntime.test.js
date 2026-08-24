import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import { createActionProvider } from "../actions/actionProvider.js";
import { createCapabilityRuntime } from "../../shared/capabilities/runtime.js";
import { defineFeature } from "../features/defineFeature.js";
import { HttpProvider } from "./HttpProvider.js";

function createFastifyStub() {
  return {
    routes: [],
    hooks: {},
    contentTypeParsers: new Map(),
    log: { error() {} },
    route(value) {
      this.routes.push(value);
    },
    addHook(name, handler) {
      this.hooks[name] = handler;
    },
    setErrorHandler(handler) {
      this.errorHandler = handler;
    },
    hasContentTypeParser(type) {
      return this.contentTypeParsers.has(type);
    },
    getDefaultJsonParser() {
      return (_request, body, done) => done(null, body);
    },
    addContentTypeParser(type, options, parser) {
      this.contentTypeParsers.set(type, { options, parser });
    }
  };
}

function createReply() {
  return {
    statusCode: 200,
    headers: {},
    code(value) {
      this.statusCode = value;
      return this;
    },
    header(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    hasHeader(name) {
      return Object.hasOwn(this.headers, name.toLowerCase());
    },
    send(value) {
      this.payload = value;
      return this;
    }
  };
}

test("HttpProvider registers routes that invoke actions directly", async () => {
  const fastify = createFastifyStub();
  const feature = defineFeature({
    id: "feature.http-proof",
    domain: "http-proof",
    requires: { http: "runtime.http" },
    setup({ http }) {
      http.router.get("/proof", {
        surface: "app",
        visibility: "public"
      }, async (request, reply) => {
        const result = await request.executeAction({ actionId: "http-proof.read" });
        reply.code(200).send(result);
      });
      return {};
    },
    actions: [{
      id: "http-proof.read",
      kind: "query",
      channels: ["api"],
      surfaces: ["app"],
      input: { schema: createSchema({}) },
      idempotency: "none",
      async execute(_input, context) {
        return {
          channel: context.channel,
          surface: context.surface,
          visibility: context.visibilityContext.visibility,
          hasRequest: Boolean(context.requestMeta.request)
        };
      }
    }]
  });
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.fastify": fastify },
    providers: [createActionProvider(), HttpProvider, feature]
  });

  await runtime.start();
  assert.equal(fastify.routes.length, 1);
  assert.equal(fastify.routes[0].url, "/proof");

  const request = { id: "req-1", routeOptions: { config: fastify.routes[0].config } };
  const reply = createReply();
  await fastify.routes[0].handler(request, reply);

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.payload, {
    channel: "api",
    surface: "app",
    visibility: "public",
    hasRequest: true
  });
  assert.equal(Object.hasOwn(request, "scope"), false);
  await runtime.shutdown();
});

test("direct HTTP action execution preserves request-scoped stream dependencies", async () => {
  const fastify = createFastifyStub();
  const streamWriter = Object.freeze({ id: "writer-1" });
  const abortSignal = Object.freeze({ aborted: false });
  const feature = defineFeature({
    id: "feature.stream-proof",
    domain: "stream-proof",
    requires: { http: "runtime.http" },
    setup({ http }) {
      http.router.post("/stream-proof", { surface: "app", visibility: "public" }, async (request, reply) => {
        const result = await request.executeAction({
          actionId: "stream-proof.run",
          deps: { streamWriter, abortSignal }
        });
        reply.code(200).send(result);
      });
      return {};
    },
    actions: [{
      id: "stream-proof.run",
      kind: "stream",
      channels: ["api"],
      surfaces: ["app"],
      input: { schema: createSchema({}) },
      idempotency: "none",
      async execute(_input, _context, deps) {
        return {
          writerId: deps.streamWriter.id,
          aborted: deps.abortSignal.aborted
        };
      }
    }]
  });
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.fastify": fastify },
    providers: [createActionProvider(), HttpProvider, feature]
  });

  await runtime.start();
  const request = { routeOptions: { config: fastify.routes[0].config } };
  const reply = createReply();
  await fastify.routes[0].handler(request, reply);

  assert.deepEqual(reply.payload, { writerId: "writer-1", aborted: false });
  await runtime.shutdown();
});
