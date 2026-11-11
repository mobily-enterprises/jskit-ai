import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createConversationRuntime, createMemoryConversationStorage } from "@jskit-ai/assistant-core/server/conversation";
import { createSurfaceAwareToolCatalog } from "../src/server/support/createSurfaceAwareToolCatalog.js";

// An assistant that proposes a whole document in one application tool call, on an API model.
const KIB = 1024;
const appConfig = { assistantServer: { writer: { maxToolArgumentBytes: 64 * KIB }, planner: { maxToolArgumentBytes: 256 * KIB }, home: {} } };
const frame = (delta, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const stream = body => new Response(body, { headers: { "content-type": "text/event-stream" } });

/** The model proposes a document of `bytes` bytes of arguments on `surface`, then answers. */
async function proposeDocument(t, surface, bytes) {
  const lengths = [];
  const actions = createActionCatalogue();
  actions.register({ contributorId: "test.documents", domain: "test", actions: [{
    id: "documents.propose", version: 1, kind: "command", channels: ["automation"], surfaces: ["writer", "planner", "home"],
    permission: { require: "authenticated" },
    input: { schema: createSchema({ text: { type: "string", required: true } }), mode: "replace" },
    output: { schema: createSchema({ length: { type: "number", required: true } }), mode: "replace" },
    execute: async ({ text }) => { lengths.push(text.length); return { length: text.length }; }
  }] });
  const toolCatalog = createSurfaceAwareToolCatalog(actions, { appConfig });
  const context = { actor: { id: "owner" }, surface, applicationId: "test", subjectId: "owner" };
  const name = toolCatalog.resolveToolSet(context).tools[0].name;
  // {"text":"…"} is 11 bytes around the text.
  const argumentsText = JSON.stringify({ text: "x".repeat(bytes - 11) });
  assert.equal(Buffer.byteLength(argumentsText), bytes);
  let streamed = 0;
  const runtime = createConversationRuntime({ storage: createMemoryConversationStorage(), toolCatalog, authorize: () => true,
    connections: { resolve: async () => ({ providerId: "test", model: "test-model", sdkPackage: "@ai-sdk/openai-compatible",
      apiKey: "test", baseURL: "http://test.invalid/v1" }) },
    async fetch(_url, request) {
      const body = JSON.parse(request.body);
      // A check of the reply's claims, when the engine makes one, finds none unsupported.
      if (!body.stream) return Response.json({ id: "check", object: "chat.completion", created: 0, model: "test-model",
        choices: [{ index: 0, message: { role: "assistant", content: '{"unsupported": []}' }, finish_reason: "stop" }] });
      streamed += 1;
      return stream(streamed === 1
        ? frame({ tool_calls: [{ index: 0, id: "propose", type: "function", function: { name, arguments: argumentsText } }] }) + frame({}, "tool_calls")
        : frame({ content: "Here is the proposal." }) + frame({}, "stop"));
    } });
  t.after(() => runtime.close());
  const conversation = await runtime.open({ id: "proposal", context,
    configuration: { systemPrompt: "Propose documents.", integrationId: "assistant" } });
  await conversation.send({ messageId: "propose", text: "Propose a document." });
  return { result: await conversation.wait(), lengths };
}

test("an API conversation's tool call is held to its surface's maxToolArgumentBytes", async t => {
  const writer = await proposeDocument(t, "writer", 40 * KIB);
  assert.equal(writer.result.error, "");
  assert.equal(writer.result.conversationLog[0].metadata.runtime.status, "complete");
  assert.deepEqual(writer.lengths, [40 * KIB - 11]);
  assert.equal(writer.result.conversationLog[0].metadata.applicationTools[0].arguments.length, 40 * KIB);

  const home = await proposeDocument(t, "home", 40 * KIB);
  assert.equal(home.result.error, "The application tool arguments exceed their size limit.");
  assert.deepEqual(home.lengths, [], "Over the default 32 KiB the action never runs");
});

test("a 128 KiB tool call passes end to end on a surface that allows it, and one over its limit fails the same way", async t => {
  const fits = await proposeDocument(t, "planner", 128 * KIB);
  assert.equal(fits.result.error, "");
  assert.deepEqual(fits.lengths, [128 * KIB - 11]);

  const over = await proposeDocument(t, "planner", 256 * KIB + 1);
  assert.equal(over.result.error, "The application tool arguments exceed their size limit.");
  assert.deepEqual(over.lengths, []);
});
