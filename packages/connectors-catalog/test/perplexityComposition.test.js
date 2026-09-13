import test from "node:test";
import assert from "node:assert/strict";
import { createPerplexityAnswers } from "../patterns/ai-connections/example/perplexity-answer.js";

const config = { schemaVersion: 1, registrations: {}, integrations: { research: {
  provider: "perplexity", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:RESEARCH_KEY" }
} } };
const input = { context: { applicationId: "app", subjectId: "user" }, integrationId: "research", model: "sonar", question: "What does the source say?" };
test("Perplexity composition uses the saved slot for cited answers, streaming, cancellation and key rotation", async () => {
  let key = "fixture-first"; const calls = [];
  const result = { choices: [{ message: { content: "Answer [1]" } }], citations: ["https://example.test/source"], search_results: [{ url: "https://example.test/source" }], usage: { total_tokens: 10 } };
  const chunks = [{ choices: [{ delta: { content: "Answer" } }] }, { choices: [], citations: result.citations }];
  const answer = createPerplexityAnswers({ configuration: config, authorize: async owner => owner,
    resolveReference: async (ref, owner, slot) => { assert.equal(ref, "env:RESEARCH_KEY"); assert.equal(owner.applicationId, "app"); assert.equal(slot.integrationId, "research"); return key; },
    createClient: options => ({ chat: { completions: { create: async (body, request) => {
      calls.push({ options, body, request });
      return body.stream ? (async function* () { yield* chunks; })() : result;
    } } } }) });
  assert.deepEqual(await answer(input), result);
  assert.equal(calls[0].options.apiKey, key); assert.equal(calls[0].options.baseURL, "https://api.perplexity.ai"); assert.equal(calls[0].options.maxRetries, 0);
  assert.deepEqual(calls[0].body.messages, [{ role: "user", content: input.question }]);
  key = "fixture-rotated"; const controller = new AbortController(); const received = [];
  for await (const chunk of await answer({ ...input, stream: true, signal: controller.signal })) received.push(chunk);
  assert.deepEqual(received, chunks); assert.equal(calls[1].options.apiKey, key); assert.equal(calls[1].request.signal, controller.signal);
  controller.abort(); await assert.rejects(answer({ ...input, signal: controller.signal })); assert.equal(calls.length, 2);
});
test("Perplexity denies before secret lookup and never exposes missing or malformed bindings", async () => {
  let lookups = 0; let clients = 0;
  const options = { configuration: config, authorize: async () => null,
    resolveReference: async () => { lookups++; throw new Error("private-fixture-secret"); }, createClient: () => { clients++; } };
  await assert.rejects(createPerplexityAnswers(options)(input), { code: "connector_access_denied" });
  assert.equal(lookups, 0);
  const allowed = createPerplexityAnswers({ ...options, authorize: async owner => owner });
  await assert.rejects(allowed({ ...input, integrationId: "constructor" }), { code: "connector_not_found" });
  await assert.rejects(allowed({ ...input, question: "" }), { code: "connector_input_invalid" });
  await assert.rejects(allowed(input), error => error.code === "connector_binding_missing" && !String(error).includes("private-fixture-secret"));
  for (const key of ["", "MISSING", "bad\nkey"]) await assert.rejects(createPerplexityAnswers({ ...options, authorize: async owner => owner, resolveReference: async () => key })(input), { code: "connector_binding_missing" });
  assert.equal(clients, 0);
});
