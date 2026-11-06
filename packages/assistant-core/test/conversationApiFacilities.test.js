import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createConversationRuntime, createFileConversationStorage, createMemoryConversationStorage } from "../src/server/conversation/index.js";

test("API configuration rejects unsupported structured output before resolving an account or sending", async t => {
  let resolved = 0;
  const runtime = createConversationRuntime({ storage: createMemoryConversationStorage(), authorize: () => true,
    apiClientFactory: { resolveClient() { resolved++; assert.fail("Unsupported structured output cannot start inference"); } } });
  t.after(() => runtime.close());
  const configuration = { systemPrompt: "Use the supplied instructions" };
  await assert.rejects(runtime.open({ id: "unsupported", configuration: { ...configuration,
    outputSchema: { type: "string", maxLength: 16 } } }), /API does not support structured output/);
  assert.equal(resolved, 0);
  const ordinary = await runtime.open({ id: "ordinary", configuration });
  assert.equal(ordinary.capabilities.structuredOutput, false);
  await assert.rejects(ordinary.configure({ outputSchema: { type: "string", maxLength: 16 } }), /API does not support structured output/);
  assert.deepEqual((await ordinary.read()).configuration, configuration);
  assert.equal(resolved, 0);
});

test("an existing API client keeps opaque receipts path-safe and selected history private without replacing canonical history", async t => {
  const directory = await mkdtemp(join(tmpdir(), "conversation-api-client-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [], resolvedAttachments = [];
  const context = { subjectId: "owner", history: [
    { role: "user", content: "Selected prior context", attachmentIds: ["historical"] },
    { role: "assistant", content: "Selected prior response" }
  ] };
  const runtime = createConversationRuntime({
    storage: createFileConversationStorage({ directory }),
    authorize: ({ context }) => context.subjectId === "owner",
    apiHistory: ({ context }) => context.history,
    apiClientFactory: { resolveClient({ context: actor, configuration }) {
      assert.equal(actor, context);
      assert.equal(configuration.integrationId, undefined, "Existing environment clients need no fabricated integration ID");
      // An existing client supplies its AI SDK model; this one speaks the OpenAI chat format.
      return { enabled: true, defaultModel: "existing-model", model: createOpenAICompatible({ name: "existing", baseURL: "http://test.invalid/v1",
        fetch: async (_url, request) => {
          requests.push(JSON.parse(request.body).messages);
          return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: " A complete answer. " } }] })}\n\n` +
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`, { headers: { "content-type": "text/event-stream" } });
        } })("existing-model") };
    } },
    attachments: { async resolve({ attachmentIds, context: actor, conversationId }) {
      assert.equal(actor, context);
      assert.equal(conversationId, "sql/conversation");
      resolvedAttachments.push([...attachmentIds]);
      return { attachments: attachmentIds.map(attachmentId => ({ attachmentId, fileName: `${attachmentId}.txt`, size: 12 })),
        content: attachmentIds.map(attachmentId => ({ type: "text", text: `Authorized ${attachmentId} bytes` })) };
    } }
  });
  t.after(() => runtime.close());
  const conversation = await runtime.open({ id: "sql/conversation", context,
    configuration: { systemPrompt: "Existing instructions", model: "existing-model" } });
  const messageId = "../invoice/42:follow-up";
  assert.equal((await conversation.send({ messageId, text: "Current question", attachmentIds: ["current"] })).messageId, messageId);
  const first = await conversation.wait();
  assert.equal(first.conversationLog[0].user.messageId, messageId);
  assert.equal(first.conversationLog[0].assistant.text, "A complete answer.", "The engine's reply has no whitespace at its ends");
  assert.deepEqual(resolvedAttachments, [["current"], ["historical"]]);
  assert.deepEqual(requests[0][1], { role: "user", content: [
    { type: "text", text: "Selected prior context" }, { type: "text", text: "Authorized historical bytes" }
  ] });
  assert.deepEqual(requests[0].at(-2), { role: "user", content: [
    { type: "text", text: "Current question" }, { type: "text", text: "Authorized current bytes" }
  ] });
  const files = await readdir(directory);
  assert.equal(files.length, 1);
  assert.match(files[0], /^[a-f0-9]{64}\.json$/);
  const persisted = await readFile(join(directory, files[0]), "utf8");
  assert.match(persisted, /invoice\/42:follow-up/);
  assert.doesNotMatch(persisted, /Selected prior|Authorized .* bytes/);

  context.history = undefined;
  await conversation.send({ messageId: "next", text: "Use canonical history" });
  await conversation.wait();
  assert.equal(requests[1].some(message => Array.isArray(message.content) && message.content[0]?.text === "Current question"), true);
  assert.equal(requests[1].some(message => message.content === "Selected prior response"), false);

  context.history = [];
  await conversation.send({ messageId: "empty-context", text: "No prior model context" });
  const last = await conversation.wait();
  assert.equal(requests[2][0].content, "Existing instructions");
  assert.deepEqual(requests[2].slice(1, -1).map(message => message.content), ["No prior model context"]);
  assert.match(requests[2].at(-1).content, /^Current state, from the system\./u, "The engine's state note follows the conversation");
  assert.equal(last.conversationLog.length, 3, "Explicitly empty model context never removes saved conversation history");
  await assert.rejects(conversation.send({ messageId: "x".repeat(129), text: "Must not dispatch" }), { code: "conversation_invalid_message" });
  assert.equal(requests.length, 3);
});
