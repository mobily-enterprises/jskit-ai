import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { registerApiRoutes } from "../server/fastify/registerApiRoutes.js";
import { buildRoutes as buildAiRoutes } from "../server/modules/ai/routes.js";
import { createSchema } from "../server/modules/ai/schema.js";

function createMissingHandler() {
  return async (_request, reply) => {
    reply.code(501).send({
      error: "missing"
    });
  };
}

test("ai route rejects malformed request body and accepts valid payload", async () => {
  const app = Fastify();
  const controllers = {
    ai: {
      async chatStream(_request, reply) {
        reply.code(200).send({
          type: "done",
          messageId: "message_1"
        });
      }
    }
  };

  registerApiRoutes(app, {
    controllers,
    routes: buildAiRoutes(controllers, {
      missingHandler: createMissingHandler()
    })
  });

  const invalid = await app.inject({
    method: "POST",
    url: "/api/workspace/ai/chat/stream",
    payload: {
      input: "hello"
    }
  });

  assert.equal(invalid.statusCode, 400);

  const valid = await app.inject({
    method: "POST",
    url: "/api/workspace/ai/chat/stream",
    payload: {
      messageId: "message_1",
      input: "hello"
    }
  });

  assert.equal(valid.statusCode, 200);
  await app.close();
});

test("ai schema publishes explicit stream event types and runtime-aligned limits", () => {
  const schema = createSchema({
    maxInputChars: 123,
    maxHistoryMessages: 7
  });

  assert.equal(schema.body.chatStream.properties.input.maxLength, 123);
  assert.equal(schema.body.chatStream.properties.history.maxItems, 7);

  const streamEventAnyOf = Array.isArray(schema.response.streamEvent.anyOf) ? schema.response.streamEvent.anyOf : [];
  const eventTypes = streamEventAnyOf
    .map((entry) => entry?.properties?.type?.const)
    .filter((value) => typeof value === "string")
    .sort();

  assert.deepEqual(eventTypes, [
    "assistant_delta",
    "assistant_message",
    "done",
    "error",
    "meta",
    "tool_call",
    "tool_result",
    "tool_result"
  ]);
});
