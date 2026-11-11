import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createConversationRuntime, createMemoryConversationStorage } from "@jskit-ai/assistant-core/server/conversation";
import { createSurfaceAwareToolCatalog } from "../src/server/support/createSurfaceAwareToolCatalog.js";

// An assistant on an API model that proposes a whole document in one application tool call, and reads one back.
const KIB = 1024;
const SURFACES = ["writer", "planner", "reader", "home"];
const appConfig = { assistantServer: { writer: { maxToolArgumentBytes: 64 * KIB }, planner: { maxToolArgumentBytes: 256 * KIB },
  reader: { maxToolResultBytes: 96 * KIB }, home: {} } };
const frame = (delta, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const stream = body => new Response(body, { headers: { "content-type": "text/event-stream" } });
/** A document whose JSON is `bytes` bytes: {"text":"…"} is 11 bytes around the text. */
function documentOf(bytes) {
  const document = { text: "x".repeat(bytes - 11) };
  assert.equal(Buffer.byteLength(JSON.stringify(document)), bytes);
  return document;
}

/**
 * On `surface`, the model calls `actionId` once with `input`, then answers. documents.read answers
 * a document of `resultBytes` bytes. Returns the turn, what the actions received and the model's requests.
 */
async function converse(t, surface, actionId, input, { resultBytes = 0 } = {}) {
  const received = [];
  const text = createSchema({ text: { type: "string", required: true } });
  const action = { version: 1, channels: ["automation"], surfaces: SURFACES, permission: { require: "authenticated" } };
  const actions = createActionCatalogue();
  actions.register({ contributorId: "test.documents", domain: "test", actions: [{
    ...action, id: "documents.propose", kind: "command", input: { schema: text, mode: "replace" },
    output: { schema: createSchema({ length: { type: "number", required: true } }), mode: "replace" },
    execute: async ({ text: proposed }) => { received.push(proposed.length); return { length: proposed.length }; }
  }, {
    ...action, id: "documents.read", kind: "query", input: { schema: createSchema({}), mode: "replace" }, output: { schema: text, mode: "replace" },
    execute: async () => { received.push("read"); return documentOf(resultBytes); }
  }] });
  const toolCatalog = createSurfaceAwareToolCatalog(actions, { appConfig });
  const context = { actor: { id: "owner" }, surface, applicationId: "test", subjectId: "owner" };
  const name = toolCatalog.resolveToolSet(context).tools.find(tool => tool.actionId === actionId).name;
  const requests = [];
  const runtime = createConversationRuntime({ storage: createMemoryConversationStorage(), toolCatalog, authorize: () => true,
    connections: { resolve: async () => ({ providerId: "test", model: "test-model", sdkPackage: "@ai-sdk/openai-compatible",
      apiKey: "test", baseURL: "http://test.invalid/v1" }) },
    async fetch(_url, request) {
      const body = JSON.parse(request.body);
      // A check of the reply's claims, when the engine makes one, finds none unsupported.
      if (!body.stream) return Response.json({ id: "check", object: "chat.completion", created: 0, model: "test-model",
        choices: [{ index: 0, message: { role: "assistant", content: '{"unsupported": []}' }, finish_reason: "stop" }] });
      requests.push(body);
      return stream(requests.length === 1
        ? frame({ tool_calls: [{ index: 0, id: "call", type: "function", function: { name, arguments: JSON.stringify(input) } }] }) + frame({}, "tool_calls")
        : frame({ content: "Here it is." }) + frame({}, "stop"));
    } });
  t.after(() => runtime.close());
  const conversation = await runtime.open({ id: "document", context, configuration: { systemPrompt: "Work on documents.", integrationId: "assistant" } });
  await conversation.send({ messageId: "ask", text: "Work on the document." });
  const result = await conversation.wait();
  const toolMessage = requests[1]?.messages.find(message => message.role === "tool");
  return { result, received, modelSaw: toolMessage && JSON.parse(toolMessage.content) };
}

test("an API conversation's tool call is held to its surface's maxToolArgumentBytes", async t => {
  const writer = await converse(t, "writer", "documents.propose", documentOf(40 * KIB));
  assert.equal(writer.result.error, "");
  assert.equal(writer.result.conversationLog[0].metadata.runtime.status, "complete");
  assert.deepEqual(writer.received, [40 * KIB - 11]);
  assert.equal(writer.result.conversationLog[0].metadata.applicationTools[0].arguments.length, 40 * KIB);

  const home = await converse(t, "home", "documents.propose", documentOf(40 * KIB));
  assert.equal(home.result.error, "The application tool arguments exceed their size limit.");
  assert.deepEqual(home.received, [], "Over the default 32 KiB the action never runs");
});

test("a 128 KiB tool call passes end to end on a surface that allows it, and one over its limit fails the same way", async t => {
  const fits = await converse(t, "planner", "documents.propose", documentOf(128 * KIB));
  assert.equal(fits.result.error, "");
  assert.deepEqual(fits.received, [128 * KIB - 11]);

  const over = await converse(t, "planner", "documents.propose", documentOf(256 * KIB + 1));
  assert.equal(over.result.error, "The application tool arguments exceed their size limit.");
  assert.deepEqual(over.received, []);
});

test("a 67 KiB document read back reaches the model on a surface whose maxToolResultBytes allows it, and only the error does elsewhere", async t => {
  const reader = await converse(t, "reader", "documents.read", {}, { resultBytes: 67 * KIB });
  assert.equal(reader.result.error, "");
  assert.equal(reader.result.conversationLog[0].metadata.applicationTools[0].result.ok, true);
  assert.equal(reader.modelSaw.text.length, 67 * KIB - 11, "The model reads the whole document");

  const home = await converse(t, "home", "documents.read", {}, { resultBytes: 67 * KIB });
  assert.equal(home.result.error, "", "The turn carries on with the error in the document's place");
  assert.deepEqual(home.received, ["read"]);
  assert.equal(home.result.conversationLog[0].metadata.applicationTools[0].result.error.code, "assistant_tool_result_too_large");
  assert.equal(home.modelSaw.error.code, "assistant_tool_result_too_large", "Over the default 48 KiB the model gets the error, not the document");

  const atLimit = await converse(t, "reader", "documents.read", {}, { resultBytes: 96 * KIB });
  assert.equal(atLimit.modelSaw.text.length, 96 * KIB - 11);
  const over = await converse(t, "reader", "documents.read", {}, { resultBytes: 96 * KIB + 1 });
  assert.equal(over.modelSaw.error.code, "assistant_tool_result_too_large");
});
